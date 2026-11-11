"""
features.py — turn a waveform into musical features (tempo, beats, chroma, key).

BEGINNER NOTE:
A "chroma" vector is 12 numbers describing how much of each note class
(C, C#, D … B) is sounding in a slice of time. Almost all harmony
analysis in this app is built on top of it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.audio.theory import KS_MAJOR, KS_MINOR, TEMPERLEY_MAJOR, TEMPERLEY_MINOR, pc_name


@dataclass
class Features:
    y: np.ndarray
    sr: int
    duration: float

    y_harmonic: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float32))
    y_percussive: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float32))

    tempo: float = 0.0
    beat_times: np.ndarray = field(default_factory=lambda: np.zeros(0))
    downbeat_times: np.ndarray = field(default_factory=lambda: np.zeros(0))
    beats_per_bar: int = 4

    chroma: np.ndarray = field(default_factory=lambda: np.zeros((12, 0)))     # (12, frames)
    chroma_times: np.ndarray = field(default_factory=lambda: np.zeros(0))
    beat_chroma: np.ndarray = field(default_factory=lambda: np.zeros((12, 0)))  # (12, beats)
    bass_chroma: np.ndarray = field(default_factory=lambda: np.zeros((12, 0)))  # (12, beats)

    key_pc: int = 0
    key_is_minor: bool = False
    key_confidence: float = 0.0
    key_scores: list[dict] = field(default_factory=list)

    rms: np.ndarray = field(default_factory=lambda: np.zeros(0))
    rms_times: np.ndarray = field(default_factory=lambda: np.zeros(0))

    @property
    def key_name(self) -> str:
        return f"{pc_name(self.key_pc, self.key_is_minor and self.key_pc in (1, 3, 6, 8, 10))}" + (
            " minor" if self.key_is_minor else " major")


def _safe(fn, default):
    try:
        return fn()
    except Exception:  # noqa: BLE001 - feature extraction must never hard-crash a job
        return default


def extract(y: np.ndarray, sr: int) -> Features:
    import librosa

    duration = float(len(y)) / float(sr)
    f = Features(y=np.asarray(y, dtype=np.float32), sr=sr, duration=duration)

    # ── 1. Harmonic / percussive separation (HPSS) ───────────────
    # Chords live in the harmonic part; drums in the percussive part.
    def hpss():
        return librosa.effects.hpss(f.y, margin=(1.0, 5.0))
    got = _safe(hpss, None)
    if got is not None:
        f.y_harmonic = np.asarray(got[0], dtype=np.float32)
        f.y_percussive = np.asarray(got[1], dtype=np.float32)
    else:
        f.y_harmonic = f.y.copy()
        f.y_percussive = np.zeros_like(f.y)

    # ── 2. Tempo + beats ────────────────────────────────────────
    def tempo_beats():
        # start_bpm hint keeps the tracker from locking onto half/double time
        tempo, beats = librosa.beat.beat_track(
            y=f.y_percussive if f.y_percussive.any() else f.y, sr=sr, units="time", start_bpm=110.0
        )
        tempo = float(np.atleast_1d(tempo)[0])
        beats = np.asarray(beats, dtype=float)
        beats = beats[(beats >= 0) & (beats <= duration)]
        # guard against absurd tempos
        while tempo > 220 and tempo / 2 >= 50:
            tempo /= 2.0
        while tempo < 45 and tempo * 2 <= 220:
            tempo *= 2.0
        return tempo, beats
    f.tempo, f.beat_times = _safe(tempo_beats, (0.0, np.zeros(0)))
    if f.beat_times.size < 2:
        # No usable beat grid -> build a synthetic one from onset density.
        f.beat_times = np.arange(0.0, duration, 0.5)
        if f.tempo <= 0:
            f.tempo = 120.0

    # ── 3. Chroma (CQT-based, from the harmonic component) ──────
    # CQT chroma handles guitar timbre far better than STFT chroma.
    def chroma_cqt():
        hop = 512
        c = librosa.feature.chroma_cqt(
            y=f.y_harmonic if f.y_harmonic.any() else f.y,
            sr=sr, hop_length=hop, bins_per_octave=36, n_octaves=7,
            fmin=librosa.note_to_hz("C1"), cqt_mode="full",
        )
        times = librosa.frames_to_time(np.arange(c.shape[1]), sr=sr, hop_length=hop)
        return c, times, hop
    got = _safe(chroma_cqt, None)
    if got is None:  # last resort: STFT chroma
        hop = 512
        c = librosa.feature.chroma_stft(y=f.y, sr=sr, hop_length=hop)
        times = librosa.frames_to_time(np.arange(c.shape[1]), sr=sr, hop_length=hop)
        got = (c, times, hop)
    f.chroma, f.chroma_times, _ = got
    f.chroma = np.asarray(f.chroma, dtype=np.float32)

    # ── 4. Bass chroma (low two octaves only) ──────────────────
    def bass():
        hop = 512
        # Bass register of a guitar / bass guitar: C2 (65 Hz) up to C4 (262 Hz).
        # (The old range started at C1, which is below the guitar entirely and
        #  picked up kick-drum rumble instead of the actual bass note.)
        C = np.abs(librosa.cqt(y=f.y, sr=sr, hop_length=hop, fmin=librosa.note_to_hz("C2"),
                               n_bins=48, bins_per_octave=24))
        pcs = np.zeros((12, C.shape[1]), dtype=np.float32)
        for i in range(C.shape[0]):
            pcs[i % 12] += C[i]
        return pcs
    f.bass_chroma_frames = _safe(bass, np.zeros((12, 1), dtype=np.float32))

    # ── 5. Beat-synchronised chroma (average each beat) ─────────
    def beat_sync():
        n = min(len(f.beat_times), 4000)
        beats = f.beat_times[:n]
        bc = np.zeros((12, len(beats)), dtype=np.float32)
        bbass = np.zeros((12, len(beats)), dtype=np.float32)
        frame_t = f.chroma_times
        for i in range(len(beats)):
            t0 = beats[i]
            t1 = beats[i + 1] if i + 1 < len(beats) else min(t0 + 60.0 / max(f.tempo, 30.0), duration)
            # analyse the middle of the beat: avoids smearing the transient
            a, b = t0 + 0.15 * (t1 - t0), t1 - 0.05 * (t1 - t0)
            idx = np.where((frame_t >= a) & (frame_t < max(b, a + 1e-3)))[0]
            if idx.size == 0:
                idx = np.array([int(np.argmin(np.abs(frame_t - t0)))])
            bc[:, i] = f.chroma[:, idx].mean(axis=1)
            bbass[:, i] = f.bass_chroma_frames[:, idx].mean(axis=1)
        return bc, bbass
    got = _safe(beat_sync, None)
    if got is None:
        n = f.chroma.shape[1]
        got = (f.chroma, np.zeros((12, n), dtype=np.float32))
    f.beat_chroma, f.beat_bass_chroma = got

    # ── 6. Global key ─────────────────────────────────────────
    f.key_pc, f.key_is_minor, f.key_confidence, f.key_scores = estimate_key(
        f.beat_chroma if f.beat_chroma.shape[1] else f.chroma
    )

    # ── 7. Meter / downbeats ──────────────────────────────────
    f.beats_per_bar, f.downbeat_times = estimate_meter(f)

    # ── 8. RMS envelope (used by the waveform + silence detection) ─
    def rms_env():
        hop = 512
        r = librosa.feature.rms(y=f.y, frame_length=2048, hop_length=hop)[0]
        t = librosa.frames_to_time(np.arange(len(r)), sr=sr, hop_length=hop)
        return r, t
    f.rms, f.rms_times = _safe(rms_env, (np.zeros(1), np.zeros(1)))

    return f


# ─────────────────────────────────────────────────────────────
# KEY ESTIMATION
# ─────────────────────────────────────────────────────────────

def _corr(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean()
    b = b - b.mean()
    denom = (np.linalg.norm(a) * np.linalg.norm(b))
    if denom < 1e-9:
        return 0.0
    return float(np.dot(a, b) / denom)


def estimate_key(chroma: np.ndarray) -> tuple[int, bool, float, list[dict]]:
    """
    Correlate the piece's overall chroma profile against major and minor
    key profiles (Krumhansl-Schmuckler + Temperley), then combine both votes.
    Returns (root_pc, is_minor, confidence 0..1, ranked list).
    """
    if chroma.size == 0 or not np.any(chroma):
        return 0, False, 0.0, []
    profile = np.asarray(chroma, dtype=np.float64)
    # duration-weighted average, loud frames count a bit more (log compression)
    profile = np.log1p(profile * 20.0).mean(axis=1)

    results = []
    for pc in range(12):
        for is_minor in (False, True):
            ks = np.roll(np.array(KS_MINOR if is_minor else KS_MAJOR), pc)
            tp = np.roll(np.array(TEMPERLEY_MINOR if is_minor else TEMPERLEY_MAJOR), pc)
            score = 0.5 * _corr(profile, ks) + 0.5 * _corr(profile, tp)
            results.append({"pc": pc, "minor": is_minor, "score": score})

    results.sort(key=lambda r: -r["score"])
    best = results[0]
    runner = results[1] if len(results) > 1 else {"score": best["score"] - 0.2}
    # relative-key ambiguity (C major vs A minor) is normal; margin tells us how sure we are
    margin = best["score"] - runner["score"]
    confidence = float(np.clip(0.30 + margin * 2.2, 0.05, 0.97))

    ranked = []
    for r in results[:6]:
        ranked.append({
            "key": pc_name(r["pc"], r["minor"] and r["pc"] in (1, 3, 6, 8, 10)) + (" minor" if r["minor"] else " major"),
            "root_pc": r["pc"],
            "is_minor": r["minor"],
            "score": round(float(r["score"]), 4),
        })
    return int(best["pc"]), bool(best["minor"]), confidence, ranked


# ─────────────────────────────────────────────────────────────
# METER / DOWNBEATS
# ─────────────────────────────────────────────────────────────

def estimate_meter(f: "Features") -> tuple[int, np.ndarray]:
    """
    Guess 3/4 vs 4/4 by testing which bar length makes beat-1 land on the
    biggest harmonic changes. Falls back to 4/4 (overwhelmingly common).
    """
    beats = f.beat_times
    bc = f.beat_chroma
    n = bc.shape[1]
    if n < 8:
        return 4, beats[::4] if len(beats) > 4 else beats[:1]

    best_len, best_score = 4, -1e9
    for bar_len in (4, 3, 2, 6):
        score = 0.0
        for phase in range(bar_len):
            s = 0.0
            cnt = 0
            for i in range(phase, n - 1, bar_len):
                d = float(np.linalg.norm(bc[:, i + 1] - bc[:, i]))
                s += d
                cnt += 1
            if cnt:
                score = max(score, s / cnt)  # strongest downbeat contrast wins
        # mild preference for 4/4 so we don't pick 3/4 on noise
        score += 0.0 if bar_len == 4 else -0.02
        if score > best_score:
            best_score, best_len = score, bar_len

    downbeats = beats[::best_len]
    return best_len, downbeats

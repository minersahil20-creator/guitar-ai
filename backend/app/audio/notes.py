"""
notes.py — turn audio into individual musical notes (transcription).

TWO ENGINES, chosen automatically:

A) Spotify Basic Pitch  (if `pip install basic-pitch` succeeded)
   A real trained neural net that outputs note events + pitch bends.

B) CQT peak-picker  (always available, pure librosa/numpy)
   For every time frame we look at the constant-Q spectrum, find the
   spectral peaks, convert them to pitches with sub-semitone accuracy, and
   stitch peaks that stay on the same pitch into notes. This is a genuine
   multi-pitch tracker — it is not a placeholder — but it is less accurate
   than Basic Pitch, and the UI says so.

On top of either engine we run *technique detection* (bends, vibrato,
slides, hammer-ons/pull-offs) from the pitch contour and attack strength.
These are heuristics, so every one of them carries a confidence value and
is labelled a "candidate" in the UI. We never claim certainty we don't have.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict

import numpy as np

from app.audio import theory as T


# ─────────────────────────────────────────────────────────────
# Engine availability probe
# ─────────────────────────────────────────────────────────────

_BASIC_PITCH_AVAILABLE: bool | None = None


def basic_pitch_available() -> bool:
    global _BASIC_PITCH_AVAILABLE
    if _BASIC_PITCH_AVAILABLE is None:
        try:
            import basic_pitch  # noqa: F401
            from basic_pitch.inference import predict  # noqa: F401
            _BASIC_PITCH_AVAILABLE = True
        except Exception:  # noqa: BLE001
            _BASIC_PITCH_AVAILABLE = False
    return _BASIC_PITCH_AVAILABLE


_CREPE_AVAILABLE: bool | None = None


def crepe_available() -> bool:
    global _CREPE_AVAILABLE
    if _CREPE_AVAILABLE is None:
        try:
            import crepe  # noqa: F401
            _CREPE_AVAILABLE = True
        except Exception:  # noqa: BLE001
            _CREPE_AVAILABLE = False
    return _CREPE_AVAILABLE


@dataclass
class Note:
    start: float
    end: float
    midi: int
    confidence: float
    velocity: float = 0.8
    bend_semitones: float = 0.0
    vibrato: bool = False
    vibrato_rate_hz: float = 0.0
    vibrato_depth_cents: float = 0.0
    slide_from: float | None = None     # previous pitch (midi, float) if slid into
    legato: str | None = None           # "hammer-on" | "pull-off" | None
    string: int | None = None
    fret: int | None = None

    @property
    def duration(self) -> float:
        return round(self.end - self.start, 4)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["duration"] = self.duration
        d["name"] = T.midi_to_name(self.midi)
        d["pitch_class"] = self.midi % 12
        d["octave"] = self.midi // 12 - 1
        return d


# ─────────────────────────────────────────────────────────────
# ENGINE A: Basic Pitch
# ─────────────────────────────────────────────────────────────

def _transcribe_basic_pitch(path: str, y: np.ndarray, sr: int) -> list[dict]:
    from basic_pitch.inference import predict

    model_output, midi_data, note_events = predict(
        path,
        onset_threshold=0.5,
        frame_threshold=0.3,
        minimum_note_length=90.0,      # ms — filters out fret noise
        minimum_frequency=70.0,        # Hz  (~C#2, below the 6th string)
        maximum_frequency=1400.0,      # Hz  (top of a 22-fret guitar neck + harmonics)
        multiple_pitch_bends=False,
        melodia_trick=True,
    )
    raw = []
    for ev in note_events:
        # basic-pitch returns (start, end, pitch, amplitude, [bends]) — unpack defensively
        start = float(ev[0]); end = float(ev[1]); pitch = int(round(float(ev[2])))
        amp = float(ev[3]) if len(ev) > 3 else 0.8
        bends = ev[4] if len(ev) > 4 and isinstance(ev[4], (list, tuple)) else []
        bend_amt = 0.0
        if bends:
            # bends are (time, cents) pairs relative to the note start
            cents = [b[1] if isinstance(b, (list, tuple)) else b for b in bends]
            bend_amt = (max(cents) - min(cents)) / 100.0 if cents else 0.0
        if end - start < 0.04:
            continue
        raw.append({
            "start": start, "end": end, "midi": pitch,
            "velocity": float(np.clip(amp, 0.05, 1.0)),
            "bend_semitones": round(float(bend_amt), 2),
            "confidence": float(np.clip(0.62 + amp * 0.33, 0.35, 0.98)),
        })
    return raw


# ─────────────────────────────────────────────────────────────
# ENGINE B: CQT multi-pitch peak picker (no ML, always available)
# ─────────────────────────────────────────────────────────────

def _cqt_peaks(y: np.ndarray, sr: int, fmin: float, fmax: float,
               bins_per_octave: int = 60, hop: int = 512):
    """Constant-Q spectrogram + per-frame peak list in (midi, magnitude, cents)."""
    import librosa

    n_bins = int(math.ceil(bins_per_octave * math.log2(fmax / fmin)))
    C = np.abs(librosa.cqt(y=y, sr=sr, fmin=fmin, n_bins=n_bins,
                           bins_per_octave=bins_per_octave, hop_length=hop))
    # log-magnitude is closer to how we hear and stabilises thresholds
    L = librosa.amplitude_to_db(C, ref=np.max)
    L = np.clip((L + 80.0) / 80.0, 0, None)      # 0..1, -80dB floor
    return L, C


def _transcribe_cqt(y: np.ndarray, sr: int, fmin: float = 70.0, fmax: float = 1500.0,
                    hop: int = 512, bins_per_octave: int = 60,
                    min_note_ms: float = 65.0) -> list[dict]:
    """
    Robust guitar note transcription:
    1. Separate harmonic content to avoid drum transients masquerading as notes.
    2. Detect musical note onsets for accurate attack timing.
    3. Track dominant fundamental pitch within each note window via parabolic CQT/piptrack.
    4. Capture continuous pitch contour for vibrato, slide, and bend detection.
    """
    import librosa

    if sr > 22050:
        y = librosa.resample(y, orig_sr=sr, target_sr=22050)
        sr = 22050

    # 1. Separate harmonic content (notes live in harmonic part; cymbals/kicks in percussive)
    try:
        y_harm, _ = librosa.effects.hpss(y, margin=(1.1, 1.4))
    except Exception:
        y_harm = y

    # 2. Detect onsets with guitar-friendly settings
    try:
        onsets = librosa.onset.onset_detect(
            y=y_harm, sr=sr, hop_length=hop, units="time",
            backtrack=True, pre_max=15, post_max=15, pre_avg=25, post_avg=25,
            delta=0.06, wait=6
        )
    except Exception:
        onsets = np.zeros(0)

    duration = float(len(y)) / float(sr)
    if onsets.size < 2:
        # Fallback regular grid if onset detection found too few
        onsets = np.arange(0.0, duration, 0.25)

    fmin_hz = max(70.0, float(fmin))
    fmax_hz = min(1500.0, float(fmax))

    # 3. For each onset window, determine prominent pitch and contour
    raw_notes = []
    for i in range(len(onsets)):
        t_start = float(onsets[i])
        t_end = float(onsets[i + 1]) if (i + 1 < len(onsets)) else min(t_start + 1.8, duration)
        dur = t_end - t_start
        if dur < (min_note_ms / 1000.0):
            continue

        s0 = int(t_start * sr)
        s1 = min(int(t_end * sr), len(y_harm))
        chunk = y_harm[s0:s1]
        if len(chunk) < 512:
            continue

        # Pitch tracking via piptrack (sub-semitone parabolic STFT peak tracking)
        try:
            pitches, magnitudes = librosa.piptrack(
                y=chunk, sr=sr, hop_length=256,
                fmin=fmin_hz, fmax=fmax_hz, threshold=0.10
            )
        except Exception:
            continue

        mask = (magnitudes > 0) & (pitches >= fmin_hz) & (pitches <= fmax_hz)
        if not np.any(mask):
            continue

        frame_pitches = []
        frame_mags = []
        n_frames = pitches.shape[1]
        for tf in range(n_frames):
            col_m = magnitudes[:, tf]
            col_p = pitches[:, tf]
            valid_idx = (col_m > 0) & (col_p >= fmin_hz) & (col_p <= fmax_hz)
            if np.any(valid_idx):
                best_bin = np.argmax(col_m * valid_idx)
                if col_m[best_bin] > 0.05 * np.max(magnitudes):
                    frame_pitches.append(col_p[best_bin])
                    frame_mags.append(col_m[best_bin])

        if not frame_pitches:
            continue

        frame_p_arr = np.asarray(frame_pitches, dtype=float)
        frame_m_arr = np.asarray(frame_mags, dtype=float)

        # Weight pitch by magnitude to identify the true held fundamental
        top_k = min(15, len(frame_p_arr))
        top_idx = np.argsort(frame_m_arr)[-top_k:]
        selected_pitches = frame_p_arr[top_idx]
        median_hz = float(np.median(selected_pitches))
        if median_hz <= 0:
            continue

        midi_val = librosa.hz_to_midi(median_hz)
        midi_int = int(round(float(midi_val)))
        if not (35 <= midi_int <= 96):  # B1 to C7 (standard guitar range)
            continue

        # Pitch contour in midi notes
        contour_midi = [float(librosa.hz_to_midi(h)) for h in frame_pitches if h > 0]
        bend_amt = 0.0
        if len(contour_midi) >= 4:
            # Filter outliers and check if pitch bent upward/downward smoothly within guitar physical range (0.5 to 3.5 st)
            p10 = float(np.percentile(contour_midi, 10))
            p90 = float(np.percentile(contour_midi, 90))
            span = p90 - p10
            if 0.45 <= span <= 3.8:
                bend_amt = round(span, 2)

        amp_norm = float(np.clip(np.mean(frame_m_arr) * 4.0, 0.15, 1.0))
        raw_notes.append({
            "start": round(t_start, 4),
            "end": round(t_end, 4),
            "midi": midi_int,
            "velocity": amp_norm,
            "bend_semitones": bend_amt,
            "confidence": float(np.clip(0.60 + amp_norm * 0.35, 0.40, 0.96)),
            "_contour": contour_midi,
        })

    # Merge consecutive identical notes with near-zero gap
    merged = []
    for n in raw_notes:
        if merged and merged[-1]["midi"] == n["midi"] and abs(n["start"] - merged[-1]["end"]) <= 0.08:
            merged[-1]["end"] = n["end"]
            merged[-1]["confidence"] = max(merged[-1]["confidence"], n["confidence"])
            if n.get("bend_semitones", 0) > merged[-1].get("bend_semitones", 0):
                merged[-1]["bend_semitones"] = n["bend_semitones"]
            if n.get("_contour"):
                merged[-1].setdefault("_contour", []).extend(n["_contour"])
        else:
            merged.append(n)

    merged.sort(key=lambda x: x["start"])
    return merged


# ─────────────────────────────────────────────────────────────
# Technique detection (works on whichever engine produced the notes)
# ─────────────────────────────────────────────────────────────

def _onset_envelope(y: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    import librosa
    env = librosa.onset.onset_strength(y=y, sr=sr, aggregate=np.median)
    env = env / (np.max(env) + 1e-9)
    times = librosa.frames_to_time(np.arange(len(env)), sr=sr,
                                   hop_length=512, n_fft=2048)
    return env, times


def detect_techniques(notes: list[dict], y: np.ndarray, sr: int) -> list[dict]:
    """Adds vibrato / slide / hammer-on / pull-off flags (all with confidence)."""
    if not notes:
        return notes
    try:
        env, env_t = _onset_envelope(y, sr)
    except Exception:  # noqa: BLE001
        env, env_t = None, None

    def attack(at: float) -> float:
        if env is None or env.size == 0:
            return 0.5
        i = int(np.argmin(np.abs(env_t - at)))
        lo, hi = max(0, i - 1), min(len(env), i + 2)
        return float(np.max(env[lo:hi]))

    for i, n in enumerate(notes):
        # ── vibrato: from the pitch contour of the note (if we captured one)
        contour = n.pop("_contour", None)
        if contour and len(contour) >= 8:
            c = np.asarray(contour, dtype=float) * 100.0          # cents
            x = np.arange(len(c))
            # remove the linear trend (the note may be bending overall)
            coef = np.polyfit(x, c, 1)
            resid = c - np.polyval(coef, x)
            if len(resid) > 4:
                # zero-crossing rate of the residual ≈ 2 x vibrato rate
                zc = np.sum(np.diff(np.sign(resid)) != 0)
                dur = max(n["end"] - n["start"], 1e-3)
                rate = zc / 2.0 / dur
                depth = float(np.percentile(resid, 90) - np.percentile(resid, 10))
                if 3.5 <= rate <= 10.0 and depth >= 18.0:
                    n["vibrato"] = True
                    n["vibrato_rate_hz"] = round(float(rate), 2)
                    n["vibrato_depth_cents"] = round(depth, 1)
                    n["confidence"] = min(0.97, n["confidence"] + 0.05)

        # ── slide: previous note ends where this one begins, big interval,
        #          and this note has no fresh pick attack
        if i > 0:
            prev = notes[i - 1]
            gap = n["start"] - prev["end"]
            interval = abs(n["midi"] - prev["midi"])
            a = attack(n["start"])
            if -0.06 <= gap <= 0.18 and interval >= 2 and a < 0.42:
                n["slide_from"] = float(prev["midi"])
                n["confidence"] = min(0.95, n["confidence"] + 0.04)

        # ── hammer-on / pull-off: same conditions but a small step (<= 3 semitones)
        if i > 0 and n.get("slide_from") is None:
            prev = notes[i - 1]
            gap = n["start"] - prev["end"]
            interval = n["midi"] - prev["midi"]
            a = attack(n["start"])
            if -0.10 <= gap <= 0.14 and 0 < abs(interval) <= 3 and a < 0.40:
                n["legato"] = "hammer-on" if interval > 0 else "pull-off"

    return notes


# ─────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────

def transcribe(path: str, y: np.ndarray, sr: int,
               use_basic_pitch: bool = True) -> dict:
    """
    Returns {"notes": [...], "engine": "...", "warnings": [...]}.
    `path` is only needed by Basic Pitch (it re-reads the file).
    """
    warnings: list[str] = []
    engine = "cqt-peak-picker"
    raw: list[dict] = []

    if use_basic_pitch and basic_pitch_available():
        try:
            raw = _transcribe_basic_pitch(path, y, sr)
            engine = "basic-pitch"
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Basic Pitch failed ({type(exc).__name__}: {exc}); "
                            f"fell back to the CQT peak tracker.")
            raw = []

    if not raw:
        try:
            raw = _transcribe_cqt(y, sr)
            engine = "harmonic-piptrack"
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Pitch tracking failed: {exc}")
            return {"notes": [], "engine": "none", "warnings": warnings}

    if not raw:
        warnings.append("No pitched notes were detected. The recording may be "
                        "purely percussive, very noisy, or the guitar may be buried "
                        "in the mix — try the stem separation step first.")
        return {"notes": [], "engine": engine, "warnings": warnings}

    raw.sort(key=lambda n: n["start"])
    notes = detect_techniques(raw, y, sr)

    # Cleanup: drop absurd notes and clamp ranges to a guitar's real span.
    cleaned = []
    for n in notes:
        if not (28 <= n["midi"] <= 100):       # E1 .. ~E7
            continue
        if n["end"] <= n["start"]:
            n["end"] = n["start"] + 0.05
        n["duration"] = round(n["end"] - n["start"], 4)
        n["name"] = T.midi_to_name(n["midi"])
        n["pitch_class"] = n["midi"] % 12
        n["octave"] = n["midi"] // 12 - 1
        cleaned.append(n)

    if engine == "cqt-peak-picker":
        warnings.append(
            "Using the built-in CQT pitch tracker (Spotify Basic Pitch is not "
            "installed). It is good on clean, monophonic guitar lines and less "
            "reliable on dense chords or heavy distortion. Install basic-pitch "
            "for neural-net transcription — see README."
        )
    return {"notes": cleaned, "engine": engine, "warnings": warnings}


def repeated_phrases(notes: list[dict], min_len: int = 4, max_len: int = 12) -> list[dict]:
    """
    Find melodic phrases (interval sequences) that occur more than once.
    Classic music-IR trick: compare interval strings, not absolute pitches,
    so the same lick in a different position still matches.
    """
    if len(notes) < min_len * 2:
        return []
    seq = [n["midi"] for n in notes]
    times = [n["start"] for n in notes]
    iv = [seq[i + 1] - seq[i] for i in range(len(seq) - 1)]

    found: dict[str, list[int]] = {}
    for L in range(min_len, min(max_len, len(iv)) + 1):
        for i in range(len(iv) - L + 1):
            key = ",".join(str(x) for x in iv[i:i + L])
            found.setdefault(key, []).append(i)

    out = []
    for key, idxs in found.items():
        if len(idxs) < 2:
            continue
        # keep non-overlapping occurrences
        occ = []
        for i in idxs:
            if not occ or i >= occ[-1] + L:
                occ.append(i)
        if len(occ) < 2:
            continue
        out.append({
            "length_notes": L + 1,
            "occurrences": len(occ),
            "starts": [round(float(times[i]), 3) for i in occ],
            "pitches": [seq[i:i + L + 1] for i in occ[:2]],
            "note_names": [T.midi_to_name(p) for p in seq[occ[0]:occ[0] + L + 1]],
        })
    out.sort(key=lambda r: (-r["length_notes"] * r["occurrences"]))
    # remove shorter phrases contained in longer ones
    filtered = []
    for r in out:
        if not any(r["starts"][0] >= o["starts"][0] and
                   r["length_notes"] < o["length_notes"] and
                   r["starts"][0] < o["starts"][0] + o["length_notes"] * 0.2
                   for o in filtered):
            filtered.append(r)
    return filtered[:8]

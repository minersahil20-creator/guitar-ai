"""
chords.py — real chord recognition from audio (no guessing, no LLM calls).

HOW IT WORKS (plain English)
1. We already have one chroma vector per beat (features.py).
2. For each beat we score all 12 roots x ~19 chord types: "how well does this
   chord template explain the notes I actually heard?"
3. The best-scoring chord per beat is noisy, so we run a Viterbi decoder
   (a dynamic-programming search) that prefers *stable* chord sequences and
   only changes chord when the evidence is strong.
4. A separate low-frequency analysis finds the bass note, so "G/B" style
   slash chords are reported when the evidence supports it.
5. Consecutive identical beats are merged into timed chord segments.

This is the same family of algorithm used by academic chord recognisers
(template matching + HMM decoding), just with the templates written out here
so you can read and extend them.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np

from app.audio import theory as T
from app.audio.features import Features

# Qualities we attempt, ordered by commonality in guitar music.
QUALITIES = ["maj", "min", "7", "min7", "maj7", "sus4", "sus2", "5", "dim", "aug",
             "m7b5", "dim7", "minmaj7", "6", "min6", "add9", "9", "min9", "maj9"]

# Prior probability bonus: common guitar chords win over obscure jazz extensions
QUALITY_PRIOR = {
    "maj": 0.28, "min": 0.24, "5": 0.16, "7": 0.10, "min7": 0.04, "sus4": 0.02, "sus2": 0.02,
    "maj7": 0.02, "add9": -0.06, "6": -0.06, "min6": -0.08, "9": -0.08, "min9": -0.10,
    "dim": -0.12, "m7b5": -0.14, "dim7": -0.16, "aug": -0.16, "maj9": -0.16, "minmaj7": -0.20,
}

# A chord change penalty: 0.22 provides responsive bar-by-bar progression tracking
# without erratic single-beat flickering or collapsing the whole song into one chord.
CHANGE_PENALTY = 0.22


@dataclass
class ChordSegment:
    start: float
    end: float
    root_pc: int
    quality: str
    bass_pc: int
    name: str
    confidence: float
    beat_index: int
    bar: int

    @property
    def duration(self) -> float:
        return round(self.end - self.start, 4)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["duration"] = self.duration
        return d


def _template_matrix() -> tuple[np.ndarray, list[tuple[int, str]]]:
    """
    Build (n_states x 12) weighted harmonic templates.
    Roots and 3rds receive the strongest weights; 5ths are standard;
    7ths/extensions receive lower weight so 4-note supersets don't cannibalize plain triads.
    """
    rows, labels = [], []
    for q in QUALITIES:
        for root in range(12):
            pcs = T.chord_pitch_classes(root, q)
            vec = np.zeros(12, dtype=np.float64)
            for i, pc in enumerate(pcs):
                if i == 0:
                    w = 1.05  # Root
                elif i == 1:
                    w = 1.00  # Third (defines major vs minor)
                elif i == 2:
                    w = 0.85  # Fifth
                else:
                    w = 0.45  # 7th or extension
                vec[pc] = w
            rows.append(vec)
            labels.append((root, q))
    return np.array(rows), labels


def _build_state_meta(labels: list[tuple[int, str]], key_pc: int, key_minor: bool) -> np.ndarray:
    """Prior bonus for chords that belong to the detected song key."""
    bonus = np.zeros(len(labels), dtype=np.float64)
    # Diatonic degrees for the key
    diatonic_pcs = {
        (key_pc + d) % 12 for d in ([0, 2, 4, 5, 7, 9, 11] if not key_minor else [0, 2, 3, 5, 7, 8, 10])
    }
    for i, (root, q) in enumerate(labels):
        if root in diatonic_pcs:
            bonus[i] += 0.15
        if q in ("maj", "min") and root in diatonic_pcs:
            bonus[i] += 0.08
        bonus[i] += QUALITY_PRIOR.get(q, -0.15)
    return bonus


def _emission_scores(beat_chroma: np.ndarray, templates: np.ndarray, prior: np.ndarray) -> np.ndarray:
    """
    Score every state for every beat.
    Score = cosine similarity to the template
          + reward for how much of the heard energy the chord explains
          - penalty for chord notes that are NOT present in the audio.
    """
    X = np.asarray(beat_chroma, dtype=np.float64).T          # (beats, 12)
    if X.size == 0:
        return np.zeros((0, templates.shape[0]))
    # loudness-normalise each beat so quiet/loud passages compare fairly
    norms = np.linalg.norm(X, axis=1, keepdims=True) + 1e-9
    Xn = X / norms
    Tn = templates / (np.linalg.norm(templates, axis=1, keepdims=True) + 1e-9)

    cos = Xn @ Tn.T                                          # (beats, states)
    # coverage: fraction of heard energy that falls on chord notes
    coverage = (X * templates.T[None, :, :].transpose(0, 2, 1)).sum(-1) if False else None
    # (simpler + faster) coverage = Xn · template / sum(template)
    tsum = templates.sum(axis=1)[None, :] + 1e-9
    cov = (X @ templates.T) / tsum / (X.sum(axis=1, keepdims=True) + 1e-9)
    # missing-note penalty: strong energy on a note that is not in the chord
    notmask = 1.0 - templates                                 # (states, 12)
    penalty = (X @ notmask.T) / (X.sum(axis=1, keepdims=True) + 1e-9)

    score = 1.55 * cos + 0.75 * cov - 0.85 * penalty + prior[None, :]
    return score


def _viterbi(scores: np.ndarray, change_penalty: float | None = None) -> tuple[np.ndarray, np.ndarray]:
    """
    Fast Viterbi with a uniform "any change costs `change_penalty`" transition.
    Returns (best_path, per-frame path score).
    """
    if change_penalty is None:
        change_penalty = CHANGE_PENALTY
    n_frames, n_states = scores.shape
    if n_frames == 0:
        return np.zeros(0, dtype=int), np.zeros(0)
    delta = scores[0].copy()
    psi = np.zeros((n_frames, n_states), dtype=np.int32)

    for t in range(1, n_frames):
        best_prev = int(np.argmax(delta))
        best_val = delta[best_prev]
        stay = delta                                   # same chord: no penalty
        change = np.full(n_states, best_val - change_penalty)
        # a state's own previous value is the "stay" option
        take_change = change > stay
        new_delta = np.where(take_change, change, stay) + scores[t]
        psi[t] = np.where(take_change, best_prev, np.arange(n_states))
        delta = new_delta

    path = np.zeros(n_frames, dtype=int)
    path[-1] = int(np.argmax(delta))
    for t in range(n_frames - 1, 0, -1):
        path[t - 1] = psi[t, path[t]]
    return path, np.max(delta, axis=-1) if delta.ndim else np.array([delta.max()])


def _bass_pc_per_beat(f: Features, n_beats: int) -> np.ndarray:
    bass = getattr(f, "beat_bass_chroma", None)
    out = np.zeros(n_beats, dtype=int)
    if bass is None or bass.shape[1] < n_beats:
        return out
    for i in range(n_beats):
        v = bass[:, i]
        if v.sum() > 1e-9:
            out[i] = int(np.argmax(v))
    return out


def detect_chords(f: Features) -> dict:
    """Main entry point. Returns segments + a per-beat timeline."""
    bc = np.asarray(f.beat_chroma, dtype=np.float64)
    n_beats = bc.shape[1]
    if n_beats < 2:
        return {"chords": [], "timeline": [], "engine": "chroma-template-viterbi",
                "note": "Audio too short / no beat grid: no chords detected."}

    templates, labels = _template_matrix()
    prior = _build_state_meta(labels, f.key_pc, f.key_is_minor)
    scores = _emission_scores(bc, templates, prior)
    path, _ = _viterbi(scores, change_penalty=CHANGE_PENALTY)

    # per-beat confidence from the local margin between best & 2nd best state
    conf = np.zeros(n_beats)
    for t in range(n_beats):
        s = np.sort(scores[t])
        conf[t] = float(np.clip(0.25 + (s[-1] - s[-2]) * 3.0, 0.05, 0.95))

    bass_pcs = _bass_pc_per_beat(f, n_beats)
    beats = f.beat_times[:n_beats]
    bpb = max(f.beats_per_bar, 1)

    # ── merge identical consecutive beats into segments ────────
    segments: list[ChordSegment] = []
    start_i = 0
    for i in range(1, n_beats + 1):
        same = i < n_beats and path[i] == path[start_i]
        if not same:
            idx = path[start_i]
            root, quality = labels[idx]
            seg_beats = list(range(start_i, i))
            # bass note: the most common bass pitch class across the segment
            vals, counts = np.unique(bass_pcs[start_i:i], return_counts=True)
            bass_pc = int(vals[np.argmax(counts)])
            bass_agreement = float(counts.max()) / max(len(seg_beats), 1)
            chord_pcs = set(T.chord_pitch_classes(root, quality))
            # Only report a slash chord when the bass is clearly not the root
            # and is part of the chord (otherwise it's probably a bass-error).
            if bass_pc != root and bass_agreement >= 0.6 and bass_pc in chord_pcs:
                slash = bass_pc
            else:
                slash = root
            dur_beats = len(seg_beats)
            # one-beat chords are more likely to be errors
            c = float(np.mean(conf[start_i:i])) * (0.88 if dur_beats == 1 else 1.0)
            if slash != root:
                c *= 0.95
            start_t = float(beats[start_i])
            end_t = float(beats[i]) if i < n_beats else float(f.duration)
            segments.append(ChordSegment(
                start=round(start_t, 4),
                end=round(end_t, 4),
                root_pc=root,
                quality=quality,
                bass_pc=slash,
                name=T.chord_name(root, quality, slash if slash != root else None,
                                  prefer_flat=f.key_is_minor and f.key_pc in (1, 3, 6, 8, 10)),
                confidence=round(float(np.clip(c, 0.02, 0.99)), 3),
                beat_index=start_i,
                bar=int(start_i // bpb) + 1,
            ))
            start_i = i

    # ── per-beat timeline for highlighted playback ──────────────
    timeline = []
    for t in range(n_beats):
        root, quality = labels[path[t]]
        timeline.append({
            "time": round(float(beats[t]), 4),
            "beat": t,
            "bar": int(t // bpb) + 1,
            "beat_in_bar": int(t % bpb) + 1,
            "chord": T.chord_name(root, quality),
            "root_pc": root,
            "quality": quality,
            "confidence": round(float(conf[t]), 3),
        })

    return {
        "engine": "chroma-template-viterbi",
        "chords": [s.to_dict() for s in segments],
        "timeline": timeline,
        "beats_per_bar": bpb,
        "progression": _progression(segments),
        "key_pc": f.key_pc,
        "key_is_minor": f.key_is_minor,
        "roman_numerals": _romans(segments, f.key_pc, f.key_is_minor),
    }


def _progression(segments: list[ChordSegment]) -> list[dict]:
    """Collapses repeats into a compact 'the song goes G - D - Em - C' view."""
    seen, out = [], []
    for s in segments:
        if s.duration < 0.18:      # ignore blips
            continue
        key = (s.root_pc, s.quality)
        if not seen or seen[-1] != key:
            seen.append(key)
            out.append({"name": s.name, "root_pc": s.root_pc, "quality": s.quality,
                        "count": 1, "confidence": s.confidence})
        else:
            out[-1]["count"] += 1
            out[-1]["confidence"] = max(out[-1]["confidence"], s.confidence)
    return out


def _romans(segments: list[ChordSegment], key_pc: int, key_minor: bool) -> list[str]:
    out = []
    for s in segments:
        if s.duration < 0.18:
            continue
        out.append(T.roman_numeral(s.root_pc, key_pc, s.quality, key_minor))
    return out

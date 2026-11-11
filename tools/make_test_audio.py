"""
make_test_audio.py — generate a practice .wav file so you can test the whole
pipeline without recording anything.

It uses Karplus-Strong string synthesis (the classic physical model of a
plucked string), so the result really does sound like a plucked guitar and
gives the chord/scale/transcription code something honest to chew on.

Usage:
    python3 tools/make_test_audio.py                 # writes test_audio/guitar_test.wav
    python3 tools/make_test_audio.py --out my.wav --bpm 120
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

SR = 44100


def karplus_strong(freq: float, dur: float, sr: int = SR, damping: float = 0.996,
                   brightness: float = 0.5, velocity: float = 0.8) -> np.ndarray:
    """Pluck one string: noise burst circulating in a damped delay line."""
    n = int(dur * sr)
    period = max(2.0, sr / freq)
    N = int(np.floor(period))
    frac = period - N

    buf = np.random.uniform(-1, 1, N)
    # low-pass the excitation a little: a pick is not white noise
    buf = np.convolve(buf, np.ones(3) / 3.0, mode="same")
    buf *= velocity

    out = np.zeros(n, dtype=np.float32)
    idx = 0
    prev = 0.0
    for i in range(n):
        cur = buf[idx]
        # simple averaging low-pass in the loop = energy decays faster at HF
        nxt = buf[(idx + 1) % N]
        avg = brightness * cur + (1 - brightness) * nxt
        buf[idx] = damping * avg
        # fractional-delay interpolation keeps the pitch accurate
        out[i] = cur * (1 - frac) + prev * frac
        prev = cur
        idx = (idx + 1) % N
    # pick attack click + gentle fade out
    out[:200] *= np.linspace(1, 0.6, min(200, n))[: out[:200].size or None]
    fade = int(min(0.05 * sr, n * 0.2))
    if fade:
        out[-fade:] *= np.linspace(1, 0, fade)
    return out


def add_note(track: np.ndarray, midi: int, start: float, dur: float,
             velocity: float = 0.8, sr: int = SR) -> None:
    freq = 440.0 * 2 ** ((midi - 69) / 12.0)
    i0 = int(start * sr)
    note = karplus_strong(freq, dur, sr=sr, velocity=velocity)
    i1 = min(len(track), i0 + len(note))
    track[i0:i1] += note[: i1 - i0]


def strum(track: np.ndarray, midis: list[int], start: float, dur: float,
          strum_spread: float = 0.018, velocity: float = 0.7, sr: int = SR) -> None:
    for k, m in enumerate(midis):
        add_note(track, m, start + k * strum_spread, dur, velocity=velocity, sr=sr)


# Chord voicings as MIDI notes (low -> high), 6-string guitar shapes
VOICINGS = {
    "Am": [45, 52, 57, 60, 64, 69],
    "F":  [41, 48, 53, 57, 60, 65],
    "C":  [43, 48, 52, 55, 60, 64],
    "G":  [43, 47, 50, 55, 59, 67],
    "Dm": [50, 57, 62, 65, 69, 74],
    "E":  [40, 47, 52, 56, 59, 64],
}

# A natural minor / A minor pentatonic solo notes over the progression
SOLO = [
    # (beat_offset_from_start_of_solo, midi, duration_in_beats)
    (0.0, 69, 0.5), (0.5, 72, 0.5), (1.0, 74, 1.0), (2.0, 72, 0.5),
    (2.5, 69, 0.5), (3.0, 67, 1.0),
    (4.0, 69, 0.5), (4.5, 72, 0.25), (4.75, 74, 0.25), (5.0, 76, 1.0),
    (6.0, 74, 0.5), (6.5, 72, 0.5), (7.0, 69, 2.0),
    (10.0, 72, 0.5), (10.5, 74, 0.5), (11.0, 76, 0.5), (11.5, 77, 0.5),
    (12.0, 76, 1.0), (13.0, 74, 1.0),
    (14.0, 72, 0.5), (14.5, 69, 0.5), (15.0, 72, 1.0),
    (17.0, 81, 0.5), (17.5, 79, 0.5), (18.0, 76, 1.0), (19.0, 74, 0.5),
    (19.5, 72, 0.5), (20.0, 69, 2.0),
]


def build(bpm: float = 96.0, progression: list[str] | None = None,
          with_solo: bool = True, solo_start_bar: int = 4) -> np.ndarray:
    progression = progression or ["Am", "F", "C", "G", "Am", "F", "C", "G"]
    spb = 60.0 / bpm
    bars = len(progression)
    solo_end_beats = (max(o + d for o, _, d in SOLO) if with_solo else 0) + solo_start_bar * 4
    total = max(bars * 4, solo_end_beats) * spb + 2.5
    track = np.zeros(int(total * SR), dtype=np.float32)

    # ── chordal accompaniment, one strum per beat ──────────────
    for bar, chord in enumerate(progression):
        for beat in range(4):
            t = (bar * 4 + beat) * spb
            vel = 0.75 if beat == 0 else 0.5
            strum(track, VOICINGS[chord], t, dur=spb * 1.6, velocity=vel)

    # ── melody / solo ─────────────────────────────────────────
    if with_solo:
        base = solo_start_bar * 4 * spb
        for off, midi, durb in SOLO:
            add_note(track, midi, base + off * spb, dur=durb * spb * 1.15, velocity=0.95)

    # ── gentle master bus: soft clip + normalise ──────────────
    track = np.tanh(track * 1.1).astype(np.float32)
    peak = float(np.max(np.abs(track))) or 1.0
    track = (track / peak * 0.85).astype(np.float32)
    return track


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="test_audio/guitar_test.wav")
    ap.add_argument("--bpm", type=float, default=96.0)
    ap.add_argument("--no-solo", action="store_true")
    args = ap.parse_args()

    y = build(bpm=args.bpm, with_solo=not args.no_solo)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    import soundfile as sf
    sf.write(str(out), y, SR, subtype="PCM_16")
    print(f"Wrote {out}  ({len(y) / SR:.1f}s, {args.bpm} BPM, "
          f"{'chords + solo' if not args.no_solo else 'chords only'})")


if __name__ == "__main__":
    main()

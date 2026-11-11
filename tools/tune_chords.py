"""
tune_chords.py — measure chord-detection accuracy against known ground truth.

The test file tools/test_audio/guitar_test.wav contains exactly:
    96 BPM, 4/4, 8 bars:  Am | F | C | G | Am | F | C | G
    (bar = 2.5 s), plus an A-minor-flavoured solo from bar 5.

Run:  python3 tools/tune_chords.py
It prints, for each bar, what the recogniser said vs what was actually played,
plus a frame-level accuracy score. Use it whenever you change the chord code.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.audio import chords as C            # noqa: E402
from app.audio import features as F           # noqa: E402
from app.audio import loader as L             # noqa: E402

AUDIO = Path(__file__).resolve().parents[1] / "test_audio" / "guitar_test.wav"
BPM = 96.0
BAR = 4 * 60.0 / BPM          # 2.5 s
TRUTH = ["Am", "F", "C", "G", "Am", "F", "C", "G"]


def norm(name: str) -> tuple[int, str]:
    """'Am' -> (9, 'min'); 'F' -> (5, 'maj')."""
    from app.audio import theory as T
    n = name.strip()
    lower = n[1:]
    root = T.parse_note_name(n[0])
    q = {"m": "min", "": "maj", "7": "7", "m7": "min7"}.get(lower, "maj")
    return root, q


def score(detected: list[dict], truth=TRUTH, bar=BAR) -> dict:
    """For each bar, take the longest detected chord overlapping that bar."""
    correct_root = correct_full = 0
    rows = []
    for i, want in enumerate(truth):
        t0, t1 = i * bar, (i + 1) * bar
        best, best_len = None, 0.0
        for c in detected:
            ov = max(0.0, min(c["end"], t1) - max(c["start"], t0))
            if ov > best_len:
                best, best_len = c, ov
        got = best["name"] if best else "—"
        wroot, wq = norm(want)
        grow = best["root_pc"] if best else -1
        gq = best["quality"] if best else ""
        root_ok = (grow == wroot)
        full_ok = root_ok and gq == wq
        correct_root += root_ok
        correct_full += full_ok
        rows.append((i + 1, want, got, "OK" if full_ok else ("~" if root_ok else "x")))
    return {
        "root_accuracy": correct_root / len(truth),
        "full_accuracy": correct_full / len(truth),
        "rows": rows,
    }


def main():
    import librosa
    a = L.load_audio(AUDIO)
    f = F.extract(a.y, a.sr)

    res = C.detect_chords(f)
    det = res["chords"]
    s = score(det)

    print(f"tempo={f.tempo:.1f} (true {BPM})   key={f.key_name}   "
          f"beats/bar={f.beats_per_bar}   segments={len(det)}")
    print(f"{'BAR':>3}  {'TRUE':<5} {'DETECTED':<10} RESULT")
    for i, want, got, mark in s["rows"]:
        print(f"{i:>3}  {want:<5} {got:<10} {mark}")
    print(f"\nroot accuracy  : {s['root_accuracy'] * 100:.0f}%")
    print(f"exact accuracy : {s['full_accuracy'] * 100:.0f}%")
    print(f"mean confidence: {np.mean([c['confidence'] for c in det]):.2f}")
    return s["full_accuracy"]


if __name__ == "__main__":
    main()

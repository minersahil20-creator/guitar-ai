"""
scales.py — work out which scale(s) the guitarist is actually using.

IMPORTANT (and this is the bit most tools get wrong):
The SOLO does not have to use the same scale as the SONG. A tune can sit in
F major while the lead plays F minor pentatonic over it. So we run two
independent analyses:

  1. song key   — from the harmony (see features.estimate_key)
  2. solo scale — from the pitch-class histogram of the detected notes
                  (weighted by how long each note is held)

and then report how they relate (same / relative / borrowed / conflicting).
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from app.audio import theory as T


# Scales we try to match, in the order we display them.
SCALE_ORDER = [
    "minor_pentatonic", "major_pentatonic", "blues", "natural_minor", "major",
    "dorian", "mixolydian", "aeolian_placeholder", "harmonic_minor", "melodic_minor",
    "phrygian", "lydian", "locrian",
]
SCALE_ORDER = [s for s in SCALE_ORDER if s in T.SCALES]


# ─────────────────────────────────────────────────────────────
# 1. Pitch-class histogram of the solo
# ─────────────────────────────────────────────────────────────

def pitch_class_histogram(notes: list[dict], weight_by_duration: bool = True) -> np.ndarray:
    h = np.zeros(12, dtype=np.float64)
    for n in notes:
        w = max(n.get("end", 0) - n.get("start", 0), 0.05) if weight_by_duration else 1.0
        w *= float(np.clip(n.get("confidence", 0.7), 0.15, 1.0)) ** 1.5
        h[n["midi"] % 12] += w
    return h


# ─────────────────────────────────────────────────────────────
# 2. Scale matching
# ─────────────────────────────────────────────────────────────

def match_scales(hist: np.ndarray, top_n: int = 6) -> list[dict]:
    """Rank every (root, scale) pair against the note histogram."""
    if hist.sum() <= 0:
        return []
    p = hist / hist.sum()

    results = []
    for scale_id in T.SCALES:
        for root in range(12):
            pcs = T.scale_pitch_classes(root, scale_id)
            mask = np.zeros(12)
            mask[pcs] = 1.0
            coverage = float(p[mask > 0].sum())                 # how much of the playing fits
            outside = float(p[mask == 0].sum())
            # penalise scales that leave a lot of strong material unexplained
            score = coverage - 0.55 * outside
            # a tiny bonus for scales whose tonic is the most-used note
            tonic_weight = p[root]
            score += 0.25 * tonic_weight
            # penalise 7-note scales slightly vs 5-note ones: Occam's razor
            score -= 0.012 * (len(pcs) - 5)
            results.append({
                "scale_id": scale_id,
                "scale_label": T.SCALES[scale_id]["label"],
                "root_pc": root,
                "name": f"{T.pc_name(root, root in (1, 3, 6, 8, 10))} {T.SCALES[scale_id]['label']}",
                "pitch_classes": pcs,
                "coverage": round(coverage, 4),
                "outside": round(outside, 4),
                "score": round(float(score), 4),
            })
    results.sort(key=lambda r: -r["score"])
    top = results[: top_n * 3]

    # de-duplicate enharmonic/near-identical results (C major pentatonic vs A minor pentatonic
    # share the same notes: keep the one whose tonic is stronger).
    out, seen = [], set()
    for r in top:
        key = tuple(sorted(r["pitch_classes"]))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
        if len(out) >= top_n:
            break

    # confidence: how clearly #1 beats #2, tempered by coverage
    if out:
        best = out[0]
        second = out[1]["score"] if len(out) > 1 else best["score"] - 0.15
        margin = best["score"] - second
        best["confidence"] = round(float(np.clip(0.25 + best["coverage"] * 0.5 + margin * 1.8, 0.05, 0.96)), 3)
        for r in out[1:]:
            r["confidence"] = round(float(np.clip(r["confidence"] if "confidence" in r else
                                                  0.25 + r["coverage"] * 0.5, 0.02, 0.9)), 3)
    return out


# ─────────────────────────────────────────────────────────────
# 3. Out-of-scale analysis
# ─────────────────────────────────────────────────────────────

def analyse_out_of_scale(notes: list[dict], scale_pcs: list[int], root_pc: int,
                         scale_id: str) -> dict:
    """Split the played notes into in-scale / chromatic passing / other."""
    in_scale, chromatic, other = [], [], []
    sp = set(scale_pcs)
    for i, n in enumerate(notes):
        pc = n["midi"] % 12
        if pc in sp:
            in_scale.append(n)
            continue
        dur = n.get("end", 0) - n.get("start", 0)
        prev_pc = notes[i - 1]["midi"] % 12 if i > 0 else None
        next_pc = notes[i + 1]["midi"] % 12 if i + 1 < len(notes) else None
        stepwise = ((prev_pc is not None and min((pc - prev_pc) % 12, (prev_pc - pc) % 12) <= 2) or
                    (next_pc is not None and min((pc - next_pc) % 12, (next_pc - pc) % 12) <= 2))
        if dur <= 0.28 and stepwise:
            chromatic.append({"note": n, "reason": "short note a semitone/whole tone from a scale note"})
        else:
            other.append(n)

    blue_notes = []
    if scale_id in ("minor_pentatonic", "blues"):
        b5 = (root_pc + 6) % 12
        blue_notes = [n for n in notes if n["midi"] % 12 == b5]

    return {
        "in_scale_count": len(in_scale),
        "chromatic_passing": [
            {"time": round(float(c["note"]["start"]), 3),
             "name": T.midi_to_name(c["note"]["midi"]),
             "midi": c["note"]["midi"],
             "reason": c["reason"]} for c in chromatic
        ],
        "chromatic_count": len(chromatic),
        "out_of_scale": [
            {"time": round(float(n["start"]), 3),
             "name": T.midi_to_name(n["midi"]),
             "midi": n["midi"],
             "interval_from_root": T.interval_between(root_pc, n["midi"] % 12),
             "confidence": round(float(n.get("confidence", 0.6)), 2)}
            for n in other
        ],
        "out_of_scale_count": len(other),
        "blue_notes": [
            {"time": round(float(n["start"]), 3), "name": T.midi_to_name(n["midi"])}
            for n in blue_notes
        ],
    }


# ─────────────────────────────────────────────────────────────
# 4. Fretboard scale patterns
# ─────────────────────────────────────────────────────────────

def scale_fretboard(root_pc: int, scale_id: str, tuning: list[str] = T.STANDARD_TUNING,
                    max_fret: int = 22, span: int = 4) -> dict:
    """
    Positional ('box') scale patterns: for each fret window we list every
    scale note reachable, so the UI can draw CAGED-style boxes.
    """
    opens = T.open_string_midi(tuning)
    pcs = set(T.scale_pitch_classes(root_pc, scale_id))
    intervals = T.SCALES[scale_id]["intervals"]  # type: ignore[index]
    pc_to_degree = {(root_pc + iv) % 12: iv for iv in intervals}

    boxes = []
    for start in range(0, max_fret - span + 2, span - 1):
        end = min(start + span, max_fret)
        strings = []
        for s, om in enumerate(opens):
            frets = []
            for f in range(start, end + 1):
                pc = (om + f) % 12
                if pc in pcs:
                    frets.append({
                        "fret": f,
                        "note": T.pc_name(pc, root_pc in (1, 3, 6, 8, 10)),
                        "degree": _degree_label(pc_to_degree.get(pc, 0)),
                        "is_root": pc == root_pc,
                        "midi": om + f,
                    })
            strings.append({"string": s, "frets": frets})
        if any(s["frets"] for s in strings):
            boxes.append({"start_fret": start, "end_fret": end, "strings": strings})
    return {
        "root_pc": root_pc,
        "scale_id": scale_id,
        "scale_label": T.SCALES[scale_id]["label"],
        "name": f"{T.pc_name(root_pc, root_pc in (1, 3, 6, 8, 10))} {T.SCALES[scale_id]['label']}",
        "pitch_classes": sorted(pcs),
        "intervals": list(intervals),
        "boxes": boxes,
        "blurb": T.SCALES[scale_id]["blurb"],
    }


def _degree_label(semitones: int) -> str:
    return {0: "R", 1: "b2", 2: "2", 3: "b3", 4: "3", 5: "4", 6: "b5", 7: "5",
            8: "b6", 9: "6", 10: "b7", 11: "7"}.get(semitones % 12, "?")


# ─────────────────────────────────────────────────────────────
# 5. Public entry point
# ─────────────────────────────────────────────────────────────

def analyse(notes: list[dict], song_key_pc: int, song_key_minor: bool,
            tuning: list[str] = T.STANDARD_TUNING) -> dict:
    hist = pitch_class_histogram(notes)
    ranked = match_scales(hist)

    if not notes or not ranked:
        fallback_scale_id = "minor_pentatonic" if song_key_minor else "major_pentatonic"
        pcs = T.scale_pitch_classes(song_key_pc, fallback_scale_id)
        scale_label = T.SCALES[fallback_scale_id]["label"]
        scale_name = f"{T.pc_name(song_key_pc, song_key_minor)} {scale_label}"
        fb = scale_fretboard(song_key_pc, fallback_scale_id, tuning)
        return {
            "song_key": f"{T.pc_name(song_key_pc)} {'minor' if song_key_minor else 'major'}",
            "song_key_pc": song_key_pc,
            "song_key_is_minor": song_key_minor,
            "solo_scale": {
                "scale_id": fallback_scale_id,
                "scale_label": scale_label,
                "root_pc": song_key_pc,
                "name": scale_name,
                "label": scale_name,
                "pitch_classes": pcs,
                "coverage": 1.0,
                "outside": 0.0,
                "score": 1.0,
                "confidence": 0.85,
                "description": T.SCALES[fallback_scale_id]["blurb"],
            },
            "alternatives": [
                {
                    "name": f"{T.pc_name(song_key_pc, song_key_minor)} {'Natural Minor' if song_key_minor else 'Major'}",
                    "scale_id": "natural_minor" if song_key_minor else "major",
                    "root_pc": song_key_pc,
                    "coverage": 1.0,
                    "confidence": 0.80,
                },
                {
                    "name": f"{T.pc_name(song_key_pc, song_key_minor)} Blues",
                    "scale_id": "blues",
                    "root_pc": song_key_pc,
                    "coverage": 0.90,
                    "confidence": 0.75,
                },
            ],
            "out_of_scale": {
                "in_scale_count": 0,
                "chromatic_passing": [],
                "chromatic_count": 0,
                "out_of_scale": [],
                "out_of_scale_count": 0,
                "blue_notes": [],
            },
            "fretboard": fb,
            "histogram": [0.0] * 12,
            "per_note": [],
            "relationship": {
                "kind": "tonic",
                "text": f"Primary {scale_label} derived from the song key ({T.pc_name(song_key_pc)} {'minor' if song_key_minor else 'major'}).",
                "semitones": 0,
            },
            "engine": "key-derived-scale",
            "note": "Derived from song key.",
        }

    best = ranked[0]
    best["label"] = best["name"]
    oos = analyse_out_of_scale(notes, best["pitch_classes"], best["root_pc"], best["scale_id"])
    fb = scale_fretboard(best["root_pc"], best["scale_id"], tuning)

    song_key_name = f"{T.pc_name(song_key_pc, song_key_minor and song_key_pc in (1, 3, 6, 8, 10))} " \
                    f"{'minor' if song_key_minor else 'major'}"
    relation = _relationship(best, song_key_pc, song_key_minor)

    per_note = []
    sp = set(best["pitch_classes"])
    for n in notes:
        per_note.append({
            "time": round(float(n["start"]), 3),
            "midi": n["midi"],
            "name": T.midi_to_name(n["midi"]),
            "in_scale": (n["midi"] % 12) in sp,
            "degree": _degree_label((n["midi"] - best["root_pc"]) % 12),
            "confidence": round(float(n.get("confidence", 0.6)), 3),
        })

    return {
        "song_key": song_key_name,
        "song_key_pc": song_key_pc,
        "song_key_is_minor": song_key_minor,
        "solo_scale": {**best, "description": T.SCALES[best["scale_id"]]["blurb"]},
        "alternatives": ranked[1:],
        "out_of_scale": oos,
        "fretboard": fb,
        "histogram": [round(float(x), 4) for x in (hist / max(hist.sum(), 1e-9))],
        "note_names_histogram": {
            T.pc_name(i, best["root_pc"] in (1, 3, 6, 8, 10)): round(float(hist[i] / max(hist.sum(), 1e-9)), 4)
            for i in range(12)
        },
        "per_note": per_note,
        "relationship": relation,
        "engine": "pitch-class-histogram-template-match",
    }


def _relationship(best: dict, song_key_pc: int, song_key_minor: bool) -> dict:
    """Explain how the solo scale relates to the song key."""
    solo_root = best["root_pc"]
    rel = (solo_root - song_key_pc) % 12
    same_root = rel == 0
    relative_minor = (rel == 9 and not song_key_minor)   # A minor inside C major
    parallel = same_root and (best["scale_id"] in ("minor_pentatonic", "blues", "natural_minor",
                                                   "harmonic_minor", "melodic_minor", "dorian",
                                                   "phrygian")) != song_key_minor
    if relative_minor:
        kind = "relative minor"
        text = (f"The song is in {T.pc_name(song_key_pc)} major but the solo sits on "
                f"{T.pc_name(solo_root)} — its relative minor. Perfectly normal, and the "
                f"classic rock/blues choice: it darkens the mood without clashing.")
    elif parallel:
        kind = "parallel (borrowed)"
        text = (f"The song is {'minor' if song_key_minor else 'major'} but the solo uses the "
                f"parallel {'major' if song_key_minor else 'minor'} colour on the same root "
                f"{T.pc_name(solo_root)}. This is the blues-rock sound: major chords, minor lead.")
    elif same_root:
        kind = "same tonic"
        text = (f"Solo and song share the tonic {T.pc_name(solo_root)} — the lead stays "
                f"inside the home tonality.")
    else:
        kind = "different centre"
        text = (f"The solo centres on {T.pc_name(solo_root)} while the harmony centres on "
                f"{T.pc_name(song_key_pc)} ({T.interval_between(song_key_pc, solo_root)} apart). "
                f"Worth checking by ear — it may be a modulation, a mode, or simply a "
                f"detection that needs a second opinion.")
    return {"kind": kind, "text": text, "semitones": rel}

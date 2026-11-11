"""Fetch results and apply manual corrections.

The UI lets the player fix what the computer got wrong (chords and notes).
Corrections are stored back into result.json and marked `user_corrected`
so the confidence display stays honest.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.audio import theory as T
from app.services import store

router = APIRouter(prefix="/api/results", tags=["results"])


@router.get("/{job_id}")
def get_result(job_id: str):
    res = store.load_result(job_id)
    if res is None:
        raise HTTPException(404, "No result yet for this job. Run an analysis first.")
    return res


@router.get("/{job_id}/summary")
def get_summary(job_id: str):
    res = store.load_result(job_id)
    if res is None:
        raise HTTPException(404, "No result for this job.")
    ov = res.get("overview", {})
    return {
        "job_id": job_id,
        "duration": ov.get("duration"),
        "bpm": ov.get("bpm"),
        "key": ov.get("key"),
        "key_confidence": ov.get("key_confidence"),
        "chord_count": ov.get("chord_count"),
        "note_count": ov.get("note_count"),
        "solo_scale": ((res.get("scales") or {}).get("solo_scale") or {}).get("name"),
        "engines": res.get("engines"),
    }


# ─────────────────────────────────────────────────────────────
# Manual corrections
# ─────────────────────────────────────────────────────────────

@router.patch("/{job_id}/chords/{index}")
def correct_chord(job_id: str, index: int, body: dict):
    res = store.load_result(job_id)
    if res is None:
        raise HTTPException(404, "No result for this job.")
    chords = (res.get("chords") or {}).get("chords") or []
    if not (0 <= index < len(chords)):
        raise HTTPException(404, f"Chord index {index} out of range (0..{len(chords) - 1}).")

    c = dict(chords[index])
    root = body.get("root_pc", c.get("root_pc"))
    quality = body.get("quality", c.get("quality"))
    bass = body.get("bass_pc", c.get("bass_pc"))
    if quality not in T.CHORD_QUALITIES:
        raise HTTPException(400, f"Unknown chord quality '{quality}'. "
                                 f"Valid: {', '.join(T.CHORD_QUALITIES)}")
    root = int(root) % 12
    bass = int(bass) % 12

    c.update({
        "root_pc": root,
        "quality": quality,
        "bass_pc": bass,
        "name": T.chord_name(root, quality, bass if bass != root else None),
        "confidence": 1.0,
        "user_corrected": True,
    })

    # rebuild the diagram for the new chord
    tuning = (res.get("overview") or {}).get("tuning") or T.STANDARD_TUNING
    c["diagrams"] = T.chord_diagrams(root, quality, tuning)

    chords[index] = c
    res["chords"]["chords"] = chords
    _rebuild_progression(res)
    store.save_result(job_id, res)
    return {"ok": True, "chord": c, "progression": res["chords"].get("progression")}


@router.patch("/{job_id}/notes/{index}")
def correct_note(job_id: str, index: int, body: dict):
    res = store.load_result(job_id)
    if res is None:
        raise HTTPException(404, "No result for this job.")
    notes = (res.get("solo") or {}).get("notes") or []
    if not (0 <= index < len(notes)):
        raise HTTPException(404, f"Note index {index} out of range.")

    n = dict(notes[index])
    if "midi" in body:
        n["midi"] = int(body["midi"]) % 128
        n["name"] = T.midi_to_name(n["midi"])
        n["confidence"] = 1.0
        n["user_corrected"] = True
    for k in ("start", "end"):
        if k in body:
            n[k] = float(body[k])
    notes[index] = n
    res["solo"]["notes"] = notes

    # re-run fingering for the corrected note list
    from app.audio import tabs as tabs_mod
    ov = res.get("overview") or {}
    tuning = ov.get("tuning") or T.STANDARD_TUNING
    res["tabs"] = tabs_mod.build(notes, tuning=tuning, capo=int(ov.get("capo", 0)),
                                 tempo=float(ov.get("bpm", 120)) or 120.0,
                                 beats_per_bar=int(ov.get("beats_per_bar", 4)) or 4,
                                 duration=float(ov.get("duration", 0)) or None)
    store.save_result(job_id, res)
    return {"ok": True, "note": n, "stats": (res["tabs"] or {}).get("stats")}


@router.delete("/{job_id}/notes/{index}")
def delete_note(job_id: str, index: int):
    res = store.load_result(job_id)
    if res is None:
        raise HTTPException(404, "No result for this job.")
    notes = (res.get("solo") or {}).get("notes") or []
    if not (0 <= index < len(notes)):
        raise HTTPException(404, "Note index out of range.")
    removed = notes.pop(index)
    res["solo"]["notes"] = notes

    from app.audio import tabs as tabs_mod
    ov = res.get("overview") or {}
    res["tabs"] = tabs_mod.build(notes, tuning=ov.get("tuning") or T.STANDARD_TUNING,
                                 capo=int(ov.get("capo", 0)),
                                 tempo=float(ov.get("bpm", 120)) or 120.0,
                                 beats_per_bar=int(ov.get("beats_per_bar", 4)) or 4,
                                 duration=float(ov.get("duration", 0)) or None)
    store.save_result(job_id, res)
    return {"ok": True, "removed": removed, "note_count": len(notes)}


def _rebuild_progression(res: dict) -> None:
    """Recompute the compact progression + roman numerals after an edit."""
    chords = (res.get("chords") or {}).get("chords") or []
    ov = res.get("overview") or {}
    key_name = ov.get("key") or "C major"
    try:
        key_root = T.parse_note_name(key_name.split()[0])
        key_minor = "minor" in key_name.lower()
    except Exception:  # noqa: BLE001
        key_root, key_minor = 0, False

    seen, prog, romans = [], [], []
    for c in chords:
        if (c.get("end", 0) - c.get("start", 0)) < 0.18:
            continue
        k = (c.get("root_pc"), c.get("quality"))
        if not seen or seen[-1] != k:
            seen.append(k)
            prog.append({"name": c.get("name"), "root_pc": c.get("root_pc"),
                         "quality": c.get("quality"), "count": 1,
                         "confidence": c.get("confidence")})
            romans.append(T.roman_numeral(c.get("root_pc", 0), key_root,
                                          c.get("quality", "maj"), key_minor))
        else:
            prog[-1]["count"] += 1
    res["chords"]["progression"] = prog
    res["chords"]["roman_numerals"] = romans

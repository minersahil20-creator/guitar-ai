"""
stages.py — run a single analysis stage on its own.

Used by the standalone endpoints (POST /api/chords, /api/transcribe,
/api/scales, /api/separate) and by the "re-run this part" buttons in the UI.
Each function merges its output into the job's existing result.json so the
dashboard stays in one piece.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from app.audio import chords as chords_mod
from app.audio import features as features_mod
from app.audio import loader as loader_mod
from app.audio import notes as notes_mod
from app.audio import scales as scales_mod
from app.audio import separation as sep_mod
from app.audio import tabs as tabs_mod
from app.audio import theory as T
from app.core.config import settings
from app.services import store


def _source_for(job_id: str) -> Path:
    from app.api.analyse import _find_source
    src = _find_source(job_id)
    if src is not None:
        return src
    d = settings.PROCESSED_DIR / job_id
    if d.exists():
        for p in sorted(d.glob("*")):
            if p.is_file() and p.stat().st_size > 0 and p.name != "result.json":
                return p
    raise FileNotFoundError(f"No source audio for job {job_id}")


def _load_existing(job_id: str) -> dict:
    return store.load_result(job_id) or {"job_id": job_id, "warnings": []}


def _save(job_id: str, result: dict) -> dict:
    store.save_result(job_id, result)
    return result


def run_chords(progress, job_id: str, options: dict | None = None) -> dict:
    options = options or {}
    src = _source_for(job_id)
    progress(10, "Decoding…")
    a = loader_mod.load_audio(src)
    progress(30, "Extracting features…")
    f = features_mod.extract(a.y, a.sr)
    progress(55, "Detecting chords…")
    res = chords_mod.detect_chords(f)
    result = _load_existing(job_id)
    result["chords"] = res
    result.setdefault("overview", {}).update({
        "bpm": round(f.tempo, 1),
        "key": T.pc_name(f.key_pc) + (" minor" if f.key_is_minor else " major"),
        "beats_per_bar": f.beats_per_bar,
        "duration": round(f.duration, 2),
    })
    progress(100, "Chords done")
    return _save(job_id, result)


def run_transcribe(progress, job_id: str, options: dict | None = None) -> dict:
    options = options or {}
    tuning = T.TUNING_PRESETS.get(options.get("tuning", "standard"), T.STANDARD_TUNING)
    src = _source_for(job_id)
    # prefer an isolated guitar stem or filtered guitar harmonic if we made one
    guitar_stem = settings.PROCESSED_DIR / job_id / "stems" / "guitar.wav"
    if not guitar_stem.exists():
        guitar_stem = settings.PROCESSED_DIR / job_id / "stems" / "guitar_approx.wav"
    if not guitar_stem.exists():
        guitar_stem = settings.PROCESSED_DIR / job_id / "stems" / "mid_harmonic.wav"
    use_path = guitar_stem if guitar_stem.exists() else src

    progress(15, "Decoding…")
    a = loader_mod.load_audio(use_path)
    progress(35, "Extracting features…")
    f = features_mod.extract(a.y, a.sr)
    progress(55, "Transcribing notes…")
    tr = notes_mod.transcribe(str(use_path), a.y, a.sr,
                              use_basic_pitch=settings.USE_BASIC_PITCH)
    notes = tr.get("notes", [])
    progress(75, "Building tablature…")
    tab = tabs_mod.build(notes, tuning=tuning, capo=int(options.get("capo", 0)),
                         tempo=f.tempo, beats_per_bar=f.beats_per_bar, duration=f.duration)
    progress(90, "Analysing scales…")
    sc = scales_mod.analyse(notes, f.key_pc, f.key_is_minor, tuning)

    result = _load_existing(job_id)
    result["solo"] = {"engine": tr.get("engine"), "notes": tab.get("placed") or notes,
                      "phrases": notes_mod.repeated_phrases(notes),
                      "source": "guitar stem" if guitar_stem.exists() else "full mix"}
    result["tabs"] = tab
    result["scales"] = sc
    result.setdefault("warnings", []).extend(tr.get("warnings", []))
    result.setdefault("overview", {}).update({"bpm": round(f.tempo, 1),
                                              "note_count": len(notes),
                                              "duration": round(f.duration, 2)})
    progress(100, "Transcription done")
    return _save(job_id, result)


def run_scales(progress, job_id: str, options: dict | None = None) -> dict:
    options = options or {}
    result = _load_existing(job_id)
    notes = (result.get("solo") or {}).get("notes") or \
            [p for p in (result.get("tabs") or {}).get("placed", [])]
    if not notes:
        progress(100, "No notes available — run transcription first.")
        result["scales"] = {"note": "Run transcription first — no notes to analyse."}
        return _save(job_id, result)

    tuning = T.TUNING_PRESETS.get(options.get("tuning", "standard"), T.STANDARD_TUNING)
    src = _source_for(job_id)
    a = loader_mod.load_audio(src)
    f = features_mod.extract(a.y, a.sr)
    progress(60, "Matching scales…")
    sc = scales_mod.analyse(notes, f.key_pc, f.key_is_minor, tuning)
    result["scales"] = sc
    result.setdefault("overview", {}).update({
        "key": sc.get("song_key"), "bpm": round(f.tempo, 1)})
    progress(100, "Scale analysis done")
    return _save(job_id, result)


def run_separate(progress, job_id: str, options: dict | None = None) -> dict:
    options = options or {}
    src = _source_for(job_id)
    progress(10, "Decoding audio…")
    a = loader_mod.load_audio(src)
    solo_only = bool(options.get("solo_only", True))
    strength = float(options.get("strength", 0.85))
    mode = options.get("mode")
    existing = _load_existing(job_id)
    notes = (existing.get("solo") or {}).get("notes") or []
    if solo_only:
        progress(25, "Removing lead guitar solo with phase-preserving clarity (bass, drums & keys 100% clear)…")
    else:
        progress(25, "Cutting all guitar frequencies…")
    stems = sep_mod.separate(
        src,
        a.y,
        a.sr,
        job_id,
        progress=progress,
        mode=mode,
        solo_only=solo_only,
        strength=strength,
        notes=notes,
    )
    result = _load_existing(job_id)
    result["stems"] = stems
    result["backing"] = stems.get("backing")
    result["guitar"] = stems.get("guitar")
    result["rhythm_guitar"] = stems.get("rhythm_guitar")
    result.setdefault("warnings", []).extend(stems.get("warnings", []))
    progress(100, "Backing track complete!")
    return _save(job_id, result)

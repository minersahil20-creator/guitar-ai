"""
pipeline.py — the conductor. Runs every stage of an analysis in order,
reports progress, and never lets one failing stage kill the whole job.

Order matters: separating stems FIRST (when asked) means the solo
transcription can run on the isolated guitar, which is much more accurate
than transcribing a full mix.
"""

from __future__ import annotations

import shutil
import time
from pathlib import Path

import numpy as np

from app.ai import gemini, local_explanations
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

WAVEFORM_POINTS = 600


def _waveform(y: np.ndarray, points: int = WAVEFORM_POINTS) -> list[float]:
    """Downsample the amplitude envelope for the UI's waveform display."""
    if y.size == 0:
        return []
    n = len(y)
    step = max(1, n // points)
    out = []
    for i in range(0, n, step):
        chunk = y[i:i + step]
        if chunk.size == 0:
            continue
        # peak (not RMS) draws a waveform that looks like a real DAW
        out.append(round(float(np.max(np.abs(chunk))), 4))
    return out[:points]


def run(progress, job_id: str, source_path: str | Path,
        options: dict | None = None) -> dict:
    """Main analysis. `progress(percent, message, stage)` is supplied by jobs.py."""
    options = options or {}
    do_separation = bool(options.get("separation", True))
    do_transcription = bool(options.get("transcription", True))
    use_gemini = bool(options.get("gemini", True)) and settings.GEMINI_ENABLED
    tuning_key = options.get("tuning", "standard")
    tuning = T.TUNING_PRESETS.get(tuning_key, T.STANDARD_TUNING)
    capo = int(options.get("capo", 0) or 0)
    max_fret = int(options.get("max_fret", 22) or 22)

    warnings: list[str] = []
    engines: dict[str, str] = {}
    t0 = time.time()
    src = Path(source_path)

    # ── 1. load ──────────────────────────────────────────────
    progress(4, "Decoding audio…", "load")
    audio = loader_mod.load_audio(src)
    y, sr = audio.y, audio.sr
    job_dir = store.job_dir(job_id)
    media_dir = job_dir / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    media_copy = media_dir / f"original{src.suffix.lower()}"
    if not media_copy.exists():
        try:
            shutil.copy2(src, media_copy)
        except OSError:
            media_copy = src

    progress(8, f"Decoded {audio.duration:.1f}s via {audio.decoder}", "load")
    engines["decoder"] = audio.decoder

    # ── 2. features ──────────────────────────────────────────
    progress(12, "Extracting tempo, beats and chroma…", "features")
    f = features_mod.extract(y, sr)
    progress(24, f"Tempo ≈ {f.tempo:.0f} BPM, key ≈ {f.key_name}", "features")
    engines["key"] = "krumhansl-temperley-chroma"

    # ── 3. chords ────────────────────────────────────────────
    progress(28, "Detecting chords…", "chords")
    chord_result = chords_mod.detect_chords(f)
    engines["chords"] = chord_result.get("engine", "unknown")
    # attach playable guitar diagrams to every detected chord
    prefer_flat = f.key_is_minor and f.key_pc in (1, 3, 6, 8, 10)
    for seg in chord_result.get("chords", []):
        seg["diagrams"] = T.chord_diagrams(seg["root_pc"], seg["quality"], tuning,
                                           prefer_flat=prefer_flat)
    for item in chord_result.get("progression", []):
        item["diagrams"] = T.chord_diagrams(item["root_pc"], item["quality"], tuning,
                                            prefer_flat=prefer_flat, max_diagrams=1)
    if chord_result.get("note"):
        warnings.append(chord_result["note"])
    progress(38, f"Found {len(chord_result['chords'])} chord segments", "chords")

    # ── 4. separation (optional, expensive) ──────────────────
    stems_result = None
    transcription_audio = (y, sr, str(src))
    if do_separation:
        progress(40, "Preparing source separation…", "separation")
        try:
            stems_result = sep_mod.separate(src, y, sr, job_id, progress=progress)
            engines["separation"] = stems_result["engine"]
            warnings.extend(stems_result.get("warnings", []))
            gp = job_dir / "stems" / "guitar.wav"
            if not gp.exists():
                gp = job_dir / "stems" / "guitar_approx.wav"
            if not gp.exists():
                gp = job_dir / "stems" / "mid_harmonic.wav"
            if gp.exists():
                ga = loader_mod.load_audio(gp)
                transcription_audio = (ga.y, ga.sr, str(gp))
                warnings.insert(0, "Solo transcription ran on the guitar/mid-harmonic stem for cleaner note detection.")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Source separation failed: {type(exc).__name__}: {exc}")
    else:
        engines["separation"] = "skipped"

    # ── 5. transcription ─────────────────────────────────────
    notes: list[dict] = []
    phrases: list[dict] = []
    trans_result: dict = {"notes": [], "engine": "skipped", "warnings": []}
    if do_transcription:
        progress(72, "Transcribing notes…", "transcription")
        ty, tsr, tpath = transcription_audio
        trans_result = notes_mod.transcribe(tpath, ty, tsr,
                                            use_basic_pitch=settings.USE_BASIC_PITCH)
        notes = trans_result.get("notes", [])
        engines["transcription"] = trans_result.get("engine", "none")
        warnings.extend(trans_result.get("warnings", []))
        progress(80, f"{len(notes)} notes detected", "transcription")
        if notes:
            phrases = notes_mod.repeated_phrases(notes)

    # ── 6. tabs ──────────────────────────────────────────────
    tab_result: dict = {"placed": [], "tab": {"lines": [], "bars": []}, "stats": {}}
    if notes:
        progress(84, "Working out fingerings and building tablature…", "tabs")
        tab_result = tabs_mod.build(notes, tuning=tuning, capo=capo, tempo=f.tempo,
                                    beats_per_bar=f.beats_per_bar, duration=f.duration,
                                    max_fret=max_fret)
        engines["tabs"] = "dp-fingering-search"

    # ── 7. scales ────────────────────────────────────────────
    progress(88, "Analysing scales…", "scales")
    scale_result = scales_mod.analyse(notes, f.key_pc, f.key_is_minor, tuning)
    engines["scales"] = scale_result.get("engine", "histogram-match")

    # ── 8. waveform + assemble ───────────────────────────────
    progress(92, "Building waveform and results…", "assemble")
    wave = _waveform(y)

    # ── 9. AI explanation ────────────────────────────────────
    progress(94, "Writing your musical explanation…", "ai")
    facts = {
        "duration": f.duration,
        "tempo": f.tempo,
        "beats_per_bar": f.beats_per_bar,
        "song_key": scale_result.get("song_key"),
        "key_confidence": f.key_confidence,
        "alternative_keys": [k["key"] for k in f.key_scores[1:4]],
        "chords": chord_result["chords"],
        "progression": chord_result.get("progression", []),
        "solo_scale": scale_result.get("solo_scale"),
        "alternative_scales": scale_result.get("alternatives", []),
        "out_of_scale": scale_result.get("out_of_scale") or {},
        "relationship": scale_result.get("relationship") or {},
        "fretboard_boxes": (scale_result.get("fretboard") or {}).get("boxes", []),
        "notes": tab_result.get("placed") or notes,
        "technique_counts": (tab_result.get("stats") or {}).get("techniques", {}),
        "repeated_phrases": phrases,
        "engines": engines,
        "warnings": warnings[:5],
    }

    ai_block: dict
    if use_gemini:
        try:
            client = gemini.GeminiClient()
            ai_block = client.explain(facts)
        except gemini.GeminiError as exc:
            warnings.append(f"Gemini explanation unavailable: {exc}")
            ai_block = local_explanations.explain(facts)
            ai_block["fallback_reason"] = str(exc)
    else:
        ai_block = local_explanations.explain(facts)
        if not settings.GEMINI_API_KEY:
            ai_block["fallback_reason"] = (
                "No GEMINI_API_KEY set — showing free local (data-derived) explanations."
            )

    # ── 10. persist ──────────────────────────────────────────
    progress(97, "Saving…", "save")
    result = {
        "job_id": job_id,
        "status": "done",
        "created_at": time.time(),
        "processing_seconds": round(time.time() - t0, 2),
        "options": options,
        "media": {
            "filename": src.name,
            "duration": round(f.duration, 3),
            "sample_rate": sr,
            "decoder": audio.decoder,
            "waveform": wave,
            "url": f"/api/audio/{job_id}/media/original{src.suffix.lower()}",
        },
        "overview": {
            "duration": round(f.duration, 2),
            "bpm": round(f.tempo, 1),
            "key": scale_result.get("song_key"),
            "key_confidence": round(f.key_confidence, 3),
            "alternative_keys": f.key_scores[:5],
            "beats_per_bar": f.beats_per_bar,
            "time_signature": f"{f.beats_per_bar}/4",
            "beat_count": int(len(f.beat_times)),
            "beat_times": [round(float(t), 4) for t in f.beat_times[:4000]],
            "downbeat_times": [round(float(t), 4) for t in f.downbeat_times[:2000]],
            "chord_count": len(chord_result["chords"]),
            "note_count": len(notes),
            "tuning": tuning,
            "capo": capo,
        },
        "chords": chord_result,
        "solo": {
            "engine": trans_result.get("engine"),
            "source": "isolated guitar stem" if transcription_audio[2] != str(src) else "full mix",
            "notes": (tab_result.get("placed") or notes)[:4000],
            "phrases": phrases,
            "range": {
                "lowest": T.midi_to_name(min((n["midi"] for n in notes), default=64)),
                "highest": T.midi_to_name(max((n["midi"] for n in notes), default=64)),
            } if notes else None,
        },
        "tabs": tab_result,
        "scales": scale_result,
        "stems": stems_result,
        "ai": ai_block,
        "warnings": warnings,
        "engines": engines,
        "capabilities": {
            "basic_pitch_installed": notes_mod.basic_pitch_available(),
            "demucs_installed": sep_mod.demucs_available(),
            "crepe_installed": notes_mod.crepe_available(),
            "gemini_configured": bool(settings.GEMINI_API_KEY),
        },
    }

    store.save_result(job_id, result)

    # ── 11. register as a project ────────────────────────────
    store.create_project(
        name=options.get("name") or src.stem[:60],
        job_id=job_id,
        source_type=options.get("source_type", "upload"),
        source_name=src.name,
        duration=round(f.duration, 2),
        bpm=round(f.tempo, 1),
        key=scale_result.get("song_key"),
        solo_scale=(scale_result.get("solo_scale") or {}).get("name"),
        chord_count=len(chord_result["chords"]),
        note_count=len(notes),
        engines=engines,
        has_stems=bool(stems_result and stems_result.get("stems")),
    )

    progress(100, "Analysis complete", "done")
    return {"job_id": job_id, "status": "done"}

"""Health + capability reporting so the UI can show what is really installed."""

from __future__ import annotations

import importlib.util
import platform
import shutil

from fastapi import APIRouter

from app.ai import gemini
from app.audio import notes as notes_mod
from app.audio import separation as sep_mod
from app.core.config import settings
from app.services import url_fetch

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health():
    return {
        "status": "ok",
        "service": "guitar-ai-backend",
        "version": "v1.0.6-production",
        "has_deno": bool(shutil.which("deno")),
        "has_ejs": bool(importlib.util.find_spec("yt_dlp_ejs")),
        "python": platform.python_version(),
        "platform": platform.system(),
    }


@router.get("/capabilities")
def capabilities():
    """Tells the frontend exactly which engines will run — no guessing."""
    _uf = url_fetch.capabilities()
    _ff = _uf["ffmpeg"]
    bp = notes_mod.basic_pitch_available()
    dm = sep_mod.demucs_available()
    cr = notes_mod.crepe_available()
    gc = gemini.GeminiClient()

    engines = [
        {"id": "librosa-dsp", "name": "Librosa DSP (tempo, key, chroma, onsets)",
         "installed": True, "required": True,
         "note": "Core analysis. Always available."},
        {"id": "chord-recognition", "name": "Chroma template + Viterbi chord recogniser",
         "installed": True, "required": True,
         "note": "Built into this repo (app/audio/chords.py)."},
        {"id": "pitch-tracker", "name": "CQT multi-pitch tracker (built-in fallback)",
         "installed": True, "required": True,
         "note": "Pure NumPy/librosa transcription. Works everywhere."},
        {"id": "basic-pitch", "name": "Spotify Basic Pitch (neural audio→MIDI)",
         "installed": bp, "required": False,
         "note": ("Installed — neural transcription active." if bp else
                  "NOT installed. Run: pip install basic-pitch  "
                  "(needs Python 3.11/3.12 — see README). The built-in tracker is used instead.")},
        {"id": "demucs", "name": "Meta Demucs (stem separation, htdemucs_6s guitar stem)",
         "installed": dm, "required": False,
         "note": ("Installed — true source separation with a real guitar stem." if dm else
                  "NOT installed. Run: pip install -U demucs  "
                  "Filter-based fallback stems are used instead (clearly labelled).")},
        {"id": "crepe", "name": "CREPE pitch tracker",
         "installed": cr, "required": False,
         "note": ("Installed." if cr else "NOT installed (optional). Run: pip install crepe")},
        {"id": "gemini", "name": "Google Gemini (Flash-Lite) musical explanations",
         "installed": gc.available, "required": False,
         "note": ("Configured with models: " + ", ".join(settings.GEMINI_MODELS) if gc.available else
                  "No API key set — free local data-derived explanations are used. "
                  "Add GEMINI_API_KEY to backend/.env to enable.")},
        {"id": "ffmpeg", "name": "ffmpeg (decodes mp3/m4a/mp4 and every video format)",
         "installed": _ff is not None, "required": False,
         "note": (f"Installed at {_ff}." if _ff else
                  "NOT found. Without it, only wav/flac/ogg upload reliably; "
                  "install it with: pip install imageio-ffmpeg")},
        {"id": "yt-dlp", "name": "yt-dlp (fetch the audio behind pasted links)",
         "installed": _uf["yt_dlp"] is not None, "required": False,
         "note": ((f"Installed (v{_uf['yt_dlp']}). " if _uf["yt_dlp"] else
                   "NOT installed. Run: pip install yt-dlp  ") +
                  ("Link fetching is ON." if _uf["enabled"] else
                   "Link fetching is OFF — set ENABLE_URL_FETCH=true in backend/.env.") +
                  (" Cookies file loaded." if _uf["cookies_file"] else ""))},
    ]

    return {
        "engines": engines,
        "limits": {
            "max_upload_mb": settings.MAX_UPLOAD_MB,
            "max_duration_seconds": settings.MAX_DURATION_SEC,
            "allowed_extensions": sorted(settings.ALLOWED_EXTENSIONS),
        },
        "gemini": gemini.capabilities(),
        "url_fetch_enabled": settings.ENABLE_URL_FETCH,
        "url_fetch": _uf,
    }

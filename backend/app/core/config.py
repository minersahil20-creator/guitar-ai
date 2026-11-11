"""
config.py — every setting for the backend lives here.

BEGINNER NOTE:
You change settings in ONE place: the file `backend/.env`
(copy it from `backend/.env.example`). Nothing here needs editing normally.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# backend/app/core/config.py -> up 3 = backend/
BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent

load_dotenv(BACKEND_DIR / ".env")


def _env_bool(name: str, default: bool = False) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


class Settings:
    # ── paths ────────────────────────────────────────────────
    PROJECT_ROOT: Path = PROJECT_ROOT
    BACKEND_DIR: Path = BACKEND_DIR
    UPLOAD_DIR: Path = PROJECT_ROOT / "uploads"
    PROCESSED_DIR: Path = PROJECT_ROOT / "processed"
    MODELS_DIR: Path = PROJECT_ROOT / "models"
    DB_PATH: Path = PROCESSED_DIR / "store.json"

    # ── server ───────────────────────────────────────────────
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = _env_int("PORT", 8000)
    RELOAD: bool = _env_bool("RELOAD", False)
    # Browser origins allowed to talk to the API (CORS).
    CORS_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()
    ]

    # ── upload limits ────────────────────────────────────────
    MAX_UPLOAD_MB: int = _env_int("MAX_UPLOAD_MB", 200)
    MAX_DURATION_SEC: float = _env_float("MAX_DURATION_SEC", 900)      # 15 min
    MIN_DURATION_SEC: float = _env_float("MIN_DURATION_SEC", 1.0)
    ALLOWED_EXTENSIONS: set[str] = {
        # audio
        ".mp3", ".wav", ".flac", ".ogg", ".oga", ".m4a", ".aac", ".opus", ".aiff", ".aif", ".webm",
        # video (audio is extracted via ffmpeg/decoder if present)
        ".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v",
    }
    AUDIO_MIME_HINTS: set[str] = {
        "audio/", "video/", "application/octet-stream", "application/mp4",
    }

    # ── analysis defaults ────────────────────────────────────
    SAMPLE_RATE: int = _env_int("SAMPLE_RATE", 44100)
    # Mono is what every analysis model here expects.
    MONO: bool = True

    # ── Gemini (optional) ────────────────────────────────────
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "").strip()
    # Verified against Google's model docs (Nov 2026): these Flash-Lite /
    # Flash ids are the ones offered on the no-billing free tier. The app
    # tries them in order and uses the first one your key can reach.
    GEMINI_MODELS: list[str] = [
        m.strip() for m in os.getenv(
            "GEMINI_MODELS",
            "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.1-flash-lite-preview,gemini-3.8-flash",
        ).split(",") if m.strip()
    ]
    GEMINI_TIMEOUT_SEC: int = _env_int("GEMINI_TIMEOUT_SEC", 60)
    GEMINI_ENABLED: bool = _env_bool("GEMINI_ENABLED", True)

    # ── heavy model switches (all optional) ──────────────────
    USE_BASIC_PITCH: bool = _env_bool("USE_BASIC_PITCH", True)
    USE_DEMUCS: bool = _env_bool("USE_DEMUCS", True)
    DEMUCS_MODEL: str = os.getenv("DEMUCS_MODEL", "htdemucs_6s")  # 6-stem -> real guitar stem
    DEMUCS_FALLBACK_MODEL: str = os.getenv("DEMUCS_FALLBACK_MODEL", "htdemucs")
    DEMUCS_DEVICE: str = os.getenv("DEMUCS_DEVICE", "cpu")
    DEMUCS_SHIFTS: int = _env_int("DEMUCS_SHIFTS", 1)   # 1 = fast, 5 = best quality
    DEMUCS_JOBS: int = _env_int("DEMUCS_JOBS", 1)
    # Seconds of audio processed at once. Lower = less RAM (6 = safe on CPU).
    DEMUCS_SEGMENT: int = _env_int("DEMUCS_SEGMENT", 6)
    # Skip Demucs entirely when less than this much RAM is free (MB).
    DEMUCS_MIN_RAM_MB: int = _env_int("DEMUCS_MIN_RAM_MB", 500)

    # ── media download (opt-in, permitted content only) ──────
    # On by default now: links are fetched with yt-dlp, but ONLY public media.
    # Age gates, private media, paywalls and "confirm you're not a bot" checks
    # are never bypassed — see backend/app/services/url_fetch.py.
    ENABLE_URL_FETCH: bool = _env_bool("ENABLE_URL_FETCH", True)
    YTDLP_PATH: str = os.getenv("YTDLP_PATH", "yt-dlp")
    # Longest clip we will pull from a link (seconds). Also caps RAM usage.
    URL_MAX_DURATION_SEC: float = _env_float("URL_MAX_DURATION_SEC", 900)
    # Default to backend/cookies.txt if present
    YTDLP_COOKIES_FILE: str = os.getenv(
        "YTDLP_COOKIES_FILE",
        str(BACKEND_DIR / "cookies.txt") if (BACKEND_DIR / "cookies.txt").exists() else ""
    ).strip()
    # YouTube player clients tried in order (some work on IPs where others don't).
    YTDLP_PLAYER_CLIENTS: str = os.getenv(
        "YTDLP_PLAYER_CLIENTS", "").strip()
    YTDLP_FORMAT: str = os.getenv("YTDLP_FORMAT", "bestaudio/best")

    # ── housekeeping ─────────────────────────────────────────
    KEEP_TEMP_HOURS: int = _env_int("KEEP_TEMP_HOURS", 24)


settings = Settings()

for _d in (settings.UPLOAD_DIR, settings.PROCESSED_DIR, settings.MODELS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

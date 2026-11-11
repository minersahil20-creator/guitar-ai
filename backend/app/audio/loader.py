"""
loader.py — safely turn an uploaded file into a mono float waveform.

BEGINNER NOTE:
Everything downstream works on two things: `y` (a NumPy array of samples,
values between -1 and 1) and `sr` (sample rate, e.g. 44100).
This file's only job is to produce those, plus honest error messages.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.core.config import settings


class AudioLoadError(Exception):
    """Raised when a file cannot be decoded. Message is safe to show the user."""


@dataclass
class LoadedAudio:
    y: np.ndarray
    sr: int
    duration: float
    source_path: Path
    decoder: str          # which decoder actually did the work


SUPPORTED = settings.ALLOWED_EXTENSIONS


def validate_upload(filename: str, size_bytes: int) -> None:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED:
        raise AudioLoadError(
            f"File type '{ext or 'unknown'}' is not supported. "
            f"Allowed: {', '.join(sorted(e.lstrip('.') for e in SUPPORTED))}"
        )
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if size_bytes <= 0:
        raise AudioLoadError("The uploaded file is empty.")
    if size_bytes > max_bytes:
        raise AudioLoadError(
            f"File is {size_bytes / 1e6:.1f} MB — the limit is {settings.MAX_UPLOAD_MB} MB. "
            f"Trim the clip or raise MAX_UPLOAD_MB in backend/.env."
        )


def save_upload(fileobj, filename: str) -> Path:
    """Stream an upload to disk with a random name (never trust user filenames)."""
    ext = Path(filename).suffix.lower()
    dest = settings.UPLOAD_DIR / f"{uuid.uuid4().hex}{ext}"
    with open(dest, "wb") as out:
        shutil.copyfileobj(fileobj, out, length=1024 * 1024)
    return dest


def _has_ffmpeg() -> bool:
    # ensure_ffmpeg() also exposes the pip-installed static binary on PATH,
    # so mp3/m4a/video decoding works without a system ffmpeg install.
    from app.core.ffmpeg import ensure_ffmpeg
    return ensure_ffmpeg() is not None


def _decode_with_ffmpeg(path: Path, sr: int) -> np.ndarray | None:
    """Decode ANY audio/video container ffmpeg understands -> mono float32."""
    if not _has_ffmpeg():
        return None
    cmd = [
        "ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
        "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-",
    ]
    try:
        raw = subprocess.run(cmd, capture_output=True, timeout=600).stdout
    except (subprocess.SubprocessError, OSError):
        return None
    if not raw:
        return None
    return np.frombuffer(raw, dtype="<f4").astype(np.float32)


def _decode_with_librosa(path: Path, sr: int) -> np.ndarray:
    import librosa
    y, _ = librosa.load(str(path), sr=sr, mono=True)
    return np.asarray(y, dtype=np.float32)


def _decode_with_soundfile(path: Path, sr: int) -> np.ndarray:
    import soundfile as sf
    data, native_sr = sf.read(str(path), dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    if native_sr != sr:
        import librosa
        data = librosa.resample(data, orig_sr=native_sr, target_sr=sr)
    return np.asarray(data, dtype=np.float32)


def load_audio(path: str | Path, sr: int | None = None) -> LoadedAudio:
    """
    Load a file into (y, sr). Tries, in order:
      1. ffmpeg  — handles mp3/m4a/mp4/mkv/… (install ffmpeg if you can)
      2. soundfile — wav/flac/ogg/opus/aiff
      3. librosa (audioread fallback) — mp3 etc. without ffmpeg
    """
    sr = sr or settings.SAMPLE_RATE
    p = Path(path)
    if not p.exists():
        raise AudioLoadError(f"File not found: {p.name}")
    if p.stat().st_size == 0:
        raise AudioLoadError("The uploaded file is empty (0 bytes).")

    y = None
    decoder = ""
    # mp4/mkv/mov are video containers: skip straight to ffmpeg.
    video_ext = p.suffix.lower() in {".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm"}
    if video_ext:
        y = _decode_with_ffmpeg(p, sr)
        decoder = "ffmpeg"
        if y is None or y.size == 0:
            raise AudioLoadError(
                "This is a video file and no audio track could be decoded. "
                "Install ffmpeg (see README) so the app can pull the audio out, "
                "or upload an audio file (.wav/.mp3/.m4a) instead."
            )
    else:
        try:
            y = _decode_with_soundfile(p, sr)
            decoder = "soundfile"
        except Exception:
            y = None
        if y is None or y.size == 0:
            y = _decode_with_ffmpeg(p, sr)
            decoder = "ffmpeg"
        if y is None or y.size == 0:
            try:
                y = _decode_with_librosa(p, sr)
                decoder = "librosa/audioread"
            except Exception as exc:  # noqa: BLE001
                raise AudioLoadError(
                    f"Could not decode '{p.name}'. {exc} "
                    "If this is an mp3/m4a, install ffmpeg and try again."
                ) from exc

    y = np.nan_to_num(np.asarray(y, dtype=np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    duration = float(len(y)) / float(sr)

    if duration < settings.MIN_DURATION_SEC:
        raise AudioLoadError(
            f"Clip is only {duration:.2f}s long — at least "
            f"{settings.MIN_DURATION_SEC:.0f}s is needed for meaningful analysis."
        )
    if duration > settings.MAX_DURATION_SEC:
        raise AudioLoadError(
            f"Clip is {duration / 60:.1f} minutes — the limit is "
            f"{settings.MAX_DURATION_SEC / 60:.0f} minutes. "
            "Trim it, or raise MAX_DURATION_SEC in backend/.env "
            "(long files are slow on CPU-only machines)."
        )
    if float(np.max(np.abs(y))) < 1e-4:
        raise AudioLoadError("This file decoded to near-silence — there is nothing to analyse.")

    return LoadedAudio(y=y, sr=sr, duration=duration, source_path=p, decoder=decoder)


def write_wav(path: str | Path, y: np.ndarray, sr: int) -> Path:
    """Write mono or multi-channel float audio to a 16-bit PCM wav (browser-safe)."""
    import soundfile as sf

    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    y = np.asarray(y, dtype=np.float32)
    if y.ndim == 1:
        data = y
    else:
        # soundfile expects (frames, channels)
        if y.shape[0] < y.shape[1]:
            data = y.T
        else:
            data = y
    data = np.clip(data, -1.0, 1.0)
    sf.write(str(p), data, sr, subtype="PCM_16")
    return p


def normalize_peak(y: np.ndarray, target: float = 0.89) -> np.ndarray:
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    if peak < 1e-6:
        return y
    return (y / peak * target).astype(np.float32)


def file_size_mb(path: str | Path) -> float:
    return os.path.getsize(path) / 1e6

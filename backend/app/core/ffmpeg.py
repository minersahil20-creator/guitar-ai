"""
ffmpeg.py — find an ffmpeg binary, and make sure the rest of the app can see it.

WHY THIS EXISTS
---------------
ffmpeg decodes mp3 / m4a / mp4 / mkv and converts downloaded audio. Installing
it system-wide is annoying (admin rights, package managers, PATH edits on
Windows), so we also accept the **static binary** shipped by the pip package
`imageio-ffmpeg` (pip install imageio-ffmpeg).

The catch: most tools look ffmpeg up on the OS `PATH`. A binary sitting in a
Python site-packages folder is invisible to them — yt-dlp's own availability
check even ignores its `--ffmpeg-location` option. So when all we have is the
static binary, we drop a symlink into `backend/.bin` and prepend that folder to
PATH. After that, everything (our loader, yt-dlp, subprocess calls) finds it.
"""

from __future__ import annotations

import os
import shutil
import stat
from pathlib import Path

# backend/app/core/ffmpeg.py -> parents[2] == backend/  (we put the symlink there)
_BIN_DIR = Path(__file__).resolve().parents[2] / ".bin"


def system_ffmpeg() -> str | None:
    """ffmpeg already installed on the machine (best case)."""
    return shutil.which("ffmpeg")


def static_ffmpeg() -> str | None:
    """The pip-installed static binary, if present."""
    try:
        import imageio_ffmpeg  # noqa: PLC0415
        p = imageio_ffmpeg.get_ffmpeg_exe()
        return p if p and Path(p).exists() else None
    except Exception:  # noqa: BLE001
        return None


def ensure_ffmpeg() -> str | None:
    """
    Return a path to a usable ffmpeg, or None if there is none at all.

    Side effect (only when needed): symlinks the static binary into
    `backend/.bin` and prepends it to PATH for this process.
    """
    found = system_ffmpeg()
    if found:
        return found

    src = static_ffmpeg()
    if not src:
        return None

    ext = ".exe" if os.name == "nt" else ""
    target_name = f"ffmpeg{ext}"
    target_bin = _BIN_DIR / target_name

    try:
        _BIN_DIR.mkdir(parents=True, exist_ok=True)
        if not target_bin.exists() or target_bin.stat().st_size == 0:
            try:
                # Try hardlink first (fast, zero extra disk space)
                os.link(src, target_bin)
            except OSError:
                try:
                    # Try symlink
                    target_bin.symlink_to(src)
                except OSError:
                    # Copy binary as reliable fallback on Windows
                    shutil.copy2(src, target_bin)
        os.chmod(target_bin, os.stat(target_bin).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    except OSError:
        pass

    if str(_BIN_DIR) not in os.environ.get("PATH", ""):
        os.environ["PATH"] = f"{_BIN_DIR}{os.pathsep}{os.environ.get('PATH', '')}"
        if hasattr(shutil.which, "cache_clear"):
            shutil.which.cache_clear()

    return shutil.which("ffmpeg") or (str(target_bin) if target_bin.exists() else src)

"""
media.py — upload handling, real link fetching, and audio file serving.

URL POLICY (please read)
------------------------
We fetch the audio behind links you paste, but only when the platform serves it
publicly. Concretely, `url_fetch.py` will:
  * download publicly accessible media (your own uploads, CC / public-domain
    material, anything you have permission to analyse),
  * STOP and explain itself when a platform answers with an age gate, a private
    or members-only item, a region/copyright block, or a "confirm you're not a
    bot" check. We never decrypt, de-DRM, or fake a login.

One thing to know up front: YouTube, Instagram and TikTok block downloads from
server / cloud IP addresses (which is what any hosted demo runs on). From a home
or mobile connection the same link normally works fine. When it is blocked we
say exactly that, instead of pretending the link is broken.
"""

from __future__ import annotations

import re
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from app.audio import loader
from app.core.config import settings
from app.services import store
from app.services import url_fetch

router = APIRouter(prefix="/api", tags=["media"])

# ─────────────────────────────────────────────────────────────
# URL recognition
# ─────────────────────────────────────────────────────────────

URL_PATTERNS = [
    ("youtube_shorts", re.compile(r"(https?://)?(www\.)?youtube\.com/shorts/[\w-]+", re.I)),
    ("youtube", re.compile(r"(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|music\.youtube\.com/watch\?v=)[\w-]+", re.I)),
    ("instagram_reel", re.compile(r"(https?://)?(www\.)?instagram\.com/(reel|reels|p)/[\w-]+", re.I)),
    ("instagram", re.compile(r"(https?://)?(www\.)?instagram\.com/[\w./-]+", re.I)),
    ("tiktok", re.compile(r"(https?://)?(www\.)?tiktok\.com/@[\w./-]+", re.I)),
    ("soundcloud", re.compile(r"(https?://)?(www\.)?soundcloud\.com/[\w./-]+", re.I)),
    ("bandcamp", re.compile(r"(https?://)?[\w-]+\.bandcamp\.com/track/[\w-]+", re.I)),
    ("vimeo", re.compile(r"(https?://)?(www\.)?vimeo\.com/\d+", re.I)),
    ("twitter", re.compile(r"(https?://)?(www\.)?(twitter|x)\.com/[\w./-]+", re.I)),
    ("facebook", re.compile(r"(https?://)?(www\.)?facebook\.com/[\w./-]+", re.I)),
    ("direct_audio", re.compile(r"^https?://.+\.(mp3|wav|flac|ogg|oga|m4a|aac|opus|mp4|webm|mkv|mov)(\?.*)?$", re.I)),
]

# What we tell the user about each platform. `note` is the honest caveat.
PLATFORM_HELP = {
    "youtube": {
        "name": "YouTube video",
        "note": "Works from a home/mobile internet connection. If the backend runs on a "
                "server, YouTube usually answers with a bot check.",
    },
    "youtube_shorts": {
        "name": "YouTube Short",
        "note": "Treated exactly like a normal YouTube video.",
    },
    "instagram_reel": {
        "name": "Instagram Reel",
        "note": "Instagram normally requires a logged-in session. Without cookies "
                "(YTDLP_COOKIES_FILE) these are usually refused.",
    },
    "instagram": {
        "name": "Instagram post",
        "note": "Instagram normally requires a logged-in session.",
    },
    "tiktok": {
        "name": "TikTok video",
        "note": "TikTok frequently blocks server IPs; audio is often licensed music.",
    },
    "soundcloud": {
        "name": "SoundCloud track",
        "note": "Public tracks download fine; 'Go+' / private tracks do not.",
    },
    "bandcamp": {
        "name": "Bandcamp track",
        "note": "Public (free) tracks download fine.",
    },
    "vimeo": {
        "name": "Vimeo video",
        "note": "Public videos work; login-only or domain-locked videos are refused.",
    },
    "twitter": {
        "name": "X / Twitter video",
        "note": "Works for public video posts.",
    },
    "facebook": {
        "name": "Facebook video",
        "note": "Only public videos; Facebook blocks most automated access.",
    },
    "direct_audio": {
        "name": "Direct audio file link",
        "note": "Fetched directly — no platform involved.",
    },
}


def classify_url(url: str) -> dict:
    """Identify a pasted link and say whether we could fetch it."""
    url = (url or "").strip()
    if not url:
        return {"ok": False, "kind": "empty", "can_fetch": False,
                "message": "Paste a link first."}
    if not url.startswith(("http://", "https://")):
        return {"ok": False, "kind": "invalid", "can_fetch": False,
                "message": "That doesn't look like a web link (it should start with https://)."}

    for kind, pattern in URL_PATTERNS:
        if pattern.search(url):
            base = kind.split("_")[0]
            info = PLATFORM_HELP.get(kind) or PLATFORM_HELP.get(base) or {}
            return {
                "ok": True,
                "kind": kind,
                "name": info.get("name", kind),
                "note": info.get("note", ""),
                "can_fetch": bool(settings.ENABLE_URL_FETCH),
                "message": f"{info.get('name', kind)} detected. {info.get('note', '')}".strip(),
            }

    return {
        "ok": True,
        "kind": "unknown",
        "name": "Unrecognised link",
        "note": "yt-dlp supports 1000+ sites, so this may still work — we ask it directly.",
        "can_fetch": bool(settings.ENABLE_URL_FETCH),
        "message": "Unrecognised link — we'll still ask yt-dlp; if it fails, upload the file.",
    }


def _blocked_info(info: dict, err: "url_fetch.UrlFetchError") -> dict:
    """Merge a fetch/probe failure into the info dict shown by the UI."""
    out = dict(info)
    out["can_fetch"] = False
    out["error_kind"] = err.kind
    out["why_blocked"] = err.message
    out["what_to_do"] = err.hint
    out["message"] = err.message
    return out


@router.post("/url")
async def handle_url(payload: dict):
    """
    Identify a pasted link AND probe it (title, duration, whether it's
    reachable) without downloading the audio yet. The UI uses this to show
    "Found: <title> — 3:41" before you commit to the analysis.
    """
    url = (payload or {}).get("url", "")
    info = classify_url(url)
    if not info.get("ok"):
        raise HTTPException(400, info.get("message", "Invalid link"))

    if not settings.ENABLE_URL_FETCH:
        info["can_fetch"] = False
        info["error_kind"] = "disabled"
        info["why_blocked"] = "Link fetching is switched off on this server."
        info["what_to_do"] = ("Set ENABLE_URL_FETCH=true in backend/.env and restart the "
                              "backend (uvicorn app.main:app --reload --port 8000).")
        return JSONResponse({"fetched": False, "job_id": None, "info": info})

    # Ask yt-dlp what this is. Any refusal is reported honestly.
    try:
        meta = await _run(url_fetch.probe, url)
    except url_fetch.UrlFetchError as err:
        return JSONResponse({"fetched": False, "job_id": None,
                             "info": _blocked_info(info, err)})

    info["can_fetch"] = True
    info["title"] = meta.get("title")
    info["duration"] = meta.get("duration")
    info["uploader"] = meta.get("uploader")
    info["thumbnail"] = meta.get("thumbnail")
    info["extractor"] = meta.get("extractor")
    if meta.get("duration"):
        m, s = divmod(int(meta["duration"]), 60)
        info["duration_label"] = f"{m}:{s:02d}"
        if meta["duration"] > settings.URL_MAX_DURATION_SEC:
            info["can_fetch"] = False
            info["error_kind"] = "too_long"
            info["why_blocked"] = (f"That media is {m} min {s:02d} s long; the limit on this "
                                   f"server is {int(settings.URL_MAX_DURATION_SEC // 60)} minutes.")
            info["what_to_do"] = ("Raise URL_MAX_DURATION_SEC in backend/.env, or trim the clip "
                                  "and upload it as a file.")
    return JSONResponse({"fetched": False, "job_id": None, "info": info})


@router.post("/url/diagnose")
async def diagnose_url(payload: dict):
    """
    Settings-page helper: reports, for one link, exactly what happened —
    tooling status plus the platform's own answer. No audio is kept.
    """
    url = (payload or {}).get("url", "")
    caps = url_fetch.capabilities()
    info = classify_url(url)
    result = {"capabilities": caps, "info": info, "probe": None, "error": None}

    if not info.get("ok"):
        result["error"] = {"kind": "invalid", "message": info.get("message")}
        return result
    if not caps["ready"]:
        result["error"] = {"kind": "not_ready", "message": caps["why_not"]}
        return result

    try:
        result["probe"] = await _run(url_fetch.probe, url)
    except url_fetch.UrlFetchError as err:
        result["error"] = err.as_dict()
    return result


async def _run(fn, *args):
    """yt-dlp is blocking; keep the FastAPI event loop free while it works."""
    import asyncio
    return await asyncio.get_running_loop().run_in_executor(None, lambda: fn(*args))


# ─────────────────────────────────────────────────────────────
# Cookies: your own logged-in session, stored locally
# ─────────────────────────────────────────────────────────────

@router.post("/url/cookies")
async def upload_cookies(file: UploadFile = File(...)):
    """
    Upload a Netscape-format cookies.txt exported from YOUR OWN browser while
    logged in. This is how you legitimately get past YouTube's "confirm you're
    not a bot" check from a server IP: you are simply signed in.

    The file is written to backend/cookies.txt (chmod 600), is never served
    back to the browser, and is git-ignored. We return metadata only.
    """
    if not (file.filename or "").lower().endswith((".txt", ".cookies")):
        raise HTTPException(415, "Please upload a .txt file (Netscape cookies format).")
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "That file is empty.")
    if len(raw) > 512 * 1024:
        raise HTTPException(413, "That cookies file is unusually large (>512 KB).")
    try:
        status = url_fetch.save_cookies(raw.decode("utf-8", errors="ignore"))
    except url_fetch.UrlFetchError as err:
        raise HTTPException(400, f"{err.message} {err.hint}") from err
    return {"ok": True, **status,
            "message": ("Cookies loaded — try your link again."
                        if status["youtube"] else
                        "Cookies loaded, but no youtube.com entry was found in them.")}


@router.delete("/url/cookies")
def delete_cookies():
    """Forget the stored cookies."""
    return {"ok": True, **url_fetch.clear_cookies()}


def fetch_from_url(url: str, dest_dir: Path) -> tuple[Path, dict]:
    """
    Download the audio behind a link into `dest_dir`.
    Raises url_fetch.UrlFetchError with a plain-English reason on refusal.
    """
    return url_fetch.fetch_audio(url, dest_dir)


# ─────────────────────────────────────────────────────────────
# Upload
# ─────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    """Validates and stores an uploaded file, then reports what it decoded to."""
    if not file.filename:
        raise HTTPException(400, "No filename received.")
    try:
        loader.validate_upload(file.filename, 0)   # extension check first
    except loader.AudioLoadError as exc:
        raise HTTPException(415, str(exc)) from exc

    # read into a temp location, checking the size as we go
    tmp = settings.UPLOAD_DIR / f"tmp_{uuid.uuid4().hex}"
    total = 0
    limit = settings.MAX_UPLOAD_MB * 1024 * 1024
    try:
        with open(tmp, "wb") as fh:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise HTTPException(
                        413, f"File is larger than the {settings.MAX_UPLOAD_MB} MB limit. "
                             f"Trim the clip or raise MAX_UPLOAD_MB in backend/.env.")
                fh.write(chunk)
    finally:
        await file.close()

    if total == 0:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, "The uploaded file is empty.")

    job_id = f"job_{uuid.uuid4().hex[:12]}"
    d = store.job_dir(job_id)
    ext = (Path(file.filename).suffix.lower() or ".bin")
    final = d / f"source{ext}"
    shutil.move(str(tmp), str(final))

    # Try decoding right away so the user gets instant feedback (bad file?).
    info = {"decoded": False, "duration": None, "decoder": None, "error": None}
    try:
        a = loader.load_audio(final)
        info = {"decoded": True, "duration": round(a.duration, 2), "decoder": a.decoder,
                "error": None}
    except loader.AudioLoadError as exc:
        info["error"] = str(exc)
        # keep the file: maybe the user wants to retry after installing ffmpeg

    return {
        "job_id": job_id,
        "filename": file.filename,
        "size_bytes": total,
        "size_mb": round(total / 1e6, 2),
        **info,
        "next": f"/api/analyse  (POST {{'job_id': '{job_id}'}})",
    }


# ─────────────────────────────────────────────────────────────
# Serving audio back to the browser
# ─────────────────────────────────────────────────────────────

_MIME = {
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac",
    ".ogg": "audio/ogg", ".oga": "audio/ogg", ".m4a": "audio/mp4",
    ".aac": "audio/aac", ".opus": "audio/opus", ".webm": "audio/webm",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
}


@router.get("/audio/{job_id}/media/{filename}")
def serve_media(job_id: str, filename: str):
    p = settings.PROCESSED_DIR / job_id / "media" / Path(filename).name
    if not p.exists():
        p = settings.PROCESSED_DIR / job_id / Path(filename).name
    if not p.exists() or not p.is_file():
        raise HTTPException(404, "Audio file not found")
    return FileResponse(p, media_type=_MIME.get(p.suffix.lower(), "application/octet-stream"),
                        headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600"})


@router.get("/audio/{job_id}/stems/{filename}")
def serve_stem(job_id: str, filename: str):
    p = settings.PROCESSED_DIR / job_id / "stems" / Path(filename).name
    if not p.exists() or not p.is_file():
        raise HTTPException(404, "Stem not found. Run stem separation first.")
    return FileResponse(p, media_type="audio/wav",
                        headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600"})

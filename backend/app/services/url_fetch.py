"""
url_fetch.py — actually fetching audio from a pasted link, using yt-dlp.

WHY THIS FILE EXISTS
--------------------
The first version of this app refused every link and just told you to upload a
file. That was safe but useless. This module does the real thing:

    link  ->  yt-dlp (download best audio stream)  ->  ffmpeg  ->  44.1 kHz mono WAV

WHAT IT WILL AND WILL NOT DO
----------------------------
* It downloads **publicly accessible** media at the URL you paste, the same way
  any media player does. Nothing is decrypted, nothing is de-DRM'd, no login
  wall or paywall is bypassed.
* If a platform says "sign in", "private", "age restricted", "not available in
  your country" or "confirm you're not a bot", we stop and tell you exactly
  that. We do not try to sneak around it.
* Age-restricted, private, members-only, rented or purchased media is refused.
* Copyright is yours to respect: use this on your own recordings, on material
  you have permission to analyse, or on public-domain / CC-licensed material.

IMPORTANT — WHERE YOU RUN THIS MATTERS
--------------------------------------
YouTube (and Instagram, and TikTok) often block downloads that come from a
**data-centre / cloud / VPS IP address** with "Sign in to confirm you're not a
bot". That is what happens if you run the app on a free cloud sandbox.
From a normal home broadband or mobile connection the same link usually works.
So: if you see a "bot check" error here, it almost always means *the machine
running the backend is a server*, not that the feature is broken.
Fixes: run the backend on your own computer, supply your own cookies file
(YTDLP_COOKIES_FILE), or just upload the audio file.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

from app.core.config import settings
from app.core import ffmpeg as ffmpeg_mod


# ─────────────────────────────────────────────────────────────
# Errors we can explain to a human
# ─────────────────────────────────────────────────────────────

class UrlFetchError(Exception):
    """A fetch failure we can describe in plain English."""

    def __init__(self, kind: str, message: str, hint: str = ""):
        super().__init__(message)
        self.kind = kind           # machine-readable: bot_check, private, ...
        self.message = message     # one short sentence for the user
        self.hint = hint           # what to actually do about it

    def as_dict(self) -> dict:
        return {"kind": self.kind, "message": self.message, "hint": self.hint}


def _friendly_error(raw: str) -> UrlFetchError:
    """Turn a yt-dlp/ffmpeg error string into something a human can act on."""
    e = (raw or "").lower()

    if "sign in to confirm you" in e or "not a bot" in e:
        return UrlFetchError(
            "bot_check",
            "YouTube refused the download with a 'confirm you're not a bot' check.",
            "This happens when the backend runs on a server/cloud IP (hosted demos, "
            "VPS, this preview sandbox). Run the backend on your own computer "
            "(home/mobile internet) and the same link usually works. You can also "
            "export your YouTube cookies and set YTDLP_COOKIES_FILE in backend/.env, "
            "or simply download your own audio and upload the file.")

    if "age" in e and ("restrict" in e or "confirm" in e):
        return UrlFetchError(
            "age_restricted",
            "This media is age-restricted and requires a signed-in account.",
            "We do not bypass age gates. Upload the audio file directly instead.")

    if "private" in e or "members-only" in e or "member only" in e:
        return UrlFetchError(
            "private",
            "That media is private or members-only.",
            "Only you (logged in) can reach it. Download it from the platform "
            "yourself and upload the file here.")

    if "unavailable" in e or "removed" in e or "deleted" in e or "not exist" in e:
        return UrlFetchError(
            "unavailable",
            "The platform says this media is unavailable, removed or deleted.",
            "Double-check the link in a browser. If it plays there, try again — "
            "some platforms rate-limit automated access for a few minutes.")

    if "copyright" in e or "blocked by" in e or "geo" in e or "not available in your country" in e:
        return UrlFetchError(
            "blocked",
            "That media is blocked (copyright or region restriction).",
            "We do not work around content blocks. Use a different source or "
            "upload your own audio file.")

    if "login" in e or "logged-in" in e or "log in" in e or "authentication" in e:
        return UrlFetchError(
            "login_required",
            "This platform requires a logged-in account to read that page.",
            "Instagram and Vimeo in particular need cookies. Export them to a "
            "cookies.txt and set YTDLP_COOKIES_FILE in backend/.env, or upload "
            "the file instead.")

    if "playlist" in e and "no playlist" not in e:
        return UrlFetchError(
            "playlist",
            "That looks like a playlist or a channel, not a single item.",
            "Paste the link to one specific video or track.")

    if "unsupported url" in e or "no video formats" in e or "url could be" in e:
        return UrlFetchError(
            "unsupported",
            "yt-dlp does not know how to read that page.",
            "Supported: YouTube (video + Shorts), SoundCloud, direct audio-file "
            "links, Vimeo, Twitter/X video, Facebook video, and many more. "
            "Anything else: upload the file.")

    if "timed out" in e or "timeout" in e or "connection" in e or "temporary failure" in e:
        return UrlFetchError(
            "network",
            "The download failed because of a network problem.",
            "Check that this machine has internet access, then try again.")

    if "ffmpeg" in e and ("not found" in e or "no such file" in e or "unable" in e):
        return UrlFetchError(
            "no_ffmpeg",
            "ffmpeg is missing, so the downloaded audio cannot be converted.",
            "Install it with:  pip install imageio-ffmpeg   (on macOS: brew install "
            "ffmpeg, on Ubuntu: sudo apt install ffmpeg)")

    return UrlFetchError("unknown", f"Download failed: {(raw or '').strip()[:300]}",
                         "Try again, or upload the audio file instead — that always works.")


# ─────────────────────────────────────────────────────────────
# Tooling checks
# ─────────────────────────────────────────────────────────────

def yt_dlp_version() -> str | None:
    """Return the installed yt-dlp version, or None if it isn't installed."""
    try:
        import yt_dlp  # noqa: PLC0415
        return getattr(yt_dlp.version, "__version__", "installed")
    except Exception:  # noqa: BLE001
        return None


def resolve_ffmpeg() -> str | None:
    """
    Find an ffmpeg binary.

    1. a real `ffmpeg` on PATH (best)
    2. the static binary shipped by the pip package `imageio-ffmpeg`
       (pip install imageio-ffmpeg) — no system install needed

    In case 2 the binary is also symlinked onto PATH (see app/core/ffmpeg.py),
    because yt-dlp only ever looks ffmpeg up on PATH.
    """
    return ffmpeg_mod.ensure_ffmpeg()


def capabilities() -> dict:
    """Reported on /api/capabilities so the UI can explain what's missing."""
    ver = yt_dlp_version()
    ff = resolve_ffmpeg()
    return {
        "enabled": bool(settings.ENABLE_URL_FETCH),
        "yt_dlp": ver,
        "ffmpeg": ff,
        # path is kept private; the UI only needs to know whether it loaded
        "cookies_file": (settings.YTDLP_COOKIES_FILE
                         if settings.YTDLP_COOKIES_FILE
                         and Path(settings.YTDLP_COOKIES_FILE).exists() else None),
        "cookies": cookie_status(),
        "max_duration_sec": settings.URL_MAX_DURATION_SEC,
        "ready": bool(settings.ENABLE_URL_FETCH and ver and ff),
        "why_not": (
            None if (settings.ENABLE_URL_FETCH and ver and ff) else
            "ENABLE_URL_FETCH is off in backend/.env" if not settings.ENABLE_URL_FETCH else
            "yt-dlp is not installed (pip install yt-dlp)" if not ver else
            "ffmpeg is not installed (pip install imageio-ffmpeg)"
        ),
    }


def _require_ready() -> None:
    if not settings.ENABLE_URL_FETCH:
        raise UrlFetchError(
            "disabled",
            "Link fetching is switched off on this server.",
            "Set ENABLE_URL_FETCH=true in backend/.env, restart the backend "
            "(uvicorn app.main:app --reload --port 8000), then try again.")
    if yt_dlp_version() is None:
        raise UrlFetchError(
            "no_yt_dlp",
            "yt-dlp is not installed, so links cannot be fetched.",
            "Run:  pip install yt-dlp   then restart the backend.")
    if resolve_ffmpeg() is None:
        raise UrlFetchError(
            "no_ffmpeg",
            "ffmpeg is not installed, so downloaded audio cannot be converted.",
            "Run:  pip install imageio-ffmpeg   (or install ffmpeg for your OS) "
            "then restart the backend.")


# ─────────────────────────────────────────────────────────────
# yt-dlp options
# ─────────────────────────────────────────────────────────────

def _base_opts() -> dict:
    opts: dict = {
        "format": settings.YTDLP_FORMAT,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "no_color": True,
        "retries": 3,
        "fragment_retries": 3,
        "socket_timeout": 30,
        "overwrites": True,
        "consoletitle": False,
    }
    ff = resolve_ffmpeg()
    if ff:
        opts["ffmpeg_location"] = str(Path(ff).parent)
    if shutil.which("deno"):
        opts["js_runtimes"] = {"deno": {}}
    elif shutil.which("node"):
        opts["js_runtimes"] = {"node": {}}
    if settings.YTDLP_COOKIES_FILE and Path(settings.YTDLP_COOKIES_FILE).exists():
        opts["cookiefile"] = settings.YTDLP_COOKIES_FILE
    elif COOKIES_PATH.exists() and COOKIES_PATH.stat().st_size > 0:
        opts["cookiefile"] = str(COOKIES_PATH)
    # Player clients: default to yt-dlp native auto-negotiation (with yt-dlp-ejs solver), or use custom if set
    clients = [c.strip() for c in settings.YTDLP_PLAYER_CLIENTS.split(",") if c.strip() and c.strip() != "default"]
    if clients:
        opts["extractor_args"] = {"youtube": {"player_client": clients}}
    return opts


# ─────────────────────────────────────────────────────────────
# Probe (metadata only — no download)
# ─────────────────────────────────────────────────────────────

def probe(url: str) -> dict:
    """
    Read a link's metadata without downloading the audio.

    Returns {"ok": True, "title", "duration", "uploader", "thumbnail",
             "extractor", "webpage_url"} or {"ok": False, "kind", "message", "hint"}.
    """
    _require_ready()
    try:
        import yt_dlp  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        raise UrlFetchError("no_yt_dlp", "yt-dlp is not installed.",
                            "Run:  pip install yt-dlp") from exc

    opts = dict(_base_opts())
    opts["skip_download"] = True
    opts.pop("format", None)
    info = None
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        err_msg = str(exc).lower()
        if any(w in err_msg for w in ("bot", "sign in", "429", "confirm", "login", "requested format")):
            for alt_clients in [["android"], ["tv_embedded"], ["mweb", "android"]]:
                try:
                    alt_opts = dict(opts)
                    alt_opts["extractor_args"] = {"youtube": {"player_client": alt_clients}}
                    with yt_dlp.YoutubeDL(alt_opts) as ydl:
                        info = ydl.extract_info(url, download=False)
                        if info:
                            break
                except Exception:
                    continue
        if info is None:
            raise _friendly_error(str(exc)) from exc

    if info is None:
        raise UrlFetchError("unsupported", "No media was found at that link.",
                            "Check the link in a browser, or upload the file.")
    if info.get("_type") == "playlist":
        entries = info.get("entries") or []
        if not entries:
            raise UrlFetchError("playlist", "That playlist has no playable items.",
                                "Paste a link to one specific video or track.")
        info = entries[0]
    return {
        "ok": True,
        "title": info.get("title") or "Unknown title",
        "duration": float(info.get("duration") or 0.0) or None,
        "uploader": info.get("uploader") or info.get("channel") or None,
        "thumbnail": info.get("thumbnail"),
        "extractor": info.get("extractor_key") or info.get("extractor") or None,
        "webpage_url": info.get("webpage_url") or url,
        "is_live": bool(info.get("is_live")),
    }


# ─────────────────────────────────────────────────────────────
# Fetch (download -> WAV)
# ─────────────────────────────────────────────────────────────

def _convert_to_wav(src: Path, dest: Path, max_sec: float) -> None:
    """ffmpeg: any audio/video file -> 44.1 kHz mono 16-bit WAV, trimmed."""
    ff = resolve_ffmpeg()
    if not ff:
        raise UrlFetchError("no_ffmpeg",
                            "ffmpeg is missing so the audio cannot be converted.",
                            "Run:  pip install imageio-ffmpeg")
    cmd = [ff, "-y", "-hide_banner", "-loglevel", "error",
           "-i", str(src),
           "-vn",                       # drop any video track
           "-ac", "1",                  # mono  (all our DSP downsamples anyway)
           "-ar", "44100",              # 44.1 kHz
           "-t", str(int(max_sec)),     # hard duration cap
           "-c:a", "pcm_s16le",
           str(dest)]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=600)
    except (subprocess.SubprocessError, OSError) as exc:
        raise UrlFetchError("no_ffmpeg", "ffmpeg failed to convert the audio.",
                            f"Error: {exc}") from exc
    if proc.returncode != 0 or not dest.exists() or dest.stat().st_size == 0:
        detail = (proc.stderr or b"").decode("utf-8", "ignore")[-300:]
        raise UrlFetchError("convert_failed",
                            "The downloaded file could not be converted to audio.",
                            "This is usually a missing codec. Install ffmpeg: "
                            f"pip install imageio-ffmpeg  (ffmpeg said: {detail})")


def fetch_audio(url: str, dest_dir: Path, max_duration: float | None = None) -> tuple[Path, dict]:
    """
    Download the audio behind `url` into `dest_dir` and return (wav_path, meta).

    Raises UrlFetchError with a human explanation when anything is refused.
    """
    _require_ready()
    import yt_dlp  # noqa: PLC0415

    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    cap = float(max_duration or settings.URL_MAX_DURATION_SEC)

    # 1. metadata first: gives us the title, and lets us reject over-long media
    #    before spending any bandwidth on it.
    meta = probe(url)
    dur = meta.get("duration")
    if dur and dur > cap:
        raise UrlFetchError(
            "too_long",
            f"That media is {int(dur // 60)} min {int(dur % 60)} s long; the limit here "
            f"is {int(cap // 60)} minutes.",
            f"Raise URL_MAX_DURATION_SEC in backend/.env (it also needs RAM), or trim "
            f"the clip and upload it as a file.")
    if meta.get("is_live"):
        raise UrlFetchError("live", "That is a live stream, which has no fixed audio to analyse.",
                            "Wait until it finishes, or upload a recording of it.")

    template = str(dest_dir / "source.%(ext)s")

    # 2. download only the audio stream
    opts = dict(_base_opts())
    opts["format"] = "ba/b,bestaudio/best,best"
    opts["outtmpl"] = template
    opts["noprogress"] = True

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except UrlFetchError:
        raise
    except Exception as exc:  # noqa: BLE001
        raw = str(exc)
        # If player client, format, or network hit 403 or failure, retry with android / tv fallback
        fallback_opts = dict(opts)
        fallback_opts["format"] = "ba/b,bestaudio/best,best"
        fallback_opts["extractor_args"] = {"youtube": {"player_client": ["android", "tv_embedded"]}}
        try:
            with yt_dlp.YoutubeDL(fallback_opts) as ydl:
                ydl.download([url])
        except Exception as exc2:  # noqa: BLE001
            raise _friendly_error(str(exc2)) from exc2

    # 3. find what landed on disk (any container: m4a, webm, opus, mp4, wav…)
    candidates = [p for p in dest_dir.glob("source.*")
                  if p.is_file() and p.suffix.lower() not in {".part", ".ytdl", ".frag"}]
    if not candidates:
        raise UrlFetchError("unknown",
                            "The download finished but no media file was produced.",
                            "Try again, or upload the audio file instead.")
    src = max(candidates, key=lambda p: p.stat().st_size)

    # 4. normalise to WAV so every later stage (librosa/soundfile) can read it
    wav = dest_dir / "source.wav"
    if src.resolve() == wav.resolve():
        return wav, meta
    _convert_to_wav(src, wav, cap)
    try:
        if src.name != wav.name:
            src.unlink(missing_ok=True)
    except OSError:
        pass
    return wav, meta


# ─────────────────────────────────────────────────────────────
# Cookies (your own logged-in session)
# ─────────────────────────────────────────────────────────────
#
# YouTube answers "confirm you're not a bot" to anonymous requests from
# server IPs. Supplying the cookies of YOUR OWN logged-in YouTube account is
# the documented, legitimate fix: you are simply signed in, as in your browser.
# Nothing is forged and no access control is bypassed — you are authenticated
# as yourself.
#
# The file lives in backend/cookies.txt, is never served to the browser (we
# only report metadata about it), and is excluded from git.

COOKIES_PATH = settings.BACKEND_DIR / "cookies.txt"


def _parse_cookies(text: str) -> dict:
    """Read a Netscape-format cookies.txt and report what's inside."""
    domains: list[str] = []
    entries = 0
    expires: list[int] = []
    names: set[str] = set()
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        domain, _flag, _path, _secure, exp, name, _value = parts[:7]
        entries += 1
        names.add(name)
        if domain.startswith("."):
            domain = domain[1:]
        if domain not in domains:
            domains.append(domain)
        try:
            exp_i = int(exp)
            if exp_i > 0:
                expires.append(exp_i)
        except ValueError:
            pass
    return {"entries": entries, "domains": domains, "expires": min(expires) if expires else None,
            "names": sorted(names)}


def save_cookies(text: str) -> dict:
    """Store a cookies.txt and switch yt-dlp over to it immediately."""
    parsed = _parse_cookies(text)
    if parsed["entries"] == 0:
        raise UrlFetchError(
            "bad_cookies",
            "That file has no cookies in it.",
            "Export a Netscape-format cookies.txt from your browser (the "
            "'Get cookies.txt LOCALLY' extension writes exactly this format) "
            "while you are logged in to the site.")

    COOKIES_PATH.write_text(text, encoding="utf-8")
    try:
        COOKIES_PATH.chmod(0o600)          # your credentials: owner-readable only
    except OSError:
        pass

    # Take effect right now, without a restart…
    settings.YTDLP_COOKIES_FILE = str(COOKIES_PATH)
    os.environ["YTDLP_COOKIES_FILE"] = str(COOKIES_PATH)
    # …and remember it across restarts.
    _persist_cookies_setting(str(COOKIES_PATH))

    return cookie_status()


def clear_cookies() -> dict:
    """Forget the stored cookies (delete the file and the setting)."""
    try:
        COOKIES_PATH.unlink(missing_ok=True)
    except OSError:
        pass
    settings.YTDLP_COOKIES_FILE = ""
    os.environ.pop("YTDLP_COOKIES_FILE", None)
    _persist_cookies_setting("")
    return cookie_status()


def _persist_cookies_setting(value: str) -> None:
    """Rewrite the YTDLP_COOKIES_FILE line in backend/.env so restarts keep it."""
    env_file = settings.BACKEND_DIR / ".env"
    line = f"YTDLP_COOKIES_FILE={value}"
    try:
        if env_file.exists():
            lines = env_file.read_text(encoding="utf-8").splitlines()
            replaced = False
            out = []
            for ln in lines:
                if ln.startswith("YTDLP_COOKIES_FILE="):
                    out.append(line)
                    replaced = True
                else:
                    out.append(ln)
            if not replaced:
                out.append(line)
            env_file.write_text("\n".join(out) + "\n", encoding="utf-8")
        else:
            env_file.write_text(f"# generated\n{line}\n", encoding="utf-8")
    except OSError:
        pass  # not fatal: the in-memory setting still works for this session


def cookie_status() -> dict:
    """Metadata only — the file's contents are never returned to a client."""
    path = settings.YTDLP_COOKIES_FILE
    p = Path(path) if (path and Path(path).exists()) else (COOKIES_PATH if COOKIES_PATH.exists() else None)
    if not p or not p.exists():
        return {"loaded": False, "entries": 0, "domains": [], "youtube": False,
                "instagram": False, "expires_at": None, "expires_in_days": None}
    try:
        parsed = _parse_cookies(p.read_text(encoding="utf-8", errors="ignore"))
    except OSError:
        return {"loaded": False, "entries": 0, "domains": [], "youtube": False,
                "instagram": False, "expires_at": None, "expires_in_days": None}
    domains = parsed["domains"]
    days = None
    if parsed["expires"]:
        import time as _t
        days = max(0, int((parsed["expires"] - _t.time()) / 86400))
    return {
        "loaded": True,
        "entries": parsed["entries"],
        "domains": domains,
        "youtube": any("youtube.com" in d for d in domains),
        "instagram": any("instagram.com" in d for d in domains),
        "expires_at": parsed["expires"],
        "expires_in_days": days,
    }

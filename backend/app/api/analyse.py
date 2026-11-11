"""Start analyses. Returns immediately with a job id you can poll."""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.audio import loader
from app.core.config import settings
from app.services import jobs, pipeline, store

router = APIRouter(prefix="/api", tags=["analyse"])

DEFAULT_OPTIONS = {
    "separation": True,
    "transcription": True,
    "gemini": True,
    "tuning": "standard",
    "capo": 0,
    "max_fret": 22,
}


def _find_source(job_id: str) -> Path | None:
    d = settings.PROCESSED_DIR / job_id
    if not d.exists():
        return None
    for p in sorted(d.glob("source.*")):
        if p.stat().st_size > 0:
            return p
    for p in sorted(d.glob("*")):
        if p.is_file() and p.suffix.lower() in settings.ALLOWED_EXTENSIONS:
            return p
    return None


@router.post("/analyse")
async def analyse(payload: dict):
    """
    body: { "job_id": "...", "options": { "separation": true, ... }, "name": "My song" }
    """
    job_id = (payload or {}).get("job_id")
    if not job_id:
        raise HTTPException(400, "Missing 'job_id'. Upload a file first (POST /api/upload).")

    src = _find_source(job_id)
    if src is None:
        raise HTTPException(404, f"No uploaded source file found for job '{job_id}'.")

    opts = dict(DEFAULT_OPTIONS)
    opts.update((payload or {}).get("options") or {})
    opts["name"] = (payload or {}).get("name")
    opts["source_type"] = (payload or {}).get("source_type", "upload")

    job = jobs.create(job_id=job_id, kind="analyse")
    jobs.submit(job_id, pipeline.run, job_id=job_id, source_path=src, options=opts)
    return {
        "job_id": job_id,
        "status": job["status"],
        "poll": f"/api/jobs/{job_id}",
        "result": f"/api/results/{job_id}",
        "options": opts,
        "estimated_seconds": _estimate(opts),
    }


@router.post("/analyse/file")
async def analyse_file(file: UploadFile = File(...), options: str = Form("{}")):
    """One-shot: upload + analyse in a single request (what the home page uses)."""
    if not file.filename:
        raise HTTPException(400, "No file received.")
    try:
        loader.validate_upload(file.filename, 1)
    except loader.AudioLoadError as exc:
        raise HTTPException(415, str(exc)) from exc

    try:
        opts = json.loads(options or "{}")
        if not isinstance(opts, dict):
            raise ValueError("options must be an object")
    except (json.JSONDecodeError, ValueError):
        opts = {}

    job_id = f"job_{uuid.uuid4().hex[:12]}"
    d = store.job_dir(job_id)
    ext = (Path(file.filename).suffix.lower() or ".bin")
    dest = d / f"source{ext}"

    total = 0
    limit = settings.MAX_UPLOAD_MB * 1024 * 1024
    with open(dest, "wb") as fh:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                fh.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, f"File exceeds the {settings.MAX_UPLOAD_MB} MB limit.")
            fh.write(chunk)
    await file.close()

    if total == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, "The uploaded file is empty.")

    final_opts = dict(DEFAULT_OPTIONS)
    final_opts.update(opts)
    final_opts["name"] = opts.get("name") or Path(file.filename).stem[:60]
    final_opts["source_type"] = "upload"

    jobs.create(job_id=job_id, kind="analyse")
    jobs.submit(job_id, pipeline.run, job_id=job_id, source_path=dest, options=final_opts)
    return {
        "job_id": job_id,
        "filename": file.filename,
        "size_mb": round(total / 1e6, 2),
        "status": "queued",
        "poll": f"/api/jobs/{job_id}",
        "result": f"/api/results/{job_id}",
        "estimated_seconds": _estimate(final_opts),
    }


@router.post("/analyse/url")
async def analyse_url(payload: dict):
    """
    Paste-a-link path: fetch the audio, then run the same pipeline as an upload.

    Public media only. If the platform refuses (age gate, private, region
    block, bot check, login wall) we return 422 with the exact reason and what
    to do instead — we do not work around it.
    """
    from fastapi.responses import JSONResponse

    from app.api.media import classify_url
    from app.services import url_fetch

    url = (payload or {}).get("url", "")
    info = classify_url(url)
    if not info.get("ok"):
        raise HTTPException(400, info.get("message", "Invalid link"))

    job_id = f"job_{uuid.uuid4().hex[:12]}"
    d = store.job_dir(job_id)

    import asyncio
    try:
        got, meta = await asyncio.get_running_loop().run_in_executor(
            None, lambda: url_fetch.fetch_audio(url, d))
    except url_fetch.UrlFetchError as err:
        shutil.rmtree(d, ignore_errors=True)
        return JSONResponse(status_code=422, content={
            "error": "url_not_fetchable",
            "kind": err.kind,
            "message": err.message,
            "hint": err.hint,
            "info": {**info, "can_fetch": False,
                     "why_blocked": err.message, "what_to_do": err.hint},
        })

    opts = dict(DEFAULT_OPTIONS)
    opts.update((payload or {}).get("options") or {})
    opts["name"] = opts.get("name") or (meta.get("title") or "")[:60]
    opts["source_type"] = "url"
    opts["source_url"] = url

    jobs.create(job_id=job_id, kind="analyse")
    jobs.submit(job_id, pipeline.run, job_id=job_id, source_path=got, options=opts)
    return {
        "job_id": job_id,
        "status": "queued",
        "title": meta.get("title"),
        "duration": meta.get("duration"),
        "poll": f"/api/jobs/{job_id}",
        "result": f"/api/results/{job_id}",
        "estimated_seconds": _estimate(opts),
    }


def _estimate(opts: dict) -> int:
    """Rough ETA so the UI can show a sensible progress bar."""
    s = 12
    if opts.get("separation"):
        s += 90          # Demucs on CPU is the expensive part
    if opts.get("transcription"):
        s += 20
    if opts.get("gemini"):
        s += 8
    return s

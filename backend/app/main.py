"""
main.py — the FastAPI application entry point.

Run it with:
    cd backend
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from app.api import analyse, export, health, jobs as jobs_api, media, projects, results, tools
from app.core.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
log = logging.getLogger("guitar-ai")

app = FastAPI(
    title="Guitar AI — analysis API",
    version="1.0.0",
    description=(
        "Real audio analysis for guitarists: chord recognition, key & scale "
        "detection, solo transcription, tablature, stem separation and "
        "AI-written explanations. No paid services required."
    ),
)

# The Vite dev server (and a deployed frontend) need to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS if settings.CORS_ORIGINS != ["*"] else ["*"],
    allow_origin_regex=None if settings.CORS_ORIGINS != ["*"] else r"https://.*\.e2b\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(media.router)
app.include_router(analyse.router)
app.include_router(jobs_api.router)
app.include_router(results.router)
app.include_router(tools.router)
app.include_router(export.router)
app.include_router(projects.router)


@app.on_event("startup")
def on_startup():
    cleanup_old_files()
    cookies_env = os.getenv("YTDLP_COOKIES_TEXT", "").strip()
    if cookies_env:
        try:
            from app.services import url_fetch
            url_fetch.save_cookies(cookies_env)
            log.info("Loaded YTDLP_COOKIES_TEXT from environment")
        except Exception as exc:
            log.warning("Failed to load YTDLP_COOKIES_TEXT: %s", exc)
    log.info("Guitar AI backend ready — uploads=%s processed=%s",
             settings.UPLOAD_DIR, settings.PROCESSED_DIR)


def cleanup_old_files(max_age_hours: int | None = None) -> None:
    """Delete temporary uploads/results older than KEEP_TEMP_HOURS."""
    max_age = (max_age_hours or settings.KEEP_TEMP_HOURS) * 3600
    now = time.time()
    removed = 0
    for base in (settings.UPLOAD_DIR, settings.PROCESSED_DIR):
        for p in Path(base).iterdir() if Path(base).exists() else []:
            try:
                age = now - (p.stat().st_mtime if p.is_file() else
                             max((f.stat().st_mtime for f in p.rglob("*") if f.is_file()),
                                 default=now))
                if age > max_age:
                    shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)
                    removed += 1
            except OSError:
                continue
    if removed:
        log.info("Housekeeping: removed %d old item(s)", removed)


# Mount frontend build if available (Hugging Face single-container deploy)
frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if not frontend_dist.exists():
    frontend_dist = Path("frontend/dist")

if frontend_dist.exists() and (frontend_dist / "index.html").exists():
    if (frontend_dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend_spa(full_path: str):
        # Don't intercept API or docs routes
        if full_path.startswith("api/") or full_path in ("docs", "openapi.json", "redoc"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        target = frontend_dist / full_path
        if target.is_file():
            return FileResponse(target)
        return FileResponse(frontend_dist / "index.html")
else:
    @app.get("/")
    def root():
        return {
            "service": "Guitar AI backend",
            "docs": "/docs",
            "health": "/api/health",
            "capabilities": "/api/capabilities",
        }


@app.post("/api/cleanup")
def cleanup_endpoint():
    cleanup_old_files()
    return {"ok": True}


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={
        "detail": f"{type(exc).__name__}: {exc}",
        "path": request.url.path,
    })

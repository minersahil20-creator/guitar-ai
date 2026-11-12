"""
jobs.py — background job runner with progress reporting.

Audio analysis takes seconds-to-minutes, so the HTTP request returns
immediately with a job id and the browser polls /api/jobs/{id} for progress.
Only ONE heavy job runs at a time (CPU-bound Python + heavy models: running
two would just make both slower, and Demucs can eat a lot of RAM).
"""

from __future__ import annotations

import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from app.core.config import settings
from app.services import store

_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="guitar-job")
_JOBS: dict[str, dict] = {}
_LOCK = threading.Lock()

JOB_TTL_SECONDS = 60 * 60 * 6     # forget finished jobs after 6 hours


class JobCancelled(Exception):
    pass


def _job(job_id: str) -> dict:
    with _LOCK:
        return _JOBS[job_id]


def create(job_id: str | None = None, kind: str = "analyse") -> dict:
    jid = job_id or f"job_{uuid.uuid4().hex[:12]}"
    job = {
        "id": jid,
        "kind": kind,
        "status": "queued",
        "progress": 0,
        "stage": "queued",
        "message": "Waiting for a free worker…",
        "created_at": time.time(),
        "updated_at": time.time(),
        "error": None,
        "result_url": f"/api/results/{jid}",
        "cancel_requested": False,
    }
    with _LOCK:
        _JOBS[jid] = job
    store.save_job(job)
    return job


def _update(job_id: str, **fields: Any) -> None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return
        job.update(fields)
        job["updated_at"] = time.time()
        snapshot = dict(job)
    try:
        store.save_job(snapshot)
    except Exception as exc:  # noqa: BLE001
        import logging
        logging.getLogger("guitar-ai").warning("Transient store.save_job failure for %s: %s", job_id, exc)


def progress_callback(job_id: str) -> Callable[[int, str], None]:
    """Returns a fn(pct, message) that also raises if the job was cancelled."""
    def cb(pct: int, message: str = "", stage: str | None = None):
        with _LOCK:
            job = _JOBS.get(job_id)
            if not job:
                raise JobCancelled("job vanished")
            if job.get("cancel_requested"):
                raise JobCancelled("cancelled by user")
        fields = {"progress": int(max(0, min(100, pct)))}
        if message:
            fields["message"] = message
        if stage:
            fields["stage"] = stage
        if fields.get("progress", 0) >= 100:
            fields["status"] = "done"
        elif job.get("status") == "queued":
            fields["status"] = "running"
        _update(job_id, **fields)
    return cb


def submit(jid: str, fn: Callable, *args, **kwargs) -> None:
    """Queue `fn(progress_cb, *args, **kwargs)` to run in the worker thread."""
    job_id = jid

    def runner():
        cb = progress_callback(job_id)
        try:
            _update(job_id, status="running", stage="starting", message="Starting…")
            result = fn(cb, *args, **kwargs)
            _update(job_id, status="done", progress=100, stage="done",
                    message="Analysis complete", result=result)
        except JobCancelled:
            _update(job_id, status="cancelled", message="Cancelled")
        except Exception as exc:  # noqa: BLE001
            tb = traceback.format_exc(limit=4)
            msg = getattr(exc, "message", str(exc))
            _update(job_id, status="error", stage="error",
                    message=f"{msg}", error=tb)
        finally:
            _cleanup_old()

    _EXECUTOR.submit(runner)


def get(job_id: str) -> dict | None:
    with _LOCK:
        job = _JOBS.get(job_id)
    if job is None:
        job = store.load_job(job_id)
        if job:
            with _LOCK:
                _JOBS[job_id] = job
    return job


def cancel(job_id: str) -> bool:
    with _LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return False
        job["cancel_requested"] = True
    _update(job_id, message="Cancelling…")
    return True


def _cleanup_old() -> None:
    now = time.time()
    with _LOCK:
        stale = [jid for jid, j in _JOBS.items()
                 if j.get("status") in ("done", "error", "cancelled")
                 and now - j.get("updated_at", now) > JOB_TTL_SECONDS]
        for jid in stale:
            _JOBS.pop(jid, None)


def list_recent(limit: int = 20) -> list[dict]:
    with _LOCK:
        jobs = list(_JOBS.values())
    jobs.sort(key=lambda j: j.get("created_at", 0), reverse=True)
    for j in jobs:
        j.pop("error", None) if j.get("status") != "error" else None
    return jobs[:limit]


def queue_size() -> int:
    return _EXECUTOR._work_queue.qsize()  # noqa: SLF001 - informative only

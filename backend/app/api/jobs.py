"""Job status, polling and cancellation."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.services import jobs, store

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("")
def list_jobs():
    return {"jobs": jobs.list_recent(30), "queued": jobs.queue_size()}


@router.get("/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"Unknown job '{job_id}'.")
    out = {k: v for k, v in job.items() if k != "error"}
    if job.get("status") == "error":
        out["error"] = job.get("error")
    return out


@router.post("/{job_id}/cancel")
def cancel_job(job_id: str):
    if not jobs.get(job_id):
        raise HTTPException(404, f"Unknown job '{job_id}'.")
    jobs.cancel(job_id)
    return {"job_id": job_id, "status": "cancelling"}


@router.delete("/{job_id}")
def delete_job(job_id: str):
    import shutil
    from app.core.config import settings
    jobs.cancel(job_id)
    d = settings.PROCESSED_DIR / job_id
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
    return {"deleted": True, "job_id": job_id}


@router.get("/{job_id}/result")
def job_result(job_id: str):
    res = store.load_result(job_id)
    if res is None:
        job = jobs.get(job_id)
        if job and job.get("status") in ("queued", "running"):
            raise HTTPException(202, "Still analysing.")
        raise HTTPException(404, "No result for this job.")
    return res

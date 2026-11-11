"""Standalone endpoints: run one stage at a time on an already-uploaded file."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.api.analyse import _find_source
from app.services import jobs, stages

router = APIRouter(prefix="/api", tags=["tools"])

_STAGES = {
    "chords": stages.run_chords,
    "transcribe": stages.run_transcribe,
    "scales": stages.run_scales,
    "separate": stages.run_separate,
}


def _start(job_id: str, stage: str, options: dict | None):
    if _find_source(job_id) is None:
        raise HTTPException(404, f"No uploaded source file for job '{job_id}'.")
    jid = f"job_{job_id[4:]}_{stage}" if job_id.startswith("job_") else f"{job_id}_{stage}"
    jobs.create(job_id=jid, kind=stage)
    jobs.submit(jid, _STAGES[stage], job_id=job_id, options=options or {})
    return {"job_id": jid, "source_job": job_id, "stage": stage,
            "poll": f"/api/jobs/{jid}", "result": f"/api/results/{job_id}"}


@router.post("/chords")
def chords_only(payload: dict):
    job_id = (payload or {}).get("job_id")
    if not job_id:
        raise HTTPException(400, "Missing 'job_id'.")
    return _start(job_id, "chords", (payload or {}).get("options"))


@router.post("/transcribe")
def transcribe_only(payload: dict):
    job_id = (payload or {}).get("job_id")
    if not job_id:
        raise HTTPException(400, "Missing 'job_id'.")
    return _start(job_id, "transcribe", (payload or {}).get("options"))


@router.post("/scales")
def scales_only(payload: dict):
    job_id = (payload or {}).get("job_id")
    if not job_id:
        raise HTTPException(400, "Missing 'job_id'.")
    return _start(job_id, "scales", (payload or {}).get("options"))


@router.post("/separate")
def separate_only(payload: dict):
    job_id = (payload or {}).get("job_id")
    if not job_id:
        raise HTTPException(400, "Missing 'job_id'.")
    return _start(job_id, "separate", (payload or {}).get("options"))


@router.post("/backing-track")
def backing_track_only(payload: dict):
    job_id = (payload or {}).get("job_id")
    if not job_id:
        raise HTTPException(400, "Missing 'job_id'.")
    return _start(job_id, "separate", (payload or {}).get("options"))

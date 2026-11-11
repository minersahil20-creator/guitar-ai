"""Saved projects (history)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.services import store

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
def list_projects():
    return {"projects": store.list_projects()}


@router.get("/{project_id}")
def get_project(project_id: str):
    p = store.get_project(project_id)
    if not p:
        raise HTTPException(404, "Project not found.")
    res = store.load_result(p.get("job_id")) if p.get("job_id") else None
    return {"project": p, "has_result": res is not None}


@router.patch("/{project_id}")
def update_project(project_id: str, body: dict):
    allowed = {k: v for k, v in (body or {}).items() if k in ("name", "starred", "notes")}
    p = store.update_project(project_id, **allowed)
    if not p:
        raise HTTPException(404, "Project not found.")
    return {"project": p}


@router.delete("/{project_id}")
def delete_project(project_id: str):
    ok = store.delete_project(project_id)
    if not ok:
        raise HTTPException(404, "Project not found.")
    return {"deleted": True, "project_id": project_id}


@router.delete("")
def delete_all_projects():
    for p in store.list_projects():
        store.delete_project(p["id"])
    return {"deleted": True}

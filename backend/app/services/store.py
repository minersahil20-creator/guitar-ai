"""
store.py — tiny JSON-file database.

WHY NOT MONGODB? The brief says "use MongoDB only if it is necessary and a
free option is available". For a single-user local app it is not necessary.
A JSON file gives you zero setup, zero cost, and it is trivial to migrate to
MongoDB/Postgres later because every record is already a plain dict.
Swap this one file when you outgrow it.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from app.core.config import settings

_LOCK = threading.Lock()


def _read() -> dict:
    p = settings.DB_PATH
    if not p.exists():
        return {"projects": {}, "jobs": {}}
    try:
        with open(p, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        data.setdefault("projects", {})
        data.setdefault("jobs", {})
        return data
    except (json.JSONDecodeError, OSError):
        return {"projects": {}, "jobs": {}}


def _safe_write(target: Path, data: dict, indent: int | None = None) -> None:
    tmp = target.with_suffix(f".tmp_{uuid.uuid4().hex[:6]}")
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=indent, default=str)
    except Exception:
        with open(target, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=indent, default=str)
        return

    for attempt in range(10):
        try:
            tmp.replace(target)
            return
        except (PermissionError, OSError):
            time.sleep(0.04 * (attempt + 1))

    try:
        with open(target, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=indent, default=str)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def _write(data: dict) -> None:
    _safe_write(settings.DB_PATH, data, indent=1)


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:12]}"


# ─────────────────────────────────────────────────────────────
# Projects
# ─────────────────────────────────────────────────────────────

def create_project(**fields: Any) -> dict:
    with _LOCK:
        data = _read()
        pid = new_id("prj_")
        proj = {
            "id": pid,
            "created_at": time.time(),
            "updated_at": time.time(),
            "name": fields.get("name") or "Untitled project",
            "starred": False,
        }
        proj.update({k: v for k, v in fields.items() if v is not None})
        data["projects"][pid] = proj
        _write(data)
        return proj


def list_projects() -> list[dict]:
    with _LOCK:
        data = _read()
    raw = data.get("projects") or {}
    if not isinstance(raw, dict):
        return []
    out = [p for p in raw.values() if isinstance(p, dict)]
    out.sort(key=lambda p: float(p.get("created_at") or 0), reverse=True)
    return out


def get_project(pid: str) -> dict | None:
    with _LOCK:
        return _read()["projects"].get(pid)


def update_project(pid: str, **fields: Any) -> dict | None:
    with _LOCK:
        data = _read()
        proj = data["projects"].get(pid)
        if not proj:
            return None
        proj.update(fields)
        proj["updated_at"] = time.time()
        data["projects"][pid] = proj
        _write(data)
        return proj


def delete_project(pid: str) -> bool:
    with _LOCK:
        data = _read()
        if pid not in data["projects"]:
            return False
        proj = data["projects"].pop(pid)
        # also drop the job record + processed files for this project
        jid = proj.get("job_id")
        if jid:
            data["jobs"].pop(jid, None)
        _write(data)
    # delete files outside the lock (slow I/O)
    if jid:
        import shutil
        d = settings.PROCESSED_DIR / str(jid)
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
    return True


# ─────────────────────────────────────────────────────────────
# Jobs
# ─────────────────────────────────────────────────────────────

def save_job(job: dict) -> None:
    with _LOCK:
        data = _read()
        data["jobs"][job["id"]] = job
        _write(data)


def load_job(jid: str) -> dict | None:
    with _LOCK:
        return _read()["jobs"].get(jid)


def list_jobs() -> list[dict]:
    with _LOCK:
        data = _read()
    out = list(data["jobs"].values())
    out.sort(key=lambda j: j.get("created_at", 0), reverse=True)
    return out


# ─────────────────────────────────────────────────────────────
# Result documents (one JSON per job — can get big, so kept off the index)
# ─────────────────────────────────────────────────────────────

def save_result(job_id: str, result: dict) -> Path:
    d = settings.PROCESSED_DIR / job_id
    d.mkdir(parents=True, exist_ok=True)
    p = d / "result.json"
    _safe_write(p, result)
    return p


def load_result(job_id: str) -> dict | None:
    p = settings.PROCESSED_DIR / job_id / "result.json"
    if not p.exists():
        return None
    try:
        with open(p, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError):
        return None


def job_dir(job_id: str) -> Path:
    d = settings.PROCESSED_DIR / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d

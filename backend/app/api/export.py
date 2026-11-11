"""Download your results: ASCII tab, MIDI, chord chart, or the raw JSON."""

from __future__ import annotations

import io
import json
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse, Response, StreamingResponse

from app.audio import midi_writer
from app.core.config import settings
from app.services import store

router = APIRouter(prefix="/api/export", tags=["export"])


def _result(job_id: str) -> dict:
    res = store.load_result(job_id)
    if res is None:
        raise HTTPException(404, "No result for this job yet.")
    return res


@router.get("/{job_id}/tab")
def export_tab(job_id: str):
    res = _result(job_id)
    tab = (res.get("tabs") or {}).get("tab") or {}
    lines = tab.get("lines") or []
    if not lines:
        raise HTTPException(404, "No tablature in this result (no notes were detected).")

    ov = res.get("overview") or {}
    header = [
        f"Guitar AI — tablature export",
        f"File: {(res.get('media') or {}).get('filename', 'unknown')}",
        f"Key: {ov.get('key')}   BPM: {ov.get('bpm')}   Time: {ov.get('time_signature')}",
        f"Tuning: {' '.join(ov.get('tuning') or [])}   Capo: {ov.get('capo')}",
        f"Transcription engine: {(res.get('solo') or {}).get('engine')}",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        "Legend: h=hammer-on  p=pull-off  /=slide up  \\=slide down  b=bend  ~=vibrato",
        "",
    ]
    body = "\n".join(header + lines)
    return PlainTextResponse(
        body, media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="guitar-ai-{job_id}.txt"'})


@router.get("/{job_id}/midi")
def export_midi(job_id: str):
    res = _result(job_id)
    notes = (res.get("solo") or {}).get("notes") or []
    if not notes:
        raise HTTPException(404, "No notes to export.")
    ov = res.get("overview") or {}
    out = settings.PROCESSED_DIR / job_id / "export.mid"
    midi_writer.write_midi(notes, out, tempo=float(ov.get("bpm") or 120.0), program=25)
    with open(out, "rb") as fh:
        data = fh.read()
    return Response(data, media_type="audio/midi",
                    headers={"Content-Disposition": f'attachment; filename="guitar-ai-{job_id}.mid"'})


@router.get("/{job_id}/chords")
def export_chords(job_id: str):
    res = _result(job_id)
    chords = (res.get("chords") or {}).get("chords") or []
    if not chords:
        raise HTTPException(404, "No chords in this result.")
    ov = res.get("overview") or {}

    def ts(t: float) -> str:
        m, s = divmod(int(t), 60)
        return f"{m:02d}:{s:02d}"

    lines = [
        "Guitar AI — chord chart",
        f"Key: {ov.get('key')}   BPM: {ov.get('bpm')}   "
        f"Time: {ov.get('time_signature')}   Duration: {ts(ov.get('duration') or 0)}",
        "",
        f"{'TIME':>7}  {'CHORD':<10} {'CONF':>6}  BAR",
        "-" * 40,
    ]
    for c in chords:
        lines.append(f"{ts(c.get('start', 0)):>7}  {c.get('name', ''):<10} "
                     f"{c.get('confidence', 0) * 100:>5.0f}%  {c.get('bar', '')}")
    prog = (res.get("chords") or {}).get("progression") or []
    if prog:
        lines += ["", "Progression: " + " – ".join(p["name"] for p in prog)]
    romans = (res.get("chords") or {}).get("roman_numerals") or []
    if romans:
        lines.append("Roman numerals: " + " ".join(romans))

    return PlainTextResponse(
        "\n".join(lines), media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="guitar-ai-{job_id}-chords.txt"'})


@router.get("/{job_id}/json")
def export_json(job_id: str):
    res = _result(job_id)
    data = json.dumps(res, indent=2, default=str).encode("utf-8")
    return StreamingResponse(io.BytesIO(data), media_type="application/json",
                             headers={"Content-Disposition":
                                      f'attachment; filename="guitar-ai-{job_id}.json"'})

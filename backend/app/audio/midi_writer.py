"""
midi_writer.py — write a real, standard MIDI file with zero dependencies.

A MIDI file is just bytes in a documented format. About 70 lines of Python
is enough, and it saves installing a library. (If you'd rather use a library:
`pip install mido` and swap this module out — nothing else depends on the
internals, only on `write_midi(...)`.)
"""

from __future__ import annotations

import struct
from pathlib import Path


def _varlen(n: int) -> bytes:
    """MIDI's variable-length quantity encoding."""
    out = bytearray([n & 0x7F])
    n >>= 7
    while n:
        out.insert(0, 0x80 | (n & 0x7F))
        n >>= 7
    return bytes(out)


def _track(events: list[tuple[int, bytes]], name: str = "guitar") -> bytes:
    data = bytearray()
    # track name meta event
    nm = name.encode("utf-8")[:120]
    data += _varlen(0) + b"\xFF\x03" + _varlen(len(nm)) + nm
    for delta, msg in events:
        data += _varlen(delta) + msg
    data += _varlen(0) + b"\xFF\x2F\x00"          # end of track
    return b"MTrk" + struct.pack(">I", len(data)) + bytes(data)


def write_midi(notes: list[dict], path: str | Path,
               tempo: float = 120.0, ticks_per_beat: int = 480,
               program: int = 24) -> Path:
    """
    notes: [{"start": seconds, "end": seconds, "midi": int, "velocity": 0..1}, ...]
    program 24 = nylon guitar, 25 = steel guitar, 30 = distorted guitar.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    microseconds_per_beat = int(60_000_000 / max(tempo, 1))
    tempo_meta = b"\xFF\x51\x03" + microseconds_per_beat.to_bytes(3, "big")

    # header: format 1, one tempo track + one note track
    header = b"MThd" + struct.pack(">IHHH", 6, 1, 2, ticks_per_beat)

    tempo_track = _track([(0, tempo_meta)], name="tempo")

    # convert note times to ticks
    events: list[tuple[int, int, bytes]] = []
    for n in notes:
        start_tick = int(round(n.get("start", 0) * tempo / 60.0 * ticks_per_beat))
        end_tick = int(round(max(n.get("end", 0), n.get("start", 0) + 0.05) * tempo / 60.0 * ticks_per_beat))
        if end_tick <= start_tick:
            end_tick = start_tick + 1
        vel = int(max(1, min(127, round(float(n.get("velocity", 0.8)) * 110))))
        pitch = int(max(0, min(127, n.get("midi", 64))))
        events.append((start_tick, 0, bytes([0x90, pitch, vel])))
        events.append((end_tick, 1, bytes([0x80, pitch, 0])))

    # sort: note-offs before note-ons at the same tick
    events.sort(key=lambda e: (e[0], e[1]))
    track_events: list[tuple[int, bytes]] = [(0, bytes([0xC0, program & 0x7F]))]
    last = 0
    for tick, _, msg in events:
        track_events.append((max(0, tick - last), msg))
        last = tick

    note_track = _track(track_events, name="guitar")

    path.write_bytes(header + tempo_track + note_track)
    return path

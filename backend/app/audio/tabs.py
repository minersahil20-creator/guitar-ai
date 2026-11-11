"""
tabs.py — convert a list of notes into playable guitar tablature.

HOW THE FINGERING IS CHOSEN (plain English)
The same note (say C4) can be played in several places on the neck. Picking
the *right* one is what separates a readable tab from gibberish. We use a
dynamic-programming search that, for every note, tries every legal position
and keeps the cheapest overall path, where "cheap" means:

  * stay near where your hand already is (hand-position cost)
  * avoid big string jumps
  * avoid unnecessary trips up the neck
  * allow open strings, but don't force them

That is the same idea behind commercial tab generators, just simplified
enough to run instantly on a laptop CPU.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from app.audio import theory as T


@dataclass
class PlacedNote:
    start: float
    end: float
    midi: int
    string: int          # 0 = low E (or lowest string of the tuning)
    fret: int
    confidence: float
    techniques: list[str]
    velocity: float = 0.8

    def to_dict(self) -> dict:
        return {
            "start": round(self.start, 4),
            "end": round(self.end, 4),
            "duration": round(self.end - self.start, 4),
            "midi": self.midi,
            "name": T.midi_to_name(self.midi),
            "string": self.string,
            "fret": self.fret,
            "confidence": round(self.confidence, 3),
            "techniques": self.techniques,
            "velocity": round(self.velocity, 3),
        }


# ─────────────────────────────────────────────────────────────
# 1. Fingering search
# ─────────────────────────────────────────────────────────────

def _positions(midi: int, open_midi: list[int], max_fret: int) -> list[tuple[int, int]]:
    """
    Every (string, fret) that can produce `midi`, plus — if the pitch is
    outside the instrument's range (a mis-detected octave, or a bass) — the
    same note an octave away, so a tab can always be drawn.
    """
    for shift in (0, -12, 12, -24, 24):
        out = []
        for s, om in enumerate(open_midi):
            f = (midi + shift) - om
            if 0 <= f <= max_fret:
                out.append((s, f))
        if out:
            # prefer the middle of the neck, then lower strings
            out.sort(key=lambda p: (abs(p[1] - 5), p[0]))
            return out
    return [(0, 0)]     # never return empty: it breaks the search


def assign_fingering(notes: list[dict], tuning: list[str] = T.STANDARD_TUNING,
                     capo: int = 0, max_fret: int = 22) -> list[PlacedNote]:
    """DP over (string, fret) choices. Returns one PlacedNote per input note."""
    if not notes:
        return []

    open_midi = T.open_string_midi(tuning)
    open_midi = [m + capo for m in open_midi]          # capo raises every string
    n_strings = len(open_midi)

    # group simultaneous notes into chord events
    events: list[list[int]] = []       # indices into notes
    cur: list[int] = []
    for i, n in enumerate(notes):
        if cur and abs(n["start"] - notes[cur[0]]["start"]) <= 0.035:
            cur.append(i)
        else:
            if cur:
                events.append(cur)
            cur = [i]
    if cur:
        events.append(cur)

    # Sanitise each event:
    #  * lowest note first (so the DP's state tracks the bass of the shape)
    #  * drop exact duplicates (one string cannot play the same pitch twice)
    #  * never more notes than strings — keep the most confident ones
    clean_events: list[list[int]] = []
    for ev in events:
        ev = sorted(ev, key=lambda i: (notes[i]["midi"], i))
        seen_midi: set[int] = set()
        uniq = []
        for i in ev:
            m = notes[i]["midi"]
            if m in seen_midi:
                continue
            seen_midi.add(m)
            uniq.append(i)
        if len(uniq) > n_strings:
            uniq = sorted(uniq, key=lambda i: -notes[i].get("confidence", 0.5))[:n_strings]
            uniq.sort(key=lambda i: notes[i]["midi"])
        if uniq:
            clean_events.append(uniq)
    events = clean_events

    # DP state: (string, fret) of the last note + smoothed hand centre
    # We discretise the hand centre to whole frets to keep the state small.
    # We keep ONE DICT PER STEP so backtracking can always find its parent.
    dp: dict[tuple[int, int, int], tuple[float, tuple]] = {
        (n_strings // 2, 5, 5): (0.0, None)
    }
    dp_history: list[dict] = [dp]

    for ev in events:
        n_in_event = len(ev)
        # candidate assignments for this event: list of tuple of (s, f) per note
        per_note_cands = [
            _positions(notes[i]["midi"], open_midi, max_fret) for i in ev
        ]
        if any(len(c) == 0 for c in per_note_cands):
            # note impossible in this tuning: drop it from the tab but keep it in notes
            per_note_cands = [c if c else [(0, 0)] for c in per_note_cands]

        if n_in_event == 1:
            options = [(c,) for c in per_note_cands[0]]
        elif n_in_event <= 3:
            options = []
            def build(idx: int, acc: list[tuple[int, int]]):
                if idx == n_in_event:
                    options.append(tuple(acc))
                    return
                for c in per_note_cands[idx]:
                    if any(c[0] == a[0] for a in acc):   # one note per string
                        continue
                    acc.append(c)
                    build(idx + 1, acc)
                    acc.pop()
            build(0, [])
            if len(options) > 400:      # safety valve on combinatorics
                options = options[:400]
            if not options:
                # No conflict-free assignment exists (rare: two notes that can
                # only be played on the same string). Fall back to greedy and
                # allow a shared string rather than losing the note.
                used, acc = set(), []
                for cands in per_note_cands:
                    pick = None
                    for c in sorted(cands, key=lambda p: (p[1], p[0])):
                        if c[0] not in used:
                            pick = c
                            break
                    if pick is None:
                        pick = sorted(cands, key=lambda p: (p[1], p[0]))[0]
                    used.add(pick[0])
                    acc.append(pick)
                options = [tuple(acc)]
        else:
            # dense chord: greedy lowest-feasible strings, then a couple of shifts
            used, acc = set(), []
            for cands in per_note_cands:
                pick = None
                for c in sorted(cands, key=lambda p: (p[1], -p[0])):
                    if c[0] not in used:
                        pick = c
                        break
                if pick is None:
                    pick = sorted(cands, key=lambda p: p[1])[0]
                used.add(pick[0])
                acc.append(pick)
            options = [tuple(acc)]

        new_dp: dict[tuple[int, int, int], tuple[float, tuple]] = {}
        for (ps, pf, ph), (cost, _) in dp.items():
            for opt in options:
                tot = cost
                for (s, f) in opt:
                    tot += 0.95 * abs(f - ph)                 # hand movement
                    tot += 0.55 * abs(s - ps)                 # string jump
                    tot += 0.20 * max(0, f - 12)              # avoid the dusty end
                    tot += 0.10 if f == 0 else 0.0            # tiny open-string nudge
                    tot -= 0.05 * (1.0 if 2 <= f <= 9 else 0.0)
                # new hand centre: smoothed towards where we just played
                avg_f = sum(f for _, f in opt) / len(opt)
                nh = int(round(0.72 * ph + 0.28 * avg_f))
                nh = int(np.clip(nh, 0, max_fret))
                key = (opt[0][0], opt[0][1], nh)
                cand = (tot, (ps, pf, ph, opt))
                if key not in new_dp or cand[0] < new_dp[key][0]:
                    new_dp[key] = cand
        if not new_dp:
            new_dp = dp
        # keep the state space bounded so memory can never run away
        if len(new_dp) > 1500:
            keep = sorted(new_dp.items(), key=lambda kv: kv[1][0])[:1500]
            new_dp = dict(keep)
        dp = new_dp
        dp_history.append(dp)

    # backtrack from the cheapest final state, walking the history backwards
    best_key = min(dp, key=lambda k: dp[k][0])
    path: list[tuple[tuple[int, int], ...]] = []
    key: tuple[int, int, int] | None = best_key
    for step in range(len(dp_history) - 1, -1, -1):
        entry = dp_history[step].get(key)
        if entry is None:
            break
        _, back = entry
        if back is None:
            break
        ps, pf, ph, opt = back
        path.append(opt)
        key = (ps, pf, ph)
    path.reverse()

    # Safety net: if backtracking produced fewer steps than there are events
    # (shouldn't happen, but a tab must never silently lose notes), fill the
    # remainder with a greedy lowest-position choice.
    if len(path) < len(events):
        for ev in events[len(path):]:
            used: set[int] = set()
            opt = []
            for i in ev:
                cands = [c for c in _positions(notes[i]["midi"], open_midi, max_fret)
                         if c[0] not in used] or _positions(notes[i]["midi"], open_midi, max_fret)[:1]
                pick = sorted(cands, key=lambda p: (p[1], p[0]))[0]
                used.add(pick[0])
                opt.append(pick)
            path.append(tuple(opt))

    placed: list[PlacedNote] = []
    for ev, opt in zip(events, path):
        for i, (s, f) in zip(ev, opt):
            n = notes[i]
            techs: list[str] = []
            if n.get("legato"):
                techs.append("h" if n["legato"] == "hammer-on" else "p")
            if n.get("slide_from") is not None:
                techs.append("/" if n["midi"] > n["slide_from"] else "\\")
            if (n.get("bend_semitones") or 0) >= 0.5:
                techs.append("b")
            if n.get("vibrato"):
                techs.append("~")
            placed.append(PlacedNote(
                start=n["start"], end=n["end"], midi=n["midi"],
                string=s, fret=f, confidence=float(n.get("confidence", 0.6)),
                techniques=techs, velocity=float(n.get("velocity", 0.8)),
            ))
    placed.sort(key=lambda p: (p.start, p.string))
    return placed


# ─────────────────────────────────────────────────────────────
# 2. ASCII tablature rendering
# ─────────────────────────────────────────────────────────────

def render_tab(placed: list[PlacedNote], tuning: list[str] = T.STANDARD_TUNING,
               capo: int = 0, tempo: float = 120.0, beats_per_bar: int = 4,
               duration: float | None = None, columns_per_bar: int | None = None) -> dict:
    r"""
    Build classic ASCII tab, one block of `beats_per_bar` beats per line,
    with technique markers (h p / \ b ~) and bar lines.
    """
    if not placed:
        return {"lines": [], "bars": [], "tuning": tuning, "capo": capo}

    n_strings = len(tuning)
    tempo = tempo if tempo and 30 < tempo < 300 else 120.0
    sec_per_beat = 60.0 / tempo
    duration = duration or max(p.end for p in placed) + sec_per_beat

    # grid resolution = 16th notes (the finest grid we print)
    cell = sec_per_beat / 4.0
    cells_per_bar = int(round(beats_per_bar * 4))
    if columns_per_bar:
        cells_per_bar = columns_per_bar
    total_cells = max(int(math.ceil(duration / cell)), cells_per_bar)

    # grid[string][cell] = text token, default '-'
    grid: list[list[str]] = [["-"] * total_cells for _ in range(n_strings)]
    cell_time = [round(i * cell, 4) for i in range(total_cells)]

    occupied: set[tuple[int, int]] = set()
    for p in placed:
        c = int(round(p.start / cell))
        c = int(np.clip(c, 0, total_cells - 1))
        while (p.string, c) in occupied and c < total_cells - 1:
            c += 1
        occupied.add((p.string, c))
        token = str(p.fret)
        grid[p.string][c] = token
        # technique markers go in the following cell(s)
        for k, t in enumerate(p.techniques):
            c2 = c + 1 + k
            while c2 < total_cells and grid[p.string][c2] != "-":
                c2 += 1
            if c2 < total_cells:
                grid[p.string][c2] = t

    # Column widths: a "12" must not push the rest of the line out of line,
    # so every cell in a column is padded to the widest token in that column.
    col_width = [1] * total_cells
    for c in range(total_cells):
        w = max(len(grid[s][c]) for s in range(n_strings))
        col_width[c] = max(1, w)

    string_labels = _string_labels(tuning)
    bars = []
    lines: list[str] = []
    n_bars = int(math.ceil(total_cells / cells_per_bar))

    for b in range(n_bars):
        s0 = b * cells_per_bar
        s1 = min(s0 + cells_per_bar, total_cells)
        if s1 <= s0:
            break
        rows = []
        columns = []
        for c in range(s0, s1):
            columns.append({"index": c, "time": cell_time[c],
                            "width": col_width[c],
                            "tokens": [grid[s][c] for s in range(n_strings)]})
        for s in range(n_strings):
            body = "".join(grid[s][c].ljust(col_width[c]) for c in range(s0, s1))
            rows.append(f"{string_labels[s]}|{body}|")
        bars.append({
            "index": b + 1,
            "start": round(s0 * cell, 4),
            "end": round(s1 * cell, 4),
            "rows": rows,
            "columns": columns,
            "cells": cells_per_bar,
        })
        lines.extend(rows)
        lines.append("")

    return {
        "tuning": tuning,
        "labels": string_labels,
        "capo": capo,
        "bars": bars,
        "lines": lines,
        "cell_time": cell_time,
        "cell_seconds": round(cell, 5),
        "cells_per_bar": cells_per_bar,
    }


def _string_labels(tuning: list[str]) -> list[str]:
    """['E2','A2',...] -> ['E','A','D','G','B','e'] (lowercase for the high E)."""
    labels = []
    for i, t in enumerate(tuning):
        base = "".join(ch for ch in t if not ch.isdigit())
        labels.append(base.lower() if i == len(tuning) - 1 and base == "E" else base)
    return labels


def build(notes: list[dict], tuning: list[str] = T.STANDARD_TUNING, capo: int = 0,
          tempo: float = 120.0, beats_per_bar: int = 4, duration: float | None = None,
          max_fret: int = 22) -> dict:
    """One-call convenience: notes -> {placed, tab, stats}."""
    placed = assign_fingering(notes, tuning=tuning, capo=capo, max_fret=max_fret)
    tab = render_tab(placed, tuning=tuning, capo=capo, tempo=tempo,
                     beats_per_bar=beats_per_bar, duration=duration)
    conf = float(np.mean([p.confidence for p in placed])) if placed else 0.0
    return {
        "placed": [p.to_dict() for p in placed],
        "tab": tab,
        "tuning": tuning,
        "capo": capo,
        "stats": {
            "notes": len(placed),
            "mean_confidence": round(conf, 3),
            "highest_fret": max([p.fret for p in placed], default=0),
            "techniques": _count_techniques(placed),
        },
    }


def _count_techniques(placed: list[PlacedNote]) -> dict:
    counts: dict[str, int] = {}
    for p in placed:
        for t in p.techniques:
            counts[t] = counts.get(t, 0) + 1
    return counts

"""
ai/local_explanations.py — the no-API-key path.

This is NOT fake AI and NOT canned filler text. Every sentence below is
assembled from numbers the analysis actually produced (chord names, their
timestamps and confidences, the note histogram, detected techniques, BPM).
If you add a Gemini key you get richer prose; without one you still get
accurate, data-derived guidance.
"""

from __future__ import annotations

import numpy as np

from app.audio import theory as T


def explain(facts: dict) -> dict:
    chords = facts.get("chords", [])
    notes = facts.get("notes", [])
    prog = facts.get("progression", []) or []
    tempo = facts.get("tempo", 0) or 0
    key = facts.get("song_key", "unknown key")
    key_conf = facts.get("key_confidence", 0)
    solo = facts.get("solo_scale") or {}
    alts = facts.get("alternative_scales") or []
    oos = facts.get("out_of_scale") or {}
    techs = facts.get("technique_counts") or {}
    duration = facts.get("duration", 0) or 0
    engines = facts.get("engines") or {}

    # ── headline ─────────────────────────────────────────────
    prog_txt = " – ".join([p["name"] for p in prog[:4]]) if prog else "no clear progression"
    headline = f"{key} at {tempo:.0f} BPM — {prog_txt}"

    # ── overview ─────────────────────────────────────────────
    overview = (
        f"The analysis found {len(prog)} distinct chord(s) across "
        f"{duration:.0f} seconds, with the song centring on {key} "
        f"(confidence {key_conf * 100:.0f}%). "
    )
    if notes:
        lo = min(n["midi"] for n in notes)
        hi = max(n["midi"] for n in notes)
        overview += (
            f"{len(notes)} individual notes were detected in the lead part, "
            f"spanning {T.midi_to_name(lo)} to {T.midi_to_name(hi)} "
            f"({hi - lo} semitones). "
        )
    else:
        overview += "No individual lead notes were detected — this may be a purely rhythmic part. "
    overview += f"Engines used: {', '.join(f'{k}={v}' for k, v in engines.items())}."

    # ── chords ───────────────────────────────────────────────
    if chords:
        names = [c["name"] for c in chords]
        confs = [c["confidence"] for c in chords]
        weak = [c["name"] for c in chords if c["confidence"] < 0.5]
        chord_explanation = (
            f"The progression runs {' → '.join(names[:12])}"
            f"{' …' if len(names) > 12 else ''}. "
        )
        if prog:
            chord_explanation += (
                f"That's {len(prog)} unique chord sound(s). "
                f"Average detection confidence is {np.mean(confs) * 100:.0f}%. "
            )
        if weak:
            chord_explanation += (
                f"Treat these with caution — the audio evidence was weak: "
                f"{', '.join(dict.fromkeys(weak))}. "
            )
        chord_explanation += (
            "Play each chord slowly and check it against the recording: chord "
            "detection is hardest when the guitar is distorted or buried in the mix."
        )
    else:
        chord_explanation = "No chords were detected from this audio."

    # ── scale ────────────────────────────────────────────────
    if solo:
        root = T.pc_name(solo.get("root_pc", 0))
        boxes = []
        fb = facts.get("fretboard_boxes") or []
        if fb:
            boxes = [f"frets {b['start_fret']}–{b['end_fret']}" for b in fb[:3]]
        scale_explanation = (
            f"The lead notes fit {solo.get('name', root)} best "
            f"(coverage {solo.get('coverage', 0) * 100:.0f}%, confidence "
            f"{solo.get('confidence', 0) * 100:.0f}%). "
            f"{T.SCALES.get(solo.get('scale_id', 'major'), {}).get('blurb', '')} "
        )
        if boxes:
            scale_explanation += f"Start looking for it in these neck areas: {', '.join(boxes)}. "
        if alts:
            scale_explanation += (
                "Other plausible readings: "
                + ", ".join(f"{a['name']} ({a['coverage'] * 100:.0f}%)" for a in alts[:3])
                + ". "
            )
        if oos.get("out_of_scale_count"):
            scale_explanation += (
                f"{oos['out_of_scale_count']} note(s) sit outside this scale"
                + (f" (e.g. {', '.join(o['name'] for o in oos['out_of_scale'][:3])})"
                   if oos.get("out_of_scale") else "")
                + "."
            )
    else:
        scale_explanation = "Not enough lead notes were detected to identify a scale."

    # ── solo ─────────────────────────────────────────────────
    if notes:
        durs = [n.get("end", 0) - n.get("start", 0) for n in notes]
        avg_dur = float(np.mean(durs)) if durs else 0
        notes_per_sec = len(notes) / max(duration, 1)
        tech_list = ", ".join(f"{k} ({v}x)" for k, v in sorted(techs.items(), key=lambda x: -x[1]))
        solo_explanation = (
            f"{len(notes)} notes over {duration:.0f}s = about {notes_per_sec:.1f} notes per second "
            f"({'fast, dense phrasing' if notes_per_sec > 3 else 'spacious, singable phrasing'}). "
            f"Average note length is {avg_dur * 1000:.0f} ms. "
        )
        if tech_list:
            solo_explanation += f"Detected technique candidates: {tech_list}. "
        phrases = facts.get("repeated_phrases") or []
        if phrases:
            p = phrases[0]
            solo_explanation += (
                f"There is a repeated lick of {p['length_notes']} notes appearing "
                f"{p['occurrences']} times (starting at {p['starts'][0]:.1f}s). "
            )
        solo_explanation += (
            "Technique detection here is heuristic — use it as a hint, and trust your ear."
        )
    else:
        solo_explanation = "No lead notes were detected in this recording."

    # ── relationship ─────────────────────────────────────────
    rel = facts.get("relationship") or {}
    chord_scale_relationship = rel.get("text", "")

    # ── practice plan ────────────────────────────────────────
    plan = []
    if tempo:
        plan.append(f"Loop the whole section at {tempo * 0.5:.0f} BPM (50%) until every "
                    f"note is clean, then step up: {tempo * 0.6:.0f} → {tempo * 0.75:.0f} → "
                    f"{tempo * 0.9:.0f} → {tempo:.0f} BPM.")
    else:
        plan.append("Use the Practice Studio to slow the audio to 50% before learning the part.")
    if prog:
        plan.append(f"Practise the chord changes on their own: {' → '.join(p['name'] for p in prog[:4])}. "
                    f"Strum each chord once, count four beats, then switch.")
    if solo:
        plan.append(f"Play the {solo.get('name')} shape up and down one position, "
                    f"in time with a metronome, before attempting the solo.")
    if notes:
        hardest = max(notes, key=lambda n: 1 - n.get("confidence", 0.6))
        plan.append(f"Isolate the trickiest spot around {hardest.get('start', 0):.1f}s with "
                    f"A–B repeat and loop it 10 times slowly.")
    plan.append("Then play along with the backing track (Stem Separation → Backing track) "
                "with the guitar removed to check your timing.")

    # ── double-check list ────────────────────────────────────
    checks = []
    weak_chords = [c["name"] for c in chords if c["confidence"] < 0.45]
    if weak_chords:
        checks.append(f"Chords with weak evidence: {', '.join(dict.fromkeys(weak_chords)[:5] if False else list(dict.fromkeys(weak_chords))[:5])}.")
    if key_conf < 0.5:
        checks.append(f"Key detection is only {key_conf * 100:.0f}% confident — the relative "
                      f"major/minor is often confused; compare both by ear.")
    if notes:
        low_conf_notes = [n for n in notes if n.get("confidence", 1) < 0.4]
        if low_conf_notes:
            checks.append(f"{len(low_conf_notes)} note(s) had weak pitch evidence — "
                          f"verify those against the recording.")
    if engines.get("transcription") == "cqt-peak-picker":
        checks.append("Transcription used the fallback pitch tracker; install Spotify Basic "
                      "Pitch for a neural-net transcription and compare.")
    if engines.get("separation") and str(engines["separation"]).startswith("hpss"):
        checks.append("Stems came from filtering, not a separation model — the 'guitar' "
                      "track will still contain other mid-range instruments.")
    if not checks:
        checks.append("Nothing looks statistically suspicious, but always confirm by ear.")

    # ── confidence comment ───────────────────────────────────
    confs = [c["confidence"] for c in chords] + [n.get("confidence", 0.6) for n in notes]
    overall = float(np.mean(confs)) if confs else 0.3
    confidence_comment = (
        f"Overall automated confidence is about {overall * 100:.0f}%. "
        + ("That is high — the analysis is probably close."
           if overall > 0.7 else
           "Treat this as a strong first draft: verify the details against the recording."
           if overall > 0.45 else
           "That is low — use this as a rough map and check every chord and note by ear.")
    )

    return {
        "provider": "local",
        "model": "rule-based (data derived, no external API)",
        "content": {
            "headline": headline,
            "overview": overview,
            "chord_explanation": chord_explanation,
            "scale_explanation": scale_explanation,
            "solo_explanation": solo_explanation,
            "chord_scale_relationship": chord_scale_relationship or
                "No relationship data available (missing chord or note analysis).",
            "practice_plan": plan,
            "things_to_double_check": checks,
            "confidence_comment": confidence_comment,
        },
    }

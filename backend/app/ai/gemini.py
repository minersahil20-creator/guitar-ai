"""
ai/gemini.py — optional Gemini layer that EXPLAINS the analysis.

WHAT GEMINI DOES HERE (and what it must never do):
  DOES:     turn the chord/scale/note data our DSP actually measured into
            beginner-friendly musical explanations, practice advice and
            "why this scale fits" reasoning.
  DOES NOT: listen to the audio, guess chords, or invent notes.

Every prompt we send contains the measured data and the instruction:
"use only the data given; if something is uncertain, say so". If no API key
is configured, the app switches to `local_explanations.py`, which builds the
same kind of text straight from the numbers — so the feature never silently
disappears and never fabricates.

Model ids verified against Google's model documentation (Nov 2026):
  gemini-3.5-flash-lite  — recommended Flash-Lite, free tier (no billing)
  gemini-3.1-flash-lite  — lightest Flash-Lite, free tier
  gemini-3.8-flash       — free-tier fallback
We try them in order and use the first one your key can reach.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from app.core.config import settings

BASE = "https://generativelanguage.googleapis.com/v1beta"

RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "headline": {"type": "STRING"},
        "overview": {"type": "STRING"},
        "chord_explanation": {"type": "STRING"},
        "scale_explanation": {"type": "STRING"},
        "solo_explanation": {"type": "STRING"},
        "chord_scale_relationship": {"type": "STRING"},
        "practice_plan": {"type": "ARRAY", "items": {"type": "STRING"}},
        "things_to_double_check": {"type": "ARRAY", "items": {"type": "STRING"}},
        "confidence_comment": {"type": "STRING"},
    },
    "required": ["headline", "overview", "chord_explanation",
                 "scale_explanation", "solo_explanation", "practice_plan"],
}


class GeminiError(Exception):
    pass


class GeminiClient:
    def __init__(self, api_key: str | None = None, models: list[str] | None = None):
        self.api_key = (api_key or settings.GEMINI_API_KEY).strip()
        self.models = models or list(settings.GEMINI_MODELS)
        self.last_model: str | None = None

    @property
    def available(self) -> bool:
        return bool(self.api_key) and settings.GEMINI_ENABLED

    # ── low-level call ───────────────────────────────────────
    def _call(self, model: str, prompt: str) -> str:
        url = f"{BASE}/models/{model}:generateContent?key={self.api_key}"
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.4,
                "maxOutputTokens": 2048,
                "responseMimeType": "application/json",
                "responseSchema": RESPONSE_SCHEMA,
            },
            "systemInstruction": {
                "parts": [{"text": (
                    "You are a patient, encouraging guitar teacher and music-theory "
                    "expert talking to a beginner/intermediate guitarist. "
                    "You are given MEASURED analysis data from audio signal processing. "
                    "You must use ONLY that data. Never invent notes, chords or "
                    "timestamps that are not in the data. If a measurement is low "
                    "confidence, say plainly that the computer may be wrong and how "
                    "the player can check by ear. Be concrete: name strings, frets, "
                    "positions and fingerings when you can. Keep each answer under "
                    "160 words. No markdown headers, no bullet asterisks."
                )}]
            },
        }
        req = urllib.request.Request(
            url, data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=settings.GEMINI_TIMEOUT_SEC) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8")[:400]
            except Exception:  # noqa: BLE001
                pass
            raise GeminiError(f"HTTP {e.code} from Gemini: {detail or e.reason}") from e
        except urllib.error.URLError as e:
            raise GeminiError(f"Could not reach Gemini ({e.reason}). Check your internet connection.") from e

        try:
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as e:
            raise GeminiError(f"Unexpected Gemini response shape: {str(data)[:300]}") from e

    # ── public: explain an analysis ──────────────────────────
    def explain(self, facts: dict) -> dict:
        """
        `facts` = the measured results (chords, key, scale, notes, tabs, engines).
        Returns {"provider": "gemini", "model": ..., "content": {...}}
        Raises GeminiError with a user-readable message.
        """
        if not self.available:
            raise GeminiError("No Gemini API key configured.")

        prompt = self._build_prompt(facts)
        errors = []
        for model in self.models:
            try:
                raw = self._call(model, prompt)
                content = json.loads(raw)
                self.last_model = model
                return {"provider": "gemini", "model": model, "content": content}
            except Exception as e:
                errors.append(f"{model}: {e}")
                continue

        raise GeminiError(
            "Gemini could not produce an explanation. Details: " + " | ".join(errors[:3])
        )

    # ── prompt building ──────────────────────────────────────
    @staticmethod
    def _build_prompt(facts: dict) -> str:
        # Trim the note list so we stay well inside the context window.
        chords = facts.get("chords", [])[:24]
        notes = facts.get("notes", [])[:80]
        prog = facts.get("progression", [])[:16]

        compact = {
            "duration_seconds": round(facts.get("duration", 0), 2),
            "tempo_bpm": round(facts.get("tempo", 0), 1),
            "beats_per_bar": facts.get("beats_per_bar"),
            "detected_song_key": facts.get("song_key"),
            "key_confidence": facts.get("key_confidence"),
            "alternative_keys": facts.get("alternative_keys", [])[:4],
            "chord_progression": [c.get("name") for c in prog],
            "chords_with_timing": [
                {"name": c.get("name"), "start": c.get("start"), "end": c.get("end"),
                 "confidence": c.get("confidence")} for c in chords
            ],
            "solo_scale": facts.get("solo_scale"),
            "alternative_scales": [
                {"name": a.get("name"), "coverage": a.get("coverage")}
                for a in (facts.get("alternative_scales") or [])[:5]
            ],
            "out_of_scale_notes": (facts.get("out_of_scale") or {}).get("out_of_scale", [])[:20],
            "chromatic_passing_notes": (facts.get("out_of_scale") or {}).get("chromatic_passing", [])[:10],
            "notes_played": [
                {"t": round(n.get("start", 0), 2), "note": n.get("name"),
                 "string": n.get("string"), "fret": n.get("fret"),
                 "technique": n.get("techniques"), "confidence": n.get("confidence")}
                for n in notes
            ],
            "detected_techniques": facts.get("technique_counts"),
            "engines_used": facts.get("engines"),
            "known_limitations": facts.get("warnings", [])[:4],
        }

        return (
            "Here is MEASURED analysis data from an audio recording of someone "
            "playing guitar. Signal-processing engines used: "
            f"{compact['engines_used']}.\n\n"
            f"{json.dumps(compact, separators=(',', ':'))}\n\n"
            "Using ONLY this data, write for a guitarist:\n"
            "1. headline: one punchy sentence (max 18 words).\n"
            "2. overview: what the computer found, honestly (3-4 sentences).\n"
            "3. chord_explanation: the progression in plain language, with roman "
            "numerals and what each chord does. Mention any low-confidence chords.\n"
            "4. scale_explanation: which scale the lead playing fits, why, and where "
            "to find it on the neck (name fret positions).\n"
            "5. solo_explanation: describe the melodic content actually detected — "
            "range, phrasing, techniques, repeated licks. Do not invent notes.\n"
            "6. chord_scale_relationship: how the solo scale relates to the chords/key, "
            "and why it works (or what to watch out for).\n"
            "7. practice_plan: 4-6 concrete steps, slow tempo first, with exact BPM targets.\n"
            "8. things_to_double_check: 2-3 items where the automated analysis may be wrong.\n"
            "9. confidence_comment: one honest sentence about overall reliability.\n"
            "Return JSON only."
        )


# ─────────────────────────────────────────────────────────────
# Capability reporting for the UI
# ─────────────────────────────────────────────────────────────

def capabilities() -> dict:
    return {
        "configured": bool(settings.GEMINI_API_KEY) and settings.GEMINI_ENABLED,
        "models": list(settings.GEMINI_MODELS),
        "note": ("Set GEMINI_API_KEY in backend/.env to enable AI explanations. "
                 "Get a free key at https://aistudio.google.com/apikey — no card needed."),
    }

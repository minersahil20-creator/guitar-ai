"""
theory.py — the music-theory brain of Guitar AI.

BEGINNER NOTE:
This file contains no machine learning and no "magic". It is plain music theory
written as data + small helper functions. Everything else in the backend
(chord detection, scale finder, tab generator) reads its musical vocabulary
from this file, so if you want to teach the app a new scale or a new chord
voicing, you edit it here — in one place.

Everything is 0-indexed on pitch classes where C = 0:
    C=0  C#/Db=1  D=2  D#/Eb=3  E=4  F=5  F#/Gb=6  G=7  G#/Ab=8  A=9  A#/Bb=10  B=11
"""

from __future__ import annotations

from functools import lru_cache
from typing import Dict, List, Sequence, Tuple

# ─────────────────────────────────────────────────────────────
# 1. NOTES
# ─────────────────────────────────────────────────────────────

SHARP_NAMES: List[str] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_NAMES: List[str] = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# Which spelling to prefer for a given key root (so we never print "F# major"
# when musicians write "Gb major").
PREFER_FLAT_ROOTS = {1: False, 3: False, 5: False, 6: False, 8: True, 10: True, 11: False}


def pc_name(pitch_class: int, prefer_flat: bool = False) -> str:
    """0 -> 'C', 1 -> 'C#' (or 'Db' if prefer_flat)."""
    return (FLAT_NAMES if prefer_flat else SHARP_NAMES)[pitch_class % 12]


def midi_to_name(midi: int, prefer_flat: bool = False) -> str:
    """MIDI 60 -> 'C4'  (scientific pitch notation: C4 = middle C)."""
    midi = int(round(midi))
    return f"{pc_name(midi % 12, prefer_flat)}{(midi // 12) - 1}"


def midi_to_freq(midi: float) -> float:
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def freq_to_midi(freq: float) -> float:
    return 69.0 + 12.0 * __import__("math").log2(max(freq, 1e-9) / 440.0)


def parse_note_name(name: str) -> int:
    """'F#' -> 6, 'Bb3' -> 10 (pitch class only)."""
    name = name.strip()
    pc = None
    for table in (SHARP_NAMES, FLAT_NAMES):
        for i, n in enumerate(table):
            if name.startswith(n):
                pc = i
                break
        if pc is not None:
            break
    if pc is None:
        raise ValueError(f"Unknown note name: {name!r}")
    return pc


# ─────────────────────────────────────────────────────────────
# 2. SCALES  (interval sets measured in semitones from the root)
# ─────────────────────────────────────────────────────────────

SCALES: Dict[str, Dict[str, object]] = {
    "major":            {"intervals": [0, 2, 4, 5, 7, 9, 11], "label": "Major (Ionian)", "blurb": "The bright, happy 'do-re-mi' scale. The default home scale of Western music."},
    "natural_minor":    {"intervals": [0, 2, 3, 5, 7, 8, 10], "label": "Natural Minor (Aeolian)", "blurb": "The classic sad/somber scale. Relative of the major scale."},
    "harmonic_minor":   {"intervals": [0, 2, 3, 5, 7, 8, 11], "label": "Harmonic Minor", "blurb": "Minor with a raised 7th, giving an exotic/classical pull to the root."},
    "melodic_minor":    {"intervals": [0, 2, 3, 5, 7, 9, 11], "label": "Melodic Minor (ascending)", "blurb": "Minor with raised 6th and 7th. Jazz favourite, also the parent of the altered scale."},
    "major_pentatonic": {"intervals": [0, 2, 4, 7, 9],        "label": "Major Pentatonic", "blurb": "Major scale minus the 4th and 7th. Five notes, no awkward intervals: country and pop-rock gold."},
    "minor_pentatonic": {"intervals": [0, 3, 5, 7, 10],       "label": "Minor Pentatonic", "blurb": "The bedrock of rock and blues lead guitar. Five notes that almost never sound wrong."},
    "blues":            {"intervals": [0, 3, 5, 6, 7, 10],    "label": "Blues Scale", "blurb": "Minor pentatonic plus the 'blue note' (b5). That bent, crying sound."},
    "dorian":           {"intervals": [0, 2, 3, 5, 7, 9, 10], "label": "Dorian", "blurb": "Minor with a natural 6th. The go-to modal scale for Santana-style jamming."},
    "phrygian":         {"intervals": [0, 1, 3, 5, 7, 8, 10], "label": "Phrygian", "blurb": "Minor with a b2. Dark, Spanish/flamenco flavour."},
    "lydian":           {"intervals": [0, 2, 4, 6, 7, 9, 11], "label": "Lydian", "blurb": "Major with a #4. Dreamy, floating, film-score sound."},
    "mixolydian":       {"intervals": [0, 2, 4, 5, 7, 9, 10], "label": "Mixolydian", "blurb": "Major with a b7. The sound of blues rock and jam bands."},
    "locrian":          {"intervals": [0, 1, 3, 5, 6, 8, 10], "label": "Locrian", "blurb": "Minor with b2 and b5. Unstable; used sparingly, mostly over m7b5 chords."},
}

# Chord-quality -> (semitone set, display suffix)
CHORD_QUALITIES: Dict[str, Dict[str, object]] = {
    "maj":     {"intervals": [0, 4, 7],        "suffix": "",     "label": "Major"},
    "min":     {"intervals": [0, 3, 7],        "suffix": "m",    "label": "Minor"},
    "dim":     {"intervals": [0, 3, 6],        "suffix": "dim",  "label": "Diminished"},
    "aug":     {"intervals": [0, 4, 8],        "suffix": "aug",  "label": "Augmented"},
    "sus2":    {"intervals": [0, 2, 7],        "suffix": "sus2", "label": "Suspended 2nd"},
    "sus4":    {"intervals": [0, 5, 7],        "suffix": "sus4", "label": "Suspended 4th"},
    "7":       {"intervals": [0, 4, 7, 10],    "suffix": "7",    "label": "Dominant 7th"},
    "maj7":    {"intervals": [0, 4, 7, 11],    "suffix": "maj7", "label": "Major 7th"},
    "min7":    {"intervals": [0, 3, 7, 10],    "suffix": "m7",   "label": "Minor 7th"},
    "minmaj7": {"intervals": [0, 3, 7, 11],    "suffix": "mMaj7","label": "Minor/Major 7th"},
    "dim7":    {"intervals": [0, 3, 6, 9],     "suffix": "dim7", "label": "Diminished 7th"},
    "m7b5":    {"intervals": [0, 3, 6, 10],    "suffix": "m7b5", "label": "Half-diminished"},
    "6":       {"intervals": [0, 4, 7, 9],     "suffix": "6",    "label": "Major 6th"},
    "min6":    {"intervals": [0, 3, 7, 9],     "suffix": "m6",   "label": "Minor 6th"},
    "9":       {"intervals": [0, 4, 7, 10, 2], "suffix": "9",    "label": "Dominant 9th"},
    "maj9":    {"intervals": [0, 4, 7, 11, 2], "suffix": "maj9", "label": "Major 9th"},
    "min9":    {"intervals": [0, 3, 7, 10, 2], "suffix": "m9",   "label": "Minor 9th"},
    "add9":    {"intervals": [0, 4, 7, 2],     "suffix": "add9", "label": "Add 9"},
    "5":       {"intervals": [0, 7],           "suffix": "5",    "label": "Power chord"},
}

# Qualities we only trust when the evidence is strong (they are easy to
# confuse with each other from chroma alone).
EXTENDED_QUALITIES = {"9", "maj9", "min9", "maj7", "minmaj7", "dim7", "m7b5", "6", "min6", "add9"}

# Diatonic chord qualities produced by each scale degree of the major scale.
MAJOR_KEY_DEGREES = ["maj", "min", "min", "maj", "maj", "min", "dim"]
MINOR_KEY_DEGREES = ["min", "dim", "maj", "min", "min", "maj", "maj"]


def scale_pitch_classes(root_pc: int, scale_id: str) -> List[int]:
    """Pitch classes (0-11) contained in `scale_id` built on `root_pc`."""
    if scale_id not in SCALES:
        raise KeyError(f"Unknown scale {scale_id!r}")
    return [(root_pc + i) % 12 for i in SCALES[scale_id]["intervals"]]  # type: ignore[index]


def chord_pitch_classes(root_pc: int, quality: str) -> List[int]:
    return [(root_pc + i) % 12 for i in CHORD_QUALITIES[quality]["intervals"]]  # type: ignore[index]


def chord_name(root_pc: int, quality: str, bass_pc: int | None = None, prefer_flat: bool = False) -> str:
    """Build a display name, e.g. (7,'min7', bass 9) -> 'Gm7/E'."""
    name = pc_name(root_pc, prefer_flat) + str(CHORD_QUALITIES[quality]["suffix"])
    if bass_pc is not None and bass_pc != root_pc:
        name += "/" + pc_name(bass_pc, prefer_flat)
    return name


# ─────────────────────────────────────────────────────────────
# 3. KEY PROFILES
#    Correlation targets for key detection (Krumhansl-Schmuckler style).
# ─────────────────────────────────────────────────────────────

KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
# Temperley / Kostka-Payne derived profiles, better on harmony-heavy audio.
TEMPERLEY_MAJOR = [0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.366, 0.057, 0.400]
TEMPERLEY_MINOR = [0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330]


# ─────────────────────────────────────────────────────────────
# 4. FRETBOARD
# ─────────────────────────────────────────────────────────────

# Open-string MIDI notes, low to high. Strings[0] is the low E string.
STANDARD_TUNING: List[str] = ["E2", "A2", "D3", "G3", "B3", "E4"]

TUNING_PRESETS: Dict[str, List[str]] = {
    "standard":    ["E2", "A2", "D3", "G3", "B3", "E4"],
    "half_down":   ["Eb2", "Ab2", "Db3", "Gb3", "Bb3", "Eb4"],
    "whole_down":  ["D2", "G2", "C3", "F3", "A3", "D4"],
    "drop_d":      ["D2", "A2", "D3", "G3", "B3", "E4"],
    "drop_c":      ["C2", "G2", "C3", "F3", "A3", "D4"],
    "open_g":      ["D2", "G2", "D3", "G3", "B3", "D4"],
    "open_d":      ["D2", "A2", "D3", "F#3", "A3", "D4"],
    "dadgad":      ["D2", "A2", "D3", "G3", "A3", "D4"],
    "7string_std": ["B1", "E2", "A2", "D3", "G3", "B3", "E4"],
}

STRING_NAMES = ["E", "A", "D", "G", "B", "e"]


def open_string_midi(tuning: Sequence[str]) -> List[int]:
    """['E2','A2',...] -> [40, 45, 50, 55, 59, 64]"""
    out = []
    for name in tuning:
        m = __import__("re").match(r"^([A-G][#b]?)(-?\d)$", name.strip())
        if not m:
            raise ValueError(f"Bad tuning note: {name!r}")
        pc = parse_note_name(m.group(1))
        octave = int(m.group(2))
        out.append((octave + 1) * 12 + pc)
    return out


@lru_cache(maxsize=None)
def tuning_open_midi(tuning_key: str) -> Tuple[int, ...]:
    return tuple(open_string_midi(TUNING_PRESETS.get(tuning_key, TUNING_PRESETS["standard"])))


def fretboard_positions(midi: int, tuning: Sequence[str] = STANDARD_TUNING,
                        max_fret: int = 22) -> List[Dict[str, int]]:
    """
    Every place on the fretboard where `midi` can be played.
    Returns [{"string": 0, "fret": 3}, ...] — string 0 = low E.
    """
    opens = open_string_midi(tuning)
    spots = []
    for s, open_midi in enumerate(opens):
        fret = midi - open_midi
        if 0 <= fret <= max_fret:
            spots.append({"string": s, "fret": fret})
    # Prefer lower strings / lower frets when sorted.
    spots.sort(key=lambda p: (p["fret"], p["string"]))
    return spots


# ─────────────────────────────────────────────────────────────
# 5. CHORD DIAGRAMS (real, playable guitar voicings)
#    frets: one entry per string, low->high; -1 = don't strum.
# ─────────────────────────────────────────────────────────────

# Movable (barre-free shapes are stored per root) + common open voicings.
OPEN_VOICINGS: Dict[str, List[Dict[str, object]]] = {
    # open position classics
    "C":   [{"frets": [-1, 3, 2, 0, 1, 0], "fingers": [0, 3, 2, 0, 1, 0], "position": 0}],
    "A":   [{"frets": [-1, 0, 2, 2, 2, 0], "fingers": [0, 0, 1, 2, 3, 0], "position": 0},
            {"frets": [-1, 0, 2, 2, 2, 3], "fingers": [0, 0, 1, 1, 1, 4], "position": 0}],
    "G":   [{"frets": [3, 2, 0, 0, 0, 3], "fingers": [2, 1, 0, 0, 0, 3], "position": 0},
            {"frets": [3, 2, 0, 0, 3, 3], "fingers": [2, 1, 0, 0, 3, 4], "position": 0}],
    "E":   [{"frets": [0, 2, 2, 1, 0, 0], "fingers": [0, 2, 3, 1, 0, 0], "position": 0}],
    "D":   [{"frets": [-1, -1, 0, 2, 3, 2], "fingers": [0, 0, 0, 1, 3, 2], "position": 0}],
    "Am":  [{"frets": [-1, 0, 2, 2, 1, 0], "fingers": [0, 0, 2, 3, 1, 0], "position": 0}],
    "Em":  [{"frets": [0, 2, 2, 0, 0, 0], "fingers": [0, 2, 3, 0, 0, 0], "position": 0}],
    "Dm":  [{"frets": [-1, -1, 0, 2, 3, 1], "fingers": [0, 0, 0, 2, 3, 1], "position": 0}],
    "F":   [{"frets": [1, 3, 3, 2, 1, 1], "fingers": [1, 3, 4, 2, 1, 1], "position": 1, "barre": 1},
            {"frets": [-1, -1, 3, 2, 1, 1], "fingers": [0, 0, 3, 2, 1, 1], "position": 1}],
    "Bm":  [{"frets": [-1, 2, 4, 4, 3, 2], "fingers": [0, 1, 3, 4, 2, 1], "position": 2, "barre": 2}],
    "A7":  [{"frets": [-1, 0, 2, 0, 2, 0], "fingers": [0, 0, 2, 0, 3, 0], "position": 0}],
    "E7":  [{"frets": [0, 2, 0, 1, 0, 0], "fingers": [0, 2, 0, 1, 0, 0], "position": 0}],
    "D7":  [{"frets": [-1, -1, 0, 2, 1, 2], "fingers": [0, 0, 0, 2, 1, 3], "position": 0}],
    "C7":  [{"frets": [-1, 3, 2, 3, 1, 0], "fingers": [0, 3, 2, 4, 1, 0], "position": 0}],
    "G7":  [{"frets": [3, 2, 0, 0, 0, 1], "fingers": [3, 2, 0, 0, 0, 1], "position": 0}],
    "B7":  [{"frets": [-1, 2, 1, 2, 0, 2], "fingers": [0, 2, 1, 3, 0, 4], "position": 0}],
    "Am7": [{"frets": [-1, 0, 2, 0, 1, 0], "fingers": [0, 0, 2, 0, 1, 0], "position": 0}],
    "Em7": [{"frets": [0, 2, 0, 0, 0, 0], "fingers": [0, 2, 0, 0, 0, 0], "position": 0}],
    "Dm7": [{"frets": [-1, -1, 0, 2, 1, 1], "fingers": [0, 0, 0, 2, 1, 1], "position": 0}],
    "Cmaj7": [{"frets": [-1, 3, 2, 0, 0, 0], "fingers": [0, 3, 2, 0, 0, 0], "position": 0}],
    "Gmaj7": [{"frets": [3, 2, 0, 0, 0, 2], "fingers": [2, 1, 0, 0, 0, 3], "position": 0}],
    "Amaj7": [{"frets": [-1, 0, 2, 1, 2, 0], "fingers": [0, 0, 3, 1, 4, 0], "position": 0}],
    "Fmaj7": [{"frets": [-1, -1, 3, 2, 1, 0], "fingers": [0, 0, 3, 2, 1, 0], "position": 0}],
    "Dmaj7": [{"frets": [-1, -1, 0, 2, 2, 2], "fingers": [0, 0, 0, 1, 1, 1], "position": 0}],
    "Asus2": [{"frets": [-1, 0, 2, 2, 0, 0], "fingers": [0, 0, 1, 2, 0, 0], "position": 0}],
    "Dsus2": [{"frets": [-1, -1, 0, 2, 3, 0], "fingers": [0, 0, 0, 1, 3, 0], "position": 0}],
    "Asus4": [{"frets": [-1, 0, 2, 2, 3, 0], "fingers": [0, 0, 1, 1, 3, 0], "position": 0}],
    "Dsus4": [{"frets": [-1, -1, 0, 2, 3, 3], "fingers": [0, 0, 0, 1, 2, 3], "position": 0}],
    "Esus4": [{"frets": [0, 2, 2, 2, 0, 0], "fingers": [0, 1, 1, 1, 0, 0], "position": 0}],
    "Dm7b5": [{"frets": [-1, -1, 0, 1, 1, 1], "fingers": [0, 0, 0, 1, 2, 3], "position": 0}],
    "Asus2": [{"frets": [-1, 0, 2, 2, 0, 0], "fingers": [0, 0, 1, 2, 0, 0], "position": 0}],
    "Cadd9": [{"frets": [-1, 3, 2, 0, 3, 3], "fingers": [0, 2, 1, 0, 3, 4], "position": 0}],
    "G5":  [{"frets": [3, 5, 5, -1, -1, -1], "fingers": [1, 3, 4, 0, 0, 0], "position": 3}],
    "A5":  [{"frets": [-1, 0, 2, 2, -1, -1], "fingers": [0, 0, 1, 2, 0, 0], "position": 0},
            {"frets": [5, 7, 7, -1, -1, -1], "fingers": [1, 3, 4, 0, 0, 0], "position": 5}],
    "D5":  [{"frets": [-1, -1, 0, 2, 3, -1], "fingers": [0, 0, 0, 1, 2, 0], "position": 0}],
    "E5":  [{"frets": [0, 2, 2, -1, -1, -1], "fingers": [0, 1, 2, 0, 0, 0], "position": 0}],
}

# Movable shapes keyed by (quality, which string is the root: 6=low E, 5=A).
# frets are relative to `position` (position = fret of the shape's first finger).
MOVABLE_SHAPES: Dict[str, List[Dict[str, object]]] = {
    "maj": [
        {"root_string": 5, "offsets": [-1, 0, 2, 2, 2, 0], "fingers": [0, 0, 1, 2, 3, 0], "root_offset": 0},   # A-shape
        {"root_string": 6, "offsets": [0, 2, 2, 1, 0, 0], "fingers": [0, 2, 3, 1, 0, 0], "root_offset": 0},   # E-shape (open only)
        {"root_string": 6, "offsets": [3, 2, 0, 0, 0, 3], "fingers": [2, 1, 0, 0, 0, 3], "root_offset": 3},   # G-shape
        {"root_string": 6, "offsets": [0, 2, 2, 1, 0, 0], "fingers": [1, 3, 4, 2, 1, 1], "root_offset": 0, "barre": True},
    ],
    "min": [
        {"root_string": 5, "offsets": [-1, 0, 2, 2, 1, 0], "fingers": [0, 0, 2, 3, 1, 0], "root_offset": 0},
        {"root_string": 6, "offsets": [0, 2, 2, 0, 0, 0], "fingers": [1, 3, 4, 1, 1, 1], "root_offset": 0, "barre": True},
    ],
    "7": [
        {"root_string": 5, "offsets": [-1, 0, 2, 0, 2, 0], "fingers": [0, 0, 1, 0, 2, 0], "root_offset": 0},
        {"root_string": 6, "offsets": [0, 2, 0, 1, 0, 0], "fingers": [1, 3, 1, 2, 1, 1], "root_offset": 0, "barre": True},
        {"root_string": 6, "offsets": [3, 2, 3, 1, 0, 0], "fingers": [3, 2, 4, 1, 0, 0], "root_offset": 3},
    ],
    "min7": [
        {"root_string": 5, "offsets": [-1, 0, 2, 0, 1, 0], "fingers": [0, 0, 2, 0, 1, 0], "root_offset": 0},
        {"root_string": 6, "offsets": [0, 2, 0, 0, 0, 0], "fingers": [1, 3, 1, 1, 1, 1], "root_offset": 0, "barre": True},
    ],
    "maj7": [
        {"root_string": 5, "offsets": [-1, 0, 2, 1, 2, 0], "fingers": [0, 0, 2, 1, 3, 0], "root_offset": 0},
        {"root_string": 6, "offsets": [0, 2, 1, 1, 0, 0], "fingers": [1, 3, 2, 2, 1, 1], "root_offset": 0, "barre": True},
    ],
    "sus4": [
        {"root_string": 5, "offsets": [-1, 0, 2, 2, 3, 0], "fingers": [0, 0, 1, 1, 3, 0], "root_offset": 0},
        {"root_string": 6, "offsets": [0, 2, 2, 2, 0, 0], "fingers": [1, 2, 3, 4, 1, 1], "root_offset": 0, "barre": True},
    ],
    "sus2": [
        {"root_string": 5, "offsets": [-1, 0, 2, 2, 0, 0], "fingers": [0, 0, 1, 2, 0, 0], "root_offset": 0},
    ],
    "5": [
        {"root_string": 6, "offsets": [0, 2, 2, -1, -1, -1], "fingers": [1, 3, 4, 0, 0, 0], "root_offset": 0},
        {"root_string": 5, "offsets": [-1, 0, 2, 2, -1, -1], "fingers": [0, 1, 3, 4, 0, 0], "root_offset": 0},
    ],
    "min9": [], "9": [], "dim": [], "aug": [], "dim7": [], "m7b5": [], "6": [], "min6": [],
    "add9": [], "maj9": [], "minmaj7": [],
}


def _transpose_shape(shape: Dict[str, object], root_pc: int, tuning: Sequence[str]) -> Dict[str, object] | None:
    """Move a movable shape so that its root lands on `root_pc`."""
    opens = open_string_midi(tuning)
    n_strings = len(opens)
    root_string = int(shape["root_string"])  # 1-based from musician view: 6 = low E
    s_index = n_strings - root_string if root_string <= n_strings else None
    if s_index is None or s_index < 0:
        return None
    offsets: List[int] = list(shape["offsets"])  # type: ignore[arg-type]
    if n_strings == 6 and len(offsets) == 6:
        frets = list(offsets)
    elif n_strings == 7:
        frets = [-1] + list(offsets)
        s_index += 1
    else:
        return None

    root_fret_on_string = root_pc - (opens[s_index] % 12)
    root_fret_on_string %= 12
    # Keep the shape low on the neck: try the root at its lowest occurrence.
    base = root_fret_on_string - int(shape["root_offset"])
    if base < 0:
        base += 12
    out = []
    for f in frets:
        out.append(-1 if f < 0 else f + base)
    # Sanity: everything must be within 0..15 to be a sane diagram.
    if any(f > 15 for f in out if f >= 0):
        # try an octave down (only valid if that keeps frets >= 0)
        cand = [(f - 12) if f > 0 else f for f in out]
        if all(f >= 0 for f in cand if f != -1):
            out = cand
    return {"frets": out, "fingers": list(shape["fingers"]),  # type: ignore[arg-type]
            "barre": bool(shape.get("barre", False)),
            "position": min([f for f in out if f > 0], default=0),
            "root_string": root_string}


def chord_diagrams(root_pc: int, quality: str, tuning: Sequence[str] = STANDARD_TUNING,
                   prefer_flat: bool = False, max_diagrams: int = 3) -> List[Dict[str, object]]:
    """
    Return playable guitar diagrams for a chord.
    Real, hand-written voicings where we have them; otherwise a movable shape.
    Never invents a shape we cannot justify: falls back to an empty list,
    and the UI then draws a plain fret number map.
    """
    name = pc_name(root_pc, prefer_flat) + str(CHORD_QUALITIES[quality]["suffix"])
    diagrams: List[Dict[str, object]] = []
    for v in OPEN_VOICINGS.get(name, []):
        diagrams.append({
            "name": name,
            "frets": list(v["frets"]),       # type: ignore[arg-type]
            "fingers": list(v["fingers"]),   # type: ignore[arg-type]
            "barre": int(v.get("barre", 0)),  # type: ignore[arg-type]
            "position": int(v["position"]),   # type: ignore[arg-type]
            "source": "voicing-library",
        })
    for shape in MOVABLE_SHAPES.get(quality, []):
        got = _transpose_shape(shape, root_pc, tuning)
        if got:
            got["name"] = name
            got["source"] = "movable-shape"
            diagrams.append(got)
    # de-duplicate
    seen, uniq = set(), []
    for d in diagrams:
        key = tuple(d["frets"])  # type: ignore[arg-type]
        if key not in seen:
            seen.add(key)
            uniq.append(d)
    uniq.sort(key=lambda d: (max(d["frets"]) if any(f > 0 for f in d["frets"]) else 99))  # type: ignore[arg-type]
    return uniq[:max_diagrams]


# ─────────────────────────────────────────────────────────────
# 6. SMALL HELPERS
# ─────────────────────────────────────────────────────────────

def interval_between(a_pc: int, b_pc: int) -> str:
    """Named interval from a to b (in semitones), used in explanations."""
    names = {0: "unison", 1: "minor 2nd", 2: "major 2nd", 3: "minor 3rd", 4: "major 3rd",
             5: "perfect 4th", 6: "tritone (b5/#4)", 7: "perfect 5th", 8: "minor 6th",
             9: "major 6th", 10: "minor 7th", 11: "major 7th"}
    return names[(b_pc - a_pc) % 12]


def degree_name(degree_index: int) -> str:
    return ["I", "II", "III", "IV", "V", "VI", "VII"][degree_index % 7]


def roman_numeral(root_pc: int, key_pc: int, quality: str, minor_key: bool = False) -> str:
    """Nashville/roman numeral relative to a key, e.g. 'V7', 'iv', 'bVII'."""
    deg = (root_pc - key_pc) % 12
    table = MINOR_KEY_DEGREES if minor_key else MAJOR_KEY_DEGREES
    flat_map = {0: 0, 1: None, 2: 1, 3: None, 4: 2, 5: 3, 6: None, 7: 4, 8: None, 9: 5, 10: None, 11: 6}
    idx = flat_map.get(deg)
    accidental = ""
    if idx is None:
        idx = flat_map[(deg + 1) % 12]
        accidental = "b"
    numeral = degree_name(idx)
    expected = table[idx]
    # numeral case: uppercase = major-ish, lowercase = minor-ish
    if quality in ("min", "min7", "min9", "min6", "dim", "dim7", "m7b5"):
        numeral = numeral.lower()
    elif quality == "aug":
        numeral = numeral.upper() + "+"
    suffix = str(CHORD_QUALITIES[quality]["suffix"])
    if expected == quality:
        suffix = "" if quality in ("maj", "min") else suffix
    return accidental + numeral + suffix

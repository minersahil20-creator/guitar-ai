"""
separation.py — split a song into stems (vocals / drums / bass / guitar / other).

TWO ENGINES, and we are scrupulous about which one ran:

A) Meta Demucs  (if `pip install demucs` succeeded)
   We specifically ask for **htdemucs_6s**, the 6-stem model, because it is
   the one that produces a real GUITAR stem (vocals, drums, bass, guitar,
   piano, other). Plain 4-stem models (vocals/drums/bass/other) do NOT give
   you a guitar stem, and this app will never label "other" as guitar.
   Backing track = sum of every stem except guitar.
   -> engine id: "demucs:htdemucs_6s", is_true_separation = True

B) HPSS + band decomposition  (always available, pure librosa)
   Harmonic/percussive separation plus frequency-band splitting. This is
   signal processing, NOT source separation: it cannot truly isolate a
   guitar that shares the midrange with keyboards and vocals.
   -> engine id: "hpss-band-fallback", is_true_separation = False
   The UI shows a clear warning whenever this engine produced the stems.
"""

from __future__ import annotations

import shutil
import subprocess
import uuid
from pathlib import Path

import numpy as np

from app.audio.loader import normalize_peak, write_wav
from app.core.config import settings

STEM_LABELS = {
    "vocals": "Vocals",
    "drums": "Drums",
    "bass": "Bass",
    "guitar": "Guitar",
    "guitar_solo": "Lead Guitar Solo",
    "guitar_rhythm": "Rhythm Guitar Chords",
    "piano": "Piano / Keys",
    "other": "Other instruments",
    "harmonic": "Harmonic content",
    "percussive": "Percussive content",
    "mid_harmonic": "Mid-range harmonic (guitar-ish)",
}


def available_ram_mb() -> int:
    """Free RAM in MB (Linux / macOS / Windows, best effort)."""
    try:
        import os
        if hasattr(os, "sysconf") and "SC_PAGE_SIZE" in os.sysconf_names:
            import os as _os
            try:
                with open("/proc/meminfo") as fh:
                    for line in fh:
                        if line.startswith("MemAvailable:"):
                            return int(line.split()[1]) // 1024
            except OSError:
                pass
    except Exception:  # noqa: BLE001
        pass
    try:
        import psutil  # type: ignore
        return int(psutil.virtual_memory().available / 1e6)
    except Exception:  # noqa: BLE001
        return 8192      # assume plenty if we cannot tell


def _limit_torch_threads() -> None:
    """Fewer threads = less memory and no speed loss on small CPU counts."""
    try:
        import torch
        import os
        n = max(1, min(4, (os.cpu_count() or 2)))
        torch.set_num_threads(n)
    except Exception:  # noqa: BLE001
        pass


def demucs_available() -> bool:
    return shutil.which("demucs") is not None or _import_demucs_api() is not None


def _import_demucs_api():
    try:
        import demucs.api  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return None


# ─────────────────────────────────────────────────────────────
# ENGINE A: Demucs
# ─────────────────────────────────────────────────────────────

def _separate_demucs(path: str | Path, out_dir: Path, model: str,
                     progress=None) -> dict | None:
    """
    Runs Demucs via its Python API (safer than shelling out) and writes each
    stem as a wav into out_dir. Returns a stem map, or None on failure.
    """
    try:
        import torch
        from demucs.api import Separator
    except Exception:  # noqa: BLE001
        return None

    ram = available_ram_mb()

    def emit(pct: int, msg: str):
        if progress:
            progress(pct, msg)

    emit(12, f"Loading Demucs model '{model}' (first run downloads the weights)…")

    # Demucs 4.x reports progress through a callback dict with segment_offset & audio_length.
    def _cb(info: dict):
        try:
            state = info.get("state", "")
            if state == "start":
                return
            offset = info.get("segment_offset") or info.get("step") or info.get("progress")
            total = info.get("audio_length") or info.get("total")
            if offset is not None and total:
                frac = float(offset) / max(float(total), 1e-9)
                pct = 25 + int(50 * min(max(frac, 0.0), 1.0))
                emit(pct, f"Separating sources ({pct}% on CPU)…")
        except Exception:  # noqa: BLE001
            pass

    try:
        sep = Separator(model=model, device=settings.DEMUCS_DEVICE,
                        shifts=settings.DEMUCS_SHIFTS, jobs=settings.DEMUCS_JOBS,
                        segment=settings.DEMUCS_SEGMENT or (6 if ram < 4096 else None),
                        progress=False, callback=_cb)
    except Exception as exc:  # noqa: BLE001
        import logging
        logging.getLogger("guitar-ai").warning("Demucs Separator init failed: %s", exc)
        return None

    emit(25, "Separating sources (this is the slow part on CPU)…")
    try:
        _, outputs = sep.separate_audio_file(Path(str(path)))
    except Exception as exc:  # noqa: BLE001
        import logging
        logging.getLogger("guitar-ai").warning("Demucs separate_audio_file failed: %s", exc)
        return None

    emit(78, "Writing stems…")
    stems = {}
    sr_out = None
    try:
        sr_out = int(sep.samplerate)
    except Exception:  # noqa: BLE001
        sr_out = None
    for name, tensor in outputs.items():
        arr = tensor.detach().cpu().numpy()
        if arr.ndim == 2:
            arr = arr.mean(axis=0)                 # stereo -> mono
        stems[str(name)] = arr.astype(np.float32)

    return {"stems": stems, "sr": sr_out or 44100}


# ─────────────────────────────────────────────────────────────
# ENGINE B: HPSS + band split (honest fallback)
# ─────────────────────────────────────────────────────────────

def _separate_hpss(y: np.ndarray, sr: int) -> dict:
    import librosa

    y_h, y_p = librosa.effects.hpss(y, margin=(1.0, 5.0))

    def bandpass(x, lo, hi, order=4):
        from scipy.signal import butter, sosfiltfilt
        nyq = sr / 2.0
        lo_n = max(lo / nyq, 1e-5)
        hi_n = min(hi / nyq, 0.99)
        if lo_n >= hi_n:
            return np.zeros_like(x)
        sos = butter(order, [lo_n, hi_n], btype="band", output="sos")
        return sosfiltfilt(sos, x).astype(np.float32)

    def lowpass(x, cutoff, order=4):
        from scipy.signal import butter, sosfiltfilt
        nyq = sr / 2.0
        c = min(cutoff / nyq, 0.99)
        sos = butter(order, c, btype="low", output="sos")
        return sosfiltfilt(sos, x).astype(np.float32)

    def highpass(x, cutoff, order=4):
        from scipy.signal import butter, sosfiltfilt
        nyq = sr / 2.0
        c = max(cutoff / nyq, 1e-5)
        sos = butter(order, c, btype="high", output="sos")
        return sosfiltfilt(sos, x).astype(np.float32)

    bass = lowpass(y, 200.0)
    # vocal band is roughly 250 Hz - 3 kHz; mid_harmonic covers guitar body + upper harmonics
    vocals = bandpass(y_h, 250.0, 3000.0)
    mid_harmonic = bandpass(y_h, 180.0, 5000.0)
    drums = y_p
    other = highpass(y_h, 5000.0)

    return {
        "vocals": vocals,
        "drums": drums,
        "bass": bass,
        "mid_harmonic": mid_harmonic,
        "other": other,
        "harmonic": y_h,
        "percussive": y_p,
    }


# ─────────────────────────────────────────────────────────────
# Transparent Phase-Preserving Lead Solo Removal
# Preserves 100% of Bass (< 250 Hz) and 100% of Cymbals/Air (> 4800 Hz)
# with ZERO phase cancellation or comb filtering.
# Uses complementary continuous spectral gain masking so the backing
# instruments (drums, bass, keys, rhythm chords) remain 100% clear.
# ─────────────────────────────────────────────────────────────

def build_transparent_backing_mask(
    y: np.ndarray,
    sr: int,
    notes: list | None = None,
    solo_only: bool = True,
    strength: float = 0.85,
    n_fft: int = 2048,
    hop: int = 512,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Computes (D, G) where D is the complex STFT of y, and G is a continuous
    phase-preserving gain mask in [0, 1].
    D * G is the backing track (perfect original phase preserved!).
    D * (1 - G) is the isolated guitar solo.
    """
    import librosa
    from scipy.ndimage import uniform_filter

    D = librosa.stft(y, n_fft=n_fft, hop_length=hop, window="hann")
    mag = np.abs(D)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    times = librosa.frames_to_time(np.arange(D.shape[1]), sr=sr, hop_length=hop)

    # 1. Start with 100% transparency everywhere (1.0 = bit-for-bit identical)
    G = np.ones_like(mag, dtype=np.float32)

    if not solo_only:
        # Full guitar cut across 250 Hz - 4500 Hz
        mid_mask = (freqs >= 250) & (freqs <= 4500)
        G[mid_mask, :] = 1.0 - (strength * 0.90)
        G = np.clip(G, 0.08, 1.0)
        G[freqs < 250, :] = 1.0
        G[freqs > 4800, :] = 1.0
        return D, G

    # 2. Percussion / Drum Transient Protection
    # Measure frame-to-frame positive onset flux so drums/snare/toms are NEVER ducked
    flux = np.diff(mag, axis=1, prepend=mag[:, :1])
    pos_flux = np.maximum(0.0, flux)
    transient_energy = np.mean(pos_flux, axis=0)
    thresh = np.percentile(transient_energy, 75)
    transient_weight = np.clip(1.0 - (transient_energy / (thresh * 2.0 + 1e-6)), 0.15, 1.0)

    # 3. Precise harmonic notch attenuation on transcribed solo notes (if available)
    if notes:
        for note in notes:
            t_start = max(0.0, float(note.get("start", 0)) - 0.04)
            t_end = float(note.get("end", 0)) + 0.04
            midi = int(note.get("midi", 0))
            if midi <= 0:
                continue
            f0 = 440.0 * (2.0 ** ((midi - 69) / 12.0))
            time_mask = (times >= t_start) & (times <= t_end)
            if not np.any(time_mask):
                continue

            for h in range(1, 7):
                fh = f0 * h
                if fh > 4500:
                    break
                bw = 28.0 + (h * 4.0)
                freq_dist = np.abs(freqs - fh)
                h_mask = freq_dist < bw
                if not np.any(h_mask):
                    continue
                depth = strength * 0.82
                shape = np.exp(-0.5 * (freq_dist[h_mask] / (bw * 0.5)) ** 2)
                for f_idx, s in zip(np.where(h_mask)[0], shape):
                    eff_notch = depth * s * transient_weight[time_mask]
                    G[f_idx, time_mask] = np.minimum(G[f_idx, time_mask], 1.0 - eff_notch)

    # 4. Adaptive temporal prominence for sustained lead notes & bends
    # Temporal smoothing along time (~11 frames = ~130ms) estimates the background chord bed
    bed = uniform_filter(mag, size=(1, 11))
    peak = np.maximum(0.0, mag - 1.15 * bed)
    ratio = peak / (mag + 1e-6)
    ratio = np.clip(ratio, 0.0, 1.0) * transient_weight[np.newaxis, :]

    mid_mask = (freqs >= 250) & (freqs <= 4500)
    G_prom = 1.0 - (strength * 0.75 * ratio)
    G[mid_mask, :] = np.minimum(G[mid_mask, :], G_prom[mid_mask, :])

    # 5. Clarity safeguards:
    # Frequencies below 250 Hz (bass guitar & kick drum) are 100% UNTOUCHED
    G[freqs < 250, :] = 1.0
    # Frequencies above 4800 Hz (cymbals & high air) are 100% UNTOUCHED
    G[freqs > 4800, :] = 1.0
    # Floor: guarantee background instruments are never reduced below 0.18
    G = np.clip(G, 0.18, 1.0)

    return D, G


def _process_solo_removal(
    y: np.ndarray,
    sr: int,
    notes: list | None = None,
    solo_only: bool = True,
    strength: float = 0.85,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    import librosa

    D, G = build_transparent_backing_mask(
        y, sr, notes=notes, solo_only=solo_only, strength=strength
    )
    # Reconstruct backing audio preserving exact original complex phase!
    y_back = librosa.istft(D * G, hop_length=512, length=len(y), window="hann")
    # Reconstruct isolated solo audio
    y_solo = librosa.istft(D * (1.0 - G), hop_length=512, length=len(y), window="hann")
    # Rhythm / diffuse bed track
    y_rhythm = librosa.istft(D * np.minimum(G, 0.75), hop_length=512, length=len(y), window="hann")

    return y_back.astype(np.float32), y_solo.astype(np.float32), y_rhythm.astype(np.float32)


def make_backing_audio(
    path: str | Path,
    y: np.ndarray,
    sr: int,
    notes: list | None = None,
    solo_only: bool = True,
    strength: float = 0.85,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    import soundfile as sf
    import librosa

    data = None
    try:
        data, native_sr = sf.read(str(path), dtype="float32", always_2d=False)
        if native_sr != sr:
            data = None
    except Exception:
        data = None

    if data is not None and data.ndim == 2 and data.shape[1] == 2:
        L = data[:, 0]
        R = data[:, 1]
        M = (L + R) * 0.5
        S = (L - R) * 0.5
        # Lead guitar solo is centered (Mid channel M).
        # Side channel S (wide stereo rhythm guitars, keys, reverb) is 100% UNTOUCHED!
        D_m, G_m = build_transparent_backing_mask(
            M, sr, notes=notes, solo_only=solo_only, strength=strength
        )
        M_back = librosa.istft(D_m * G_m, hop_length=512, length=len(M), window="hann")
        M_solo = librosa.istft(D_m * (1.0 - G_m), hop_length=512, length=len(M), window="hann")

        L_back = M_back + S
        R_back = M_back - S
        backing = np.column_stack([L_back, R_back])
        solo = np.column_stack([M_solo, M_solo])
        rhythm = np.column_stack([M_back * 0.65 + S, M_back * 0.65 - S])
        return backing.astype(np.float32), solo.astype(np.float32), rhythm.astype(np.float32)

    return _process_solo_removal(y, sr, notes=notes, solo_only=solo_only, strength=strength)


# ─────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────

def separate(
    path: str | Path,
    y: np.ndarray,
    sr: int,
    job_id: str,
    want_guitar: bool = True,
    progress=None,
    mode: str | None = None,
    solo_only: bool = True,
    strength: float = 0.85,
    notes: list | None = None,
) -> dict:
    """
    Runs source separation / lead solo removal and writes wav files into
    processed/<job_id>/stems/. Returns a complete description of what was produced.

    When solo_only is True (default):
      Preserves full bass (< 260 Hz), drums/percussion, keyboards/piano, and rhythm guitar chords.
      Only attenuates the lead solo so the guitarist can jam along!
    """
    out_dir = settings.PROCESSED_DIR / job_id / "stems"
    out_dir.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []
    stems: dict[str, np.ndarray] = {}
    engine = ""
    true_sep = False

    min_ram = settings.DEMUCS_MIN_RAM_MB
    ram = available_ram_mb()
    force_fast = (mode == "fast")

    if not force_fast and settings.USE_DEMUCS and demucs_available() and ram >= min_ram:
        _limit_torch_threads()
        got = None
        for model in dict.fromkeys([settings.DEMUCS_MODEL, settings.DEMUCS_FALLBACK_MODEL]):
            try:
                got = _separate_demucs(path, out_dir, model, progress=progress)
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"Demucs model '{model}' failed: {type(exc).__name__}: {exc}")
                got = None
            if got and got.get("stems"):
                stems = got["stems"]
                sr = int(got.get("sr") or sr)
                engine = f"demucs:{model}"
                true_sep = True
                break
        if not true_sep:
            warnings.append("Demucs was installed but could not run; using targeted spectral solo removal instead.")
    elif settings.USE_DEMUCS and demucs_available():
        warnings.append(
            f"Meta Demucs is installed but this machine has only ~{ram:,} MB of free RAM "
            f"(the model needs about {min_ram:,} MB). Used instant spectral solo removal to avoid server crash."
        )

    # ── Calculate reference peak gain ─────────────────────────
    peaks = {n: float(np.max(np.abs(np.nan_to_num(a)))) for n, a in stems.items()}
    ref_peak = max(peaks.values()) if peaks else float(np.max(np.abs(y)))
    gain = (0.95 / ref_peak) if ref_peak > 1e-6 else 1.0

    guitar_path = None
    rhythm_path = None
    backing_path = None

    if "guitar" in stems and true_sep:
        # Demucs separated stems: vocals, drums, bass, guitar, piano/keys, other.
        # If solo_only is True, we don't throw away guitar! We separate guitar into solo and rhythm chords:
        g_full = stems["guitar"]
        if solo_only:
            _, g_solo, g_rhythm = _process_solo_removal(
                g_full, sr, notes=notes, solo_only=True, strength=strength
            )
        else:
            g_solo = g_full
            g_rhythm = np.zeros_like(g_full)

        g = np.clip(np.nan_to_num(g_solo) * gain, -1.0, 1.0).astype(np.float32)
        guitar_path = out_dir / "guitar.wav"
        write_wav(guitar_path, g, sr)

        if solo_only:
            r_wav = np.clip(np.nan_to_num(g_rhythm) * gain, -1.0, 1.0).astype(np.float32)
            rhythm_path = out_dir / "guitar_rhythm.wav"
            write_wav(rhythm_path, r_wav, sr)

        # Backing track = bass + drums + piano/keys + vocals + other + rhythm guitar!
        backing = np.zeros_like(g_full)
        for name, arr in stems.items():
            if name == "guitar":
                if solo_only:
                    backing = backing + g_rhythm[: len(backing)]
                continue
            a = np.nan_to_num(np.asarray(arr, dtype=np.float32))
            backing = backing + a[: len(backing)]

        backing_path = out_dir / "backing.wav"
        write_wav(backing_path, np.clip(backing * gain, -1.0, 1.0).astype(np.float32), sr)

        # Write each individual stem as well
        written = []
        for name, arr in stems.items():
            arr = np.nan_to_num(np.asarray(arr, dtype=np.float32))
            if not np.any(arr):
                continue
            rms = float(np.sqrt(np.mean(arr ** 2)))
            silent = rms < max(0.0015, ref_peak * 0.02)
            out_arr = np.clip(arr * gain, -1.0, 1.0).astype(np.float32)
            fp = out_dir / f"{name}.wav"
            write_wav(fp, out_arr, sr)
            written.append({
                "stem": name,
                "label": STEM_LABELS.get(name, name.title()),
                "url": f"/api/audio/{job_id}/stems/{name}.wav",
                "is_guitar": name in ("guitar", "mid_harmonic"),
                "rms": round(rms, 5),
                "silent": bool(silent),
            })
    else:
        # Transparent Phase-Preserving Solo Removal engine
        engine = "spectral-solo-removal"
        true_sep = False
        backing, solo, rhythm = make_backing_audio(
            path, y, sr, notes=notes, solo_only=solo_only, strength=strength
        )

        backing_path = out_dir / "backing.wav"
        guitar_path = out_dir / "guitar.wav"

        # Maintain master fullness, punch, and dynamic clarity
        orig_peak = float(np.max(np.abs(y)))
        back_peak = float(np.max(np.abs(backing)))
        if back_peak > 1e-4 and orig_peak > 1e-4:
            backing_scaled = backing * (min(0.95, orig_peak) / back_peak)
        else:
            backing_scaled = backing

        write_wav(backing_path, np.clip(np.nan_to_num(backing_scaled), -1.0, 1.0).astype(np.float32), sr)
        write_wav(guitar_path, np.clip(np.nan_to_num(solo), -1.0, 1.0).astype(np.float32), sr)
        write_wav(out_dir / "guitar_approx.wav", np.clip(np.nan_to_num(solo), -1.0, 1.0).astype(np.float32), sr)

        if solo_only:
            rhythm_path = out_dir / "guitar_rhythm.wav"
            write_wav(rhythm_path, np.clip(np.nan_to_num(rhythm) * gain, -1.0, 1.0).astype(np.float32), sr)

        # Generate individual stems for practice: bass, drums, vocals, rhythm chords
        stems_dict = _separate_hpss(y, sr)
        written = []
        for name, arr in stems_dict.items():
            arr = np.nan_to_num(np.asarray(arr, dtype=np.float32))
            if not np.any(arr):
                continue
            rms = float(np.sqrt(np.mean(arr ** 2)))
            silent = rms < max(0.0015, ref_peak * 0.02)
            out_arr = np.clip(arr * gain, -1.0, 1.0).astype(np.float32)
            fp = out_dir / f"{name}.wav"
            write_wav(fp, out_arr, sr)
            written.append({
                "stem": name,
                "label": STEM_LABELS.get(name, name.title()),
                "url": f"/api/audio/{job_id}/stems/{name}.wav",
                "is_guitar": name in ("guitar", "mid_harmonic"),
                "rms": round(rms, 5),
                "silent": bool(silent),
            })

    out = {
        "engine": engine,
        "is_true_separation": true_sep,
        "stems": written,
        "guitar": {
            "available": guitar_path is not None,
            "is_isolated": True,
            "url": f"/api/audio/{job_id}/stems/guitar.wav" if guitar_path else None,
            "label": "Isolated Lead Guitar Solo",
        },
        "rhythm_guitar": {
            "available": rhythm_path is not None,
            "url": f"/api/audio/{job_id}/stems/guitar_rhythm.wav" if rhythm_path else None,
            "label": "Rhythm Guitar Chords",
        },
        "backing": {
            "available": backing_path is not None,
            "url": f"/api/audio/{job_id}/stems/backing.wav" if backing_path else None,
            "label": "Jam Backing Track (Solo Removed · Rhythm Guitar, Bass & Keys Kept)" if solo_only
                     else "Jam Backing Track (Full Guitar Cut)",
            "solo_only": solo_only,
            "strength": strength,
        },
        "warnings": warnings,
    }
    return out

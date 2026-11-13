"""Shared building blocks for synthesized sound effects (#3560, #3563).

Oscillators, filters, envelopes and an Ogg writer used by the per-game generators,
`synth_starswarm_sfx.py` (#3560) and `synth_arcade_sfx.py` (#3563). Every recipe built from these is deterministic: noise always takes an
explicit seed, so a generator reproduces its files' decoded audio exactly. Ogg bytes still
differ between runs, because libvorbis picks a random stream serial number. Compare decoded PCM
with `decoded_pcm_sha256` instead.

Needs numpy, plus ffmpeg with libvorbis for `write_ogg` / `decoded_pcm_sha256`.
"""

from __future__ import annotations

import hashlib
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

import numpy as np

SR = 44100


# --- time and oscillators ---------------------------------------------------------------------


def t_axis(dur: float) -> np.ndarray:
    return np.arange(int(dur * SR)) / SR


def phase(freq: np.ndarray) -> np.ndarray:
    """Integrate an instantaneous-frequency array (Hz) into phase (radians)."""
    return 2 * np.pi * np.cumsum(freq) / SR


def sine(f: float | np.ndarray, t: np.ndarray) -> np.ndarray:
    return np.sin(phase(np.broadcast_to(np.asarray(f, float), t.shape).copy()))


def saw(ph: np.ndarray) -> np.ndarray:
    return 2 * ((ph / (2 * np.pi)) % 1.0) - 1


def square(ph: np.ndarray, duty: float = 0.5) -> np.ndarray:
    return np.where((ph / (2 * np.pi)) % 1.0 < duty, 1.0, -1.0)


def lfo(t: np.ndarray, rate: float) -> np.ndarray:
    return np.sin(2 * np.pi * rate * t)


def noise(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(n)


# --- filters ----------------------------------------------------------------------------------


def lowpass(x: np.ndarray, cutoff: float | np.ndarray) -> np.ndarray:
    """One-pole lowpass; cutoff may be a scalar or a per-sample array (Hz)."""
    cut = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * cut / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def lp2(x: np.ndarray, cutoff: float | np.ndarray) -> np.ndarray:
    """Two passes of the one-pole lowpass: a gentler, darker 12 dB/oct slope."""
    return lowpass(lowpass(x, cutoff), cutoff)


def highpass(x: np.ndarray, cutoff: float | np.ndarray) -> np.ndarray:
    return x - lowpass(x, cutoff)


# --- envelopes and mixing ---------------------------------------------------------------------


def env_ad(n: int, attack: float, decay_shape: float) -> np.ndarray:
    """Linear attack (seconds), then a power-curve decay to 0 at the end."""
    e = np.ones(n)
    a = max(1, int(attack * SR))
    e[:a] = np.linspace(0, 1, a)
    e[a:] = np.linspace(1, 0, n - a) ** decay_shape
    return e


def env(t: np.ndarray, attack: float, decay: float) -> np.ndarray:
    """Linear attack, then exponential decay."""
    return np.clip(t / attack, 0, 1) * np.exp(-np.clip(t - attack, 0, None) / decay)


def fade(x: np.ndarray, fin: float = 0.004, fout: float = 0.01) -> np.ndarray:
    x = x.copy()
    a, b = int(fin * SR), int(fout * SR)
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)
    return x


def echo(x: np.ndarray, taps=((0.045, 0.35), (0.09, 0.2), (0.15, 0.1))) -> np.ndarray:
    """A few short delay taps: cheap 'space' without a reverb engine."""
    y = x.copy()
    for delay, gain in taps:
        k = int(delay * SR)
        y[k:] += gain * x[:-k]
    return y


def place(dst: np.ndarray, src: np.ndarray, at: float) -> None:
    """Mix src into dst starting at `at` seconds (clipped to dst's length)."""
    k = int(at * SR)
    end = min(len(dst), k + len(src))
    dst[k:end] += src[: end - k]


def norm(x: np.ndarray, peak_db: float) -> np.ndarray:
    return x / (np.max(np.abs(x)) + 1e-12) * 10 ** (peak_db / 20)


def level_rms(x: np.ndarray, rms50_db: float, peak_max_db: float) -> np.ndarray:
    """Set the loudest 50 ms RMS to `rms50_db`, then cap the peak at `peak_max_db`.

    For sets of variations: matching short-term loudness keeps them equally loud, where
    normalizing each to the same peak would not (short transients vary a lot in crest factor).
    """
    w = int(0.05 * SR)
    r = np.sqrt(np.convolve(x**2, np.ones(w) / w, "valid")).max()
    y = x * 10 ** (rms50_db / 20) / r
    return y if np.abs(y).max() <= 10 ** (peak_max_db / 20) else norm(y, peak_max_db)


def loopify(x: np.ndarray, xfade: float = 0.15) -> np.ndarray:
    """Equal-power crossfade of the last `xfade` s into the head, so the result loops cleanly."""
    n = int(xfade * SR)
    ramp = np.linspace(0, np.pi / 2, n)
    out = x[:-n].copy()
    out[:n] = x[:n] * np.sin(ramp) + x[-n:] * np.cos(ramp)
    return out


# --- voices -----------------------------------------------------------------------------------


def bell(f: float, dur: float, decay: float) -> np.ndarray:
    """A soft pure bell tone: one sine with a 4 ms attack and an exponential decay."""
    t = t_axis(dur)
    return np.sin(phase(np.full_like(t, f))) * np.exp(-t / decay) * np.clip(t / 0.004, 0, 1)


def mallet(f: float, dur: float, decay: float) -> np.ndarray:
    """Warm mallet (marimba-like): fundamental, a quiet 2nd and a quick 4th harmonic."""
    t = t_axis(dur)
    x = np.sin(phase(np.full_like(t, f))) * np.exp(-t / decay)
    x += 0.35 * np.sin(phase(np.full_like(t, f * 4))) * np.exp(-t / (decay * 0.3))
    x += 0.15 * np.sin(phase(np.full_like(t, f * 2.01))) * np.exp(-t / (decay * 0.6))
    return x * np.clip(t / 0.006, 0, 1)


def hiss(dur: float, lo: float, hi: float, seed: int, decay: float) -> np.ndarray:
    """A burst of band-limited air (lo..hi Hz) with a fast attack and exponential decay."""
    t = t_axis(dur)
    x = lp2(highpass(noise(len(t), seed), lo), hi)
    return x * (1 - np.exp(-t / 0.01)) * np.exp(-t / decay)


# --- output -----------------------------------------------------------------------------------


def write_ogg(x: np.ndarray, path: Path) -> None:
    """Mono Ogg Vorbis at quality 5, no metadata."""
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ac", "1", "-ar", str(SR)]
    cmd += ["-i", "-", "-c:a", "libvorbis", "-q:a", "5", "-map_metadata", "-1", str(path)]
    subprocess.run(cmd, input=pcm, check=True)


def decoded_pcm_sha256(path: Path) -> str:
    """SHA-256 of a file's decoded 16-bit PCM: equal for two encodes of the same audio."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-"]
    pcm = subprocess.run(cmd, capture_output=True, check=True).stdout
    return hashlib.sha256(pcm).hexdigest()


# --- runner-up options (#3673) ----------------------------------------------------------------

SHIPPED_SOUNDS_DIR = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "sounds"

# One sound's options: a label ("A", "B", ...) to (recipe, level). Option A is the pick that
# ships, so it points at the same recipe `SOUNDS` uses. The others are never shipped.
OptionTable = dict[str, dict[str, tuple[Callable[[], np.ndarray], object]]]


def options_scratch_dir(requested: str | None = None) -> Path:
    """Where `--options` writes: a scratch folder, never the shipped sounds."""
    out = Path(requested) if requested else Path(tempfile.gettempdir()) / "bc-arcade-sound-options"
    resolved = out.resolve()
    if resolved == SHIPPED_SOUNDS_DIR or SHIPPED_SOUNDS_DIR in resolved.parents:
        raise SystemExit(f"--options never writes to {SHIPPED_SOUNDS_DIR}; pick a scratch folder")
    return out


def write_options(
    table: OptionTable,
    sound: str,
    out_dir: Path,
    finish: Callable[[Callable[[], np.ndarray], object], np.ndarray],
) -> list[Path]:
    """Render every option of `sound` to `out_dir/<sound>-<label>.ogg`; returns the paths."""
    if sound not in table:
        known = ", ".join(sorted(table)) or "none saved yet"
        raise SystemExit(f"no runner-up options for {sound!r}; known: {known}")
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for label, (recipe, level) in table[sound].items():
        path = out_dir / f"{sound}-{label}.ogg"
        write_ogg(finish(recipe, level), path)
        paths.append(path)
    return paths


def options_cli(
    args: list[str],
    table: OptionTable,
    finish: Callable[[Callable[[], np.ndarray], object], np.ndarray],
) -> bool:
    """Handle `--options <sound> [out_dir]`; returns False when `args` is not that flag."""
    if args[:1] != ["--options"]:
        return False
    if len(args) < 2:
        raise SystemExit(f"usage: --options <sound> [scratch_dir]; known: {', '.join(table)}")
    for path in write_options(
        table, args[1], options_scratch_dir(args[2] if len(args) > 2 else None), finish
    ):
        print(path)
    return True

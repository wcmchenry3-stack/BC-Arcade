"""Synthesize the Star Swarm Carrier beam sounds (no samples, no third-party audio).

Writes two files into frontend/assets/sounds/:

- starswarm-beamcharge.ogg  0.60 s "reactor" charge-up: a low buzz that brightens and
  climbs ~0.6 octave while a pulse speeds up 3 -> 12 Hz. It must end exactly as the beam
  fires, so its length is tied to BEAM_CHARGE_MS (600) in engine/tuning.ts.
- starswarm-beamfire.ogg    0.90 s plasma blast: a detuned saw chord diving together,
  ring-modulated, with a sub thump and a short echo. The dive takes ~0.5 s (the bolt
  crosses the lane in ~0.4 s); the rest is ring-out, which does not affect gameplay.

Both are generated from oscillators and noise with a fixed seed, so a run is reproducible.
Owner picked this recipe ("c2", calmer 0.6 s charge) on 2026-11-07 after a gameplay audition.

Run from the repo root (needs numpy and ffmpeg with libvorbis):
    python tools/assets/synth_starswarm_beam.py [out_dir]
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 44100
OUT_DEFAULT = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "sounds"


def t_axis(dur: float) -> np.ndarray:
    return np.arange(int(dur * SR)) / SR


def phase(freq: np.ndarray) -> np.ndarray:
    """Integrate an instantaneous-frequency array (Hz) into phase (radians)."""
    return 2 * np.pi * np.cumsum(freq) / SR


def saw(ph: np.ndarray) -> np.ndarray:
    return 2 * ((ph / (2 * np.pi)) % 1.0) - 1


def square(ph: np.ndarray, duty: float = 0.5) -> np.ndarray:
    return np.where((ph / (2 * np.pi)) % 1.0 < duty, 1.0, -1.0)


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


def env_ad(n: int, attack: float, decay_shape: float) -> np.ndarray:
    """Linear attack (seconds), then a power-curve decay to 0 at the end."""
    e = np.ones(n)
    a = max(1, int(attack * SR))
    e[:a] = np.linspace(0, 1, a)
    e[a:] = np.linspace(1, 0, n - a) ** decay_shape
    return e


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


def norm(x: np.ndarray, peak_db: float) -> np.ndarray:
    return x / (np.max(np.abs(x)) + 1e-12) * 10 ** (peak_db / 20)


def beam_charge(
    dur: float = 0.60, pulse_from: float = 3.0, pulse_to: float = 12.0, octaves: float = 0.6
) -> np.ndarray:
    """Reactor charge-up: low buzz that brightens and climbs, pulse train speeding up."""
    t = t_axis(dur)
    p = t / t[-1]
    f = 55 * 2 ** (octaves * p**1.2)
    buzz = square(phase(f), 0.3) + 0.6 * saw(phase(f * 1.005))
    buzz = lowpass(buzz, 200 + 3800 * p**2.2)
    sub = np.sin(phase(f / 2))
    rate = pulse_from + (pulse_to - pulse_from) * p**1.5
    pulse = lowpass(0.5 + 0.5 * np.sign(np.sin(phase(rate))), 120)  # softened gate
    x = (0.7 * buzz + 0.5 * sub) * (0.45 + 0.55 * pulse)
    x *= 0.3 + 0.7 * p
    return fade(x)


def beam_fire(dur: float = 0.90) -> np.ndarray:
    """Plasma blast. The dive keeps its 0.5 s speed; a longer dur only lets it ring out."""
    t = t_axis(dur)
    p = t / 0.50
    base = 110 + 700 * np.exp(-p * 4.5)
    chord = sum(saw(phase(base * r)) for r in (1.0, 1.007, 1.498, 2.003))
    ring = np.sin(phase(np.full_like(t, 63)))
    x = chord * (0.6 + 0.4 * ring)
    x = lowpass(x, 6000 * np.exp(-p * 2.5) + 400)
    sub = np.sin(phase(55 + 60 * np.exp(-t / 0.04))) * np.exp(-t / 0.2)
    x = (0.5 * x + 0.8 * sub) * env_ad(len(t), 0.003, 1.8)
    return fade(echo(x), 0.0, 0.03)


def write_ogg(x: np.ndarray, path: Path) -> None:
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ac", "1", "-ar", str(SR)]
    cmd += ["-i", "-", "-c:a", "libvorbis", "-q:a", "5", "-map_metadata", "-1", str(path)]
    subprocess.run(cmd, input=pcm, check=True)


def main(out_dir: Path) -> None:
    write_ogg(norm(beam_charge(), -1.5), out_dir / "starswarm-beamcharge.ogg")
    write_ogg(norm(beam_fire(), -1.0), out_dir / "starswarm-beamfire.ogg")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else OUT_DEFAULT)

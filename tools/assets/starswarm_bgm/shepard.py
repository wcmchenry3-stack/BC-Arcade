"""The descending Shepard tone (approved in Round 40, placed in Round 46).

Ten octave-spaced sine partials all gliding down at `rate` octaves per second under a fixed
bell-shaped loudness window (centred on 410 Hz, 0.9 octave wide), so the pitch seems to fall
forever. The two channels are detuned by 0.045% for width. 1.6 s fades at each end.

Copied from `shepard()` in `starswarm_round46_full_orchestration.py`, arithmetic unchanged.
Returns float64 (layer (2, n), envelope (n,)); the arrangement scales the layer by `amp` and ducks
the music under the envelope.
"""

from __future__ import annotations

import numpy as np

from .common import SR, ease


def render(duration: float, rate: float = 0.15, base: float = 245.0, n: int | None = None):
    n = round(duration * SR) if n is None else n
    t = np.arange(n, dtype=np.float64) / SR
    layer = np.zeros((2, n), np.float64)
    for octv in range(-3, 7):
        freq = base * np.exp2(octv - rate * t)
        weight = np.exp(-0.5 * (np.log2(np.maximum(freq, 1.0) / 410.0) / 0.9) ** 2)
        for ch in (0, 1):
            ph = np.cumsum(freq * (1 + 0.00045 * ch)) * (2 * np.pi / SR) + octv * 0.93 + ch * 0.48
            layer[ch] += weight * np.sin(ph)
    env = ease(t / 1.6) * ease((duration - t) / 1.6)
    return layer, env

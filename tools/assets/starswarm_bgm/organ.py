"""The distant organ colour (Round 19 "haunting", owner-approved).

Four overlapping held notes (D3, A#3, D#4, A#4) whose harmonic weights drift, so it reads as a
far-off organ without an exposed pipe stop; long diffuse reflections and a band of faint air.
Renders a 46 s phrase, float32 (2, n).

Copied from `starswarm_round19_remaining_colors.py` `haunting()`. Round 19 mixed it over an
excerpt of the Round 17 track; Round 46 replaced that bed with silence, so the bed is gone here.
Arithmetic unchanged (the shipped track is bit-exact to it). Round 19's other two ideas
(`astronomical()`, `lurking()`) were not used in the final track and are not carried over.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfilt

from .common import SR

DUR = 46
N = SR * DUR


def sm(z):
    z = np.clip(z, 0, 1)
    return z * z * (3 - 2 * z)


def ambience(seed, low, high, n):
    g = np.random.default_rng(seed)
    y = g.normal(0, 1, n).astype(np.float32)
    lo = max(10, low)
    hi = min(high, SR * 0.46)
    return sosfilt(butter(2, [lo, hi], fs=SR, btype="bandpass", output="sos"), y).astype(np.float32)


def reflect(x, delays):
    for ch in range(2):
        dry = x[ch].copy()
        for sec, g in delays:
            k = int(SR * (sec + (0.12 if ch else 0)))
            x[ch, k:] += dry[:-k] * g
    return x


def render() -> np.ndarray:
    T = np.arange(N, dtype=np.float32) / SR
    layer = np.zeros((2, N), dtype=np.float32)
    events = [(5, 27, 51, 0.013), (11, 38, 58, 0.012), (16, 41, 63, 0.009), (25, 45, 70, 0.006)]
    for k, (start, stop, midi, gain) in enumerate(events):
        i = int(start * SR)
        j = min(N, int(stop * SR))
        tt = T[i:j] - start
        f0 = 440 * 2 ** ((midi - 69) / 12)
        env = sm(tt / 4) * sm((stop - start - tt) / 4)
        drift = (
            1
            + 0.0014 * np.sin(2 * np.pi * 0.12 * tt + k)
            + 0.0010 * np.sin(2 * np.pi * 0.23 * tt + 0.3 * k)
        )
        phase = np.cumsum(f0 * drift, dtype=np.float64) * 2 * np.pi / SR + k * 0.9
        sig = np.zeros(j - i, dtype=np.float32)
        # Conceal a conventional organ signature by varying harmonic ratios and air.
        for h, weight in [(1, 0.52), (2, 0.16), (3, 0.31), (4, 0.08), (5, 0.12), (7, 0.07)]:
            amp = weight * (0.83 + 0.17 * np.sin(0.29 * tt + h + k))
            sig += (amp * np.sin(h * phase + 0.2 * h * h)).astype(np.float32)
        p = 0.45 + 0.25 * np.sin(0.077 * tt + k)
        sig *= env * gain
        layer[0, i:j] += sig * np.sqrt(2 * (1 - p))
        layer[1, i:j] += sig * np.sqrt(2 * p)
    # Diffuse distant returns instead of a recognizably dry foreground organ.
    reflect(layer, [(0.41, 0.42), (1.14, 0.29), (2.5, 0.24), (3.6, 0.10)])
    air = ambience(1915, 1000, 3200, N)
    air *= 0.00045 * (sm((T - 9) / 7) * sm((44 - T) / 6))
    layer[0] += air
    layer[1] += np.roll(air, int(0.12 * SR))
    return layer

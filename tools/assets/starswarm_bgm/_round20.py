"""Helpers shared by the astronomical rise and the robotic signals (both from Round 20).

Copied from `starswarm_round20_spotlight_signals.py`, arithmetic unchanged. Both layers render a
48 s phrase, float32 (2, n).
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfilt

from .common import SR

DUR = 48
N = SR * DUR


def time_axis():
    return np.arange(N, dtype=np.float32) / SR


def sm(x):
    z = np.clip(x, 0.0, 1.0)
    return z * z * (3 - 2 * z)


def bp_noise(seed, lo, hi, n):
    gen = np.random.default_rng(seed)
    noise = gen.normal(0, 1, n).astype(np.float32)
    return sosfilt(butter(2, [lo, hi], fs=SR, btype="bandpass", output="sos"), noise).astype(
        np.float32
    )


def add_pan(dest, sig, i, p):
    j = min(i + len(sig), N)
    sig = sig[: j - i]
    if np.isscalar(p):
        dest[0, i:j] += sig * np.sqrt(2 * (1 - p))
        dest[1, i:j] += sig * np.sqrt(2 * p)
    else:
        p = p[: j - i]
        dest[0, i:j] += sig * np.sqrt(2 * (1 - p))
        dest[1, i:j] += sig * np.sqrt(2 * p)


def echo(layer):
    for c in range(2):
        dry = layer[c].copy()
        for sec, g in [(0.21, 0.20), (0.63, 0.15), (1.4, 0.11), (2.3, 0.07)]:
            lag = int(SR * (sec + (0.08 if c else 0)))
            layer[c, lag:] += dry[:-lag] * g
    return layer

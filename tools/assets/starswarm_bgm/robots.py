"""The robotic signals (Round 20 `signals()`, owner-approved).

Six short machine "calls", each an inharmonic partial stack (ratios 1, 1.73, 2.46, 3.91) on its own
pitch contour (searching, stepped, rising or sinking), with tremolo, moving pan and, on three of
them, a band of digital noise opposite; a four-tap echo. Renders a 48 s phrase, float32 (2, n).

Copied from `starswarm_round20_spotlight_signals.py` `signals()`. Round 20 ducked an excerpt of the
Round 17 track under it; Rounds 45 and 46 replaced that bed with silence, so the bed is gone here.
Arithmetic unchanged (the shipped track is bit-exact to it).
"""

from __future__ import annotations

import numpy as np

from ._round20 import N, add_pan, bp_noise, echo, sm, time_axis
from .common import SR

# start s, duration s, f0 Hz, brightness, contour kind (0-3), amplitude, pan
EVENTS = [
    (8.8, 3.1, 148.0, 0.25, 0, 0.035, 0.22),
    (13.7, 4.4, 110.0, 0.55, 1, 0.045, 0.79),
    (19.2, 3.8, 176.0, 0.85, 2, 0.050, 0.30),
    (24.0, 5.2, 95.0, 0.75, 3, 0.069, 0.66),
    (30.3, 3.5, 213.0, 0.90, 2, 0.061, 0.82),
    (34.5, 5.3, 132.0, 0.42, 1, 0.060, 0.37),
]


def render() -> np.ndarray:
    T = time_axis()
    layer = np.zeros((2, N), dtype=np.float32)
    for k, (start, dur, f0, bright, kind, amp, pan) in enumerate(EVENTS):
        i = int(start * SR)
        j = min(N, int((start + dur) * SR))
        tt = T[i:j] - start
        p = tt / dur
        # Pitch searches, stepped metallic phrases, modulated alien vocal tones.
        if kind == 0:
            f = f0 * (1 - 0.13 * p + 0.028 * np.sin(2 * np.pi * 2.2 * tt))
        elif kind == 1:
            f = (
                f0
                * (1 + 0.11 * sm((tt - 0.5) / 1.5) - 0.18 * sm((tt - 2.0) / 1.5))
                * (1 + 0.016 * np.sin(2 * np.pi * 4.3 * tt))
            )
        elif kind == 2:
            f = (
                f0
                * (1 + 0.17 * sm((tt - 0.4) / 1.0))
                * (1 + 0.04 * np.sin(2 * np.pi * (0.7 + 1.4 * p) * tt))
            )
        else:
            f = f0 * (1 - 0.08 * p) * (1 + 0.018 * np.sin(2 * np.pi * 6.0 * tt))
        phase = np.cumsum(f, dtype=np.float64) * 2 * np.pi / SR
        env = sm(tt / 0.18) * sm((dur - tt) / 0.7)
        # Inharmonic, formant-like synthetic energy, distinct from a pure sine or a choir.
        sig = (
            0.50 * np.sin(phase)
            + (0.22 + 0.23 * bright) * np.sin(1.73 * phase + 0.4)
            + (0.15 + 0.22 * bright) * np.sin(2.46 * phase + 0.7)
            + 0.20 * bright * np.sin(3.91 * phase + 0.2)
        )
        trem = 0.84 + 0.16 * np.sin(2 * np.pi * (3.0 + 0.7 * kind) * tt + k * 0.5)
        sig = (sig * env * trem * amp).astype(np.float32)
        moving = pan + 0.09 * np.sin(2 * np.pi * 0.22 * tt + k)
        add_pan(layer, sig, i, np.clip(moving, 0.07, 0.93))
        if k in [2, 3, 4]:
            digital = bp_noise(2060 + k, 1500, 4300, j - i)
            digital *= 0.005 * env * (0.4 + 0.6 * np.sin(2 * np.pi * (4.0 + k) * tt) ** 2)
            add_pan(layer, digital.astype(np.float32), i, 1 - pan)
    echo(layer)
    return layer

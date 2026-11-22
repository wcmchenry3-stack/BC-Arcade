"""The astronomical rise (Round 20 `rise()`, owner-approved).

Two overlapping upward lines (from 120 Hz over 1.15 octaves, and from 182 Hz over 0.85 octaves),
six soft harmonics each with drifting pan, plus three short bright airy trails; a four-tap echo.
Renders a 48 s phrase, float32 (2, n).

Copied from `starswarm_round20_spotlight_signals.py` `rise()`. Round 20 dipped an excerpt of the
Round 17 track under it ("spotlight"); Rounds 45 and 46 replaced that bed with silence, so the bed
is gone here. Arithmetic unchanged (the shipped track is bit-exact to it).
"""

from __future__ import annotations

import numpy as np

from ._round20 import N, add_pan, bp_noise, echo, sm, time_axis
from .common import SR


def render() -> np.ndarray:
    T = time_axis()
    layer = np.zeros((2, N), dtype=np.float32)
    # (start s, duration s, start Hz, amplitude, octaves climbed)
    for k, (start, dur, freq, amp, octaves) in enumerate(
        [(9.0, 16.5, 120.0, 0.058, 1.15), (14.5, 13.0, 182.0, 0.035, 0.85)]
    ):
        i = int(start * SR)
        j = min(N, int((start + dur) * SR))
        tt = T[i:j] - start
        progress = tt / dur
        f = (
            freq
            * np.exp2(octaves * sm(progress))
            * (1 + 0.0017 * np.sin(2 * np.pi * 0.23 * tt + 0.4 * k))
        )
        phase = np.cumsum(f, dtype=np.float64) * (2 * np.pi / SR)
        env = sm(tt / 2.3) * sm((dur - tt) / 3.5)
        for h in [1, 2, 3, 4, 5, 6]:
            spectral = (1 / h**1.25) * (
                1 + 0.08 * np.sin(2 * np.pi * (0.16 + 0.015 * h) * tt + 0.8 * h)
            )
            sig = (np.sin(phase * h + 0.6 * h) * env * spectral * amp).astype(np.float32)
            pan = 0.5 + 0.32 * np.sin(0.23 * tt + 1.3 * k + 0.4 * h)
            add_pan(layer, sig, i, pan)
    # Sparse bright trails as short, independently positioned spatial events.
    for k, (start, dur) in enumerate([(18.4, 0.7), (23.0, 1.0), (27.2, 0.55)]):
        i = int(start * SR)
        j = min(N, int((start + dur) * SR))
        tt = T[i:j] - start
        airy = bp_noise(2010 + k, 1000, 4300, j - i)
        freq = 1900 * np.exp2(-0.45 * tt / dur)
        ph = np.cumsum(freq) * 2 * np.pi / SR
        sig = (0.005 * airy + 0.002 * np.sin(ph)) * sm(tt / 0.08) * np.exp(-4 * tt / dur)
        add_pan(layer, sig.astype(np.float32), i, [0.13, 0.82, 0.42][k])
    echo(layer)
    return layer

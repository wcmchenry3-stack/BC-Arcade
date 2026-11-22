"""The ambient foundation under the whole track (Round 44, owner-approved).

Seven 63 s harmonic regions (pad clouds, a pedal drone, sparse held lead notes, filtered air and a
synthetic room) joined by 3.5 s equal-power overlaps: 420 s in all. No samples and no audio input.

Copied from `starswarm_round44_ambient_longform.py` with the arithmetic unchanged: the shipped
track is bit-exact to this code, so a "tidy-up" that reorders a float operation changes the sound.
The one random generator is shared by every region in order (grain, then the room noise of each
channel), so regions cannot be rendered out of order or on their own.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

from .common import SR

SEG = 63.0
OVER = 3.5
COUNT = 7
DUR = SEG * COUNT - OVER * (COUNT - 1)  # 420 s
L = int(SEG * SR)
O = int(OVER * SR)
SEED = 440042
PEAK = 0.352  # the bed is normalized to this peak before the signatures are mixed in


def hz(n):
    return 440.0 * 2.0 ** ((n - 69) / 12)


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def fade(t, start, end, atk=4.0, rel=5.0):
    return smooth((t - start) / atk) * smooth((end - t) / rel) * ((t >= start) & (t <= end))


def hp(x, cutoff):
    return sosfilt(butter(2, cutoff, fs=SR, output="sos", btype="highpass"), x, axis=0)


# Seven RELATED, DIFFERENT harmonic/melodic passages. Open pedal/fifths, minor/add9/sus/shimmer; no
# cadential hymn progressions, no pulse or drums. Values are MIDI notes; `lead` is
# (start s, end s, note) within the 63 s region.
REGIONS = [
    {"name": "Persistent horizon", "ped": 28, "pads": [[40, 47, 57, 62], [40, 47, 59, 64], [40, 47, 57, 66], [40, 47, 59, 62]], "lead": [(9, 15, 71), (29, 36, 74), (50, 56, 73)], "energy": 0.94},
    {"name": "Spectral expansion", "ped": 28, "pads": [[40, 47, 59, 66], [40, 47, 61, 64], [40, 47, 57, 62], [40, 47, 61, 69]], "lead": [(5, 11, 76), (35, 42, 73), (51, 58, 74)], "energy": 0.98},
    {"name": "Dark current", "ped": 26, "pads": [[38, 45, 55, 62], [38, 45, 57, 64], [38, 45, 55, 60], [38, 45, 57, 65]], "lead": [(16, 23, 69), (43, 50, 72)], "energy": 0.85},
    {"name": "Undercurrent", "ped": 31, "pads": [[43, 50, 57, 64], [43, 50, 59, 66], [43, 50, 61, 69], [43, 50, 57, 66]], "lead": [(7, 13, 74), (30, 37, 78), (48, 54, 76)], "energy": 1.03},
    {"name": "New pressure", "ped": 29, "pads": [[41, 48, 58, 65], [41, 48, 60, 67], [41, 48, 58, 63], [41, 48, 60, 70]], "lead": [(13, 20, 75), (39, 46, 79)], "energy": 1.05},
    {"name": "Distant resolve", "ped": 26, "pads": [[38, 45, 57, 64], [38, 45, 59, 66], [38, 45, 55, 62], [38, 45, 57, 60]], "lead": [(8, 14, 72), (34, 41, 74)], "energy": 0.86},
    {"name": "Return without cadence", "ped": 28, "pads": [[40, 47, 59, 64], [40, 47, 57, 62], [40, 47, 59, 66], [40, 47, 57, 62]], "lead": [(15, 21, 74), (37, 44, 76), (52, 58, 71)], "energy": 1.01},
]  # fmt: skip


def render_region(i, region, rng):
    """One 63 s region, float32 (L, 2)."""
    t = np.arange(L, dtype=np.float64) / SR
    stereo = np.zeros((L, 2), np.float32)
    # Four overlapping drifting pad clouds with a minimum of three notes per layer.
    bounds = [(0, 21), (15, 37), (31, 54), (47, 63.5)]
    for k, ((a, b), notes) in enumerate(zip(bounds, region["pads"], strict=False)):
        lo = max(0, int((a - 3) * SR))
        hi = min(L, int((b + 3) * SR))
        tt = t[lo:hi]
        env = fade(tt, a - 3, b + 3, 6.0, 7.0)
        for j, m in enumerate(notes):
            freq = hz(m)
            phase = (
                2
                * np.pi
                * freq
                * (tt + 0.0032 * np.sin(2 * np.pi * (0.022 + 0.003 * j) * tt + i * 0.61))
            )
            phase2 = 2 * np.pi * freq * (1.003 + (0.00025 * i % 3)) * tt + 0.7 * k + 1.07 * j
            src = (
                0.55 * np.sin(phase)
                + 0.30 * np.sin(phase2)
                + (0.052 + 0.043 * np.sin(0.11 * tt + 0.7 * j + i * 0.2)) * np.sin(2 * phase + 0.9)
                + 0.014 * np.sin(3 * phase2)
            )
            evolving = 0.77 + 0.23 * np.sin(
                2 * np.pi * (0.035 + 0.004 * j) * tt + k * 0.98 + i * 0.47 + j * 0.75
            )
            # Pedal / fifth components kept stronger than high choral overtones.
            amount = (0.87 if j < 2 else 0.44) * (1.0 + 0.055 * np.sin(0.4 * i + k))
            pan = np.clip(
                0.5 + 0.25 * np.sin(2 * np.pi * 0.0096 * tt + j * 2.2 + k * 0.88 + i * 0.3),
                0.16,
                0.84,
            )
            signal = src * env * evolving * amount
            stereo[lo:hi, 0] += (signal * (1 - pan)).astype(np.float32)
            stereo[lo:hi, 1] += (signal * pan).astype(np.float32)
    stereo = hp(stereo, 108)
    # Continuous, non-marching bass field: breathing rather than accented pulses.
    ped = region["ped"]
    drone = np.sin(
        2 * np.pi * hz(ped) * t + 0.7 * np.sin(2 * np.pi * 0.033 * t + i * 0.4)
    ) + 0.20 * np.sin(2 * np.pi * hz(ped + 12) * t + 0.24 * np.sin(2 * np.pi * 0.097 * t))
    drone = (
        0.079 * (0.80 + 0.20 * np.sin(2 * np.pi * (0.058 + 0.002 * i) * t + 0.65 * i)) * drone
    ).astype(np.float32)
    # Genuinely sparse foreground: 2-3 individual held notes per 63 s region.
    lead = np.zeros(L, np.float32)
    for j, (a, b, n) in enumerate(region["lead"]):
        lo = int(a * SR)
        hi = min(int(b * SR), L)
        tt = t[lo:hi]
        dt = tt - a
        depth = 0.0031 * smooth((dt - 0.75) / 2.25)
        vib = depth / (2 * np.pi * 4.9) * np.sin(2 * np.pi * 4.9 * dt + 0.45 * j + i * 0.2)
        phase = 2 * np.pi * hz(n) * (dt + vib)
        shape = (0.76 + 0.24 * np.sin(np.pi * np.clip(dt / (b - a), 0, 1))) * fade(
            tt, a, b, 1.5, 1.9
        )
        bright = 0.025 + 0.015 * np.sin(0.7 * dt + i * 0.37)
        timbre = (
            0.79 * np.sin(phase)
            + 0.14 * np.sin(2 * phase + 0.25)
            + bright * np.sin(3 * phase + 0.8)
        )
        lead[lo:hi] += (0.100 * shape * timbre).astype(np.float32)
    # Filtered airy grain: evolving, no foreground spaceship signatures.
    grain = rng.standard_normal((L, 2)).astype(np.float32)
    grain = hp(grain, 800)
    grain = sosfilt(butter(2, 3200, fs=SR, output="sos"), grain, axis=0)
    grain *= ((0.43 + 0.57 * np.sin(2 * np.pi * 0.025 * t + 0.4 * i) ** 2) * 0.007)[:, None].astype(
        np.float32
    )
    dry = (stereo + 0.49 * lead[:, None] + 0.77 * drone[:, None] + grain).astype(np.float32)
    # Room response rendered per region; the 3.5 s overlap keeps the atmosphere continuous.
    wet = np.zeros_like(dry)
    for ch in (0, 1):
        length = int(4.0 * SR)
        impulse = np.zeros(length, np.float32)
        for off, g in ((0.10, 0.15), (0.17, 0.11), (0.29, 0.09), (0.45, 0.07), (0.62, 0.045)):
            impulse[int((off + 0.013 * ch) * SR)] += g
        noise = rng.standard_normal(length).astype(np.float32)
        noise = sosfilt(butter(1, 3100, fs=SR, output="sos"), noise)
        z = np.arange(length) / SR
        impulse += 0.00255 * (noise * np.exp(-z / 1.42) * smooth((z - 0.05) / 0.15)).astype(
            np.float32
        )
        wet[:, ch] = fftconvolve(dry[:, 1 - ch], impulse, mode="full")[:L]
    mix = hp(0.82 * dry + 0.73 * hp(wet, 160), 37)
    mix *= region["energy"]
    return mix.astype(np.float32)


def render(log=print) -> np.ndarray:
    """The 420 s bed, float32 (n, 2), with the 1.1 s fade-in and 1.6 s fade-out baked in.

    The loop edit trims those fades off again; they are kept because the approved render has them.
    """
    rng = np.random.default_rng(SEED)
    final = np.zeros((int(DUR * SR), 2), np.float32)
    # Blend regions with equal-power overlap; never hard-reset the atmosphere.
    for i, region in enumerate(REGIONS):
        s = render_region(i, region, rng)
        start = i * (L - O)
        if i > 0:
            u = np.linspace(0, np.pi / 2, O, endpoint=False)
            final[start : start + O] = (
                final[start : start + O] * np.cos(u)[:, None] + s[:O] * np.sin(u)[:, None]
            ).astype(np.float32)
            final[start + O : start + L] = s[O:]
        else:
            final[:L] = s
        log(f"bed: region {i + 1}/7 {region['name']}")
    fade_in = int(1.1 * SR)
    fade_out = int(1.6 * SR)
    final[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
    final[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]
    peak = float(np.max(np.abs(final)))
    final *= PEAK / max(peak, 1e-8)
    return final

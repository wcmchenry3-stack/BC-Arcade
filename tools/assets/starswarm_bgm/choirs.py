"""The two choirs (Round 18, owner-approved): the Gathering Swarm Chorus and the Electromagnetic Choir.

Twenty synthetic voices, each a band-limited harmonic bank weighted by three vowel formants, with
per-voice detune, vibrato, staggered entrances and three wide reflections. No vocal samples.
- `gathering`: fixed formants (740 / 1190 / 2320 Hz), steady tone; the swarm "voice".
- `electromagnetic`: moving formants and a 4-5 Hz tremolo; the alien choir.

Each call renders a 44 s phrase, float32 (2, n). The arrangement takes a window out of it.

Copied from `starswarm_round18_foreground_chorus.py` `build()`. Round 18 mixed the choir over an
excerpt of the Round 17 track; Rounds 45 and 46 replaced that bed with silence, so only the choir
was ever used and the bed is gone here. Arithmetic unchanged (the shipped track is bit-exact to it).
"""

from __future__ import annotations

import numpy as np

from .common import SR

DUR = 44
N = SR * DUR
KINDS = ("gathering", "electromagnetic")
_SEEDS = {"gathering": 1842, "electromagnetic": 1877}

# (start s, MIDI voicing): shifting suspended sonorities.
PROGRESSION = [
    (0, [50, 57, 62, 65]),
    (12, [50, 58, 63, 67]),
    (23, [48, 55, 62, 68]),
    (34, [50, 57, 63, 69]),
]


def soft(x):
    z = np.clip(x, 0, 1)
    return z * z * (3 - 2 * z)


def gaussian(f, mu, width):
    return np.exp(-0.5 * ((f - mu) / width) ** 2)


def render(kind: str) -> np.ndarray:
    if kind not in _SEEDS:
        raise ValueError(f"unknown choir {kind!r}; expected one of {KINDS}")
    t = np.arange(N, dtype=np.float32) / SR
    rng = np.random.default_rng(_SEEDS[kind])
    chorus = np.zeros((2, N), dtype=np.float32)
    # Entrance ~0:07, full chorus ~0:17-0:33, then withdraw.
    envelope = soft((t - 5) / 12) * soft((42 - t) / 8)
    nvoices = 20
    for j in range(nvoices):
        v = j % 5
        section = (j // 5) % 4
        note = PROGRESSION[section][1][v % 4] + (12 if j >= 12 else 0)
        f0 = 440 * 2 ** ((note - 69) / 12)
        detune = rng.normal(0, 4.3)  # cents
        ff = f0 * 2 ** (detune / 1200)
        # Slow, natural oscillator instability + compact synthetic chorus diffusion.
        phase_j = rng.uniform(0, 2 * np.pi)
        vi = 0.0017 * np.sin(2 * np.pi * (4.0 + 0.13 * v) * t + phase_j) + 0.0005 * np.sin(
            2 * np.pi * 0.21 * t + phase_j
        )
        if kind == "electromagnetic":
            vi += 0.0022 * np.sin(2 * np.pi * (5.2 + 0.1 * section) * t + 0.3 * v)
        freq = ff * (1 + vi)
        phase = np.cumsum(freq, dtype=np.float64) * (2 * np.pi / SR) + phase_j
        # Shared choral envelope; per-voice arrival not equal.
        time_j = t - (3.7 + 0.36 * j)
        arrival = soft(time_j / (6.5 + 0.2 * v)) * soft((42.5 - t) / (6.5 + 0.2 * v))
        move = 0.83 + 0.15 * np.sin(0.23 * t + 1.1 * j)
        if kind == "electromagnetic":
            # Time-varying formants and modulation produce an alien-choir sensation.
            f1 = 700 + 140 * np.sin(0.19 * t + 0.2 * j)
            f2 = 1250 + 220 * np.sin(0.13 * t + section)
            f3 = 2250 + 290 * np.sin(0.18 * t + phase_j)
            trem = (
                0.74
                + 0.19 * np.sin(2 * np.pi * (4.3 + 0.08 * section) * t + phase_j)
                + 0.07 * np.sin(2 * np.pi * 8.4 * t + j)
            )
        else:
            f1 = np.full(N, 740, dtype=np.float32)
            f2 = np.full(N, 1190, dtype=np.float32)
            f3 = np.full(N, 2320, dtype=np.float32)
            trem = 0.94 + 0.05 * np.sin(2 * np.pi * 0.31 * t + j)
        signal = np.zeros(N, dtype=np.float32)
        # Band-limited harmonic bank, explicit vowel formants, no vocal samples.
        for h in range(1, 17):
            hz = h * ff
            if hz > 6500:
                break
            amp = (
                0.42 * gaussian(hz, f1, 240)
                + 0.5 * gaussian(hz, f2, 360)
                + 0.55 * gaussian(hz, f3, 480)
                + 0.18
            ) * h ** (-1.08)
            signal += (amp * np.sin(phase * h + 0.06 * j * h)).astype(np.float32)
        p = 0.5 + 0.30 * np.sin(0.035 * t + 1.45 * j)
        strength = 0.018 if kind == "gathering" else 0.017
        sig = signal * arrival * move * trem * strength
        chorus[0] += (sig * np.sqrt(2 * (1 - p))).astype(np.float32)
        chorus[1] += (sig * np.sqrt(2 * p)).astype(np.float32)
    # Harmonically coherent collective swelling.
    rise = np.interp(
        t, [0, 6, 12, 17, 22, 27, 31, 35, 38, 44], [0, 0, 0.5, 1, 1.06, 0.88, 1.09, 0.8, 0.55, 0]
    ).astype(np.float32)
    chorus *= (envelope * rise)[None, :]
    # Widely separated, asymmetric reflections; the dry signal stays obvious and strong.
    for ch in range(2):
        dry = chorus[ch].copy()
        for delay, gain in [
            (0.23 + ch * 0.06, 0.19),
            (0.71 + ch * 0.13, 0.15),
            (1.46 + ch * 0.19, 0.1),
        ]:
            k = int(SR * delay)
            chorus[ch, k:] += dry[:-k] * gain
    return chorus

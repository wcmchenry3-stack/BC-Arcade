"""Synthesize the puzzle, tile and dice games' sound effects (no samples, no third-party audio). #3578

Covers Sort, 2048, Yacht, Daily Word, Sudoku and Mahjong (not the card games, which are
synth_arcade_sfx.py / #3563, Star Swarm or Cascade). Mahjong's background music is out of scope.
These games share one family of sounds: one file can back several games' registry keys. Each
recipe is the one the owner approved after a gameplay audition. The reasoning behind each sound
is in docs/games/puzzle-sound-design.md. The building blocks are in synth_common.py.

Writes into frontend/assets/sounds/. Noise uses a fixed seed per sound, so every run
reproduces the same decoded audio (compare with synth_common.decoded_pcm_sha256: Ogg bytes
differ only by their random stream serial).

Run from the repo root (needs numpy and ffmpeg with libvorbis):
    python tools/assets/synth_puzzle_sfx.py [out_dir] [sound ...]

With no sound names, every sound is written.

Sounds:
- dice-roll-1/2/3.ogg  Yacht "short cup and spill", 0.75 s each: a brief muffled rattle in a cup
  (~90 ms), then five dice spill onto a wooden tray and bounce to rest by ~0.42 s, inside the
  500 ms tumble animation. Every impact is noise (a click plus noise-driven resonances, no sine
  body), a few with a die-on-die knock. Three variations (seeds) via useSoundVariants.
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synth_common import SR, fade, highpass, level_rms, lp2, noise, norm, place, t_axis, write_ogg

OUT_DEFAULT = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "sounds"


# --- dice ------------------------------------------------------------------------------------


def resonate(x: np.ndarray, f: float, q: float) -> np.ndarray:
    """Two-pole bandpass resonator (RBJ constant-peak-gain biquad), for ringing noise."""
    w = 2 * np.pi * f / SR
    alpha = np.sin(w) / (2 * q)
    a0 = 1 + alpha
    b0, b2 = alpha / a0, -alpha / a0
    a1, a2 = -2 * np.cos(w) / a0, (1 - alpha) / a0
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i in range(len(x)):
        v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, x[i], y1, v
        y[i] = v
    return y


# surface -> (highpass, lowpass, attack s, decay s, thud level); resonances drawn per impact
CLACK_SURFACES = {
    "wood": (400, 9000, 0.0003, 0.0025, 0.35),  # a die landing on a wooden tray
    "cup": (500, 4500, 0.0004, 0.003, 0.0),  # dice knocking inside a cup: muffled
    "die": (2500, 10000, 0.0002, 0.0012, 0.0),  # die on die: tiny and bright
}


def clack(seed: int, surface: str, g: float = 1.0) -> np.ndarray:
    """One die impact, 50 ms: a broadband click plus noise-driven resonances (no sine body)."""
    rng = np.random.default_rng(seed)
    t = t_axis(0.05)
    n = len(t)
    lo, hi, att, dec, thud = CLACK_SURFACES[surface]
    if surface == "wood":
        bands = [(rng.uniform(1500, 2100), 10, 0.012), (rng.uniform(3200, 4200), 12, 0.008)]
    elif surface == "cup":
        bands = [(rng.uniform(700, 900), 8, 0.012), (rng.uniform(2600, 3200), 10, 0.006)]
    else:
        bands = [(rng.uniform(4500, 6000), 14, 0.005)]
    onset = np.clip(t / att, 0, 1)
    click = lp2(highpass(noise(n, seed), lo), hi)
    x = click / (np.std(click) + 1e-12) * onset * np.exp(-t / dec)
    for f, q, d in bands:
        r = resonate(noise(n, seed + int(f)), f, q)
        x += 0.5 * r / (np.std(r) + 1e-12) * onset * np.exp(-t / d)
    if thud:
        th = lp2(highpass(noise(n, seed + 7), 150), 600)
        x += thud * th / (np.std(th) + 1e-12) * np.clip(t / 0.002, 0, 1) * np.exp(-t / 0.012)
    return x * g


def bounces(
    seed: int, t0: float, first_gap: float, ratio: float, n_hits: int, g0: float, end: float = 0.56
) -> list[tuple[float, float, int]]:
    """One die bouncing to rest: (time, level, seed) per impact, gaps and levels shrinking."""
    rng = np.random.default_rng(seed)
    hits = []
    at, gap, g = t0, first_gap, g0
    for k in range(n_hits):
        if at > end:
            break
        hits.append((at, g * rng.uniform(0.85, 1.0), seed * 10 + k))
        at += gap * rng.uniform(0.85, 1.15)
        gap *= ratio
        g *= rng.uniform(0.6, 0.72)
    return hits


DICE_CUP_LEN = 0.09  # s of rattle in the cup before the spill ("short cup", owner pick)


def dice_roll(i: int) -> np.ndarray:
    """Short cup and spill, 0.75 s: a brief cup rattle, then 5 dice bounce on wood (variation i)."""
    base = 1000 * (1 + i) + 600
    rng = np.random.default_rng(base)
    x = np.zeros(int(0.75 * SR))
    for j in range(int(rng.integers(7, 9))):  # the rattle swells a little as the cup tips
        at = rng.uniform(0, DICE_CUP_LEN)
        place(x, clack(base + 500 + j, "cup", 0.18 + 0.22 * at / DICE_CUP_LEN), at)
    start = DICE_CUP_LEN + 0.01
    for d in range(5):
        t0 = start + rng.uniform(0, 0.05)
        gap = rng.uniform(0.08, 0.11)
        for at, g, s in bounces(base + d, t0, gap, 0.66, 6, rng.uniform(0.7, 1.0)):
            place(x, clack(s, "wood", g), at)
            if rng.random() < 0.35 and at < 0.4:  # sometimes a knock against another die
                place(x, clack(s + 3, "die", g * 0.45), at + rng.uniform(0.008, 0.02))
    return fade(x, 0.0, 0.05)


# --- registry ---------------------------------------------------------------------------------

Level = Callable[[np.ndarray], np.ndarray]


def peak(db: float) -> Level:
    return lambda x: norm(x, db)


def rms50(db: float, peak_max: float) -> Level:
    return lambda x: level_rms(x, db, peak_max)


DICE_ROLL_LEVEL = rms50(-20.0, -1.0)  # ~1.5 dB over card place: a roll is a bigger event

# file stem -> (recipe, leveling). Each stem is written as <stem>.ogg.
SOUNDS: dict[str, tuple[Callable[[], np.ndarray], Level]] = {
    "dice-roll-1": (lambda: dice_roll(0), DICE_ROLL_LEVEL),
    "dice-roll-2": (lambda: dice_roll(1), DICE_ROLL_LEVEL),
    "dice-roll-3": (lambda: dice_roll(2), DICE_ROLL_LEVEL),
}


def main(out_dir: Path, names: list[str]) -> None:
    unknown = [n for n in names if n not in SOUNDS]
    if unknown:
        raise SystemExit(f"unknown sound(s): {', '.join(unknown)}; known: {', '.join(SOUNDS)}")
    for name in names or list(SOUNDS):
        recipe, level = SOUNDS[name]
        write_ogg(level(recipe()), out_dir / f"{name}.ogg")


if __name__ == "__main__":
    args = sys.argv[1:]
    main(Path(args[0]) if args else OUT_DEFAULT, args[1:])

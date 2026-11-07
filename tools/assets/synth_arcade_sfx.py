"""Synthesize the card and puzzle games' sound effects (no samples, no third-party audio). #3563

Covers Blackjack, Solitaire, FreeCell, Hearts, Mahjong, Sudoku, 2048, Yacht, Sort and Daily Word
(not Star Swarm or Cascade). These games share one family of sounds: one file can back several
games' registry keys, e.g. a single card-place sound for Solitaire, FreeCell and Hearts. Each
recipe is the one the owner approved after a gameplay audition. The reasoning behind each
sound is in docs/games/arcade-sound-design.md. The building blocks are in synth_common.py.

Writes into frontend/assets/sounds/. Noise uses a fixed seed per sound, so every run
reproduces the same decoded audio (compare with synth_common.decoded_pcm_sha256: Ogg bytes
differ only by their random stream serial).

Run from the repo root (needs numpy and ffmpeg with libvorbis):
    python tools/assets/synth_arcade_sfx.py [out_dir] [sound ...]

With no sound names, every sound is written.

Sounds:
- card-place-1/2/3.ogg  "slide and settle", 0.10 s each: ~40-50 ms of grainy card-on-felt
  friction ending in a soft flat flap of air, with no tonal body. Three variations (slide length,
  seeds) played in random order, never the same twice in a row (useSoundVariants), so a run of
  Auto-Complete (one card every 120 ms) doesn't sound mechanical. Solitaire, FreeCell, Hearts.
- riffle-start/loop/settle.ogg  Auto-Complete "riffle shuffle" (Solitaire, FreeCell), played by
  useRunSound for as long as the run lasts: a 0.14 s pick-up (an accelerating flutter), a 2.0 s
  seamless loop (a dense flutter of bright card edges, ~42/s, over a papery whirr) and a 0.30 s
  settle (a few last edges, then the deck tapped flat: two soft flaps of air).
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synth_common import (
    SR,
    fade,
    highpass,
    level_rms,
    loopify,
    lp2,
    noise,
    norm,
    place,
    t_axis,
    write_ogg,
)

OUT_DEFAULT = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "sounds"


# --- cards ------------------------------------------------------------------------------------


def flap(
    seed: int,
    dur: float = 0.03,
    decay: float = 0.003,
    tail: float = 0.012,
    lo: float = 180,
    hi: float = 7000,
    tail_level: float = 0.18,
) -> np.ndarray:
    """A card landing flat: a very short broadband puff of air, with a softer, darker after-puff."""
    t = t_axis(dur)
    n = len(t)
    x = lp2(highpass(noise(n, seed), lo), hi)
    x /= np.std(x) + 1e-12
    e = np.clip(t / 0.0006, 0, 1) * (np.exp(-t / decay) + tail_level * np.exp(-t / tail))
    return x * e


def friction(
    seed: int,
    dur: float,
    lo: float = 1500,
    hi: float = 7000,
    grain_rate: float = 900,
    grain_depth: float = 0.8,
    rise: float = 0.3,
) -> np.ndarray:
    """Paper sliding on felt: band-limited noise with grainy micro-bursts (card stock texture)."""
    t = t_axis(dur)
    n = len(t)
    rng = np.random.default_rng(seed + 500)
    base = lp2(highpass(noise(n, seed), lo), hi)
    base /= np.std(base) + 1e-12
    # grain: sparse random impulses smeared over ~1 ms
    imp = (rng.random(n) < grain_rate / SR) * rng.uniform(0.5, 1.0, n)
    grain = lp2(imp, 1500)
    grain /= grain.max() + 1e-12
    p = t / t[-1]
    shape = np.clip(p / rise, 0, 1) ** 0.7 * (1 - np.clip((p - rise) / (1 - rise), 0, 1)) ** 1.5
    return base * (1 - grain_depth + grain_depth * grain * 3) * shape


def card_place(i: int) -> np.ndarray:
    """Slide and settle: a short papery slide ending in a soft flat flap (variation i = 0..2)."""
    dur = (0.045, 0.05, 0.04)[i]
    x = np.zeros(int(0.10 * SR))
    place(x, friction(71 + i, dur, lo=1200, hi=7500, grain_rate=1100, rise=0.15) * 0.35, 0.0)
    place(x, flap(81 + i, decay=0.003, tail=0.012, hi=5500) * 0.9, dur - 0.004)
    return fade(x, 0.0, 0.01)


# --- Auto-Complete riffle ---------------------------------------------------------------------

RIFFLE_LOOP = 2.0  # s; every modulation rate is a multiple of 1 / RIFFLE_LOOP
RIFFLE_XF = 0.15  # s folded back into the head by loopify


def tick(seed: int, decay: float = 0.0012, lo: float = 1500, hi: float = 8000) -> np.ndarray:
    """One card edge flicking past: a tiny bright broadband click (12 ms)."""
    t = t_axis(0.012)
    x = lp2(highpass(noise(len(t), seed), lo), hi)
    x /= np.std(x) + 1e-12
    return x * np.clip(t / 0.0003, 0, 1) * np.exp(-t / decay)


def place_wrap(dst: np.ndarray, src: np.ndarray, at: float) -> None:
    """Mix src into dst at `at` s, wrapping the overflow to the start (for seamless loops)."""
    k = int(at * SR) % len(dst)
    n = min(len(src), len(dst) - k)
    dst[k : k + n] += src[:n]
    if n < len(src):
        dst[: len(src) - n] += src[n:]


def flutter(length: float, rate: float, seed: int, jitter: float) -> np.ndarray:
    """Card edges at `rate` per second with timing and level jitter, wrapped to loop."""
    rng = np.random.default_rng(seed)
    x = np.zeros(int(length * SR))
    for j in range(int(rate * length)):
        at = (j + rng.uniform(-jitter, jitter)) / rate
        g = tick(int(rng.integers(1_000_000)), decay=0.0010, lo=1800, hi=8500)
        place_wrap(x, g * rng.uniform(0.55, 1.0), at % length)
    return x


def whirr(length: float, seed: int, swell_rate: float, swell_depth: float) -> np.ndarray:
    """Papery whirr under the flutter, crossfaded to loop."""
    t = t_axis(length + RIFFLE_XF)
    x = lp2(highpass(noise(len(t), seed), 1500), 7000)
    x /= np.std(x) + 1e-12
    x *= 1 - swell_depth * (0.5 + 0.5 * np.sin(2 * np.pi * swell_rate * t))
    return loopify(x, RIFFLE_XF)


def riffle_loop_raw() -> np.ndarray:
    """Riffle shuffle: a dense flutter of bright card edges (~42/s) over a papery whirr."""
    edges = flutter(RIFFLE_LOOP, 42, 101, jitter=0.3)
    return edges + 0.06 * whirr(RIFFLE_LOOP, 102, swell_rate=3.0, swell_depth=0.3)


# The loop is set to RIFFLE_LOOP_LUFS integrated loudness (a bed under the run, a little under
# card place). Its unscaled loudness, measured once with ffmpeg's ebur128 (the loop played 3
# times), is fixed here so the generator doesn't depend on the ffmpeg version.
RIFFLE_LOOP_LUFS = -27.0
RIFFLE_LOOP_MEASURED_LUFS = -16.6


def riffle_loop() -> np.ndarray:
    return riffle_loop_raw() * 10 ** ((RIFFLE_LOOP_LUFS - RIFFLE_LOOP_MEASURED_LUFS) / 20)


def riffle_start() -> np.ndarray:
    """Pick-up, 0.14 s: an accelerating flutter into the loop, peaking with the loop."""
    x = np.zeros(int(0.14 * SR))
    rng = np.random.default_rng(7)
    ats = [0.0, 0.035, 0.062, 0.083, 0.100, 0.114, 0.126]
    for j, at in enumerate(ats):
        g = tick(int(rng.integers(1e6)), decay=0.0012, lo=1600, hi=8000)
        place(x, g * (0.5 + 0.5 * j / len(ats)), at)
    x = fade(x, 0.0, 0.01)
    return x * (np.abs(riffle_loop()).max() / (np.abs(x).max() + 1e-12))


def riffle_settle() -> np.ndarray:
    """Squared pile, 0.30 s: a few last edges, then the deck tapped flat (two soft flaps)."""
    seed = 500
    x = np.zeros(int(0.30 * SR))
    for j, at in enumerate((0.0, 0.022, 0.040)):
        place(x, tick(seed + j, decay=0.0012) * (0.6 - 0.15 * j), at)
    place(x, friction(seed + 10, 0.05, lo=1200, hi=6000, rise=0.3) * 0.25, 0.03)
    place(
        x,
        flap(seed + 20, dur=0.06, decay=0.004, tail=0.02, lo=150, hi=4500, tail_level=0.25),
        0.075,
    )
    place(
        x,
        flap(seed + 21, dur=0.06, decay=0.003, tail=0.015, lo=150, hi=4000, tail_level=0.2) * 0.55,
        0.115,
    )
    return fade(x, 0.0, 0.05)


# --- registry ---------------------------------------------------------------------------------

Level = Callable[[np.ndarray], np.ndarray]


def peak(db: float) -> Level:
    return lambda x: norm(x, db)


def rms50(db: float, peak_max: float) -> Level:
    return lambda x: level_rms(x, db, peak_max)


CARD_PLACE_LEVEL = rms50(-21.5, -1.5)  # the three variations match by short-term loudness

# file stem -> (recipe, leveling). Each stem is written as <stem>.ogg.
SOUNDS: dict[str, tuple[Callable[[], np.ndarray], Level]] = {
    "card-place-1": (lambda: card_place(0), CARD_PLACE_LEVEL),
    "card-place-2": (lambda: card_place(1), CARD_PLACE_LEVEL),
    "card-place-3": (lambda: card_place(2), CARD_PLACE_LEVEL),
    "riffle-start": (riffle_start, lambda x: x),  # peaks with the loop (set in the recipe)
    "riffle-loop": (riffle_loop, lambda x: x),  # RIFFLE_LOOP_LUFS (set in the recipe)
    "riffle-settle": (riffle_settle, rms50(-21.5, -1.5)),  # lands like a card place
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

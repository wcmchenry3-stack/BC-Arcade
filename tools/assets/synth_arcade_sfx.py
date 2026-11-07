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

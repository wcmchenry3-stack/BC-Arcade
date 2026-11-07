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

Sounds: none yet (each is added here once the owner approves it).
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synth_common import level_rms, norm, write_ogg

OUT_DEFAULT = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "sounds"


# --- registry ---------------------------------------------------------------------------------

Level = Callable[[np.ndarray], np.ndarray]


def peak(db: float) -> Level:
    return lambda x: norm(x, db)


def rms50(db: float, peak_max: float) -> Level:
    return lambda x: level_rms(x, db, peak_max)


# file stem -> (recipe, leveling). Each stem is written as <stem>.ogg.
SOUNDS: dict[str, tuple[Callable[[], np.ndarray], Level]] = {}


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

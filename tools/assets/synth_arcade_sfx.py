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
(none yet. Each approved sound adds its recipe below and a line here.)
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synth_common import norm, write_ogg

OUT_DEFAULT = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "sounds"


# file stem -> (recipe, peak dBFS). Each stem is written as <stem>.ogg.
SOUNDS: dict[str, tuple[Callable[[], np.ndarray], float]] = {}


def main(out_dir: Path, names: list[str]) -> None:
    unknown = [n for n in names if n not in SOUNDS]
    if unknown:
        raise SystemExit(f"unknown sound(s): {', '.join(unknown)}; known: {', '.join(SOUNDS)}")
    for name in names or list(SOUNDS):
        recipe, peak = SOUNDS[name]
        write_ogg(norm(recipe(), peak), out_dir / f"{name}.ogg")


if __name__ == "__main__":
    args = sys.argv[1:]
    main(Path(args[0]) if args else OUT_DEFAULT, args[1:])

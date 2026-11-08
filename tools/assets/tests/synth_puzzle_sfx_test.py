"""pytest suite for synth_puzzle_sfx.py (#3578)."""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import synth_puzzle_sfx
from synth_common import SR


def test_generator_rejects_unknown_sound(tmp_path):
    with pytest.raises(SystemExit, match="unknown sound"):
        synth_puzzle_sfx.main(tmp_path, ["no-such-sound"])


def test_every_sound_is_deterministic_and_in_range():
    for name, (recipe, level) in synth_puzzle_sfx.SOUNDS.items():
        a, b = level(recipe()), level(recipe())
        assert np.array_equal(a, b), name
        assert 0 < len(a) <= 4 * SR, name
        assert np.max(np.abs(a)) <= 1.0, name

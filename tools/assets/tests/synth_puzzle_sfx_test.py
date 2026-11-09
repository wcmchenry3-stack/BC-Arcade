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


def _loudest_50ms_at(x: np.ndarray) -> float:
    w = int(0.005 * SR)
    e = np.convolve(x**2, np.ones(w), "same")
    return float(np.argmax(e)) / SR


def test_mahjong_match_clacks_as_the_pair_meets():
    # motion.ts: the pair meets at 0.6 of the 440 ms match (#3613); the sound fires at the tap.
    assert pytest.approx(0.6 * 0.44) == synth_puzzle_sfx.MAHJONG_MEET_AT
    for i in range(3):
        at = _loudest_50ms_at(synth_puzzle_sfx.mahjong_match(i))
        assert synth_puzzle_sfx.MAHJONG_MEET_AT <= at <= synth_puzzle_sfx.MAHJONG_MEET_AT + 0.02


def test_mahjong_select_is_on_the_tap_and_quieter_than_match():
    for i in range(3):
        assert _loudest_50ms_at(synth_puzzle_sfx.mahjong_select(i)) <= 0.02
    sel = synth_puzzle_sfx.SOUNDS["mahjong-select-1"]
    mat = synth_puzzle_sfx.SOUNDS["mahjong-match-1"]
    rms = lambda x: np.sqrt(np.convolve(x**2, np.ones(2205) / 2205, "valid").max())
    assert 20 * np.log10(rms(mat[1](mat[0]())) / rms(sel[1](sel[0]()))) == pytest.approx(3, abs=0.2)

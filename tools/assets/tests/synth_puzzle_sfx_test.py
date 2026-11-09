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


def _loudest_5ms_at(x: np.ndarray) -> float:
    w = int(0.005 * SR)
    e = np.convolve(x**2, np.ones(w), "same")
    return float(np.argmax(e)) / SR


def test_mahjong_match_clacks_as_the_pair_meets():
    # motion.ts: the pair meets at 0.6 of the 440 ms match (#3613); the sound fires at the tap.
    assert pytest.approx(0.6 * 0.44) == synth_puzzle_sfx.MAHJONG_MEET_AT
    for i in range(3):
        at = _loudest_5ms_at(synth_puzzle_sfx.mahjong_match(i))
        assert synth_puzzle_sfx.MAHJONG_MEET_AT <= at <= synth_puzzle_sfx.MAHJONG_MEET_AT + 0.02


def test_mahjong_select_is_on_the_tap_and_quieter_than_match():
    for i in range(3):
        assert _loudest_5ms_at(synth_puzzle_sfx.mahjong_select(i)) <= 0.02
    sel = synth_puzzle_sfx.SOUNDS["mahjong-select-1"]
    mat = synth_puzzle_sfx.SOUNDS["mahjong-match-1"]
    rms = lambda x: np.sqrt(np.convolve(x**2, np.ones(2205) / 2205, "valid").max())
    assert 20 * np.log10(rms(mat[1](mat[0]())) / rms(sel[1](sel[0]()))) == pytest.approx(3, abs=0.2)


def test_mahjong_shuffle_lands_with_the_swirl():
    # motion.ts: the shuffle's tiles land between 0.65 and 1.0 of its 880 ms (#3613).
    land0, land1 = synth_puzzle_sfx.MAHJONG_SHUFFLE_LAND
    assert (land0, land1) == (pytest.approx(0.65 * 0.88), pytest.approx(0.88))
    x = synth_puzzle_sfx.mahjong_shuffle()
    w = int(0.005 * SR)
    e = np.convolve(x**2, np.ones(w), "same")
    # The last click is a landing, inside the window, and the sound is over soon after.
    loud = np.nonzero(e > e.max() * 0.05)[0]
    assert land0 <= loud[-1] / SR <= land1 + 0.05
    assert len(x) / SR <= 1.1


def test_mahjong_win_strikes_as_the_result_card_shows():
    # motion.ts: the spark cascade holds the card back for 1.45 s (#3613).
    assert pytest.approx(1.45) == synth_puzzle_sfx.MAHJONG_WIN_CARD_AT
    x = synth_puzzle_sfx.mahjong_win()
    at = _loudest_5ms_at(x)
    assert synth_puzzle_sfx.MAHJONG_WIN_CARD_AT <= at <= synth_puzzle_sfx.MAHJONG_WIN_CARD_AT + 0.1


def test_mahjong_endings_carry_on_phone_speakers():
    for name in ("mahjong-win", "mahjong-deadlock"):
        recipe, level = synth_puzzle_sfx.SOUNDS[name]
        x = level(recipe())
        spec = np.abs(np.fft.rfft(x)) ** 2
        f = np.fft.rfftfreq(len(x), 1 / SR)
        assert spec[f < 300].sum() / spec.sum() < 0.05, name


def _rms50_db(x: np.ndarray) -> float:
    return 20 * np.log10(np.sqrt(np.convolve(x**2, np.ones(2205) / 2205, "valid").max()))


def test_daily_word_reveal_ticks_at_once_and_clears_before_the_next_tile():
    # motion.ts (#3664): tiles show their colour 100 ms apart; each sound is played at that moment.
    for r in synth_puzzle_sfx.DAILY_WORD_RESULTS:
        for i in range(3):
            x = synth_puzzle_sfx.daily_word_reveal(r, i)
            assert _loudest_5ms_at(x) <= 0.02, (r, i)
            assert len(x) / SR <= 0.25, (r, i)
            # The next tile's tick stands clear: 100 ms on, the tail (a green tile's chord rings
            # under it) is at least 10 dB down.
            head = np.abs(x[: int(0.02 * SR)]).max()
            assert np.abs(x[int(0.1 * SR) :]).max() < head * 10 ** (-10 / 20), (r, i)


def test_daily_word_reveal_grows_with_the_result():
    levels = {}
    for r in synth_puzzle_sfx.DAILY_WORD_RESULTS:
        recipe, level = synth_puzzle_sfx.SOUNDS[f"daily-word-{r}-1"]
        levels[r] = _rms50_db(level(recipe()))
    assert levels["present"] - levels["miss"] == pytest.approx(2, abs=0.2)
    assert levels["correct"] - levels["miss"] == pytest.approx(4, abs=0.2)


def test_daily_word_refusal_fits_the_shake():
    # motion.ts (#3664): the shake is 360 ms; the "no" is two taps 120 ms apart inside it.
    x = synth_puzzle_sfx.daily_word_refused()
    assert len(x) / SR <= 0.4
    w = int(0.005 * SR)
    e = np.convolve(x**2, np.ones(w), "same")
    second = int(0.1 * SR) + int(np.argmax(e[int(0.1 * SR) : int(0.2 * SR)]))
    assert 0.12 <= second / SR <= 0.14
    assert _loudest_5ms_at(x) <= 0.02


def test_daily_word_sounds_carry_on_phone_speakers():
    names = [f"daily-word-{r}-1" for r in synth_puzzle_sfx.DAILY_WORD_RESULTS]
    for name in [*names, "daily-word-refused"]:
        recipe, level = synth_puzzle_sfx.SOUNDS[name]
        x = level(recipe())
        spec = np.abs(np.fft.rfft(x)) ** 2
        f = np.fft.rfftfreq(len(x), 1 / SR)
        assert spec[f < 300].sum() / spec.sum() < 0.10, name


def test_daily_word_win_rides_the_dance_and_lands_on_the_card():
    # motion.ts (#3664): hops 70 ms apart, highest 0.45 of 240 ms in; the card at 1.1 s.
    assert pytest.approx(0.07) == synth_puzzle_sfx.DAILY_WORD_HOP_STAGGER
    assert pytest.approx(0.45 * 0.24) == synth_puzzle_sfx.DAILY_WORD_HOP_PEAK
    assert pytest.approx(1.1) == synth_puzzle_sfx.DAILY_WORD_WIN_CARD_AT
    x = synth_puzzle_sfx.daily_word_win()
    w = int(0.005 * SR)
    e = np.convolve(x**2, np.ones(w), "same")
    # The first hop's note starts the sound; the chord at the card is the loudest moment.
    first = np.nonzero(e > e.max() * 0.01)[0][0] / SR
    assert first == pytest.approx(synth_puzzle_sfx.DAILY_WORD_HOP_PEAK - 0.004, abs=0.01)
    card = synth_puzzle_sfx.DAILY_WORD_WIN_CARD_AT
    assert card <= _loudest_5ms_at(x) <= card + 0.06


def test_daily_word_loss_falls_with_the_answer_and_settles_on_the_card():
    # motion.ts (#3664): answer tiles show 120 ms apart from 150 ms; the card at 0.78 s.
    assert pytest.approx(0.12) == synth_puzzle_sfx.DAILY_WORD_ANSWER_STAGGER
    assert pytest.approx(0.15) == synth_puzzle_sfx.DAILY_WORD_ANSWER_MID
    assert pytest.approx(4 * 0.12 + 0.3) == synth_puzzle_sfx.DAILY_WORD_LOSS_CARD_AT
    x = synth_puzzle_sfx.daily_word_loss()
    w = int(0.005 * SR)
    e = np.convolve(x**2, np.ones(w), "same")
    first = np.nonzero(e > e.max() * 0.01)[0][0] / SR
    assert first == pytest.approx(synth_puzzle_sfx.DAILY_WORD_ANSWER_MID - 0.004, abs=0.01)
    assert len(x) / SR <= 2.0


def test_daily_word_win_is_louder_than_the_loss_and_both_carry_on_phones():
    levels = {}
    for name in ("daily-word-win", "daily-word-loss"):
        recipe, level = synth_puzzle_sfx.SOUNDS[name]
        x = level(recipe())
        levels[name] = _rms50_db(x)
        spec = np.abs(np.fft.rfft(x)) ** 2
        f = np.fft.rfftfreq(len(x), 1 / SR)
        assert spec[f < 300].sum() / spec.sum() < 0.05, name
    assert levels["daily-word-win"] - levels["daily-word-loss"] == pytest.approx(4, abs=0.2)

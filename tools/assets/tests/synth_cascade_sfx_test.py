"""pytest suite for synth_cascade_sfx.py (#3702): the two sets, determinism, range, levels and the
timings the sounds are cut to (frontend/src/game/cascade/motion.ts and celebration.ts).

That the shipped files equal the recipes is `synth_shipped_test.py`.
"""

import re
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import synth_cascade_sfx as cascade
from synth_common import SR

REPO = Path(__file__).resolve().parents[3]
MOTION_TS = (REPO / "frontend/src/game/cascade/motion.ts").read_text(encoding="utf-8")
CELEBRATION_TS = (REPO / "frontend/src/game/cascade/celebration.ts").read_text(encoding="utf-8")
SOUNDS_TS = (REPO / "frontend/src/game/cascade/sounds.ts").read_text(encoding="utf-8")

NAMES = (
    ["drop", "land-light", "land-heavy"]
    + [f"merge-t{n}" for n in range(11)]
    + [f"chain-{k}" for k in range(1, 5)]
    + ["danger", "win", "game-over"]
)


def _render(stem: str) -> np.ndarray:
    recipe, level = cascade.SOUNDS[stem]
    return level(recipe())


def _rms50_db(x: np.ndarray) -> float:
    w = int(0.05 * SR)
    return 20 * np.log10(np.sqrt(np.convolve(x**2, np.ones(w) / w, "valid")).max())


def _ms(block: str, key: str, source: str = MOTION_TS) -> float:
    """A number from motion.ts's `block: { ... key: N ... }`."""
    body = source[source.index(f"  {block}: {{") :]
    return float(re.search(rf"\b{key}: ([\d.]+)", body).group(1))


def test_two_sets_of_the_same_sounds_named_by_set():
    assert sorted(cascade.SOUNDS) == sorted(f"cascade-{s}-{n}" for s in cascade.SETS for n in NAMES)
    assert cascade.SETS == ("fruits", "cosmos")


def test_the_app_registers_every_sound_and_no_other():
    files = set(re.findall(r'require\("[^"]*/(cascade-[\w-]+)\.ogg"\)', SOUNDS_TS))
    assert files == set(cascade.SOUNDS)


def test_generator_rejects_unknown_sound(tmp_path):
    with pytest.raises(SystemExit, match="unknown sound"):
        cascade.main(tmp_path, ["no-such-sound"])
    assert list(tmp_path.iterdir()) == []


def test_normal_run_writes_one_file_per_stem(tmp_path, monkeypatch):
    # The encoder is stubbed, so this runs without ffmpeg: it is the names that are checked.
    monkeypatch.setattr(cascade, "write_ogg", lambda _x, path: Path(path).write_bytes(b"x"))
    cascade.main(tmp_path, ["cascade-fruits-drop", "cascade-cosmos-win"])
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "cascade-cosmos-win.ogg",
        "cascade-fruits-drop.ogg",
    ]


@pytest.mark.parametrize("stem", sorted(cascade.SOUNDS))
def test_every_sound_is_deterministic_and_in_range(stem):
    a, b = _render(stem), _render(stem)
    assert np.array_equal(a, b)
    assert 0 < len(a) <= 3 * SR
    assert np.max(np.abs(a)) <= 1.0


@pytest.mark.parametrize("name", NAMES)
def test_both_sets_are_equally_loud(name):
    # A skin switch never jumps in level: each sound sits at the same loudest-50-ms level.
    fruits, cosmos = _render(f"cascade-fruits-{name}"), _render(f"cascade-cosmos-{name}")
    assert _rms50_db(fruits) == pytest.approx(_rms50_db(cosmos), abs=0.3)


@pytest.mark.parametrize("s", cascade.SETS)
def test_the_merge_ladder_rises_a_step_per_tier_and_gets_louder(s):
    levels = [_rms50_db(_render(f"cascade-{s}-merge-t{n}")) for n in range(11)]
    assert levels == sorted(levels)
    assert levels[-1] - levels[0] == pytest.approx(5.0, abs=0.3)
    assert [cascade.penta(n) for n in range(11)] == [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]


def test_timings_match_the_motion():
    assert cascade.CHAIN_STEP * 1000 == _ms("chain", "stepMs")
    assert cascade.GAME_OVER_CARD_AT * 1000 == _ms("gameOver", "cardAtMs")
    assert cascade.DANGER_FASTEST * 1000 == _ms("danger", "fastMs")
    card = float(re.search(r"CELEBRATION_CARD_MS = (\d+)", CELEBRATION_TS).group(1))
    start = float(re.search(r"CELEBRATION_START_MS = (\d+)", CELEBRATION_TS).group(1))
    assert cascade.WIN_CARD_AT * 1000 == card
    assert cascade.WIN_RISE[0] * 1000 == start


@pytest.mark.parametrize("s", cascade.SETS)
def test_danger_ticks_never_overlap_at_the_fastest_blink(s):
    assert len(_render(f"cascade-{s}-danger")) / SR < cascade.DANGER_FASTEST


@pytest.mark.parametrize("s", cascade.SETS)
def test_chain_steps_are_short_enough_for_the_80_ms_steps(s):
    for k in range(1, 5):
        assert len(_render(f"cascade-{s}-chain-{k}")) / SR <= 3 * cascade.CHAIN_STEP


def _loudest_onset_after(x: np.ndarray, t0: float) -> float:
    """Time of the loudest 5 ms window at or after t0."""
    w = int(0.005 * SR)
    e = np.convolve(x**2, np.ones(w), "same")
    k = int(t0 * SR)
    return (k + int(np.argmax(e[k:]))) / SR


@pytest.mark.parametrize("s", cascade.SETS)
def test_the_win_chord_lands_as_the_card_shows(s):
    x = _render(f"cascade-{s}-win")
    at = _loudest_onset_after(x, cascade.WIN_CARD_AT - 0.3)
    assert cascade.WIN_CARD_AT - 0.01 <= at <= cascade.WIN_CARD_AT + 0.1


@pytest.mark.parametrize("s", cascade.SETS)
def test_the_game_over_chord_lands_as_the_loss_card_shows(s):
    x = _render(f"cascade-{s}-game-over")
    at = _loudest_onset_after(x, cascade.GAME_OVER_CARD_AT - 0.15)
    assert cascade.GAME_OVER_CARD_AT - 0.01 <= at <= cascade.GAME_OVER_CARD_AT + 0.1

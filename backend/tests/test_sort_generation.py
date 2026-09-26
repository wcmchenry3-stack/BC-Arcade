"""Sort level generation (#1576, #2764).

``deal_level`` deals uniform random shuffles and keeps the first one that
``sort.fast_solver`` proves solvable. These tests cover the shape of what it
deals, and that nothing short of a proof gets through.
"""

from __future__ import annotations

import logging
import random
from collections import Counter

import pytest

from sort import generate_levels
from sort.fast_solver import solve
from sort.generate_levels import (
    COLORS_3,
    COLORS_9,
    COLORS_14,
    DEPTH,
    LEVEL_SPECS,
    LevelGenerationError,
    _solved,
    deal_level,
)

_CONFIGS = sorted({(len(colors), n_empty) for _, colors, n_empty in LEVEL_SPECS})
_COLORS_BY_SIZE = {len(colors): colors for _, colors, _ in LEVEL_SPECS}
_N_SAMPLES = 5


@pytest.mark.parametrize(("n_colors", "n_empty"), _CONFIGS, ids=lambda v: str(v))
def test_deals_are_well_formed_non_trivial_and_proven(n_colors: int, n_empty: int) -> None:
    colors = _COLORS_BY_SIZE[n_colors]
    rng = random.Random(1576)
    for _ in range(_N_SAMPLES):
        state = deal_level(colors, n_empty, rng)
        assert len(state) == n_colors + n_empty
        assert all(len(b) == DEPTH for b in state[:n_colors])
        assert state[n_colors:] == [[] for _ in range(n_empty)]
        assert Counter(c for b in state for c in b) == {c: DEPTH for c in colors}
        assert not _solved(state)
        assert solve(state)[0] is True


@pytest.mark.parametrize("rejected", [False, None], ids=["unsolvable", "undecided"])
def test_only_a_proven_deal_is_returned(
    monkeypatch: pytest.MonkeyPatch, rejected: bool | None
) -> None:
    """A deal proven dead, or not decided within the budget, is dealt again."""
    verdicts = [rejected, rejected, True]
    seen_deals: list[list[list[str]]] = []

    def fake_solve(state: list[list[str]], budget: int) -> tuple[bool | None, int]:
        assert budget == generate_levels.SOLVER_BUDGET
        seen_deals.append([list(b) for b in state])
        return verdicts[len(seen_deals) - 1], 1

    monkeypatch.setattr(generate_levels, "solve", fake_solve)
    state = deal_level(COLORS_9, 1, random.Random(0))
    assert len(seen_deals) == 3
    assert state == seen_deals[-1]


def test_no_proof_within_max_attempts_raises_and_logs(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Never an unverified level: out of attempts is a logged error."""
    calls = 0

    def undecided(state: list[list[str]], budget: int) -> tuple[None, int]:
        nonlocal calls
        calls += 1
        return None, budget

    monkeypatch.setattr(generate_levels, "solve", undecided)
    with (
        caplog.at_level(logging.ERROR, logger="sort.generate_levels"),
        pytest.raises(LevelGenerationError, match="14 colors, 2 empty"),
    ):
        deal_level(COLORS_14, 2, random.Random(0), max_attempts=7)
    assert calls == 7
    assert "no provably solvable deal in 7 attempts" in caplog.text


def test_build_levels_raises_rather_than_serve_an_unproven_level(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(generate_levels, "solve", lambda state, budget: (False, 1))
    with pytest.raises(LevelGenerationError, match="3 colors, 2 empty"):
        generate_levels.build_levels(0)


def test_trivial_deals_are_never_returned() -> None:
    # One colour: every deal is already solved, so none may be returned.
    with pytest.raises(LevelGenerationError):
        deal_level(COLORS_3[:1], 1, random.Random(0), max_attempts=5)

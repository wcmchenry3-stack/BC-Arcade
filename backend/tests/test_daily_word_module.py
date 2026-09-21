"""Daily Word GameModule + result envelope (#2451).

Pure unit tests — no database. The DB round trip (create with metadata, complete
with a result, read it back) lives in ``test_games_api.py`` next to the other
games' result tests.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from daily_challenge.definitions import FREE_GOAL_POOL, game_facts
from daily_word.models import DailyWordMetadata, DailyWordResult
from daily_word.module import module
from games.protocol import GameModule
from games.registry import get_module
from vocab import GameType


def test_module_registered_and_satisfies_protocol() -> None:
    assert get_module("daily_word") is module
    assert isinstance(module, GameModule)
    assert module.game_type == GameType.DAILY_WORD


def test_module_declares_distinct_metadata_and_result_models() -> None:
    assert module.metadata_model is DailyWordMetadata
    assert module.result_model is DailyWordResult


def test_metadata_needs_only_puzzle_id_and_defaults_language() -> None:
    meta = DailyWordMetadata.model_validate({"puzzle_id": "20260920-en"})
    assert meta.language == "en"


def test_result_accepts_a_win() -> None:
    result = DailyWordResult.model_validate({"is_complete": True, "won": True, "guesses_used": 3})
    assert result.model_dump(exclude_unset=True) == {
        "is_complete": True,
        "won": True,
        "guesses_used": 3,
    }


def test_result_accepts_an_abandon_with_no_guesses() -> None:
    assert DailyWordResult.model_validate({"is_complete": False, "won": False, "guesses_used": 0})


def test_result_ignores_unknown_keys_so_newer_builds_still_complete() -> None:
    result = DailyWordResult.model_validate(
        {"is_complete": True, "won": False, "guesses_used": 6, "hint_used": True}
    )
    assert "hint_used" not in result.model_dump(exclude_unset=True)


@pytest.mark.parametrize(
    "bad",
    [
        {"won": True, "guesses_used": 3},  # is_complete missing
        {"is_complete": True, "guesses_used": 3},  # won missing
        {"is_complete": True, "won": True},  # guesses_used missing
        {"is_complete": True, "won": True, "guesses_used": -1},
    ],
)
def test_result_rejects_invalid_blocks(bad: dict) -> None:
    with pytest.raises(ValidationError):
        DailyWordResult.model_validate(bad)


def test_result_does_not_cap_guesses_so_a_taller_board_cannot_dead_letter_a_game() -> None:
    assert DailyWordResult.model_validate({"is_complete": True, "won": True, "guesses_used": 8})


def _met(result: dict, tier: str) -> bool:
    """Does a finished game reporting *result* meet Daily Word's *tier* goal?"""
    facts = game_facts(DailyWordResult.model_validate(result).model_dump(), None, None)
    (goal,) = (g for g in FREE_GOAL_POOL["daily_word"] if g.tier == tier)
    return goal.evaluate(facts)


def test_reported_result_drives_the_daily_challenge_goals() -> None:
    """The fields this model stores are exactly the ones the challenge reads."""
    win_in_3 = {"is_complete": True, "won": True, "guesses_used": 3}
    win_in_5 = {"is_complete": True, "won": True, "guesses_used": 5}
    loss = {"is_complete": True, "won": False, "guesses_used": 6}
    abandoned = {"is_complete": False, "won": False, "guesses_used": 2}

    assert [_met(win_in_3, t) for t in ("easy", "medium", "hard")] == [True, True, True]
    assert [_met(win_in_5, t) for t in ("easy", "medium", "hard")] == [True, True, False]
    assert [_met(loss, t) for t in ("easy", "medium", "hard")] == [True, False, False]
    assert [_met(abandoned, t) for t in ("easy", "medium", "hard")] == [False, False, False]

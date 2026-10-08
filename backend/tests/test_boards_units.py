"""Unit tests for edge branches of ``games/boards/`` (#2992).

The route-level suites (``test_generic_leaderboard.py``, ``test_game_rank.py``,
...) cover the package end to end; these pin the branches no shipped board
reaches today (a metadata metric with a floor, a partition value of ``None``,
a missing board) and the ``player_standing`` error and empty paths.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy.dialects import sqlite
from sqlalchemy.exc import OperationalError

from games.board import BoardDefinition
from games.boards import limits, queries, sql
from games.boards.types import LeaderboardError, LimitViolation
from tests.test_generic_leaderboard import SECRET_SID, _FailingDB, _finished_game

_LEVEL_BOARD = BoardDefinition(
    metric="level_reached", direction="desc", label_key="level", min_value=3
)
_PARTITIONED = BoardDefinition(
    metric="final_score", direction="desc", label_key="score", partitions=("difficulty",)
)


def _sql(filters: list) -> list[str]:
    dialect = sqlite.dialect()
    return [
        str(f.compile(dialect=dialect, compile_kwargs={"literal_binds": True})) for f in filters
    ]


def test_a_metadata_metric_floor_is_a_filter() -> None:
    text = _sql(sql.board_filters(_LEVEL_BOARD, 1, {}))
    # The metadata metric is bounded by metadata_count; only the floor is added.
    assert any(">= 3" in f for f in text), text


def test_a_metadata_metric_without_floor_adds_no_bound() -> None:
    board = _LEVEL_BOARD.model_copy(update={"min_value": 0})
    assert len(sql.board_filters(board, 1, {})) == len(sql.board_filters(_LEVEL_BOARD, 1, {})) - 1


def test_a_none_partition_value_matches_rows_without_the_key() -> None:
    text = _sql(sql.board_filters(_PARTITIONED, 1, {"difficulty": None}))
    assert any("IS NULL" in f and "difficulty" in f for f in text), text


def test_no_board_means_no_limit() -> None:
    assert limits.board_limit_violation("zz", None, 10**12, {}) is None


def test_a_non_integer_metadata_metric_is_a_violation() -> None:
    violation = limits.board_limit_violation("sort", _LEVEL_BOARD, None, {"level_reached": "9"})
    assert violation == LimitViolation(
        "sort", "level_reached", "level_reached must be a non-negative integer."
    )


@pytest.mark.parametrize("value", [-1, True, 1.5, None])
def test_is_count_rejects_non_counts(value: object) -> None:
    assert not limits.is_count(value)


def test_an_unfinished_game_is_unrankable_for_lack_of_a_score() -> None:
    game = _finished_game("solitaire")
    game.completed_at = None
    board = BoardDefinition(metric="final_score", direction="desc", label_key="score")
    assert queries._unrankable_reason(board, game) == "Game has no final score."


async def test_player_standing_db_error_is_a_clean_500(caplog: pytest.LogCaptureFixture) -> None:
    board = BoardDefinition(metric="final_score", direction="desc", label_key="score")
    with caplog.at_level("ERROR"), pytest.raises(LeaderboardError) as info:
        await queries.player_standing(
            _FailingDB(fail_execute=True),  # type: ignore[arg-type]
            board=board,
            game=_finished_game("solitaire"),
            session_id=SECRET_SID,
        )
    assert info.value.status_code == 500
    assert info.value.detail == "Failed to calculate rank."
    assert isinstance(info.value.__cause__, OperationalError)
    assert SECRET_SID not in caplog.text


class _EmptyResult:
    def first(self) -> None:
        return None


class _EmptyDB:
    async def execute(self, *_: Any, **__: Any) -> _EmptyResult:
        return _EmptyResult()


async def test_player_standing_without_an_entry_is_none() -> None:
    board = BoardDefinition(metric="final_score", direction="desc", label_key="score")
    standing = await queries.player_standing(
        _EmptyDB(),  # type: ignore[arg-type]
        board=board,
        game=_finished_game("solitaire"),
        session_id=SECRET_SID,
    )
    assert standing is None

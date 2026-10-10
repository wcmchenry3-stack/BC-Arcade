"""``compute_rank`` takes its last tie-break direction from ``FINAL_TIEBREAK`` (#2972).

The board order (``games.boards``) and ``/games/{id}/rank`` must use the same
direction for ``completed_at``, so both read the constant instead of hard-coding it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.dialects import sqlite

from db.models import Game
from games import ranking


class _CapturingDB:
    def __init__(self) -> None:
        self.sql = ""

    async def execute(self, statement: Any) -> Any:
        self.sql = str(statement.compile(dialect=sqlite.dialect()))

        class _Result:
            def scalar(self) -> int:
                return 0

        return _Result()


async def _rank_sql() -> str:
    db = _CapturingDB()
    await ranking.compute_rank(
        db,  # type: ignore[arg-type]
        metric=Game.final_score,
        direction="desc",
        value=100,
        completed_at=datetime(2026, 1, 1, tzinfo=UTC),
        game_label="test",
    )
    return db.sql


async def test_rank_counts_earlier_completions_for_the_current_ascending_tiebreak() -> None:
    assert ranking.FINAL_TIEBREAK == ("completed_at", "asc")
    assert "games.completed_at <" in await _rank_sql()


async def test_rank_follows_the_final_tiebreak_direction(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ranking, "FINAL_TIEBREAK", ("completed_at", "desc"))
    sql = await _rank_sql()
    assert "games.completed_at >" in sql
    assert "games.completed_at <" not in sql

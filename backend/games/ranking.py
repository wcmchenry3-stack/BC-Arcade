"""Rank helpers for leaderboards.

``compute_rank`` is the generic, direction-aware rank used by
``GET /games/leaderboard`` and ``GET /games/{id}/rank`` (#2618, #2677). It counts
players (distinct sessions), not rows, and always returns the exact rank.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import ColumnElement, DateTime, and_, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Game
from games.board import FINAL_TIEBREAK, Direction

logger = logging.getLogger(__name__)


def receipt_expr() -> ColumnElement:
    """The final tie key (``FINAL_TIEBREAK``): the server's receipt time of the
    completion, falling back to ``completed_at`` for a row without one (#2765)."""
    return func.coalesce(Game.received_at, Game.completed_at, type_=DateTime(timezone=True))


def beats(expr: ColumnElement, value: Any, direction: Direction) -> ColumnElement[bool]:
    """``expr`` is strictly better than ``value`` in ``direction``."""
    return expr > value if direction == "desc" else expr < value


async def compute_rank(  # noqa: PLR0913 - keyword-only args describing one rank query
    db: AsyncSession,
    *,
    metric: ColumnElement,
    direction: Direction,
    value: Any,
    received_at: datetime,
    tiebreak: tuple[ColumnElement, Direction, Any] | None = None,
    filters: Sequence[ColumnElement] = (),
    game_label: str,
) -> int:
    """Exact 1-based rank of a player's best entry on a board.

    Counts the distinct sessions with at least one row (within ``filters``)
    that beats the entry: a better ``metric`` in ``direction``; on a tie, a
    better ``tiebreak`` ``(expr, direction, entry's value)``; on a further tie,
    an earlier ``receipt_expr()`` (server receipt time). A session has a row that beats the entry
    exactly when its best row does, so this is the number of players ranked
    above, plus one. There is no "outside the top 10" sentinel.

    The caller passes the same expressions the board is ordered by (including
    any NULL coalescing), so the rank always agrees with the listed order.
    Raises a clean 500 on a DB error.
    """
    # Same key and direction the board orders by (``FINAL_TIEBREAK``).
    earlier = beats(receipt_expr(), received_at, FINAL_TIEBREAK[1])
    last_tie = and_(metric == value, earlier)
    if tiebreak is not None:
        tb_expr, tb_dir, tb_value = tiebreak
        last_tie = and_(
            metric == value,
            or_(
                beats(tb_expr, tb_value, tb_dir),
                and_(tb_expr == tb_value, earlier),
            ),
        )
    try:
        count = (
            await db.execute(
                select(func.count(func.distinct(Game.session_id))).where(
                    *filters,
                    or_(beats(metric, value, direction), last_tie),
                )
            )
        ).scalar()
    except SQLAlchemyError as exc:
        # Class name only: the exception text carries bound parameters.
        logger.error("%s rank query failed: %s", game_label, type(exc).__name__)
        raise HTTPException(status_code=500, detail="Failed to calculate rank.") from exc
    return int(count or 0) + 1

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
from sqlalchemy import ColumnElement, and_, case, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Game
from games.board import FINAL_TIEBREAK, Direction

logger = logging.getLogger(__name__)


def receipt_order(
    received: ColumnElement, completed: ColumnElement, direction: Direction
) -> list[ColumnElement]:
    """The final tie order (``FINAL_TIEBREAK``) over a received/completed column pair.

    A row with a server receipt time ranks before any row without one (#3225);
    rows without one (only those completed by the old instance during the
    migration's deploy window) fall back to the device ``completed_at``, then
    the caller's id. ``CASE`` rather than ``NULLS LAST``: portable to SQLite.
    """
    no_receipt = case((received.is_(None), 1), else_=0)
    if direction == "desc":
        return [no_receipt.asc(), received.desc(), completed.desc()]
    return [no_receipt.asc(), received.asc(), completed.asc()]


def beats_receipt(
    received: ColumnElement,
    completed: ColumnElement,
    entry_received: datetime | None,
    entry_completed: datetime | None,
    direction: Direction,
) -> ColumnElement[bool]:
    """A row (``received``/``completed`` columns) is strictly ahead of the entry on
    the final tie: same order as ``receipt_order`` (no receipt time ranks last)."""
    if entry_received is None:
        ahead = received.is_not(None)
        if entry_completed is None:
            return ahead
        return or_(ahead, and_(received.is_(None), beats(completed, entry_completed, direction)))
    return and_(received.is_not(None), beats(received, entry_received, direction))


def beats(expr: ColumnElement, value: Any, direction: Direction) -> ColumnElement[bool]:
    """``expr`` is strictly better than ``value`` in ``direction``."""
    return expr > value if direction == "desc" else expr < value


async def compute_rank(  # noqa: PLR0913 - keyword-only args describing one rank query
    db: AsyncSession,
    *,
    metric: ColumnElement,
    direction: Direction,
    value: Any,
    received_at: datetime | None,
    completed_at: datetime | None = None,
    tiebreak: tuple[ColumnElement, Direction, Any] | None = None,
    filters: Sequence[ColumnElement] = (),
    game_label: str,
) -> int:
    """Exact 1-based rank of a player's best entry on a board.

    Counts the distinct sessions with at least one row (within ``filters``)
    that beats the entry: a better ``metric`` in ``direction``; on a tie, a
    better ``tiebreak`` ``(expr, direction, entry's value)``; on a further tie,
    an earlier ``received_at`` (server receipt time; a row without one ranks
    last, then by ``completed_at``, #3225). A session has a row that beats the entry
    exactly when its best row does, so this is the number of players ranked
    above, plus one. There is no "outside the top 10" sentinel.

    The caller passes the same expressions the board is ordered by (including
    any NULL coalescing), so the rank always agrees with the listed order.
    Raises a clean 500 on a DB error.
    """
    # Same key and direction the board orders by (``FINAL_TIEBREAK``).
    earlier = beats_receipt(
        Game.received_at, Game.completed_at, received_at, completed_at, FINAL_TIEBREAK[1]
    )
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

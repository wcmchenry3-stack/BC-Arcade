"""Rank helpers for leaderboards.

``compute_rank`` is the generic, direction-aware rank used by the
``/games/leaderboard`` and ``/games/{id}/name`` routes (#2618). It counts
players (distinct sessions), not rows, and always returns the exact rank.

``compute_legacy_rank`` and ``ensure_scored`` serve the per-game
``PATCH /<game>/score/{game_id}`` routes (cascade, sudoku) until those routers
are deleted in #2644. The legacy rank counts rows, higher-is-better only.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Game
from games.board import Direction
from games.filters import not_abandoned

logger = logging.getLogger(__name__)


def ensure_scored(game: Game) -> None:
    """Raise 400 if `game` hasn't been completed with a final_score yet."""
    if game.final_score is None:
        raise HTTPException(status_code=400, detail="Game has no final score.")


def beats(expr: ColumnElement, value: Any, direction: Direction) -> ColumnElement[bool]:
    """``expr`` is strictly better than ``value`` in ``direction``."""
    return expr > value if direction == "desc" else expr < value


async def compute_rank(
    db: AsyncSession,
    *,
    metric: ColumnElement,
    direction: Direction,
    value: Any,
    completed_at: datetime,
    tiebreak: tuple[ColumnElement, Direction, Any] | None = None,
    filters: Sequence[ColumnElement] = (),
    game_label: str,
) -> int:
    """Exact 1-based rank of a player's best entry on a board.

    Counts the distinct sessions with at least one row (within ``filters``)
    that beats the entry: a better ``metric`` in ``direction``; on a tie, a
    better ``tiebreak`` ``(expr, direction, entry's value)``; on a further tie,
    an earlier ``completed_at``. A session has a row that beats the entry
    exactly when its best row does, so this is the number of players ranked
    above, plus one. There is no "outside the top 10" sentinel.

    The caller passes the same expressions the board is ordered by (including
    any NULL coalescing), so the rank always agrees with the listed order.
    Raises a clean 500 on a DB error.
    """
    last_tie = and_(metric == value, Game.completed_at < completed_at)
    if tiebreak is not None:
        tb_expr, tb_dir, tb_value = tiebreak
        last_tie = and_(
            metric == value,
            or_(
                beats(tb_expr, tb_value, tb_dir),
                and_(tb_expr == tb_value, Game.completed_at < completed_at),
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
        logger.error("%s rank query failed: %s", game_label, exc)
        raise HTTPException(status_code=500, detail="Failed to calculate rank.")
    return int(count or 0) + 1


async def compute_legacy_rank(
    db: AsyncSession,
    *,
    game_type_id: int,
    score_val: int,
    completed_at: datetime,
    game_id: uuid.UUID,
    game_label: str,
    extra_filters: Sequence[ColumnElement] = (),
) -> int:
    """1-based rank of a completed game among same-type scored games (legacy).

    Used only by the per-game ``PATCH /<game>/score/{game_id}`` routes until
    #2644. Counts rows, higher-is-better. Tie-break: equal scores rank older
    ``completed_at`` first (same order as those routers' GET), so a game
    ranks below existing tied entries. ``extra_filters`` scopes the partition
    further (e.g. sudoku's difficulty/variant). Raises a clean 500 on a DB
    error rather than letting it bubble up unhandled.
    """
    try:
        count = (
            await db.execute(
                select(func.count()).where(
                    Game.game_type_id == game_type_id,
                    Game.final_score.is_not(None),
                    not_abandoned(),
                    *extra_filters,
                    or_(
                        Game.final_score > score_val,
                        and_(
                            Game.final_score == score_val,
                            Game.completed_at < completed_at,
                        ),
                    ),
                )
            )
        ).scalar()
    except SQLAlchemyError as exc:
        logger.error("%s rank query failed for game %s: %s", game_label, game_id, exc)
        raise HTTPException(status_code=500, detail="Failed to calculate rank.")
    return int(count or 0) + 1

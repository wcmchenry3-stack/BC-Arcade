"""Shared helpers for `PATCH /<game>/score/{game_id}` set-player-name routers.

cascade and sudoku both: (1) reject a name update on a game that hasn't been
completed with a `final_score` yet, then (2) rank the game among same-type
scored games with an equal-score-ranks-older-first tie-break. Centralising
both here means a future game reusing this pattern (e.g. hearts, yacht)
inherits the guard and the 500-on-DB-error handling instead of re-deriving
them — and risking the ArgumentError this guard was added to fix
(comparing `Game.completed_at` to `None` with `<`; see BC_GAMES-4V).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Sequence

from fastapi import HTTPException
from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Game

logger = logging.getLogger(__name__)


def ensure_scored(game: Game) -> None:
    """Raise 400 if `game` hasn't been completed with a final_score yet."""
    if game.final_score is None:
        raise HTTPException(status_code=400, detail="Game has no final score.")


async def compute_rank(
    db: AsyncSession,
    *,
    game_type_id: int,
    score_val: int,
    completed_at: datetime,
    game_id: uuid.UUID,
    game_label: str,
    extra_filters: Sequence[ColumnElement] = (),
) -> int:
    """1-based rank of a completed game among same-type scored games.

    Tie-break: equal scores rank older `completed_at` first (same order as
    the leaderboard GET), so a game ranks below existing tied entries.
    `extra_filters` scopes the partition further (e.g. sudoku's
    difficulty/variant). Raises a clean 500 on a DB error rather than
    letting it bubble up unhandled.
    """
    try:
        count = (
            await db.execute(
                select(func.count()).where(
                    Game.game_type_id == game_type_id,
                    Game.final_score.is_not(None),
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

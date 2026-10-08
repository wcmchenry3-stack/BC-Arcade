"""Result types of the leaderboard layer (#2618, #2677; split out in #2992).

Plain frozen dataclasses and ``LeaderboardError``; no queries. ``RankReason``
is declared in ``games/board.py`` and re-exported here with the type that
carries it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import HTTPException

from games.board import RankReason

__all__ = [
    "BestRow",
    "BoardEntry",
    "GameRank",
    "LeaderboardError",
    "LimitViolation",
    "RankReason",
    "Standing",
]


class LeaderboardError(HTTPException):
    """An HTTP error raised by the leaderboard layer."""


@dataclass(frozen=True)
class BoardEntry:
    rank: int
    player_name: str
    value: int
    completed_at: datetime
    is_me: bool = False
    """The entry is the requesting player's own (``viewer_session_id``)."""


@dataclass(frozen=True)
class Standing:
    """Where a player stands on one board: the exact rank of their best entry,
    and whether a given game is that entry."""

    rank: int
    is_best: bool


@dataclass(frozen=True)
class GameRank:
    """``GET /games/{id}/rank``: the caller's standing, or why they have none.

    ``rank`` and ``is_best`` are set exactly when ``ranked`` is true;
    ``reason`` exactly when it is false.
    """

    ranked: bool
    rank: int | None = None
    is_best: bool | None = None
    reason: RankReason | None = None


@dataclass(frozen=True)
class BestRow:
    """A session's best row on one board (``queries._session_best``)."""

    game_id: uuid.UUID
    value: Any
    tiebreak: Any
    completed_at: datetime
    player_name: str | None = None


@dataclass(frozen=True)
class LimitViolation:
    game_type: str
    metric: str
    detail: str

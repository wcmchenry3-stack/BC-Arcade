"""Response models for /daily-challenge/* (#2392).

No display strings: the client builds the copy from ``kind`` + ``game_type`` +
``target`` in its own i18n namespace.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class GoalResponse(BaseModel):
    id: str
    game_type: str
    # Per-game vocabulary, e.g. ``won``, ``moves_at_least``, ``highest_tile_at_least``.
    kind: str
    # The number to reach (or stay under) for the kinds that have one; else null.
    target: int | None


class ChallengeResponse(BaseModel):
    # The player's local date, "YYYY-MM-DD".
    challenge_id: str
    template_id: str
    goals: list[GoalResponse]
    # UTC instant of the player's next local midnight — drives the countdown.
    resets_at: datetime


class GoalStatusResponse(GoalResponse):
    completed: bool
    # Best final_score today for ``final_score_at_least`` goals (null until a game
    # of that type is finished); null for every other kind.
    best_score: int | None


class ChallengeStatusResponse(BaseModel):
    challenge_id: str
    template_id: str
    goals: list[GoalStatusResponse]
    resets_at: datetime
    completed_goals: int
    total_goals: int
    # True once every goal is done.
    completed: bool

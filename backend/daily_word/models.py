"""Pydantic metadata model for the Daily Word game (#1187)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DailyWordMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    puzzle_id: str
    language: Literal["en", "hi"] = "en"


class DailyWordResult(BaseModel):
    """Validated result block sent on ``PATCH /games/{id}/complete`` (#2451).

    Distinct from the creation-time metadata model. Unknown keys are ignored so
    a newer app build never fails completion. Daily Word has no numeric score,
    so ``games.final_score`` stays null; the daily challenge reads these fields
    instead (``daily_challenge/definitions.py``): ``is_complete`` for the easy
    "finish the puzzle" goal, ``won`` for the win goal, and ``guesses_used`` for
    the "win in N guesses" goal. An abandoned attempt reports
    ``is_complete=False, won=False`` plus the guesses made so far.
    """

    is_complete: bool
    won: bool
    guesses_used: int = Field(ge=0, le=6)

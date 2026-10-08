"""Blackjack metadata and result models: the run aggregates written at a
session's start and the closing balance sent on completion (#539, #2745)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, model_validator
from pydantic_core import PydanticCustomError

from games.board import MAX_BOARD_VALUE

TableTier = Literal["beginner", "intermediate", "high_roller"]


class BlackjackMetadata(BaseModel):
    """Validated metadata shape for Blackjack game rows (#539, BJ-4).

    Run-aggregate fields (best_run_chips, total_runs, runs_completed,
    current_table) are written by the frontend when starting a new game
    session after a run completes. They represent the player's cumulative
    run history and are used by stats_shape() to populate the scoreboard.
    ``extra="forbid"`` rejects unexpected keys.
    """

    model_config = ConfigDict(extra="forbid")

    best_run_chips: int | None = None
    total_runs: int | None = None
    runs_completed: int | None = None
    current_table: TableTier | None = None


class BlackjackResult(BaseModel):
    """Validated result block sent on ``PATCH /games/{id}/complete`` (#2449).

    Distinct from ``BlackjackMetadata`` (creation-time, ``extra="forbid"``).
    Unknown keys are ignored so a newer app build never fails completion.

    ``final_chips`` is the run's closing balance: the score Stats "Best" ranks
    (the board's metric, #2745). A finished run's ``final_score`` is the same
    number: the app sends both, and when the completion's ``final_score`` is in
    the validation context it must equal ``final_chips``.
    """

    hands_won: int = Field(ge=0)
    # Hands resolved this session — the daily challenge's "play N hands" goal.
    # Optional so builds that predate it still complete (#2453).
    hands_played: int | None = Field(default=None, ge=0)
    starting_chips: int | None = None
    final_chips: int | None = Field(default=None, ge=0, le=MAX_BOARD_VALUE)

    @model_validator(mode="after")
    def _final_score_is_final_chips(self, info: ValidationInfo) -> BlackjackResult:
        context = info.context if isinstance(info.context, dict) else {}
        final_score = context.get("final_score")
        if (
            final_score is not None
            and self.final_chips is not None
            and final_score != self.final_chips
        ):
            raise PydanticCustomError("final_score_mismatch", "final_score must equal final_chips")
        return self

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

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
    """

    hands_won: int = Field(ge=0)
    # Hands resolved this session — the daily challenge's "play N hands" goal.
    # Optional so builds that predate it still complete (#2453).
    hands_played: int | None = Field(default=None, ge=0)
    starting_chips: int | None = None
    final_chips: int | None = None

from typing import Literal

from pydantic import BaseModel, ConfigDict

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

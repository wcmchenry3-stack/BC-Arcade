"""Blackjack metadata and result models: the (empty) metadata a session starts
with and the closing balance sent on completion (#539, #2745)."""

from __future__ import annotations

from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, model_validator
from pydantic_core import PydanticCustomError

from games.board import MAX_BOARD_VALUE

# Run aggregates older builds sent when starting a session (#539). Nothing read
# them, so current builds send none (#3140); they are still accepted and stripped
# (``CreateGameRequest`` removes them before the row is stored) so an older
# client is never rejected and nothing unvalidated is persisted.
RETIRED_METADATA_KEYS = frozenset(
    {"best_run_chips", "total_runs", "runs_completed", "current_table"}
)


class BlackjackMetadata(BaseModel):
    """Validated metadata shape for Blackjack game rows (#539, BJ-4).

    A Blackjack session has no metadata of its own. The four run aggregates
    older builds wrote at session start (``RETIRED_METADATA_KEYS``) are
    accepted and stripped before storage (#3140); ``extra="forbid"`` still rejects any other
    unexpected key.
    """

    model_config = ConfigDict(extra="forbid")

    # Read by ``CreateGameRequest``, which also strips them before the row is stored.
    retired_keys: ClassVar[frozenset[str]] = RETIRED_METADATA_KEYS

    @model_validator(mode="before")
    @classmethod
    def _drop_retired_keys(cls, data: object) -> object:
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if k not in RETIRED_METADATA_KEYS}
        return data


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

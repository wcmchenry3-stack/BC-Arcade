"""Twenty48 metadata and result models (#2623).

Twenty48 records its sessions through the shared ``/games`` pipeline
(``useGameSync("twenty48")``). These models describe what the app sends today,
so registering the module validates rows without rejecting any current build.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Twenty48Metadata(BaseModel):
    """Creation-time metadata for a Twenty48 game row.

    The app sends none: the opening board goes in the ``game_started`` event,
    not in metadata. ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")


class Twenty48Result(BaseModel):
    """Result block sent on ``PATCH /games/{id}/complete`` (#2449).

    Mirrors ``progressResult`` in ``Twenty48Screen.tsx``: the finished game
    (the 2048 win, or a game over without it) adds ``outcome``, and the
    abandon snapshot omits it. The daily challenge reads ``final_score`` and
    ``highest_tile`` from here: an abandon leaves the ``final_score`` column
    null, so the result is its only score.

    Every field is optional and unknown keys are ignored, so no build the
    stores already have can fail completion and dead-letter the game.
    ``outcome`` repeats the row's outcome: ``win`` / ``loss`` since #2631, and
    ``completed`` / ``kept_playing`` from older builds; it is a plain string
    so none of them is rejected. A ``duration_ms`` of zero or less (a skewed clock) is
    stored as ``null``, "unknown", as the sync worker sends it on the row
    itself (``resolveDurationMs``): rejecting it would dead-letter the game.
    """

    final_score: int | None = Field(default=None, ge=0)
    highest_tile: int | None = Field(default=None, ge=0)
    move_count: int | None = Field(default=None, ge=0)
    duration_ms: int | None = None
    outcome: str | None = Field(default=None, max_length=32)

    @field_validator("duration_ms")
    @classmethod
    def _no_duration_is_unknown(cls, v: int | None) -> int | None:
        return None if v is not None and v <= 0 else v

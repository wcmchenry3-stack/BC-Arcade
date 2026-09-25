"""Star Swarm metadata and result models (#2623).

Star Swarm records a session row per run through the shared ``/games``
pipeline (``useGameSync("starswarm")``, #2516). These models describe what the
app sends today, so registering the module validates rows without rejecting
any current build. The named leaderboard entry is still written by
``POST /starswarm/score`` (``router.py``), which does not use them.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class StarSwarmMetadata(BaseModel):
    """Creation-time metadata for a Star Swarm game row.

    The app sends the run's ``difficulty_tier`` (a ``DifficultyTier`` name such
    as ``"LieutenantJG"``). It is a plain string, as on ``POST /starswarm/score``,
    so a tier added to the app never fails creation. ``extra="forbid"``
    rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    difficulty_tier: str | None = Field(default=None, max_length=32)


class StarSwarmResult(BaseModel):
    """Result block sent on ``PATCH /games/{id}/complete`` (#2449).

    Mirrors ``handleGameOver`` in ``StarSwarmScreen.tsx``:
    ``{outcome, wave_reached, difficulty_tier}``. ``difficulty_tier`` is
    declared so it survives validation into ``games.metadata``, where the board
    partitions on it. Every field is optional and unknown keys are ignored, so
    no current build can fail completion and dead-letter the run.
    """

    outcome: str | None = Field(default=None, max_length=32)
    wave_reached: int | None = Field(default=None, ge=0)
    difficulty_tier: str | None = Field(default=None, max_length=32)

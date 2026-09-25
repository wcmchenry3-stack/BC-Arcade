"""Star Swarm metadata and result models (#2623).

Star Swarm records a session row per run through the shared ``/games``
pipeline (``useGameSync("starswarm")``, #2516). These models describe what the
app sends today, so registering the module validates rows without rejecting
any current build. The named leaderboard entry is still written by
``POST /starswarm/score`` (``router.py``), which does not use them.
"""

from __future__ import annotations

from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict, Field

DifficultyTier = Literal[
    "Ensign",
    "LieutenantJG",
    "Lieutenant",
    "LieutenantCommander",
    "Commander",
    "Captain",
    "RearAdmiral",
    "ViceAdmiral",
    "Admiral",
    "FleetAdmiral",
]
"""Every tier the app can send, easiest to hardest.

Mirrors ``DIFFICULTY_TIERS`` in ``frontend/src/game/starswarm/engine.ts`` (the
``DifficultyTier`` union in ``types.ts``); ``tests/test_starswarm_module.py``
parses both and fails on drift. Each tier is its own public board, so a value
outside this list is rejected rather than opening a new one. A tier added to
the app must be added here, in the same release, or its runs fail validation.
"""

DIFFICULTY_TIERS: tuple[str, ...] = get_args(DifficultyTier)

DEFAULT_DIFFICULTY_TIER: DifficultyTier = "LieutenantJG"
"""The tier of a row that has none: the legacy ``POST /starswarm/score`` default
and the engine's default (``initStarSwarm``, ``GameCanvas``)."""


class StarSwarmMetadata(BaseModel):
    """Creation-time metadata for a Star Swarm game row.

    The app sends the run's ``difficulty_tier``, one of ``DIFFICULTY_TIERS``.
    It may be omitted (the row then counts as ``DEFAULT_DIFFICULTY_TIER``);
    any other value is rejected. ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    difficulty_tier: DifficultyTier | None = None


class StarSwarmResult(BaseModel):
    """Result block sent on ``PATCH /games/{id}/complete`` (#2449).

    Mirrors ``handleGameOver`` in ``StarSwarmScreen.tsx``:
    ``{outcome, wave_reached, difficulty_tier}``. ``difficulty_tier`` is
    declared so it survives validation into ``games.metadata``, where the board
    partitions on it; like the metadata's, it must be one of
    ``DIFFICULTY_TIERS``. Every field is optional and unknown keys are ignored,
    so no current build can fail completion and dead-letter the run.
    """

    outcome: str | None = Field(default=None, max_length=32)
    wave_reached: int | None = Field(default=None, ge=0)
    difficulty_tier: DifficultyTier | None = None

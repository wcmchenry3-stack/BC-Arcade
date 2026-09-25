"""Star Swarm metadata and result models (#2623).

Star Swarm records a session row per run through the shared ``/games``
pipeline (``useGameSync("starswarm")``, #2516). Since #2626 the app completes
that row with the run's ``final_score``, and the row is the leaderboard entry
on its ``difficulty_tier``'s board, under the player's display name. These
models describe what the app sends, so no current build is rejected. Installed
builds from before #2626 send a score-less session row and still post the
named entry to the legacy ``POST /starswarm/score`` (``router.py``, until
#2644), which writes its row directly and does not use these models.
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
parses both and fails on drift. Each tier is its own public board
(``partition_values``), so a run on a tier outside this list is stored but
never ranks and no board can be requested for it. A tier added to the app must
be added here, in the same release, or its runs stay off the leaderboard.
"""

DIFFICULTY_TIERS: tuple[str, ...] = get_args(DifficultyTier)

DEFAULT_DIFFICULTY_TIER: DifficultyTier = "LieutenantJG"
"""The tier of a row that has none: the legacy ``POST /starswarm/score`` default
and the engine's default (``initStarSwarm``, ``GameCanvas``)."""


class StarSwarmMetadata(BaseModel):
    """Creation-time metadata for a Star Swarm game row.

    The app sends the run's ``difficulty_tier``, one of ``DIFFICULTY_TIERS``.
    It may be omitted (the row then counts as ``DEFAULT_DIFFICULTY_TIER``).
    Any other string is accepted, never ranked: rejecting it would dead-letter
    the run in the app. ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    difficulty_tier: str | None = Field(default=None, max_length=32)


class StarSwarmResult(BaseModel):
    """Result block sent on ``PATCH /games/{id}/complete`` (#2449).

    Mirrors ``handleGameOver`` in ``StarSwarmScreen.tsx``:
    ``{outcome, wave_reached, difficulty_tier}``. ``difficulty_tier`` is
    declared so it survives validation into ``games.metadata``, where the board
    partitions on it; like the metadata's, only a value in
    ``DIFFICULTY_TIERS`` ranks. Every field is optional and unknown keys are
    ignored, so no current build can fail completion and dead-letter the run.
    """

    outcome: str | None = Field(default=None, max_length=32)
    wave_reached: int | None = Field(default=None, ge=0)
    difficulty_tier: str | None = Field(default=None, max_length=32)

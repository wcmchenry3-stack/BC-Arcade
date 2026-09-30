"""Star Swarm metadata and result models (#2623).

Star Swarm records a session row per run through the shared ``/games``
pipeline (``useGameSync("starswarm")``, #2516). Since #2626 the app completes
that row with the run's ``final_score``, and the row is the leaderboard entry
on its ``difficulty_tier``'s board, under the player's display name. These
models describe what the app sends, so no current build is rejected. Builds
from before #2626 send a score-less session row, which never ranks.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any, Literal, get_args

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    ValidatorFunctionWrapHandler,
    field_validator,
)

logger = logging.getLogger(__name__)

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
"""The tier of a row that has none: the engine's default (``initStarSwarm``,
``GameCanvas``)."""


class StarSwarmMetadata(BaseModel):
    """Creation-time metadata for a Star Swarm game row.

    The app sends the run's ``difficulty_tier``, one of ``DIFFICULTY_TIERS``.
    It may be omitted (the row then counts as ``DEFAULT_DIFFICULTY_TIER``).
    Any other string is accepted, never ranked: rejecting it would dead-letter
    the run in the app. ``extra="forbid"`` rejects unknown keys.
    """

    model_config = ConfigDict(extra="forbid")
    difficulty_tier: str | None = Field(default=None, max_length=32)


# --- per-wave score breakdown (#2837) ---------------------------------------
#
# Built by ``summarizeScoreLedger`` in ``frontend/src/game/starswarm/scoreLedger.ts``.
# The app caps it at 4 KiB of JSON (20 detailed waves, older ones folded into
# ``earlier``); the bounds here are looser, so the app's own cap is what bites.

MAX_BREAKDOWN_WAVES = 64
MAX_BREAKDOWN_SOURCES = 48

SourceKey = Annotated[str, StringConstraints(min_length=1, max_length=32)]
"""A point source: an enemy tier id (``Grunt``, ``Elite``, ``Boss``,
``Carrier``, or whatever the engine calls a tier next), optionally with a
``:dive`` / ``:rout`` / ``:bomb`` / ``:ram`` modifier, or ``clear`` for the
wave-clear bonus. An open set: an unknown source is kept, not rejected."""

ScorePoints = Annotated[dict[SourceKey, int], Field(max_length=MAX_BREAKDOWN_SOURCES)]


class StarSwarmWaveScore(BaseModel):
    """One wave that scored: ``end - start == total == sum(pts)``."""

    wave: int = Field(ge=0)
    start: int
    end: int
    total: int
    pts: ScorePoints


class StarSwarmEarlierScore(BaseModel):
    """Waves ``first``..``last`` folded together to keep the block bounded; they start at 0."""

    first: int = Field(ge=0)
    last: int = Field(ge=0)
    total: int
    pts: ScorePoints


class StarSwarmScoreBreakdown(BaseModel):
    """Where a run's score came from, by wave and source.

    ``earlier.total`` + every ``waves[].total`` + ``unattributed`` equals the
    run's ``final_score``. Waves that scored nothing are absent. Unknown keys
    are ignored so a newer build's additions don't fail the block.
    """

    v: int = 1
    earlier: StarSwarmEarlierScore | None = None
    waves: list[StarSwarmWaveScore] = Field(default_factory=list, max_length=MAX_BREAKDOWN_WAVES)
    unattributed: int | None = None


class StarSwarmResult(BaseModel):
    """Result block sent on ``PATCH /games/{id}/complete`` (#2449).

    Mirrors ``handleGameOver`` in ``StarSwarmScreen.tsx``:
    ``{outcome, wave_reached, difficulty_tier, score_breakdown}``
    (``score_breakdown`` since #2837). ``difficulty_tier`` is
    declared so it survives validation into ``games.metadata``, where the board
    partitions on it; like the metadata's, only a value in
    ``DIFFICULTY_TIERS`` ranks. Every field is optional and unknown keys are
    ignored, so no current build can fail completion and dead-letter the run.
    """

    outcome: str | None = Field(default=None, max_length=32)
    wave_reached: int | None = Field(default=None, ge=0)
    difficulty_tier: str | None = Field(default=None, max_length=32)
    # #2837: the run's per-wave score breakdown. Builds before it send none.
    score_breakdown: StarSwarmScoreBreakdown | None = None

    @field_validator("score_breakdown", mode="wrap")
    @classmethod
    def _drop_a_malformed_breakdown(
        cls, value: Any, handler: ValidatorFunctionWrapHandler
    ) -> StarSwarmScoreBreakdown | None:
        """A breakdown that doesn't validate is dropped, never the run (#2837).

        The score and tier still complete and rank; losing the player's
        breakdown beats dead-lettering the whole run.
        """
        try:
            return handler(value)
        except ValidationError as e:
            logger.warning(
                "starswarm: dropped a malformed score_breakdown (%s)",
                ", ".join(".".join(str(p) for p in err["loc"]) for err in e.errors()[:5]),
            )
            return None

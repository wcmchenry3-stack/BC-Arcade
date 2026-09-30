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

import sentry_sdk
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StringConstraints,
    ValidationError,
    ValidationInfo,
    ValidatorFunctionWrapHandler,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError

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
"""A point source: an enemy tier id (``Grunt``, ``Elite``, ``Guardian`` —
``Boss`` from builds before #2843 — ``Carrier``, or whatever the engine
calls a tier next), optionally with a
``:dive`` / ``:rout`` / ``:bomb`` / ``:ram`` modifier, or ``clear`` for the
wave-clear bonus. An open set: an unknown source is kept, not rejected."""

Points = Annotated[StrictInt, Field(ge=0)]
ScorePoints = Annotated[dict[SourceKey, Points], Field(max_length=MAX_BREAKDOWN_SOURCES)]

# Error types the invariant checks raise; the drop report's reason names them.
INCONSISTENT = "breakdown_inconsistent"
UNRECONCILED = "breakdown_unreconciled"


def _inconsistent(what: str) -> PydanticCustomError:
    return PydanticCustomError(
        INCONSISTENT, "score_breakdown is inconsistent: {what}", {"what": what}
    )


class StarSwarmWaveScore(BaseModel):
    """One wave that scored: ``end - start == total == sum(pts)``.

    ``start``/``end`` are the ledger's running total, which leaves out any
    ``unattributed`` points, so they can trail the live score by that much.
    """

    wave: StrictInt = Field(ge=0)
    start: Points
    end: Points
    total: Points
    pts: ScorePoints


class StarSwarmEarlierScore(BaseModel):
    """Waves ``first``..``last`` folded together to keep the block bounded; they start at 0."""

    first: StrictInt = Field(ge=0)
    last: StrictInt = Field(ge=0)
    total: Points
    pts: ScorePoints


class StarSwarmScoreBreakdown(BaseModel):
    """Where a run's score came from, by wave and source.

    ``earlier.total`` + every ``waves[].total`` + ``unattributed`` equals the
    run's ``final_score``. Waves that scored nothing are absent. Unknown keys
    are ignored so a newer build's additions don't fail the block.
    """

    v: StrictInt = 1
    earlier: StarSwarmEarlierScore | None = None
    waves: list[StarSwarmWaveScore] = Field(default_factory=list, max_length=MAX_BREAKDOWN_WAVES)
    unattributed: StrictInt | None = None

    @model_validator(mode="after")
    def _check_invariants(self, info: ValidationInfo) -> StarSwarmScoreBreakdown:
        """The block adds up: per wave, across waves, and (when the completion's
        ``final_score`` is in the validation context) to the run's score."""
        running = 0
        if self.earlier is not None:
            if self.earlier.first > self.earlier.last:
                raise _inconsistent("earlier.first > earlier.last")
            if self.earlier.total != sum(self.earlier.pts.values()):
                raise _inconsistent("earlier.total != sum(earlier.pts)")
            running = self.earlier.total
        prev_wave: int | None = None
        for w in self.waves:
            if prev_wave is not None and w.wave <= prev_wave:
                raise _inconsistent("waves not strictly ascending")
            if self.earlier is not None and w.wave <= self.earlier.last:
                raise _inconsistent("wave inside earlier")
            if w.end - w.start != w.total or w.total != sum(w.pts.values()):
                raise _inconsistent("wave end - start != total != sum(pts)")
            if w.start != running:
                raise _inconsistent("wave start != previous end")
            running = w.end
            prev_wave = w.wave
        context = info.context if isinstance(info.context, dict) else {}
        final_score = context.get("final_score")
        if final_score is not None and running + (self.unattributed or 0) != final_score:
            raise PydanticCustomError(
                UNRECONCILED, "score_breakdown does not add up to final_score"
            )
        return self


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
            breakdown = handler(value)
        except ValidationError as e:
            errors = e.errors()[:5]
            fields = [
                ".".join(["score_breakdown", *(str(p) for p in err["loc"])]) for err in errors
            ]
            types = sorted({err["type"] for err in errors})
            reason = next((t for t in (UNRECONCILED, INCONSISTENT) if t in types), "invalid")
            logger.warning(
                "starswarm: dropped a malformed score_breakdown (%s)",
                ", ".join(f"{f} [{err['type']}]" for f, err in zip(fields, errors, strict=True)),
            )
            _report_dropped_breakdown(reason, fields=fields, error_types=types)
            return None
        if isinstance(breakdown, StarSwarmScoreBreakdown) and breakdown.unattributed:
            # Kept, but some points bypassed the ledger: a scoring path that
            # doesn't go through scoreLedger.ts (drift detector).
            _report_dropped_breakdown("unattributed", fields=["score_breakdown.unattributed"])
        return breakdown


def _report_dropped_breakdown(
    reason: str, *, fields: list[str], error_types: list[str] | None = None
) -> None:
    """Send a dropped (or drifting) Star Swarm breakdown to Sentry (#2837).

    Field paths and error types only, never values. One issue per ``reason``.
    """
    sentry_sdk.capture_message(
        f"starswarm result: score_breakdown {reason}",
        level="warning",
        fingerprint=["starswarm-result-breakdown-dropped", reason],
        tags={"game_type": "starswarm", "reason": reason},
        extras={"fields": ", ".join(fields), "error_types": error_types or []},
    )

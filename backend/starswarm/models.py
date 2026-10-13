"""Star Swarm metadata and result models (#2623).

Star Swarm records a session row per run through the shared ``/games``
pipeline (``useGameSync("starswarm")``, #2516). Since #2626 the app completes
that row with the run's ``final_score``, and the row is the leaderboard entry
on its ``difficulty_tier``'s board, under the player's display name. These
models describe what the app sends, so no current build is rejected. Builds
from before #2626 send a score-less session row, which never ranks.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any, Literal, get_args

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StringConstraints,
    ValidationError,
    ValidationInfo,
    ValidatorFunctionWrapHandler,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError

from observability.report import report_event

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

Mirrors ``DIFFICULTY_TIERS`` in ``frontend/src/game/starswarm/engine/tuning.ts`` (the
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
    report_event(
        f"starswarm result: score_breakdown {reason}",
        level="warning",
        fingerprint=["starswarm-result-breakdown-dropped", reason],
        tags={"game_type": "starswarm", "reason": reason},
        extras={"fields": ", ".join(fields), "error_types": error_types or []},
    )


# --- wave_completed event payload (#3250, epic #3244) ------------------------
#
# The v1 wire shape built by the app's ``toWirePayload`` (frontend
# ``game/starswarm/engine``). Zero counters and then-empty objects are omitted
# on the wire, so a missing key means 0 and every counter field is optional.
# The registries below mirror the app's ``engine/registries.ts``; a key outside
# one is tolerated (a newer build may add a power-up) and kept, but logged.
# Change the shape in a breaking way -> bump ``v`` (``WAVE_STATS_VERSION``).

WAVE_COMPLETED = "wave_completed"
WAVE_STATS_VERSION = 1
MAX_WAVE_STATS_BYTES = 4096
MAX_COUNTER = 10_000_000
MAX_POINTS = 2_000_000_000

PowerUpType = Literal["lightning", "shield", "buddy", "bomb", "salvage", "hull"]
PowerUpSource = Literal["kill", "rock", "carrier", "dev"]
EnemyTier = Literal["Grunt", "Elite", "Guardian", "Carrier"]
AsteroidKind = Literal["large", "small"]
RockBreaker = Literal["player", "enemy", "bomb", "contact"]
HitCause = Literal["bullet", "rock", "beam", "ram"]
BuddyHitCause = Literal["bullet", "beam", "rock"]
HitResult = Literal["life", "plating", "shield"]
KillMethod = Literal["shot", "dive", "rout", "bomb", "ram", "rock", "buddy"]
CarrierStage = Literal["protected", "exposed", "finalStand"]

POWERUP_TYPES: tuple[str, ...] = get_args(PowerUpType)
POWERUP_SOURCES: tuple[str, ...] = get_args(PowerUpSource)
ENEMY_TIERS: tuple[str, ...] = get_args(EnemyTier)
ASTEROID_KINDS: tuple[str, ...] = get_args(AsteroidKind)
ROCK_BREAKERS: tuple[str, ...] = get_args(RockBreaker)
HIT_CAUSES: tuple[str, ...] = get_args(HitCause)
BUDDY_HIT_CAUSES: tuple[str, ...] = get_args(BuddyHitCause)
HIT_RESULTS: tuple[str, ...] = get_args(HitResult)
KILL_METHODS: tuple[str, ...] = get_args(KillMethod)
CARRIER_STAGES: tuple[str, ...] = get_args(CarrierStage)

Count = Annotated[StrictInt, Field(ge=0, le=MAX_COUNTER)]
Score = Annotated[StrictInt, Field(ge=0, le=MAX_POINTS)]
TableKey = Annotated[str, StringConstraints(min_length=1, max_length=32)]
Counts = dict[TableKey, Count]
NestedCounts = dict[TableKey, Counts]

# Where the wave's registered keys live: dotted path -> (outer registry, inner
# registry or None). Used to log (never reject) a key outside its registry.
_KEYED_TABLES: dict[str, tuple[tuple[str, ...], tuple[str, ...] | None]] = {
    "powerUps.spawned": (POWERUP_TYPES, POWERUP_SOURCES),
    "powerUps.collected": (POWERUP_TYPES, None),
    "powerUps.missed": (POWERUP_TYPES, None),
    "powerUps.leftover": (POWERUP_TYPES, None),
    "powerUps.expired": (POWERUP_TYPES, None),
    "powerUps.activeMs": (POWERUP_TYPES, None),
    "rocks.spawned": (ASTEROID_KINDS, None),
    "rocks.broken": (ROCK_BREAKERS, None),
    "rocks.enemiesStruck": (ENEMY_TIERS, None),
    "rocks.enemiesDestroyed": (ENEMY_TIERS, None),
    "rocks.playerHits": (HIT_RESULTS, None),
    "rocks.dodge": (ENEMY_TIERS, None),
    "buddy.hits": (BUDDY_HIT_CAUSES, None),
    "buddy.destroyed": (BUDDY_HIT_CAUSES, None),
    "buddy.kills": (ENEMY_TIERS, None),
    "carrier.stageReachedMs": (CARRIER_STAGES, None),
    "combat.spawned": (ENEMY_TIERS, None),
    "combat.kills": (ENEMY_TIERS, KILL_METHODS),
    "damage.hits": (HIT_CAUSES, HIT_RESULTS),
}


# Field names below are the app's camelCase wire names.


class _WaveBlock(BaseModel):
    """A section of the payload. Unknown keys are dropped (a newer build's
    additions); ``model_dump(exclude_unset=True)`` keeps the sparse wire form."""

    model_config = ConfigDict(extra="ignore")


class WaveLoadout(_WaveBlock):
    lives: Count = 0
    guns: Count = 0
    hull: Count = 0


class WavePacing(_WaveBlock):
    durationMs: Count = 0
    start: WaveLoadout = Field(default_factory=WaveLoadout)
    end: WaveLoadout = Field(default_factory=WaveLoadout)
    bonusLives: Count = 0


class WaveScore(_WaveBlock):
    total: Score
    runningTotal: Score = 0
    pts: dict[SourceKey, Score] = Field(default_factory=dict, max_length=MAX_BREAKDOWN_SOURCES)


class WavePowerUps(_WaveBlock):
    spawned: NestedCounts = Field(default_factory=dict)
    collected: Counts = Field(default_factory=dict)
    missed: Counts = Field(default_factory=dict)
    leftover: Counts = Field(default_factory=dict)
    expired: Counts = Field(default_factory=dict)
    activeMs: Counts = Field(default_factory=dict)
    shieldAbsorbed: Count = 0


class WaveDodge(_WaveBlock):
    rolls: Count = 0
    dodged: Count = 0
    pathRolls: Count = 0
    pathDodged: Count = 0
    flak: Count = 0


class WaveRocks(_WaveBlock):
    spawned: Counts = Field(default_factory=dict)
    devSpawned: Count = 0
    broken: Counts = Field(default_factory=dict)
    enemiesStruck: Counts = Field(default_factory=dict)
    enemiesDestroyed: Counts = Field(default_factory=dict)
    playerHits: Counts = Field(default_factory=dict)
    buddyHits: Count = 0
    buddyDestroyed: Count = 0
    dodge: dict[TableKey, WaveDodge] = Field(default_factory=dict)


class WaveBuddy(_WaveBlock):
    launched: Count = 0
    hits: Counts = Field(default_factory=dict)
    destroyed: Counts = Field(default_factory=dict)
    shotsDrawn: Count = 0
    kills: Counts = Field(default_factory=dict)


class WaveCarrier(_WaveBlock):
    gruntsLaunched: Count = 0
    armorDeflects: Count = 0
    beamsFired: Count = 0
    beamHits: Count = 0
    attackRuns: Count = 0
    stageReachedMs: Counts = Field(default_factory=dict)


class WaveRout(_WaveBlock):
    triggered: StrictBool
    atMs: Count | None = None
    grunts: Count = 0
    caught: Count = 0
    escaped: Count = 0


class WaveCombat(_WaveBlock):
    spawned: Counts = Field(default_factory=dict)
    kills: NestedCounts = Field(default_factory=dict)
    shotsFired: Count = 0
    shotsHit: Count = 0
    shotsOnRocks: Count = 0


class WaveDamage(_WaveBlock):
    hits: NestedCounts = Field(default_factory=dict)
    # Required: null on a wave the player cleared.
    deathCause: HitCause | None


class StarSwarmWaveStats(_WaveBlock):
    """One ``wave_completed`` event's ``data`` (wire form, schema ``v`` 1).

    Required: ``v`` (== 1), ``wave`` (>= 1), ``difficulty``, ``outcome``,
    ``dev``, ``pacing``, ``score``, ``rout`` and ``damage.deathCause``. The
    other sections default to empty. Counters are non-negative ints. Unknown
    top-level and section keys are dropped; unknown keys inside a keyed table
    are kept (logged by ``validate_wave_completed``).
    """

    v: Literal[1]
    wave: StrictInt = Field(ge=1, le=MAX_COUNTER)
    difficulty: str = Field(min_length=1, max_length=32)
    outcome: Literal["cleared", "died"]
    dev: StrictBool
    pacing: WavePacing
    score: WaveScore
    powerUps: WavePowerUps = Field(default_factory=WavePowerUps)
    rocks: WaveRocks = Field(default_factory=WaveRocks)
    buddy: WaveBuddy = Field(default_factory=WaveBuddy)
    carrier: WaveCarrier = Field(default_factory=WaveCarrier)
    rout: WaveRout
    combat: WaveCombat = Field(default_factory=WaveCombat)
    damage: WaveDamage


def _dig(data: dict[str, Any], path: str) -> Any:
    node: Any = data
    for part in path.split("."):
        if not isinstance(node, dict):
            return None
        node = node.get(part)
    return node


def _unknown_table_keys(stats: dict[str, Any]) -> list[str]:
    """``path.key`` of every key outside its registry (names only, never values)."""
    found: list[str] = []
    for path, (outer, inner) in _KEYED_TABLES.items():
        table = _dig(stats, path)
        if not isinstance(table, dict):
            continue
        for key, value in table.items():
            if key not in outer:
                found.append(f"{path}.{key}")
            if inner is not None and isinstance(value, dict):
                found.extend(f"{path}.{key}.{k}" for k in value if k not in inner)
    if stats.get("difficulty") not in DIFFICULTY_TIERS:
        found.append("difficulty")
    return found


def _consistency_flags(stats: dict[str, Any]) -> list[str]:
    """Cheap cross-field checks. A failure flags the event, never drops it."""
    flags: list[str] = []
    score = stats["score"]
    if score["total"] != sum(score.get("pts", {}).values()):
        flags.append("score_mismatch")
    power_ups = stats.get("powerUps", {})
    spawned = power_ups.get("spawned", {})
    for kind, collected in power_ups.get("collected", {}).items():
        if sum(spawned.get(kind, {}).values()) < collected:
            flags.append("powerup_collected_exceeds_spawned")
            break
    return flags


def validate_wave_completed(data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``wave_completed`` ``data`` to store, or ``None`` to drop the event.

    Dropped (logged + reported to Sentry, field paths and error types only):
    more than ``MAX_WAVE_STATS_BYTES`` of compact JSON, or any schema
    violation (wrong type, negative or oversized counter, missing/wrong ``v``,
    wave < 1, bad outcome...). Kept: unknown keys inside keyed tables (logged)
    and an inconsistent total (``score.total != sum(score.pts)``, or a power-up
    collected more often than it spawned), which adds ``_flags`` (a list of
    flag names) at the top level; readers that ignore unknown keys are
    unaffected. The stored form is the sparse wire form, minus unknown
    top-level/section keys.
    """
    try:
        size = len(json.dumps(data, separators=(",", ":")).encode())
    except (TypeError, ValueError):
        size = MAX_WAVE_STATS_BYTES + 1
    if size > MAX_WAVE_STATS_BYTES:
        logger.warning("starswarm: dropped an oversize wave_completed (%d bytes)", size)
        _report_dropped_wave("oversize", fields=[], error_types=["oversize"])
        return None
    try:
        stats = StarSwarmWaveStats.model_validate(data)
    except ValidationError as e:
        errors = e.errors()[:5]
        fields = [".".join(str(p) for p in err["loc"]) for err in errors]
        types = sorted({err["type"] for err in errors})
        logger.warning(
            "starswarm: dropped an invalid wave_completed (%s)",
            ", ".join(f"{f} [{err['type']}]" for f, err in zip(fields, errors, strict=True)),
        )
        _report_dropped_wave("invalid", fields=fields, error_types=types)
        return None
    stored = stats.model_dump(mode="json", exclude_unset=True)
    unknown = _unknown_table_keys(stored)
    if unknown:
        logger.warning("starswarm: wave_completed has unregistered keys: %s", ", ".join(unknown))
    flags = _consistency_flags(stored)
    if flags:
        logger.warning("starswarm: wave_completed is inconsistent: %s", ", ".join(flags))
        stored["_flags"] = flags
    return stored


def _report_dropped_wave(reason: str, *, fields: list[str], error_types: list[str]) -> None:
    """Send a dropped ``wave_completed`` to Sentry. Paths and types, never values."""
    report_event(
        f"starswarm event: wave_completed {reason}",
        level="warning",
        fingerprint=["starswarm-wave-completed-dropped", reason],
        tags={"game_type": "starswarm", "reason": reason},
        extras={"fields": ", ".join(fields), "error_types": error_types},
    )

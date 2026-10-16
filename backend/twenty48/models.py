"""Twenty48 metadata and result models (#2623).

Twenty48 records its sessions through the shared ``/games`` pipeline
(``useGameSync("twenty48")``). These models describe what the app sends today,
so registering the module validates rows without rejecting any current build.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    ValidationError,
    field_validator,
)

from int_bounds import INT32_MAX, NonNegInt32
from observability.report import report_event

logger = logging.getLogger(__name__)


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
    ``completed`` / ``kept_playing`` from older builds (set to ``win`` with
    the row when ``games.legacy_outcomes`` finds a certain win, #2703); it is a
    plain string so none of them is rejected. A ``duration_ms`` of zero or less (a skewed clock) is
    stored as ``null``, "unknown", as the sync worker sends it on the row
    itself (``resolveDurationMs``): rejecting it would dead-letter the game.
    """

    final_score: NonNegInt32 | None = None
    highest_tile: int | None = Field(default=None, ge=0)
    move_count: int | None = Field(default=None, ge=0)
    duration_ms: NonNegInt32 | None = None
    outcome: str | None = Field(default=None, max_length=32)

    @field_validator("duration_ms", mode="before")
    @classmethod
    def _no_duration_is_unknown(cls, v: Any) -> Any:
        # Before the bound, so a clock jump far below -2**31 is "unknown" too, not a 422.
        if isinstance(v, int) and not isinstance(v, bool) and v <= 0:
            return None
        return v


# --- moves event payload (#3286, epic #3273) ---------------------------------
#
# The app records 2048 as one ``moves`` event per chunk of up to 25 swipes
# (``frontend/src/game/twenty48/replay.ts``), through the shared GameRecorder,
# so a stored game rebuilds from the opening board in ``game_started`` plus its
# ``moves`` rows in ``event_index`` order. Builds from before #3286 send one
# ``move`` event per swipe instead; that type stays valid and is stored as sent
# (it has no validator here), so no older build is rejected.
#
# One move is the 5-tuple ``[direction, index, value, score_delta, score_after]``:
# ``direction`` 0..3 = up, down, left, right; ``index``/``value`` are the tile
# the move spawned (cell ``row * 4 + col``, 2 or 4); the scores are the points
# the move gained and the running total. Change the shape in a breaking way ->
# bump ``v`` (``MOVES_VERSION``) and the app's registry entry together.

MOVES = "moves"
MOVES_VERSION = 1
MAX_MOVES_BYTES = 1024
"""Compact-JSON bytes one ``moves`` event may take. The app's registry holds the
same figure (``maxBytes``): 25 worst-case moves plus the envelope are ~700 B."""
MAX_MOVES_PER_EVENT = 32
"""The app sends 25; the headroom is for a retuned chunk size on a newer build."""
BOARD_CELLS = 16


def _spawn_is_2_or_4(v: int) -> int:
    """The engine spawns a 2 (90%) or a 4; nothing in between."""
    if v not in (2, 4):
        raise ValueError("a spawned tile is 2 or 4")
    return v


Direction = Annotated[StrictInt, Field(ge=0, le=3)]
CellIndex = Annotated[StrictInt, Field(ge=0, lt=BOARD_CELLS)]
SpawnValue = Annotated[StrictInt, Field(ge=2, le=4), AfterValidator(_spawn_is_2_or_4)]
Points = Annotated[StrictInt, Field(ge=0, le=INT32_MAX)]


class Twenty48Moves(BaseModel):
    """One ``moves`` event's ``data`` (wire form, schema ``v`` 1).

    The recorder's envelope (``v``, ``unit``, ``t_ms``) plus ``m``; ``part`` /
    ``parts`` appear only when the app had to split an oversized event.
    ``extra="forbid"``: an unknown key means a newer schema, which bumps ``v``.
    """

    model_config = ConfigDict(extra="forbid")

    # StrictInt with equal bounds, not Literal[1]: a Literal accepts True as 1
    v: StrictInt = Field(ge=MOVES_VERSION, le=MOVES_VERSION)
    unit: StrictInt = Field(ge=0, le=INT32_MAX)
    t_ms: StrictInt = Field(ge=0, le=INT32_MAX)
    m: list[tuple[Direction, CellIndex, SpawnValue, Points, Points]] = Field(
        min_length=1, max_length=MAX_MOVES_PER_EVENT
    )
    part: StrictInt | None = Field(default=None, ge=0, le=MAX_MOVES_PER_EVENT)
    parts: StrictInt | None = Field(default=None, ge=1, le=MAX_MOVES_PER_EVENT)


def validate_moves(data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``moves`` ``data`` to store, or ``None`` to drop the event.

    Dropped (logged, reported to Sentry by reason only, never values): more
    than ``MAX_MOVES_BYTES`` of compact JSON, or any schema violation (wrong
    type, a direction outside 0..3, a cell outside the board, a spawn that is
    not 2 or 4, a negative score, an unknown key, a wrong ``v``). Otherwise
    the payload is stored exactly as sent.
    """
    try:
        size = len(json.dumps(data, separators=(",", ":")).encode())
    except (TypeError, ValueError):
        size = MAX_MOVES_BYTES + 1
    if size > MAX_MOVES_BYTES:
        logger.warning("twenty48: dropped an oversize moves event (%d bytes)", size)
        _report_dropped("oversize")
        return None
    try:
        Twenty48Moves.model_validate(data)
    except ValidationError as e:
        types = sorted({err["type"] for err in e.errors()})[:10]
        logger.warning("twenty48: dropped an invalid moves event [%s]", ", ".join(types))
        _report_dropped("invalid", error_types=types)
        return None
    return data


def _report_dropped(reason: str, *, error_types: list[str] | None = None) -> None:
    """Send a dropped ``moves`` event to Sentry: the reason and error types only."""
    report_event(
        f"twenty48 event: moves {reason}",
        level="warning",
        fingerprint=["twenty48-moves-dropped", reason],
        tags={"game_type": "twenty48", "reason": reason},
        extras={"error_types": error_types or []},
    )

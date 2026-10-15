"""Yacht ``turn_completed`` event: the game module's ``validate_event`` (#3282, epic #3273).

The app (``frontend/src/game/yacht/replay.ts``) records every turn of both
players as one ``turn_completed`` event, through the shared GameRecorder: the
recorder's envelope (``v``, ``unit``, ``t_ms``, and ``actor`` in a vs game) plus
the turn. Builds from before #3282 send the human's per-roll ``roll`` and
per-score ``score`` events instead; those types stay seeded and are stored as
sent (no validator), so no older build is rejected.

The turn (compact keys; booleans left out when false)::

    r      round, 1..13
    rolls  1..3 x [dice] | [dice, mask]  -- the five dice a roll produced, and
           the hold mask going into it (bit i = die i kept; omitted when 0)
    h      hold taps [after_roll, die, held 1|0], the human's, at most 16
    ro     rolls of the turn lost to an app kill (omitted when 0)
    s      [category, value]  -- category = index into ``CATEGORY_ORDER``
    alt    flat [category, value, ...], the other legal categories
    jk yb ub   1 = the Joker rule applied / a Yacht bonus / the upper bonus
    yc     Yacht bonus count after the turn (omitted when 0)
    us     upper subtotal after, tot = total after
    ev     the computer's [EV of its choice, EV of the best category]

Change the shape in a breaking way -> bump ``v`` (``TURN_VERSION``) and the
app's registry entry together. ``extra="forbid"``: an unknown key means a
newer schema.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, ValidationError

from int_bounds import INT32_MAX
from observability.report import Throttle, report_event
from yacht.models import CATEGORY_MAX, MAX_YACHT_BONUS_COUNT

logger = logging.getLogger(__name__)

TURN_COMPLETED = "turn_completed"
TURN_VERSION = 1
MAX_TURN_BYTES = 640
"""Compact-JSON bytes one ``turn_completed`` event may take. The app's registry
holds the same figure (``YACHT_TURN_MAX_BYTES``): a worst-case turn plus the
envelope is under 500 (tests/test_yacht_turn_event.py measures it)."""

CATEGORY_ORDER: tuple[str, ...] = tuple(CATEGORY_MAX)
"""Category index -> name, ``CATEGORIES`` in ``frontend/src/game/yacht/engine.ts``
(``test_yacht_turn_event.py`` parses both)."""
ROUNDS = 13
MAX_ROLLS = 3
MAX_HOLD_CHANGES = 16
MAX_ALTERNATIVES = len(CATEGORY_ORDER) - 1
UPPER_SUBTOTAL_MAX = 105  # 5 + 10 + 15 + 20 + 25 + 30 (every upper box at its best)
TOTAL_MAX = 1575  # YachtModule.board.max_value

Die = Annotated[StrictInt, Field(ge=1, le=6)]
Dice = Annotated[list[Die], Field(min_length=5, max_length=5)]
Mask = Annotated[StrictInt, Field(ge=1, le=31)]
CategoryIndex = Annotated[StrictInt, Field(ge=0, lt=len(CATEGORY_ORDER))]
Points = Annotated[StrictInt, Field(ge=0, le=max(CATEGORY_MAX.values()))]
# 1 only (a Literal[1] would accept True)
Flag = Annotated[StrictInt, Field(ge=1, le=1)]
Ev = Annotated[StrictInt | StrictFloat, Field(ge=0, le=TOTAL_MAX)]


class Actor(BaseModel):
    """The recorder's ``actor``: ``{seat, kind}`` in a vs game (more CPU types later)."""

    model_config = ConfigDict(extra="forbid")

    seat: StrictInt = Field(ge=0, le=1)
    kind: Literal["human", "cpu"]
    cpu_type: str | None = Field(default=None, max_length=24)
    difficulty: str | None = Field(default=None, max_length=24)


class TurnCompleted(BaseModel):
    """One ``turn_completed`` event's ``data`` (wire form, schema ``v`` 1)."""

    model_config = ConfigDict(extra="forbid")

    # StrictInt with equal bounds, not Literal[1]: a Literal accepts True as 1
    v: StrictInt = Field(ge=TURN_VERSION, le=TURN_VERSION)
    unit: StrictInt = Field(ge=0, le=INT32_MAX)
    t_ms: StrictInt = Field(ge=0, le=INT32_MAX)
    actor: Actor | None = None

    r: StrictInt = Field(ge=1, le=ROUNDS)
    rolls: list[tuple[Dice] | tuple[Dice, Mask]] = Field(min_length=1, max_length=MAX_ROLLS)
    h: (
        list[
            tuple[
                Annotated[StrictInt, Field(ge=1, le=MAX_ROLLS)],
                Annotated[StrictInt, Field(ge=0, le=4)],
                Annotated[StrictInt, Field(ge=0, le=1)],
            ]
        ]
        | None
    ) = Field(default=None, min_length=1, max_length=MAX_HOLD_CHANGES)
    ro: StrictInt | None = Field(default=None, ge=1, le=MAX_ROLLS - 1)
    s: tuple[CategoryIndex, Points]
    alt: list[StrictInt] | None = Field(default=None, min_length=2, max_length=2 * MAX_ALTERNATIVES)
    jk: Flag | None = None
    yb: Flag | None = None
    ub: Flag | None = None
    yc: StrictInt | None = Field(default=None, ge=1, le=MAX_YACHT_BONUS_COUNT)
    us: StrictInt = Field(ge=0, le=UPPER_SUBTOTAL_MAX)
    tot: StrictInt = Field(ge=0, le=TOTAL_MAX)
    ev: tuple[Ev, Ev] | None = None


def _alternatives_are_pairs(alt: list[int]) -> bool:
    if len(alt) % 2:
        return False
    return all(
        0 <= alt[i] < len(CATEGORY_ORDER) and 0 <= alt[i + 1] <= max(CATEGORY_MAX.values())
        for i in range(0, len(alt), 2)
    )


def validate_turn(data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``turn_completed`` ``data`` to store, or ``None`` to drop the event.

    Dropped (logged, reported to Sentry by reason only, never values): more
    than ``MAX_TURN_BYTES`` of compact JSON, or any schema violation (wrong
    type, a die outside 1..6, a hold mask outside 1..31, a category outside the
    13, an unknown key, a wrong ``v``, an odd-length ``alt``). Otherwise the
    payload is stored exactly as sent.
    """
    try:
        size = len(json.dumps(data, separators=(",", ":")).encode())
    except (TypeError, ValueError):
        size = MAX_TURN_BYTES + 1
    if size > MAX_TURN_BYTES:
        logger.warning("yacht: dropped an oversize turn_completed event (%d bytes)", size)
        _report_dropped("oversize")
        return None
    try:
        turn = TurnCompleted.model_validate(data)
        if turn.alt is not None and not _alternatives_are_pairs(turn.alt):
            raise ValueError("alt is flat [category, value, ...] pairs")
    except (ValidationError, ValueError) as e:
        types = (
            sorted({err["type"] for err in e.errors()})[:10]
            if isinstance(e, ValidationError)
            else ["value_error"]
        )
        logger.warning("yacht: dropped an invalid turn_completed event [%s]", ", ".join(types))
        _report_dropped("invalid", error_types=types)
        return None
    return data


# One Sentry report per reason per window (#3293): a bad build drops up to 26
# turns a game, and the fingerprint is fixed, so a throttled call loses no grouping.
_REPORT_WINDOW_S = 300.0
_throttles: dict[str, Throttle] = {}


def _report_dropped(reason: str, *, error_types: list[str] | None = None) -> None:
    """Send a dropped ``turn_completed`` event to Sentry: the reason and error types only.

    At most once per ``_REPORT_WINDOW_S`` per reason; the drop is logged every time.
    """
    if not _throttles.setdefault(reason, Throttle(_REPORT_WINDOW_S)).allow():
        return
    report_event(
        f"yacht event: turn_completed {reason}",
        level="warning",
        fingerprint=["yacht-turn-dropped", reason],
        tags={"game_type": "yacht", "reason": reason},
        extras={"error_types": error_types or []},
    )

"""Bottle Sort ``moves`` event: the replay record of a level (#3387, epic #3383).

The app records a level through the shared GameRecorder. ``game_started`` carries
``{"level": int, "catalog": int, "engine_version": 1}`` (the level number, the
catalog version it came from, and the engine's replay version), so the opening
board is the catalog's own level; the ``moves`` rows, in ``event_index`` order,
rebuild everything after it. The backend does not validate ``game_started``
(``SortModule`` passes lifecycle events through as sent), so those keys, and the
unchanged ``game_ended`` / ``SortResult`` payload, are accepted as they were.

A ``moves`` event is one chunk of up to 25 actions (the recorder's envelope
plus ``m``) and one entry of ``m`` is one action, a JSON array of strict ints:

- ``[0, from, to]``: a committed pour, bottle indices ``0 <= i < MAX_BOTTLES``,
  ``from != to``;
- ``[1]``: an undo that changed the board;
- ``[2, from, to]``: a hint was shown (it changes nothing), bounds as a pour;
- ``[3, n]``: "back to last good move", rewinding ``n`` moves,
  ``1 <= n <= MAX_REWIND``.

Wire form, schema ``v`` 1. Change it in a breaking way -> bump ``v``
(``MOVES_VERSION``) and the app's registry entry together.

The byte cap on the compact JSON (``MAX_MOVES_BYTES``) is the same figure as the
app's ``SORT_MOVES_MAX_BYTES`` in ``eventQueueConfig.ts`` (a test holds the two
equal). A bad event is dropped, not the batch: the request still succeeds, with
one Sentry report by reason and error types, never values.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Annotated, Any

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    ValidationError,
    model_validator,
)

from int_bounds import INT32_MAX
from observability.report import Throttle, report_event

logger = logging.getLogger(__name__)

MOVES = "moves"
MOVES_VERSION = 1
MAX_MOVES_BYTES = 1024
"""Compact-JSON bytes one ``moves`` event may take. The app's registry holds the
same figure (``SORT_MOVES_MAX_BYTES``): a worst honest chunk (25 pours between
bottles 15 and 14) is about 300 B."""
MAX_ACTIONS_PER_EVENT = 32
"""The app sends 25; the headroom is for a retuned chunk size on a newer build."""
MAX_BOTTLES = 16
"""The shipped catalog's largest level has 16 bottles (a test reads the catalog)."""
MAX_REWIND = 1000
"""Most moves one "back to last good move" may rewind."""

POUR = 0
UNDO = 1
HINT = 2
REWIND = 3


def _check_action(entry: list[int]) -> list[int]:
    """One action by kind: its arity and the bounds of its operands."""
    kind, operands = entry[0], entry[1:]
    if kind in (POUR, HINT):
        if len(operands) != 2:
            raise ValueError("a pour or hint is [kind, from, to]")
        src, dst = operands
        if not (0 <= src < MAX_BOTTLES and 0 <= dst < MAX_BOTTLES):
            raise ValueError("a bottle is on the board")
        if src == dst:
            raise ValueError("a pour is between two different bottles")
    elif kind == UNDO:
        if operands:
            raise ValueError("an undo is [1]")
    elif kind == REWIND:
        if len(operands) != 1:
            raise ValueError("a rewind is [3, n]")
        if not 1 <= operands[0] <= MAX_REWIND:
            raise ValueError("a rewind is 1..MAX_REWIND moves")
    else:
        raise ValueError("unknown action kind")
    return entry


# StrictInt: no bool, float or numeric string is read as a number
Action = Annotated[
    list[StrictInt],
    Field(min_length=1, max_length=3),
    AfterValidator(_check_action),
]


class SortMoves(BaseModel):
    """One ``moves`` event's ``data`` (wire form, schema ``v`` 1).

    The recorder's envelope (``v``, ``unit``, ``t_ms``) plus ``m``; ``part`` /
    ``parts`` appear only when the app had to split an oversized event.
    ``extra="forbid"``: an unknown key means a newer schema, which bumps ``v``.
    """

    model_config = ConfigDict(extra="forbid")

    # StrictInt with equal bounds, not Literal[1]: a Literal accepts True as 1
    v: StrictInt = Field(ge=MOVES_VERSION, le=MOVES_VERSION)
    # units count from 1, as Mahjong's do
    unit: StrictInt = Field(ge=1, le=INT32_MAX)
    t_ms: StrictInt = Field(ge=0, le=INT32_MAX)
    m: list[Action] = Field(min_length=1, max_length=MAX_ACTIONS_PER_EVENT)
    part: StrictInt | None = Field(default=None, ge=0, lt=MAX_ACTIONS_PER_EVENT)
    parts: StrictInt | None = Field(default=None, ge=2, le=MAX_ACTIONS_PER_EVENT)

    @model_validator(mode="after")
    def _a_split_event_says_which_part(self) -> SortMoves:
        """The recorder writes ``part`` and ``parts`` together, on a split event only,
        and a split makes at least two parts: ``0 <= part < parts``."""
        if (self.part is None) != (self.parts is None):
            raise ValueError("part and parts come together")
        if self.part is not None and self.parts is not None and self.part >= self.parts:
            raise ValueError("part is below parts")
        return self


def validate_moves(data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``moves`` ``data`` to store, or ``None`` to drop the event.

    Dropped (logged, reported to Sentry by reason only, never values): more
    than ``MAX_MOVES_BYTES`` of compact JSON, or any schema violation (wrong
    type, a bottle off the board, a pour from a bottle to itself, an unknown
    action kind or arity, an unknown key, a wrong ``v``). Otherwise the payload
    is stored exactly as sent.
    """
    try:
        size = len(json.dumps(data, separators=(",", ":")).encode())
    except (TypeError, ValueError):
        size = MAX_MOVES_BYTES + 1
    if size > MAX_MOVES_BYTES:
        logger.warning("sort: dropped an oversize moves event (%d bytes)", size)
        _report_dropped("oversize")
        return None
    try:
        SortMoves.model_validate(data)
    except ValidationError as e:
        types = sorted({err["type"] for err in e.errors()})[:10]
        logger.warning("sort: dropped an invalid moves event [%s]", ", ".join(types))
        _report_dropped("invalid", error_types=types)
        return None
    return data


# One throttle per reason: a bad build sends a bad event every chunk of every
# level, and must not send one Sentry event each (#3293). The fingerprint is fixed,
# so a throttled call loses no grouping.
_DROP_REPORT_WINDOW_S = 300.0
_drop_throttles: dict[str, Throttle] = {}
_drop_throttles_lock = threading.Lock()


def _drop_throttle(reason: str) -> Throttle:
    throttle = _drop_throttles.get(reason)
    if throttle is None:
        with _drop_throttles_lock:
            throttle = _drop_throttles.setdefault(reason, Throttle(_DROP_REPORT_WINDOW_S))
    return throttle


def _report_dropped(reason: str, *, error_types: list[str] | None = None) -> None:
    """Send a dropped ``moves`` event to Sentry: the reason and error types only.

    At most one event per reason per five minutes per process; the drop itself
    is always logged.
    """
    if not _drop_throttle(reason).allow():
        return
    report_event(
        f"sort event: moves {reason}",
        level="warning",
        fingerprint=["sort-moves-dropped", reason],
        tags={"game_type": "sort", "reason": reason},
        extras={"error_types": error_types or []},
    )

"""Sudoku metadata, result and ``entries`` event models (#614, #3288)."""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError, field_validator

from games.metadata import LegacyPlayerName
from int_bounds import INT32_MAX
from observability.report import Throttle, report_event

logger = logging.getLogger(__name__)

Difficulty = Literal["easy", "medium", "hard"]
Variant = Literal["classic", "mini"]


class SudokuMetadata(BaseModel):
    """Validated metadata shape for Sudoku game rows (#614).

    ``extra="forbid"`` rejects unknown keys.  ``difficulty`` is the only
    required game-specific field; it's constrained to the three tiers
    defined in Epic #613.
    """

    model_config = ConfigDict(extra="forbid")
    player_name: LegacyPlayerName = ""
    difficulty: Difficulty
    variant: Variant = "classic"


class SudokuResult(BaseModel):
    """Validated result block sent on ``PATCH /games/{id}/complete`` (#2449).

    Distinct from the creation-time metadata model. Unknown keys are ignored so
    a newer app build never fails completion. ``won`` is the win signal for
    goal evaluation; ``games.outcome`` semantics live on ``vocab.GameOutcome``.
    """

    won: bool
    # Illegal moves (row/column/box duplicates), counted by the client (#2943).
    errors: int = Field(ge=0)


# --- entries event payload (#3288, epic #3273) -------------------------------
#
# The app records Sudoku as one ``entries`` event per chunk of up to 32 player
# actions (``frontend/src/game/sudoku/replay.ts``), through the shared
# GameRecorder. The puzzle's givens are in ``game_started`` (``puzzle``, one
# digit per cell, 0 = empty); the givens plus the ``entries`` rows in
# ``event_index`` order rebuild the final grid.
#
# One entry is a short list of ints, ``[op, cell, digit, flag]`` with the tail
# cut where it is not needed:
#
#   [0, cell, digit]     digit placed (``[0, cell, digit, 1]``: an illegal one,
#                        a duplicate in its row, column or box: the wrong-entry flag)
#   [1, cell, digit]     pencil note toggled
#   [2, cell]            cell erased (value and notes)
#   [3]                  undo
#   [4, cell, digit]     hint: the solution digit placed
#
# ``cell`` is ``row * size + col`` (0..80; 0..35 for Mini). Change the shape in
# a breaking way -> bump ``v`` (``ENTRIES_VERSION``) and the app's registry
# entry together.

ENTRIES = "entries"
ENTRIES_VERSION = 1
MAX_ENTRIES_BYTES = 512
"""Compact-JSON bytes one ``entries`` event may take. The app's registry holds
the same figure (``maxBytes``): 32 worst-case entries plus the envelope are ~410 B."""
MAX_ENTRIES_PER_EVENT = 40
"""The app sends 32; a few more are allowed for a retuned chunk size. 40 is also
about what the byte cap admits of the longest entries (11 B each)."""
MAX_CELL = 80
"""The last cell of a Classic 9x9 grid; Mini's 36 cells are a subset."""

OP_DIGIT, OP_NOTE, OP_ERASE, OP_UNDO, OP_HINT = 0, 1, 2, 3, 4

# op -> allowed entry lengths. Only a digit may carry the wrong-entry flag (4).
_ENTRY_LENGTHS: dict[int, tuple[int, ...]] = {
    OP_DIGIT: (3, 4),
    OP_NOTE: (3,),
    OP_ERASE: (2,),
    OP_UNDO: (1,),
    OP_HINT: (3,),
}


def _check_entry(entry: list[int]) -> None:
    """One entry's shape: its op's length, ``cell`` on the grid, ``digit`` 1..9, flag 1."""
    lengths = _ENTRY_LENGTHS.get(entry[0])
    if lengths is None:
        raise ValueError("unknown op")
    if len(entry) not in lengths:
        raise ValueError("wrong length for the op")
    if len(entry) >= 2 and not 0 <= entry[1] <= MAX_CELL:
        raise ValueError("cell is off the grid")
    if len(entry) >= 3 and not 1 <= entry[2] <= 9:
        raise ValueError("digit is 1..9")
    if len(entry) == 4 and entry[3] != 1:
        raise ValueError("the wrong-entry flag is 1 or absent")


Entry = Annotated[list[StrictInt], Field(min_length=1, max_length=4)]


class SudokuEntries(BaseModel):
    """One ``entries`` event's ``data`` (wire form, schema ``v`` 1).

    The recorder's envelope (``v``, ``unit``, ``t_ms``) plus ``i`` (the ordinal
    of the chunk's first entry in the game, so a reader can spot a hole) and
    ``e``. ``extra="forbid"``: an unknown key means a newer schema, which
    bumps ``v``.
    """

    model_config = ConfigDict(extra="forbid")

    # StrictInt with equal bounds, not Literal[1]: a Literal accepts True as 1
    v: StrictInt = Field(ge=ENTRIES_VERSION, le=ENTRIES_VERSION)
    unit: StrictInt = Field(ge=0, le=INT32_MAX)
    t_ms: StrictInt = Field(ge=0, le=INT32_MAX)
    i: StrictInt = Field(ge=0, le=INT32_MAX)
    e: list[Entry] = Field(min_length=1, max_length=MAX_ENTRIES_PER_EVENT)

    @field_validator("e")
    @classmethod
    def _entries_are_well_formed(cls, v: list[list[int]]) -> list[list[int]]:
        for entry in v:
            _check_entry(entry)
        return v


def validate_entries(data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``entries`` ``data`` to store, or ``None`` to drop the event.

    Dropped (logged, reported to Sentry by reason only, never values): more
    than ``MAX_ENTRIES_BYTES`` of compact JSON, or any schema violation (wrong
    type, an unknown op, a cell off the grid, a digit outside 1..9, an unknown
    key, a wrong ``v``). Otherwise the payload is stored exactly as sent.
    """
    try:
        size = len(json.dumps(data, separators=(",", ":")).encode())
    except (TypeError, ValueError):
        size = MAX_ENTRIES_BYTES + 1
    if size > MAX_ENTRIES_BYTES:
        logger.warning("sudoku: dropped an oversize entries event (%d bytes)", size)
        _report_dropped("oversize")
        return None
    try:
        SudokuEntries.model_validate(data)
    except ValidationError as e:
        types = sorted({err["type"] for err in e.errors()})[:10]
        logger.warning("sudoku: dropped an invalid entries event [%s]", ", ".join(types))
        _report_dropped("invalid", error_types=types)
        return None
    return data


# One report per reason per five minutes per process (#3293): a bad build sends
# every chunk of every game, and must not send one Sentry event each. The
# fingerprint is fixed, so a held-back report loses no grouping.
_DROP_REPORT_WINDOW_S = 300.0
_drop_throttles: dict[str, Throttle] = {}


def _report_dropped(reason: str, *, error_types: list[str] | None = None) -> None:
    """Send a dropped ``entries`` event to Sentry: the reason and error types only,
    at most once per reason per window."""
    throttle = _drop_throttles.setdefault(reason, Throttle(_DROP_REPORT_WINDOW_S))
    if not throttle.allow():
        return
    report_event(
        f"sudoku event: entries {reason}",
        level="warning",
        fingerprint=["sudoku-entries-dropped", reason],
        tags={"game_type": "sudoku", "reason": reason},
        extras={"error_types": error_types or []},
    )

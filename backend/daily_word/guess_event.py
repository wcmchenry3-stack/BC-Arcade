"""Daily Word ``guess_submitted`` event: the game module's ``validate_event`` (#3287, epic #3273).

The app (``frontend/src/game/daily_word/replay.ts``) records every guess
attempt through the shared GameRecorder: the recorder's envelope (``v``,
``unit``, ``t_ms``) plus the attempt. ``guess_submitted`` has been seeded since
migration 0017 and no build ever sent it, so there is no older shape to keep
and no migration: this module only adds the check.

The attempt (compact keys)::

    n     row number the guess was made on, 1..6 (also the recorder ``unit``)
    g     the guess: the letters typed, folded and lower-case (Hindi: its
          grapheme clusters joined), as POSTed to ``/daily-word/guess``
    t     per-letter result of an accepted guess, one character per tile:
          ``c`` correct, ``p`` present, ``a`` absent
    rej   set instead of ``t`` when the guess was refused and no row was
          spent: ``nw`` not a word, ``dup`` already guessed on this board

Exactly one of ``t`` / ``rej`` is present. ``DailyWordProgress``
(``daily_word/progress.py``) still enforces the rules; this is the log only.
The stats, streaks and the daily challenge read ``games``, never this event.

Change the shape in a breaking way -> bump ``v`` (``GUESS_VERSION``) and the
app's registry entry together. ``extra="forbid"``: an unknown key means a
newer schema.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StrictStr,
    ValidationError,
    model_validator,
)

from int_bounds import INT32_MAX
from observability.report import Throttle, report_event

logger = logging.getLogger(__name__)

GUESS_SUBMITTED = "guess_submitted"
GUESS_VERSION = 1
MAX_GUESS_BYTES = 256
"""Compact-JSON bytes (UTF-8) one ``guess_submitted`` event may take. The app's
registry holds the same figure (``DAILY_WORD_GUESS_MAX_BYTES``); the largest
real event, a five-letter Hindi guess, is about 90."""

ROWS = 6
MAX_WORD_LENGTH = 16
"""Tiles in a row; the longest answer today is 5. Room for a longer list."""

Row = Annotated[StrictInt, Field(ge=1, le=ROWS)]


class GuessSubmitted(BaseModel):
    """One ``guess_submitted`` event's ``data`` (wire form, schema ``v`` 1)."""

    model_config = ConfigDict(extra="forbid")

    # StrictInt with equal bounds, not Literal[1]: a Literal accepts True as 1
    v: StrictInt = Field(ge=GUESS_VERSION, le=GUESS_VERSION)
    unit: StrictInt = Field(ge=0, le=INT32_MAX)
    t_ms: StrictInt = Field(ge=0, le=INT32_MAX)

    n: Row
    g: StrictStr = Field(min_length=1, max_length=MAX_WORD_LENGTH * 3)
    t: StrictStr | None = Field(default=None, pattern=r"^[cpa]+$", max_length=MAX_WORD_LENGTH)
    rej: Literal["nw", "dup"] | None = None

    @model_validator(mode="after")
    def _result_or_refusal(self) -> GuessSubmitted:
        if (self.t is None) == (self.rej is None):
            raise ValueError("exactly one of t (accepted) and rej (refused)")
        return self


def validate_guess(data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``guess_submitted`` ``data`` to store, or ``None`` to drop the event.

    Dropped (logged, reported to Sentry by reason only, never values): more
    than ``MAX_GUESS_BYTES`` of compact JSON, or any schema violation (wrong
    type, a row outside 1..6, a result character outside ``c`` / ``p`` / ``a``,
    both or neither of ``t`` / ``rej``, an unknown key, a wrong ``v``).
    Otherwise the payload is stored exactly as sent.
    """
    try:
        size = len(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode())
    except (TypeError, ValueError):
        size = MAX_GUESS_BYTES + 1
    if size > MAX_GUESS_BYTES:
        logger.warning("daily_word: dropped an oversize guess_submitted event (%d bytes)", size)
        _report_dropped("oversize")
        return None
    try:
        GuessSubmitted.model_validate(data)
    except ValidationError as e:
        types = sorted({err["type"] for err in e.errors()})[:10]
        logger.warning(
            "daily_word: dropped an invalid guess_submitted event [%s]", ", ".join(types)
        )
        _report_dropped("invalid", error_types=types)
        return None
    return data


_REPORT_WINDOW_S = 300.0
_throttles: dict[str, Throttle] = {}
"""One throttle per reason: a bad build sends a drop per guess, and Sentry gets one
report per reason per five minutes per process (#3293); the log line still says every one."""


def _report_dropped(reason: str, *, error_types: list[str] | None = None) -> None:
    """Send a dropped ``guess_submitted`` event to Sentry: the reason and error types only."""
    throttle = _throttles.setdefault(reason, Throttle(_REPORT_WINDOW_S))
    if not throttle.allow():
        return
    report_event(
        f"daily_word event: guess_submitted {reason}",
        level="warning",
        fingerprint=["daily-word-guess-dropped", reason],
        tags={"game_type": "daily_word", "reason": reason},
        extras={"error_types": error_types or []},
    )

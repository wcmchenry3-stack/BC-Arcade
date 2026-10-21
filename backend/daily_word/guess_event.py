"""Daily Word ``guess_submitted`` event: the game module's ``validate_event`` (#3287, #3368, epic #3273).

The app (``frontend/src/game/daily_word/replay.ts``) records **one**
``guess_submitted`` per game through the shared GameRecorder, when the game ends
(won, lost, or abandoned with at least one scored guess): the recorder's envelope
(``v``, ``unit``, ``t_ms``) plus every guess of the game. ``guess_submitted`` has
been seeded since migration 0017 and no build ever sent it, so there is no older
shape to keep and no migration: this module only adds the check.

The game (compact keys)::

    g     the scored guesses in order: the letters typed, folded and
          lower-case, as POSTed to ``/daily-word/guess`` (1..6)
    t     each guess's result, one character per tile: ``c`` correct,
          ``p`` present, ``a`` absent; as many entries as ``g``
    d     each guess as the board shows it, with accents (fr / es), aligned
          with ``g`` (each as long as its guess); left out when none differs
    rj    refusals (not a word, already guessed) in the game; left out when 0

A refused guess has no event of its own (it only raises ``rj``); a per-guess
shape (``n``, ``rej``) is rejected like any unknown key: nothing that shipped
sent it. ``DailyWordProgress`` (``daily_word/progress.py``) still enforces the
rules; this is the log only. The stats, streaks and the daily challenge read
``games``, never this event.

Change the shape in a breaking way -> bump ``v`` (``GUESS_VERSION``) and the
app's registry entry together. ``extra="forbid"``: an unknown key means a
newer schema.
"""

from __future__ import annotations

import json
import logging
import unicodedata
from typing import Annotated, Any

from pydantic import (
    AfterValidator,
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
MAX_GUESS_BYTES = 384
"""Compact-JSON bytes (UTF-8) a game's ``guess_submitted`` event may take. The
app's registry holds the same figure (``DAILY_WORD_GUESS_MAX_BYTES``); the
largest real event (six guesses with accents, or six Hindi guesses) is under 260."""

ROWS = 6
MAX_WORD_LENGTH = 16
"""Tiles in a row; the longest answer today is 5. Room for a longer list."""
MAX_REFUSAL_COUNT = 99
"""The app counts at most this many refusals into the event."""


def _folded_letters(word: str) -> str:
    """Letters and marks only: each character's Unicode category starts with L or M, lower-case,
    printable, no whitespace, control or surrogate characters (#3372: digits, punctuation,
    symbols and emoji are rejected; marks stay, for Hindi)."""
    if not all(
        unicodedata.category(ch)[0] in "LM"
        and ch.isprintable()
        and not ch.isspace()
        and ch == ch.lower()
        for ch in word
    ):
        raise ValueError("letters and marks, lower-case, no whitespace or control characters")
    return word


Word = Annotated[
    StrictStr, Field(min_length=1, max_length=MAX_WORD_LENGTH), AfterValidator(_folded_letters)
]
Result = Annotated[StrictStr, Field(pattern=r"^[cpa]+$", max_length=MAX_WORD_LENGTH)]


class GuessSubmitted(BaseModel):
    """A game's ``guess_submitted`` ``data`` (wire form, schema ``v`` 1)."""

    model_config = ConfigDict(extra="forbid")

    # StrictInt with equal bounds, not Literal[1]: a Literal accepts True as 1
    v: StrictInt = Field(ge=GUESS_VERSION, le=GUESS_VERSION)
    unit: StrictInt = Field(ge=0, le=INT32_MAX)
    t_ms: StrictInt = Field(ge=0, le=INT32_MAX)

    g: list[Word] = Field(min_length=1, max_length=ROWS)
    t: list[Result] = Field(min_length=1, max_length=ROWS)
    d: list[Word] | None = Field(default=None, min_length=1, max_length=ROWS)
    rj: StrictInt | None = Field(default=None, ge=1, le=MAX_REFUSAL_COUNT)

    @model_validator(mode="after")
    def _lists_line_up(self) -> GuessSubmitted:
        if len(self.t) != len(self.g) or any(
            len(result) != len(guess) for result, guess in zip(self.t, self.g, strict=True)
        ):
            raise ValueError("t has one result per guess, one character per letter")
        if self.d is not None:
            if len(self.d) != len(self.g) or any(
                len(shown) != len(guess) for shown, guess in zip(self.d, self.g, strict=True)
            ):
                raise ValueError("d has one spelling per guess, as long as the guess")
            if self.d == self.g:
                raise ValueError("d is left out when no spelling differs from g")
        return self


def validate_guess(data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``guess_submitted`` ``data`` to store, or ``None`` to drop the event.

    Dropped (logged, reported to Sentry by reason only, never values): more
    than ``MAX_GUESS_BYTES`` of compact JSON, or any schema violation (wrong
    type, more than 6 guesses, a result character outside ``c`` / ``p`` / ``a``,
    lists that do not line up, a ``d`` equal to ``g``, a per-guess ``n`` / ``rej``
    or other unknown key, a wrong ``v``). Otherwise the payload is stored
    exactly as sent.
    """
    try:
        size = len(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode())
    except UnicodeEncodeError:
        # A lone surrogate (``"\ud800"``) has no UTF-8 form: invalid, dropped with a 2xx
        # like any other bad event, rather than a 500 the client would retry (#3298).
        logger.warning("daily_word: dropped a guess_submitted event that is not valid text")
        _report_dropped("invalid", error_types=["unicode_encode"])
        return None
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
"""One throttle per reason: a bad build sends a drop per game, and Sentry gets one
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

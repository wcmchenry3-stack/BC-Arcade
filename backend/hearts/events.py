"""Hearts replay events: ``hand_opened`` and ``hand_played`` (#3283, epic #3273).

The app (``frontend/src/game/hearts/replay.ts``) records each game through the
shared GameRecorder. The seats and preset are in ``game_started``; each hand then
adds, in ``event_index`` order, one ``hand_opened`` and one ``hand_played`` (more
if the app was backgrounded mid-hand: the tricks so far go as a part, the rest as
the next). A stored game's hands, passes, plays and every seat's score rebuild
from those rows. Two rows a hand, not sixteen: the 200 B a stored row costs is
most of what a small event costs (games/replay_caps.py).

Wire form, schema ``v`` 1. Every event carries the recorder's envelope (``v``,
``unit``, ``t_ms``) and ``h``, the 1-based hand number. A card is two ASCII
characters, rank then suit (``2``-``9``, ``T``, ``J``, ``Q``, ``K``, ``A``;
``C``, ``D``, ``H``, ``S``), and a card list is its codes joined with no
separator (``"QSAH2C"``). Seats are 0..3 (0 is the human).

- ``hand_opened``: ``d`` pass direction (0 left, 1 right, 2 across, 3 none; it is
  ``(h - 1) % 4``), ``c`` the four starting hands, 13 cards each, in seat order;
  ``p`` (not on a hold hand) the three cards each seat passed, in seat order, and
  ``r`` (omitted when no principle is known) 12 digits: the conservative CPU's
  principle number for each passed card, 3 a seat (0 where a seat has none).
  What a seat received is what the seat ``d`` away passed.
- ``hand_played``: ``l`` the lead seat of the first trick of the row, ``c`` the
  plays of its tricks in order, 8 characters a trick, ``n`` (omitted for 1) the
  number of that first trick. A trick's winner leads the next, and the winner is
  the highest card of the led suit (ace high), so the seats, winners and points
  are not recorded: they follow from the cards. ``r`` (omitted when every digit
  is 0) one principle digit per play. On the row that ends the hand (its last
  trick is the 13th): ``s`` the four applied deltas (after the moon), ``t`` the
  four running totals, ``m`` the shooter's seat on a moon hand.

Principle numbers are the ``n`` of ``P<n>-...`` in docs/hearts/CONSERVATIVE_AI.md
(1..9); ``0`` is none (the human, a legacy persona, a forced play).

What the server checks per row: the schema, 52 distinct cards in a deal, the
passed cards distinct and from the seat's own hand, the direction following the
hand number, distinct cards in a row's plays, a score only on the row that ends
the hand and a scoring the engine can make. That each play is from the seat's
hand is a check across rows (the reader's, ``rebuildGame`` in the app's tests).

Each type has a byte cap on its compact JSON (``MAX_*_BYTES``), the same figure
as the app's ``HEARTS_*_MAX_BYTES`` in ``eventQueueConfig.ts`` (a test holds the
two equal). A bad event is dropped, not the batch: the request still succeeds,
with one Sentry report by reason and error types, never values. Change the shape
in a breaking way -> bump ``v`` and the app's registry entry together.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StringConstraints,
    ValidationError,
    model_validator,
)

from hearts.models import MAX_HANDS, SEATS, hand_row_is_valid
from int_bounds import INT32_MAX
from observability.report import report_event

logger = logging.getLogger(__name__)

HAND_OPENED = "hand_opened"
HAND_PLAYED = "hand_played"
EVENT_TYPES: tuple[str, ...] = (HAND_OPENED, HAND_PLAYED)

EVENTS_VERSION = 1
MAX_HAND_OPENED_BYTES = 384
MAX_HAND_PLAYED_BYTES = 384
"""Compact-JSON bytes one event of the type may take. The app's registry holds
the same figures (``maxBytes``); the worst honest event is 232 B (``hand_opened``)
and 264 B (``hand_played``), about 60% and 69% of them
(tests/test_hearts_replay_events.py)."""

_CAPS: dict[str, int] = {HAND_OPENED: MAX_HAND_OPENED_BYTES, HAND_PLAYED: MAX_HAND_PLAYED_BYTES}

TRICKS = 13
MAX_TOTAL = 26 * MAX_HANDS


def _split(cards: str) -> list[str]:
    return [cards[i : i + 2] for i in range(0, len(cards), 2)]


# A list of exactly n cards: each card is a rank character then a suit character.
Hand = Annotated[str, StringConstraints(pattern=r"^(?:[2-9TJQKA][CDHS]){13}$")]
Pass = Annotated[str, StringConstraints(pattern=r"^(?:[2-9TJQKA][CDHS]){3}$")]
# 1..13 tricks of four plays
Plays = Annotated[str, StringConstraints(pattern=r"^(?:[2-9TJQKA][CDHS]){4,52}$", max_length=104)]
Seat = Annotated[StrictInt, Field(ge=0, lt=SEATS)]
HandPoints = Annotated[StrictInt, Field(ge=0, le=26)]
Total = Annotated[StrictInt, Field(ge=0, le=MAX_TOTAL)]


class _Envelope(BaseModel):
    """The recorder's envelope plus the hand number; ``extra="forbid"``: an unknown
    key means a newer schema, which bumps ``v``."""

    model_config = ConfigDict(extra="forbid")

    v: StrictInt = Field(ge=EVENTS_VERSION, le=EVENTS_VERSION)
    unit: StrictInt = Field(ge=0, le=INT32_MAX)
    t_ms: StrictInt = Field(ge=0, le=INT32_MAX)
    h: StrictInt = Field(ge=1, le=MAX_HANDS)


class HeartsHandOpened(_Envelope):
    d: StrictInt = Field(ge=0, le=3)
    c: list[Hand] = Field(min_length=SEATS, max_length=SEATS)
    p: list[Pass] | None = Field(default=None, min_length=SEATS, max_length=SEATS)
    r: str | None = Field(default=None, pattern=r"^[0-9]{12}$")

    @model_validator(mode="after")
    def _a_whole_deck_a_pass_from_the_hands_and_the_hand_numbers_direction(
        self,
    ) -> HeartsHandOpened:
        if self.d != (self.h - 1) % 4:
            raise ValueError("pass direction does not follow the hand number")
        hands = [_split(hand) for hand in self.c]
        if len({card for hand in hands for card in hand}) != 52:
            raise ValueError("the four hands are not 52 distinct cards")
        hold = self.d == 3
        if hold != (self.p is None):
            raise ValueError("a pass hand has a pass and a hold hand has none")
        if hold and self.r is not None:
            raise ValueError("principles for a pass that was not made")
        if self.p is not None:
            passed = [_split(cards) for cards in self.p]
            if len({card for cards in passed for card in cards}) != 12:
                raise ValueError("the passed cards are not 12 distinct cards")
            if any(not set(cards) <= set(hand) for cards, hand in zip(passed, hands, strict=True)):
                raise ValueError("a seat passed a card it was not dealt")
        return self


class HeartsHandPlayed(_Envelope):
    n: StrictInt | None = Field(default=None, ge=2, le=TRICKS)
    l: Seat  # the wire key: the lead seat of the first trick
    c: Plays
    r: str | None = Field(default=None, pattern=r"^[0-9]{4,52}$")
    s: list[HandPoints] | None = Field(default=None, min_length=SEATS, max_length=SEATS)
    t: list[Total] | None = Field(default=None, min_length=SEATS, max_length=SEATS)
    m: Seat | None = None

    @model_validator(mode="after")
    def _whole_tricks_that_end_the_hand_only_when_it_ends(self) -> HeartsHandPlayed:
        if len(self.c) % 8:
            raise ValueError("plays are not whole tricks")
        tricks = len(self.c) // 8
        first = self.n or 1
        last = first - 1 + tricks
        if last > TRICKS:
            raise ValueError("more than 13 tricks in a hand")
        cards = _split(self.c)
        if len(set(cards)) != len(cards):
            raise ValueError("a card played twice")
        if self.r is not None and (len(self.r) != len(cards) or set(self.r) == {"0"}):
            raise ValueError("one principle digit per play, and none if all are 0")
        ends = last == TRICKS
        if ends != (self.s is not None and self.t is not None):
            raise ValueError("a score on exactly the row that ends the hand")
        if self.s is None:
            if self.m is not None or self.t is not None:
                raise ValueError("a moon or totals without a score")
            return self
        if not hand_row_is_valid(self.s):
            raise ValueError("the deltas are not a possible hand")
        moon = sum(self.s) == 78
        if moon != (self.m is not None) or (moon and self.s[self.m or 0] != 0):
            raise ValueError("the moon shooter does not match the deltas")
        return self


_MODELS: dict[str, type[_Envelope]] = {HAND_OPENED: HeartsHandOpened, HAND_PLAYED: HeartsHandPlayed}


def validate_hearts_event(name: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``data`` to store for one of ``EVENT_TYPES``, or ``None`` to drop it.

    Dropped (logged, reported to Sentry by reason only, never values): more than
    the type's cap of compact JSON, or any schema violation (wrong type or range,
    a malformed card, a deal that is not 52 distinct cards, a pass from cards the
    seat was not dealt, an unknown key, a wrong ``v``). Otherwise the payload is
    stored exactly as sent.
    """
    try:
        size = len(json.dumps(data, separators=(",", ":")).encode())
    except (TypeError, ValueError):
        size = _CAPS[name] + 1
    if size > _CAPS[name]:
        logger.warning("hearts: dropped an oversize %s event (%d bytes)", name, size)
        _report_dropped(name, "oversize")
        return None
    try:
        _MODELS[name].model_validate(data)
    except ValidationError as e:
        types = sorted({err["type"] for err in e.errors()})[:10]
        logger.warning("hearts: dropped an invalid %s event [%s]", name, ", ".join(types))
        _report_dropped(name, "invalid", error_types=types)
        return None
    return data


def _report_dropped(name: str, reason: str, *, error_types: list[str] | None = None) -> None:
    """Send a dropped event to Sentry: the type, reason and error types only."""
    report_event(
        f"hearts event: {name} {reason}",
        level="warning",
        fingerprint=["hearts-event-dropped", name, reason],
        tags={"game_type": "hearts", "reason": reason},
        extras={"error_types": error_types or []},
    )

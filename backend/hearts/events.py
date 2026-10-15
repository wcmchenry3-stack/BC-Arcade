"""Hearts replay events: ``hand_dealt``, ``pass_committed``, ``trick_completed``
and ``hand_scored`` (#3283, epic #3273).

The app (``frontend/src/game/hearts/replay.ts``) records each game through the
shared GameRecorder. The opening seats and preset are in ``game_started``; each
hand then adds, in ``event_index`` order, one ``hand_dealt``, one
``pass_committed`` (not on a no-pass hand), thirteen ``trick_completed`` and one
``hand_scored``. Those rows rebuild every hand and every seat's score.

Wire form, schema ``v`` 1. Every event carries the recorder's envelope (``v``,
``unit``, ``t_ms``) and ``h``, the 1-based hand number. A card is two ASCII
characters, rank then suit (``2``-``9``, ``T``, ``J``, ``Q``, ``K``, ``A``;
``C``, ``D``, ``H``, ``S``), and a card list is its codes joined with no
separator (``"QSAH2C"``). Seats are 0..3 (0 is the human).

- ``hand_dealt``: ``d`` pass direction (0 left, 1 right, 2 across, 3 none; it is
  ``(h - 1) % 4``), ``c`` the four starting hands, 13 cards each, in seat order.
- ``pass_committed``: ``p`` the three cards each seat passed, in seat order;
  ``r`` (omitted when no principle is known) the conservative CPU's principle
  number for each passed card, per seat, ``0`` where the seat has none. What a
  seat received is what the seat ``d`` away passed.
- ``trick_completed``: ``n`` the trick number 1..13, ``l`` the lead seat, ``c``
  the four cards in play order (the seats are ``l``, ``l+1``, ... mod 4), ``w``
  the winner, ``pt`` the points in the trick, ``hb`` 1 once hearts are broken,
  ``q`` 1 when the queen of spades was taken; ``pt``, ``hb``, ``q`` are omitted
  when zero / false. ``r`` (omitted when empty) the principle number of each play.
- ``hand_scored``: ``s`` the four applied deltas (after the moon), ``t`` the four
  running totals, ``m`` the shooter's seat on a moon hand.

Principle numbers are the ``n`` of ``P<n>-...`` in docs/hearts/CONSERVATIVE_AI.md
(1..9); ``0`` is none (the human, a legacy persona, a forced play).

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

from hearts.models import MAX_HANDS, SEATS, _hand_row_is_valid
from int_bounds import INT32_MAX
from observability.report import report_event

logger = logging.getLogger(__name__)

HAND_DEALT = "hand_dealt"
PASS_COMMITTED = "pass_committed"
TRICK_COMPLETED = "trick_completed"
HAND_SCORED = "hand_scored"
EVENT_TYPES: tuple[str, ...] = (HAND_DEALT, PASS_COMMITTED, TRICK_COMPLETED, HAND_SCORED)

EVENTS_VERSION = 1
MAX_HAND_DEALT_BYTES = 256
MAX_PASS_COMMITTED_BYTES = 192
MAX_TRICK_COMPLETED_BYTES = 160
MAX_HAND_SCORED_BYTES = 128
"""Compact-JSON bytes one event of the type may take. The app's registry holds
the same figures (``maxBytes``); the worst honest event of each type is about
60-70% of its cap (tests/test_hearts_replay_events.py)."""

_CAPS: dict[str, int] = {
    HAND_DEALT: MAX_HAND_DEALT_BYTES,
    PASS_COMMITTED: MAX_PASS_COMMITTED_BYTES,
    TRICK_COMPLETED: MAX_TRICK_COMPLETED_BYTES,
    HAND_SCORED: MAX_HAND_SCORED_BYTES,
}

RANKS = "23456789TJQKA"  # low to high: the ace is high
SUITS = "CDHS"
QUEEN_OF_SPADES = "QS"
MAX_PRINCIPLE = 9
MAX_TOTAL = 26 * MAX_HANDS


def _split(cards: str) -> list[str]:
    return [cards[i : i + 2] for i in range(0, len(cards), 2)]


# A list of exactly n cards: each card is a rank character then a suit character.
Hand = Annotated[str, StringConstraints(pattern=r"^(?:[2-9TJQKA][CDHS]){13}$")]
Pass = Annotated[str, StringConstraints(pattern=r"^(?:[2-9TJQKA][CDHS]){3}$")]
Trick = Annotated[str, StringConstraints(pattern=r"^(?:[2-9TJQKA][CDHS]){4}$")]
Seat = Annotated[StrictInt, Field(ge=0, lt=SEATS)]
Principle = Annotated[StrictInt, Field(ge=0, le=MAX_PRINCIPLE)]
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


class HeartsHandDealt(_Envelope):
    d: StrictInt = Field(ge=0, le=3)
    c: list[Hand] = Field(min_length=SEATS, max_length=SEATS)

    @model_validator(mode="after")
    def _a_whole_deck_and_the_hand_numbers_direction(self) -> HeartsHandDealt:
        if self.d != (self.h - 1) % 4:
            raise ValueError("pass direction does not follow the hand number")
        dealt = [card for hand in self.c for card in _split(hand)]
        if len(set(dealt)) != 52:
            raise ValueError("the four hands are not 52 distinct cards")
        return self


class HeartsPassCommitted(_Envelope):
    p: list[Pass] = Field(min_length=SEATS, max_length=SEATS)
    r: list[StrictInt | list[Principle]] | None = Field(
        default=None, min_length=SEATS, max_length=SEATS
    )

    @model_validator(mode="after")
    def _twelve_distinct_cards_and_whole_principle_lists(self) -> HeartsPassCommitted:
        if len({card for cards in self.p for card in _split(cards)}) != 12:
            raise ValueError("the passed cards are not 12 distinct cards")
        if self.h % 4 == 0:
            raise ValueError("no cards are passed on a hold hand")
        for entry in self.r or []:
            if isinstance(entry, list):
                if len(entry) != 3:
                    raise ValueError("a seat's principles are one per passed card")
            elif entry != 0:
                raise ValueError("a seat with no principles is 0")
        return self


class HeartsTrickCompleted(_Envelope):
    n: StrictInt = Field(ge=1, le=13)
    l: Seat  # the wire key: the lead seat
    c: Trick
    w: Seat
    pt: StrictInt | None = Field(default=None, ge=1, le=26)
    hb: StrictInt | None = Field(default=None, ge=1, le=1)
    q: StrictInt | None = Field(default=None, ge=1, le=1)
    r: list[Principle] | None = Field(default=None, min_length=SEATS, max_length=SEATS)

    @model_validator(mode="after")
    def _the_summary_follows_from_the_cards(self) -> HeartsTrickCompleted:
        cards = _split(self.c)
        if len(set(cards)) != 4:
            raise ValueError("the four plays are not distinct cards")
        led = cards[0][1]
        best = max(
            (i for i, card in enumerate(cards) if card[1] == led),
            key=lambda i: RANKS.index(cards[i][0]),
        )
        if self.w != (self.l + best) % SEATS:
            raise ValueError("the winner does not follow from the plays")
        points = sum(1 for card in cards if card[1] == "H")
        has_queen = QUEEN_OF_SPADES in cards
        if has_queen:
            points += 13
        if (self.pt or 0) != points:
            raise ValueError("the points do not follow from the plays")
        if bool(self.q) != has_queen:
            raise ValueError("the queen flag does not follow from the plays")
        if any(card[1] == "H" for card in cards) and not self.hb:
            raise ValueError("hearts played but not broken")
        return self


class HeartsHandScored(_Envelope):
    s: list[HandPoints] = Field(min_length=SEATS, max_length=SEATS)
    t: list[Total] = Field(min_length=SEATS, max_length=SEATS)
    m: Seat | None = None

    @model_validator(mode="after")
    def _the_row_is_a_scoring_the_engine_can_make(self) -> HeartsHandScored:
        if not _hand_row_is_valid(self.s):
            raise ValueError("the deltas are not a possible hand")
        moon = sum(self.s) == 78
        if moon != (self.m is not None) or (moon and self.s[self.m or 0] != 0):
            raise ValueError("the moon shooter does not match the deltas")
        return self


_MODELS: dict[str, type[_Envelope]] = {
    HAND_DEALT: HeartsHandDealt,
    PASS_COMMITTED: HeartsPassCommitted,
    TRICK_COMPLETED: HeartsTrickCompleted,
    HAND_SCORED: HeartsHandScored,
}


def validate_hearts_event(name: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``data`` to store for one of ``EVENT_TYPES``, or ``None`` to drop it.

    Dropped (logged, reported to Sentry by reason only, never values): more than
    the type's cap of compact JSON, or any schema violation (wrong type or range,
    a malformed card, a trick whose winner or points do not follow from its
    cards, a hand that is not 52 distinct cards, an unknown key, a wrong ``v``).
    Otherwise the payload is stored exactly as sent.
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

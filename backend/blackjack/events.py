"""Blackjack replay events: schema and validation (#3284, epic #3273).

The app records a Blackjack run one round at a time through the shared
GameRecorder (``frontend/src/game/blackjack/replay.ts`` builds the payloads);
``GameModule.validate_event`` checks each event here. A round is these events,
in ``event_index`` order, each wrapped in the recorder's envelope (``v``,
``unit`` = the round, ``t_ms``):

* ``bet_placed``     ``{amount, chips_remaining}``
* ``hand_dealt``     ``{p, d, sh, rem}``: the player's two cards, the dealer's two
  as ``[hole, up]``, the shoe size and the cards left after the deal
* ``player_action``  ``{a, i, c | h}``: hit / stand / double / split, the hand acted
  on, the card it drew, or the two hands a split made
* ``dealer_played``  ``{h, d, t, b?}``: the hole card, the cards drawn, the final
  total and ``1`` when it busted. New in #3284; older builds never send it.
* ``hand_resolved``  ``{i, o, p, ch, c}``: one per hand, with its full cards

Cards are ``"QS"``: ``A 2-9 T J Q K`` and ``S H D C``. Booleans are omitted when
false.

Two shapes per type. An event with a ``v`` is the current one (``v`` 1, strict,
no unknown keys). An event without one is what builds from before #3284 send
(``LEGACY_*`` below): it is still accepted, so no older build is rejected, and is
stored as sent. A newer ``v`` is dropped until this module learns it, so deploy
the backend first (docs/GAME-CONTRACT.md "Adding an event type").

Every event is held to ``MAX_EVENT_BYTES`` of compact JSON, the same figure as
the app's ``BLACKJACK_EVENT_MAX_BYTES`` (``eventQueueConfig.ts``; a test holds
them equal). A dropped event is logged and reported to Sentry by reason only,
never with its values. This module records chip counts and changes none.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StrictStr,
    ValidationError,
    model_validator,
)

from int_bounds import INT32_MAX
from observability.report import report_event

logger = logging.getLogger(__name__)

BET_PLACED = "bet_placed"
HAND_DEALT = "hand_dealt"
PLAYER_ACTION = "player_action"
DEALER_PLAYED = "dealer_played"
HAND_RESOLVED = "hand_resolved"

EVENT_VERSION = 1
MAX_EVENT_BYTES = 256
"""Compact-JSON bytes any one Blackjack event may take. The app holds the same
figure; its widest possible event (a hand of 14 cards) is 166."""
MAX_CARDS_IN_HAND = 14
"""A hand cannot hold more: 11 cards reach 21, and one more busts it."""
MAX_HANDS = 8
"""Hand indexes accepted. The engine allows 4 (three splits)."""
MAX_SHOE_CARDS = 52 * 16

Card = Annotated[StrictStr, Field(pattern=r"^[A2-9TJQK][SHDC]$")]
Hand = Annotated[list[Card], Field(min_length=2, max_length=MAX_CARDS_IN_HAND)]
SplitHand = Annotated[list[Card], Field(min_length=2, max_length=2)]
HandIndex = Annotated[StrictInt, Field(ge=0, lt=MAX_HANDS)]
Chips = Annotated[StrictInt, Field(ge=0, le=INT32_MAX)]
Payout = Annotated[StrictInt, Field(ge=-INT32_MAX, le=INT32_MAX)]


class _Envelope(BaseModel):
    """The recorder's envelope. ``extra="forbid"``: an unknown key means a newer schema."""

    model_config = ConfigDict(extra="forbid")

    # StrictInt with equal bounds, not Literal[1]: a Literal accepts True as 1
    v: StrictInt = Field(ge=EVENT_VERSION, le=EVENT_VERSION)
    unit: StrictInt = Field(ge=0, le=INT32_MAX)
    t_ms: StrictInt = Field(ge=0, le=INT32_MAX)


class BetPlacedV1(_Envelope):
    amount: StrictInt = Field(ge=1, le=INT32_MAX)
    chips_remaining: Chips


class HandDealtV1(_Envelope):
    p: Annotated[list[Card], Field(min_length=2, max_length=2)]
    d: Annotated[list[Card], Field(min_length=2, max_length=2)]
    sh: StrictInt = Field(ge=52, le=MAX_SHOE_CARDS)
    rem: StrictInt = Field(ge=0, le=MAX_SHOE_CARDS)


class PlayerActionV1(_Envelope):
    a: Literal["h", "s", "d", "p"]
    i: HandIndex
    c: Card | None = None
    h: Annotated[list[SplitHand], Field(min_length=2, max_length=2)] | None = None

    @model_validator(mode="after")
    def _fields_fit_the_action(self) -> PlayerActionV1:
        """A hit or double draws one card, a split makes two hands, a stand neither."""
        draws = self.a in ("h", "d")
        if draws != (self.c is not None):
            raise ValueError("c is the card drawn by a hit or a double, and only those")
        if (self.a == "p") != (self.h is not None):
            raise ValueError("h is the hands a split made, and only a split has it")
        return self


class DealerPlayedV1(_Envelope):
    h: Card
    d: Annotated[list[Card], Field(max_length=MAX_CARDS_IN_HAND)]
    # The dealer plays to 17 or more, so a bust is at most 26; headroom for rules variants.
    t: StrictInt = Field(ge=17, le=31)
    # StrictInt bounded to 1, not Literal[1]: a Literal accepts True as 1
    b: StrictInt | None = Field(default=None, ge=1, le=1)

    @model_validator(mode="after")
    def _bust_flag_matches_total(self) -> DealerPlayedV1:
        if (self.b == 1) != (self.t > 21):
            raise ValueError("b is 1 when the total is over 21, and only then")
        return self


class HandResolvedV1(_Envelope):
    i: HandIndex
    o: Literal["blackjack", "win", "lose", "push"]
    p: Payout
    ch: Chips
    c: Hand


class _Legacy(BaseModel):
    """What builds from before #3284 send (no ``v``): required keys, no more."""

    model_config = ConfigDict(extra="allow")


class LegacyBetPlaced(_Legacy):
    amount: Chips
    chips_remaining: Chips


class LegacyHandDealt(_Legacy):
    player_hand: Annotated[list[dict[str, Any]], Field(max_length=MAX_CARDS_IN_HAND)]
    dealer_up_card: dict[str, Any] | None = None
    is_player_blackjack: StrictBool | None = None


class LegacyPlayerAction(_Legacy):
    action: Literal["hit", "stand", "double", "split"]
    hand_index: HandIndex
    hand_value_after: StrictInt = Field(ge=0, le=64)


class LegacyHandResolved(_Legacy):
    hand_index: HandIndex
    outcome: Literal["blackjack", "win", "lose", "push"]
    payout_delta: Payout
    chips_after: Chips


# event type -> (the current schema, the pre-#3284 one; None when there was none)
_MODELS: dict[str, tuple[type[BaseModel], type[BaseModel] | None]] = {
    BET_PLACED: (BetPlacedV1, LegacyBetPlaced),
    HAND_DEALT: (HandDealtV1, LegacyHandDealt),
    PLAYER_ACTION: (PlayerActionV1, LegacyPlayerAction),
    DEALER_PLAYED: (DealerPlayedV1, None),
    HAND_RESOLVED: (HandResolvedV1, LegacyHandResolved),
}

EVENT_TYPES = frozenset(_MODELS)


def validate_hand_event(name: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``data`` to store for Blackjack event ``name``, or ``None`` to drop it.

    Dropped (logged, reported to Sentry by reason only): more than
    ``MAX_EVENT_BYTES`` of compact JSON, or any schema violation (wrong type, a
    card that is not a card, a hit with no card, an unknown key, a ``v`` this
    module does not know). Otherwise stored exactly as sent. ``name`` must be one
    of ``EVENT_TYPES``; anything else is returned as is.
    """
    models = _MODELS.get(name)
    if models is None:
        return data
    try:
        size = len(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode())
    except (TypeError, ValueError):
        size = MAX_EVENT_BYTES + 1
    if size > MAX_EVENT_BYTES:
        logger.warning("blackjack: dropped an oversize %s event (%d bytes)", name, size)
        _report_dropped(name, "oversize")
        return None
    current, legacy = models
    # A missing ``v`` is the shape older builds send; a present one is the new schema.
    model = current if "v" in data or legacy is None else legacy
    try:
        model.model_validate(data)
    except ValidationError as e:
        types = sorted({err["type"] for err in e.errors()})[:10]
        logger.warning("blackjack: dropped an invalid %s event [%s]", name, ", ".join(types))
        _report_dropped(name, "invalid", error_types=types)
        return None
    return data


def _report_dropped(name: str, reason: str, *, error_types: list[str] | None = None) -> None:
    """Send a dropped event to Sentry: its type, the reason and error types, no values."""
    report_event(
        f"blackjack event: {name} {reason}",
        level="warning",
        fingerprint=["blackjack-event-dropped", name, reason],
        tags={"game_type": "blackjack", "event_type": name, "reason": reason},
        extras={"error_types": error_types or []},
    )

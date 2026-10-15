"""Blackjack replay events: schema and validation (#3284, epic #3273).

The app records a Blackjack run one round at a time through the shared
GameRecorder (``frontend/src/game/blackjack/replay.ts`` builds the payloads);
``GameModule.validate_event`` checks each event here. A round is two kinds of
event, each wrapped in the recorder's envelope (``v``, ``unit`` = the round,
``t_ms``), so a round costs one replay row plus one lifecycle row per hand:

* ``round_played``  one per round: ``{b, p, d, sh, rem, a?, dl?, r?}``
  - ``b`` ``[bet, chips before the bet]``
  - ``p`` the player's two cards; ``d`` the dealer's two as ``[hole, up]``
  - ``sh`` the shoe size, ``rem`` the cards left after the deal
  - ``a`` the actions in order, each ``[code, hand]`` plus the card a hit or
    double drew, or the two hands a split made: ``["h", 0, "KS"]``,
    ``["d", 0, "9S"]``, ``["s", 1]``, ``["p", 0, [["8S","3D"],["8H","KC"]]]``
  - ``dl`` the dealer's play, only when it played: ``{d: draws, t: total, b?: 1}``
  - ``r`` 1 on a round resumed after the app was killed mid-hand: the earlier
    actions and ``p`` were not kept (``p`` is then absent)
* ``hand_resolved``  one per hand (a lifecycle row): ``{i, o, p, ch, c}`` with the
  hand's full cards, outcome, payout and the chips after the round

Cards are ``"QS"``: ``A 2-9 T J Q K`` and ``S H D C``. Booleans are omitted when
false.

Older builds (before #3284) send ``bet_placed``, ``hand_dealt``, ``player_action``
and ``hand_resolved`` in other shapes, without a ``v``. They are still accepted
and stored as sent (``LEGACY_*`` below) so no older build is rejected; the first
three are legacy-only (new builds never send them), and an event of those types
with a ``v`` is dropped. ``hand_resolved`` and ``round_played`` with a ``v`` are
the strict v1 schema; a newer ``v`` is dropped until this module learns it, so
deploy the backend first (docs/GAME-CONTRACT.md "Adding an event type").

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
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StrictStr,
    TypeAdapter,
    ValidationError,
    model_validator,
)

from int_bounds import INT32_MAX
from observability.report import report_event

logger = logging.getLogger(__name__)

BET_PLACED = "bet_placed"
HAND_DEALT = "hand_dealt"
PLAYER_ACTION = "player_action"
ROUND_PLAYED = "round_played"
HAND_RESOLVED = "hand_resolved"

EVENT_VERSION = 1
MAX_EVENT_BYTES = 1024
"""Compact-JSON bytes any one Blackjack event may take. The app holds the same
figure. A normal ``round_played`` is 150-250; the widest legal one, a hand of 21
aces hit one by one against a dealer who also draws 22, is about 520."""
MAX_CARDS_IN_HAND = 22
"""A hand can hold 21 cards without busting (aces and twos from a 6-deck shoe),
and one more draw busts it."""
MAX_ACTIONS = 96
MAX_HANDS = 8
"""Hand indexes accepted. The engine allows 4 (three splits)."""
MAX_SHOE_CARDS = 52 * 16

Card = Annotated[StrictStr, Field(pattern=r"^[A2-9TJQK][SHDC]$")]
Hand = Annotated[list[Card], Field(min_length=2, max_length=MAX_CARDS_IN_HAND)]
HandIndex = Annotated[StrictInt, Field(ge=0, lt=MAX_HANDS)]
Chips = Annotated[StrictInt, Field(ge=0, le=INT32_MAX)]
Payout = Annotated[StrictInt, Field(ge=-INT32_MAX, le=INT32_MAX)]

_CARD = TypeAdapter(Card)
_INDEX = TypeAdapter(HandIndex)
_SPLIT_HAND = TypeAdapter(Annotated[list[Card], Field(min_length=2, max_length=2)])


class _Envelope(BaseModel):
    """The recorder's envelope. ``extra="forbid"``: an unknown key means a newer schema."""

    model_config = ConfigDict(extra="forbid")

    # StrictInt with equal bounds, not Literal[1]: a Literal accepts True as 1
    v: StrictInt = Field(ge=EVENT_VERSION, le=EVENT_VERSION)
    unit: StrictInt = Field(ge=0, le=INT32_MAX)
    t_ms: StrictInt = Field(ge=0, le=INT32_MAX)


def _check_action(item: list[Any]) -> list[Any]:
    """``[code, hand]`` and, for a hit or double, the card drawn; for a split, the two hands made."""
    code = item[0]
    if code not in ("h", "s", "d", "p"):
        raise ValueError("action code is h, s, d or p")
    _INDEX.validate_python(item[1])
    if len(item) != (2 if code == "s" else 3):
        raise ValueError("a stand has no third item, every other action has one")
    if code in ("h", "d"):
        _CARD.validate_python(item[2])
    elif code == "p":
        if not isinstance(item[2], list) or len(item[2]) != 2:
            raise ValueError("a split makes two hands")
        for hand in item[2]:
            _SPLIT_HAND.validate_python(hand)
    return item


Action = Annotated[list[Any], Field(min_length=2, max_length=3), AfterValidator(_check_action)]


class DealerPlay(BaseModel):
    model_config = ConfigDict(extra="forbid")

    d: Annotated[list[Card], Field(max_length=MAX_CARDS_IN_HAND)]
    # The dealer plays to 17 or more, so a bust is at most 26; headroom for rules variants.
    t: StrictInt = Field(ge=17, le=31)
    # StrictInt bounded to 1, not Literal[1]: a Literal accepts True as 1
    b: StrictInt | None = Field(default=None, ge=1, le=1)

    @model_validator(mode="after")
    def _bust_flag_matches_total(self) -> DealerPlay:
        if (self.b == 1) != (self.t > 21):
            raise ValueError("b is 1 when the total is over 21, and only then")
        return self


class RoundPlayedV1(_Envelope):
    b: Annotated[list[StrictInt], Field(min_length=2, max_length=2)]
    p: Annotated[list[Card], Field(min_length=2, max_length=2)] | None = None
    d: Annotated[list[Card], Field(min_length=2, max_length=2)]
    sh: StrictInt = Field(ge=52, le=MAX_SHOE_CARDS)
    rem: StrictInt = Field(ge=0, le=MAX_SHOE_CARDS)
    a: Annotated[list[Action], Field(max_length=MAX_ACTIONS)] = []
    dl: DealerPlay | None = None
    r: StrictInt | None = Field(default=None, ge=1, le=1)

    @model_validator(mode="after")
    def _fields_fit(self) -> RoundPlayedV1:
        amount, chips = self.b
        if not 1 <= amount <= INT32_MAX or not amount <= chips <= INT32_MAX:
            raise ValueError("b is [bet, chips before the bet], with the bet within the chips")
        if self.p is None and self.r is None:
            raise ValueError("p (the deal) is missing and the round was not resumed")
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


# event type -> (the current schema or None, the pre-#3284 one or None)
_MODELS: dict[str, tuple[type[BaseModel] | None, type[BaseModel] | None]] = {
    BET_PLACED: (None, LegacyBetPlaced),
    HAND_DEALT: (None, LegacyHandDealt),
    PLAYER_ACTION: (None, LegacyPlayerAction),
    ROUND_PLAYED: (RoundPlayedV1, None),
    HAND_RESOLVED: (HandResolvedV1, LegacyHandResolved),
}

EVENT_TYPES = frozenset(_MODELS)


def validate_hand_event(name: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """The ``data`` to store for Blackjack event ``name``, or ``None`` to drop it.

    Dropped (logged, reported to Sentry by reason only): more than
    ``MAX_EVENT_BYTES`` of compact JSON, or any schema violation (wrong type, a
    card that is not a card, an unknown key, a ``v`` this module does not know, a
    ``v`` on a type only older builds send). Otherwise stored exactly as sent.
    ``name`` must be one of ``EVENT_TYPES``; anything else is returned as is.
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
        if model is None:
            raise ValueError("this type has no v1 schema; only older builds send it")
        model.model_validate(data)
    except (ValidationError, ValueError) as e:
        types = (
            sorted({err["type"] for err in e.errors()})[:10]
            if isinstance(e, ValidationError)
            else ["value_error"]
        )
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

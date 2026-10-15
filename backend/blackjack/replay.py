"""Read a recorded Blackjack run back as rounds (#3284, epic #3273).

``scripts/replay_game.py`` prints the stored events of a game as JSON; for a
Blackjack game it also prints this: each round, with every card dealt and drawn
(split hands and the dealer's play included), the bet, the outcome and the chips.
The input is the game's events in ``event_index`` order, as ``(type, data)``
pairs; the shapes are in ``blackjack/events.py``.

Read only: nothing here validates, stores or changes anything. Events from
builds before #3284 carry no cards, so a round made of them is listed as such
and not rebuilt. A round with events missing (the app drops an event over its
cap, or a batch is lost) is shown as far as it goes.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

_VALUE = {"A": 11, "T": 10, "J": 10, "Q": 10, "K": 10}
_ACTION = {"h": "hit", "s": "stand", "d": "double", "p": "split"}


def hand_value(cards: Iterable[str]) -> int:
    """The best total of a hand: aces count 11 until that busts it."""
    total = aces = 0
    for card in cards:
        total += _VALUE.get(card[0], 0) or int(card[0])
        aces += card[0] == "A"
    while total > 21 and aces:
        total -= 10
        aces -= 1
    return total


def show(cards: Iterable[str]) -> str:
    """Cards as the app records them, ``"TS 7H"`` (T is ten): a card greps the same here and in the data."""
    return " ".join(cards)


@dataclass
class Round:
    unit: int | None = None
    bet: int | None = None
    chips_before: int | None = None
    shoe: tuple[int, int] | None = None  # (cards left after the deal, shoe size)
    player: list[list[str]] = field(default_factory=list)
    dealer: list[str] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)
    results: list[str] = field(default_factory=list)
    chips_after: int | None = None
    legacy: bool = False


def _bet(r: Round, d: Mapping[str, Any]) -> None:
    r.bet = d.get("amount")
    if isinstance(d.get("chips_remaining"), int) and isinstance(r.bet, int):
        r.chips_before = d["chips_remaining"] + r.bet


def _dealt(r: Round, d: Mapping[str, Any]) -> None:
    if "p" not in d:  # an older build: the cards are objects, the hole card is missing
        r.legacy = True
        return
    r.player = [list(d["p"])]
    r.dealer = list(d["d"])
    r.shoe = (d["rem"], d["sh"])
    r.steps.append(
        f"deal     you {show(d['p'])} | dealer hole {show(d['d'][:1])} up {show(d['d'][1:])}"
    )


def _action(r: Round, d: Mapping[str, Any]) -> None:
    if "a" not in d:
        r.legacy = True
        return
    i, name = d["i"], _ACTION.get(d["a"], d["a"])
    if i >= len(r.player):
        r.steps.append(f"{name:<8} hand {i + 1} (earlier events missing)")
    elif d["a"] in ("h", "d"):
        r.player[i].append(d["c"])
        cards = r.player[i]
        total = hand_value(cards)
        r.steps.append(
            f"{name:<8} hand {i + 1} draws {show([d['c']])} -> {show(cards)} = {total}"
            + (" BUST" if total > 21 else "")
        )
    elif d["a"] == "p":
        r.player[i : i + 1] = [list(d["h"][0]), list(d["h"][1])]
        r.steps.append(f"split    hand {i + 1} -> " + " | ".join(show(h) for h in d["h"]))
    else:
        r.steps.append(f"stand    hand {i + 1} on {hand_value(r.player[i])}")


def _dealer(r: Round, d: Mapping[str, Any]) -> None:
    drew = list(d["d"])
    r.dealer = [d["h"], *(r.dealer[1:2] if len(r.dealer) >= 2 else []), *drew]
    r.steps.append(
        f"dealer   hole {show([d['h']])}"
        + (f" draws {show(drew)}" if drew else " stands")
        + f" -> {show(r.dealer)} = {d['t']}"
        + (" BUST" if d.get("b") == 1 else "")
    )


def _resolved(r: Round, d: Mapping[str, Any]) -> None:
    if "o" not in d:
        r.legacy = True
        return
    sign = f"+{d['p']}" if d["p"] > 0 else str(d["p"])
    r.results.append(
        f"hand {d['i'] + 1} {show(d['c'])} = {hand_value(d['c'])} {d['o'].upper()} {sign}"
    )
    r.chips_after = d["ch"]


_STEP = {
    "hand_dealt": _dealt,
    "player_action": _action,
    "dealer_played": _dealer,
    "hand_resolved": _resolved,
}


def rounds(events: Iterable[tuple[str, Mapping[str, Any]]]) -> list[Round]:
    """The run's rounds, each from its ``bet_placed`` to its last ``hand_resolved``."""
    out: list[Round] = []
    current: Round | None = None
    for name, data in events:
        if name == "bet_placed":
            current = Round(unit=data.get("unit"))
            out.append(current)
            _bet(current, data)
        elif name in _STEP:
            if current is None:  # the round's start was lost
                current = Round(unit=data.get("unit"))
                out.append(current)
            _STEP[name](current, data)
    return out


def render_rounds(events: Iterable[tuple[str, Mapping[str, Any]]]) -> list[str]:
    """Plain-text lines for every round of the run; empty when nothing was dealt."""
    lines: list[str] = []
    all_rounds = rounds(events)
    for n, r in enumerate(all_rounds, start=1):
        head = f"round {r.unit if r.unit is not None else n}"
        head += f"  bet {r.bet}" if r.bet is not None else "  bet ?"
        if r.shoe:
            head += f"  shoe {r.shoe[0]}/{r.shoe[1]}"
        lines.append(head)
        if r.legacy and not r.steps:
            lines.append("  (recorded by an older build: no cards)")
        lines += [f"  {s}" for s in r.steps]
        lines += [f"  result   {s}" for s in r.results]
        if r.chips_after is not None:
            lines.append(
                f"  chips    {r.chips_before if r.chips_before is not None else '?'} -> {r.chips_after}"
            )
    if all_rounds:
        first = next((r.chips_before for r in all_rounds if r.chips_before is not None), None)
        last = next(
            (r.chips_after for r in reversed(all_rounds) if r.chips_after is not None), None
        )
        lines.append(
            f"run: {len(all_rounds)} rounds, chips {first if first is not None else '?'} -> {last if last is not None else '?'}"
        )
    return lines

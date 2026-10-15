"""Read a recorded Blackjack run back as rounds (#3284, epic #3273).

``scripts/replay_game.py`` prints the stored events of a game as JSON; for a
Blackjack game it also prints this: each round, with every card dealt and drawn
(split hands and the dealer's play included), the bet, the outcome and the chips.
The input is the game's events in ``event_index`` order, as ``(type, data)``
pairs; the shapes are in ``blackjack/events.py``: a ``round_played`` per round
and a ``hand_resolved`` per hand.

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
    resumed: bool = False


def _action(r: Round, item: list[Any]) -> None:
    code, i = item[0], item[1]
    name = _ACTION.get(code, code)
    if i >= len(r.player):
        r.steps.append(f"{name:<8} hand {i + 1} (earlier events missing)")
    elif code in ("h", "d"):
        r.player[i].append(item[2])
        cards = r.player[i]
        total = hand_value(cards)
        r.steps.append(
            f"{name:<8} hand {i + 1} draws {show([item[2]])} -> {show(cards)} = {total}"
            + (" BUST" if total > 21 else "")
        )
    elif code == "p":
        r.player[i : i + 1] = [list(item[2][0]), list(item[2][1])]
        r.steps.append(f"split    hand {i + 1} -> " + " | ".join(show(h) for h in item[2]))
    else:
        r.steps.append(f"stand    hand {i + 1} on {hand_value(r.player[i])}")


def _played(data: Mapping[str, Any]) -> Round:
    """A ``round_played`` event as a round with its steps; results come later."""
    r = Round(unit=data.get("unit"))
    r.bet, r.chips_before = data["b"]
    r.shoe = (data["rem"], data["sh"])
    r.dealer = list(data["d"])
    r.resumed = data.get("r") == 1
    if "p" in data:
        r.player = [list(data["p"])]
        r.steps.append(
            f"deal     you {show(data['p'])} | dealer hole {show(data['d'][:1])} up {show(data['d'][1:])}"
        )
    else:
        r.steps.append(
            f"resumed  after the app was killed mid-hand; dealer hole {show(data['d'][:1])} "
            f"up {show(data['d'][1:])}, earlier actions not recorded"
        )
    for item in data.get("a", []):
        _action(r, item)
    dl = data.get("dl")
    if dl:
        drew = list(dl["d"])
        r.dealer = [*r.dealer, *drew]
        r.steps.append(
            f"dealer   hole {show(r.dealer[:1])}"
            + (f" draws {show(drew)}" if drew else " stands")
            + f" -> {show(r.dealer)} = {dl['t']}"
            + (" BUST" if dl.get("b") == 1 else "")
        )
    return r


def _resolved(r: Round, d: Mapping[str, Any]) -> None:
    if "o" not in d:
        r.legacy = True
        return
    sign = f"+{d['p']}" if d["p"] > 0 else str(d["p"])
    r.results.append(
        f"hand {d['i'] + 1} {show(d['c'])} = {hand_value(d['c'])} {d['o'].upper()} {sign}"
    )
    r.chips_after = d["ch"]


def rounds(events: Iterable[tuple[str, Mapping[str, Any]]]) -> list[Round]:
    """The run's rounds, each from its ``round_played`` to its last ``hand_resolved``."""
    out: list[Round] = []
    current: Round | None = None
    for name, data in events:
        if name == "round_played":
            current = _played(data)
            out.append(current)
        elif name in ("bet_placed", "hand_dealt", "player_action"):
            if name == "bet_placed":  # an older build: no cards, only the bet
                current = Round(unit=data.get("unit"), legacy=True, bet=data.get("amount"))
                out.append(current)
            elif current is not None:
                current.legacy = True
        elif name == "hand_resolved":
            if current is None:  # the round's start was lost
                current = Round(unit=data.get("unit"))
                out.append(current)
            _resolved(current, data)
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
            before = r.chips_before if r.chips_before is not None else "?"
            lines.append(f"  chips    {before} -> {r.chips_after}")
    if all_rounds:
        first = next((r.chips_before for r in all_rounds if r.chips_before is not None), None)
        last = next(
            (r.chips_after for r in reversed(all_rounds) if r.chips_after is not None), None
        )
        lines.append(
            f"run: {len(all_rounds)} rounds, "
            f"chips {first if first is not None else '?'} -> {last if last is not None else '?'}"
        )
    return lines

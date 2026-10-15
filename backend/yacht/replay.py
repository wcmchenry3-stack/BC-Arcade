"""Rebuild a Yacht game's scorecards from its recorded ``turn_completed`` events (#3282).

The app records every turn of both players (``frontend/src/game/yacht/replay.ts``;
the event is described in ``yacht/turn_event.py``). The starting scorecard is
empty and the dice of every roll are recorded, so a finished game, solo or vs
the computer, rebuilds from its events alone: for each turn the last roll's dice
and the chosen category go through the scoring rules below (a port of
``engine.ts``; ``tests/test_yacht_replay.py`` plays the two against each other),
and everything else the event says is checked against the result.

``scripts/replay_game.py <game_id>`` prints this for a Yacht game. A recorded
game with a gap (a dropped batch, an app kill: a turn whose ``ro`` is set lost
some of its rolls, a missing round shows as a round mismatch) still rebuilds as
far as it goes; every disagreement is a line in ``Rebuilt.problems``, never an
exception.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from yacht.models import CATEGORY_MAX, UPPER_BONUS_THRESHOLD, UPPER_BONUS_VALUE, UPPER_CATEGORIES
from yacht.turn_event import CATEGORY_ORDER, TURN_COMPLETED

YACHT_BONUS_VALUE = 100
_FACE_TO_UPPER = dict(enumerate(UPPER_CATEGORIES, start=1))
_LOWER = tuple(c for c in CATEGORY_ORDER if c not in UPPER_CATEGORIES)


def _has_run(dice: Iterable[int], length: int) -> bool:
    faces = set(dice)
    return any(all(start + i in faces for i in range(length)) for start in range(1, 8 - length))


def category_score(category: str, dice: list[int]) -> int:
    """The plain score of ``dice`` in ``category`` (``calculateScore`` in ``engine.ts``)."""
    counts = Counter(dice)
    if category in UPPER_CATEGORIES:
        face = UPPER_CATEGORIES.index(category) + 1
        return counts[face] * face
    return {
        "three_of_a_kind": sum(dice) if max(counts.values()) >= 3 else 0,
        "four_of_a_kind": sum(dice) if max(counts.values()) >= 4 else 0,
        "full_house": 25 if sorted(counts.values()) == [2, 3] else 0,
        "small_straight": 30 if _has_run(dice, 4) else 0,
        "large_straight": 40 if _has_run(dice, 5) else 0,
        "yacht": 50 if len(counts) == 1 else 0,
        "chance": sum(dice),
    }[category]


def joker_score(category: str, dice: list[int]) -> int:
    """The score of an extra Yacht in ``category`` (``calculateJokerScore``)."""
    if category in UPPER_CATEGORIES:
        return category_score(category, dice)
    return {
        "full_house": 25,
        "small_straight": 30,
        "large_straight": 40,
        "yacht": 50,
    }.get(category, sum(dice))


@dataclass
class Card:
    """One player's scorecard as the replay builds it."""

    categories: dict[str, int | None] = field(default_factory=lambda: dict.fromkeys(CATEGORY_ORDER))
    yacht_bonus_count: int = 0
    round: int = 1
    turns: int = 0

    @property
    def upper_subtotal(self) -> int:
        return sum(self.categories[c] or 0 for c in UPPER_CATEGORIES)

    @property
    def upper_bonus(self) -> int:
        done = all(self.categories[c] is not None for c in UPPER_CATEGORIES)
        return UPPER_BONUS_VALUE if done and self.upper_subtotal >= UPPER_BONUS_THRESHOLD else 0

    @property
    def total(self) -> int:
        filled = sum(v for v in self.categories.values() if v is not None)
        return filled + self.upper_bonus + self.yacht_bonus_count * YACHT_BONUS_VALUE

    @property
    def finished(self) -> bool:
        return all(v is not None for v in self.categories.values())

    def joker_active(self, dice: list[int]) -> bool:
        return len(set(dice)) == 1 and self.categories["yacht"] == CATEGORY_MAX["yacht"]


@dataclass
class Rebuilt:
    """Seat -> the scorecard rebuilt from that seat's turns, and every disagreement."""

    cards: dict[int, Card] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)


def _alternatives(card: Card, dice: list[int], chosen: str) -> list[int]:
    """The other legal categories as the app records them: flat ``[category, value, ...]``."""
    if card.joker_active(dice):
        upper = _FACE_TO_UPPER[dice[0]]
        if card.categories[upper] is None:
            options = [upper]
        else:
            options = [c for c in _LOWER if c != "yacht" and card.categories[c] is None]
            options = options or [c for c in UPPER_CATEGORIES if card.categories[c] is None]
        value = joker_score
    else:
        options = [c for c in CATEGORY_ORDER if card.categories[c] is None]
        value = category_score
    return [x for c in options if c != chosen for x in (CATEGORY_ORDER.index(c), value(c, dice))]


def rebuild(events: Iterable[tuple[str, Mapping[str, Any]]]) -> Rebuilt:
    """Both scorecards from ``(event_type, data)`` pairs in ``event_index`` order.

    Anything that is not a ``turn_completed`` event is ignored. A turn that
    does not fit the card (an unknown or filled category, a malformed shape) is
    a problem and is skipped; the others still apply.
    """
    out = Rebuilt()
    for name, data in events:
        if name != TURN_COMPLETED:
            continue
        actor = data.get("actor") or {}
        seat = actor.get("seat", 0) if isinstance(actor, Mapping) else 0
        card = out.cards.setdefault(seat, Card())
        at = f"seat {seat} round {data.get('r')}"
        try:
            rolls = data["rolls"]
            dice = list(rolls[-1][0])
            category = CATEGORY_ORDER[data["s"][0]]
            recorded = data["s"][1]
        except (KeyError, IndexError, TypeError):
            out.problems.append(f"{at}: malformed turn")
            continue
        if card.categories[category] is not None:
            out.problems.append(f"{at}: {category} is already filled")
            continue
        if data.get("r") != card.round:
            out.problems.append(f"{at}: expected round {card.round}")
        if data.get("ro"):
            out.problems.append(f"{at}: {data['ro']} roll(s) lost to an app kill")
        joker = card.joker_active(dice)
        value = joker_score(category, dice) if joker else category_score(category, dice)
        upper_bonus_before = card.upper_bonus
        expected_alt = _alternatives(card, dice, category)
        card.categories[category] = value
        if joker:
            card.yacht_bonus_count += 1
        card.round += 1
        card.turns += 1
        checks = {
            "value": value == recorded,
            "joker flag": (data.get("jk") == 1) == joker,
            "yacht bonus flag": (data.get("yb") == 1) == joker,
            "upper bonus flag": (data.get("ub") == 1)
            == (upper_bonus_before == 0 < card.upper_bonus),
            "yacht bonus count": data.get("yc", 0) == card.yacht_bonus_count,
            "upper subtotal": data.get("us") == card.upper_subtotal,
            "total": data.get("tot") == card.total,
            "alternatives": (data.get("alt") or []) == expected_alt,
        }
        out.problems.extend(f"{at}: {what} differs" for what, ok in checks.items() if not ok)
    return out


def render_scorecards(rebuilt: Rebuilt, final_score: int | None = None) -> list[str]:
    """The rebuilt scorecards as plain text lines, one column per seat."""
    lines = ["scorecards rebuilt from turn_completed events"]
    if not rebuilt.cards:
        return [*lines, "  no turn_completed events (a game from before #3282, or none recorded)"]
    seats = sorted(rebuilt.cards)
    label = {0: "player", 1: "computer"}
    lines.append(
        "  " + f"{'category':<16}" + "".join(f"{label.get(s, f'seat {s}'):>10}" for s in seats)
    )
    for category in CATEGORY_ORDER:
        cells = "".join(
            f"{'-' if (v := rebuilt.cards[s].categories[category]) is None else v:>10}"
            for s in seats
        )
        lines.append("  " + f"{category:<16}" + cells)
    for title, getter in (
        ("upper bonus", lambda c: c.upper_bonus),
        ("yacht bonus", lambda c: c.yacht_bonus_count * YACHT_BONUS_VALUE),
        ("total", lambda c: c.total),
    ):
        lines.append(
            "  " + f"{title:<16}" + "".join(f"{getter(rebuilt.cards[s]):>10}" for s in seats)
        )
    lines.append("  " + f"{'turns':<16}" + "".join(f"{rebuilt.cards[s].turns:>10}" for s in seats))
    if final_score is not None and 0 in rebuilt.cards:
        agrees = "matches" if rebuilt.cards[0].total == final_score else "DIFFERS from"
        lines.append(f"  player total {agrees} games.final_score ({final_score})")
    lines.append(
        f"  problems   {len(rebuilt.problems)}" if rebuilt.problems else "  problems   none"
    )
    lines.extend(f"    {p}" for p in rebuilt.problems)
    return lines

"""Daily cross-game challenge — per-game goals, two slates, deterministic pick (#2392, #2453).

Same stateless pattern as ``daily_word/puzzle.py``: nothing is stored. Each day
gets three goals — **Daily Word always**, plus two goals in two other games —
picked from the day's ordinal and ``DAILY_CHALLENGE_SALT``. The day *ordinal*
(not Daily Word's ``YYYYMMDD``) is used because it always steps by one, so month
ends cannot repeat a pick. ``challenge_id`` is the local date, ``"YYYY-MM-DD"``.

Goals are per game
------------------
There is no one measurement that fits every game, so each game owns three goals
(easy / medium / hard) worded in its own terms — moves, pairs, highest tile,
chips, guesses. A ``Goal`` carries ``game_type`` + ``kind`` + ``target`` (never
display copy — the client builds that in its own i18n namespace) and an
``evaluate(facts)`` predicate. ``facts`` is one finished game's measures: the
result block the game reported on ``PATCH /games/{id}/complete`` (merged into
``games.metadata``, #2449) plus the ``final_score`` and ``duration_ms`` columns —
build it with ``game_facts``. A goal is met if *any one* of the player's games of
that type today satisfies it; nothing is aggregated across games. Abandoned games
count for progress goals (``moves_at_least`` and friends) because the game
reports ``won: false`` plus its progress on abandon; only ``won`` goals need a
win. ``games.outcome`` is lifecycle-only and is never read here.

Fields the evaluators read, per game (the result each game must send):
    daily_word  is_complete, won, guesses_used         (#2451)
    twenty48    final_score, highest_tile              (already sent)
    solitaire   won, moves                             (SolitaireResult)
    mahjong     won, pairs, duration_ms (column)       (MahjongResult)
    freecell    won, moves                             (#2452)
    blackjack   hands_played, hands_won, starting_chips, final_chips (BlackjackResult)

Slates
------
``FREE_GOAL_POOL`` holds the games a store build can show; ``PREMIUM_GOAL_POOL`` is
a superset for sessions entitled to premium games. Which slate a session gets is
decided per request from ``game_types.is_premium`` + entitlements (service layer,
#2454) — never from a list in this module. Premium-only goal specs are
post-launch (#2458), so today the two pools hold the same games and both slates
pick identically.

Rules the pick enforces (all tested): Daily Word is always present; the other two
games differ from each other and from the previous day's two; at most one goal
per day is luck-dependent (a win, or a blackjack run ending in profit) — the slot
rotates by day, and any other such goal is swapped for that game's easy goal
(every game's easy goal is not luck-dependent).
Targets are tuned to be reachable and are marked ``tune post-launch``.
SALT comes from the DAILY_CHALLENGE_SALT env var (default 0); changing it
shifts the whole future schedule and reshuffles the game order.
"""

from __future__ import annotations

import hashlib
import logging
import os
import random
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from functools import cache
from typing import Any, Literal

logger = logging.getLogger(__name__)


def parse_salt(raw: str | None) -> int:
    """DAILY_CHALLENGE_SALT as an int. Never raises: main.py imports this module,
    so a secret pasted in the wrong format must not stop the whole API booting.
    A non-integer value is hashed instead — still secret, still stable."""
    value = (raw or "").strip()
    if not value:
        return 0
    try:
        return int(value)
    except ValueError:
        logger.warning("DAILY_CHALLENGE_SALT is not an integer — using a hash of it")
        return int.from_bytes(hashlib.sha256(value.encode()).digest()[:8], "big")


# Must be set in production; the default 0 makes the schedule trivially derivable.
SALT = parse_salt(os.environ.get("DAILY_CHALLENGE_SALT"))

Tier = Literal["easy", "medium", "hard"]
Slate = Literal["free", "premium"]
TIERS: tuple[Tier, ...] = ("easy", "medium", "hard")

# One finished game's measures — see ``game_facts``.
Facts = Mapping[str, Any]

ALWAYS_PRESENT = "daily_word"
GOALS_PER_DAY = 3


def game_facts(
    metadata: Mapping[str, Any] | None,
    final_score: int | None,
    duration_ms: int | None,
) -> dict[str, Any]:
    """The measures ``Goal.evaluate`` reads for one finished game row.

    ``metadata`` is ``games.metadata`` (creation fields + the merged result
    block). The ``final_score`` / ``duration_ms`` columns are authoritative, so
    they win when set.
    """
    facts: dict[str, Any] = dict(metadata or {})
    if final_score is not None:
        facts["final_score"] = final_score
    if duration_ms is not None:
        facts["duration_ms"] = duration_ms
    return facts


def _number(facts: Facts, name: str) -> int | float | None:
    value = facts.get(name)
    # bool is an int subclass — ``won: true`` must not read as the number 1.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


@dataclass(frozen=True)
class Goal:
    """One goal. ``game_type`` + ``kind`` + ``target`` is the whole wire contract."""

    game_type: str
    kind: str
    target: int | None
    tier: Tier
    # True when the goal depends on the game going the player's way (a win, or
    # ending a blackjack run in profit) — the luck-dependent kind. At most one
    # such goal is picked per day.
    is_win: bool
    check: Callable[[Facts], bool] = field(repr=False, compare=False)
    # The numeric measure a progress goal tracks (``at_least`` goals), so the
    # service can report the best value without parsing ``kind``.
    measure: str | None = None

    @property
    def id(self) -> str:
        """Stable within a challenge — the client keys its goal rows on it."""
        base = f"{self.game_type}:{self.kind}"
        return base if self.target is None else f"{base}:{self.target}"

    def evaluate(self, facts: Facts) -> bool:
        """True if the game these ``facts`` describe meets the goal."""
        return bool(self.check(facts))


def _completed(game_type: str, tier: Tier) -> Goal:
    """Played through to the end, win or lose (Daily Word's ``is_complete``)."""
    return Goal(game_type, "completed", None, tier, False, lambda f: f.get("is_complete") is True)


def _won(game_type: str, tier: Tier) -> Goal:
    return Goal(game_type, "won", None, tier, True, lambda f: f.get("won") is True)


def _at_least(game_type: str, measure: str, target: int, tier: Tier) -> Goal:
    """Reach ``target`` on a numeric measure; no win needed, abandoned games count."""

    def check(f: Facts) -> bool:
        value = _number(f, measure)
        return value is not None and value >= target

    return Goal(game_type, f"{measure}_at_least", target, tier, False, check, measure)


def _won_within(game_type: str, measure: str, limit: int, tier: Tier) -> Goal:
    """Win while keeping a measure (moves, guesses, time) at or under ``limit``."""

    def check(f: Facts) -> bool:
        value = _number(f, measure)
        return f.get("won") is True and value is not None and value <= limit

    return Goal(game_type, f"won_{measure}_at_most", limit, tier, True, check)


def _chips_gained(game_type: str, tier: Tier) -> Goal:
    """End a blackjack run with more chips than it started with."""

    def check(f: Facts) -> bool:
        start, end = _number(f, "starting_chips"), _number(f, "final_chips")
        return start is not None and end is not None and end > start

    return Goal(game_type, "chips_gained", None, tier, True, check)


# Easy / medium / hard per game. Every game's *easy* goal must not require a win
# (the pick falls back to it) — tests enforce that. All numbers: tune post-launch.
FREE_GOAL_POOL: dict[str, tuple[Goal, Goal, Goal]] = {
    "daily_word": (
        _completed("daily_word", "easy"),
        _won("daily_word", "medium"),
        _won_within("daily_word", "guesses_used", 4, "hard"),
    ),
    "twenty48": (
        _at_least("twenty48", "final_score", 500, "easy"),
        _at_least("twenty48", "highest_tile", 512, "medium"),
        _at_least("twenty48", "final_score", 2500, "hard"),
    ),
    # Klondike deals are not always winnable, so solitaire's win goals are the
    # luck-dependent kind. A win takes at least 52 foundation moves, so the hard
    # limit is well above that (a 60-move win is not realistic).
    "solitaire": (
        _at_least("solitaire", "moves", 10, "easy"),
        _won("solitaire", "medium"),
        _won_within("solitaire", "moves", 120, "hard"),
    ),
    # 72 pairs to clear; the hard limit is minutes, not seconds (duration_ms).
    "mahjong": (
        _at_least("mahjong", "pairs", 10, "easy"),
        _won("mahjong", "medium"),
        _won_within("mahjong", "duration_ms", 480_000, "hard"),
    ),
    "freecell": (
        _at_least("freecell", "moves", 5, "easy"),
        _won("freecell", "medium"),
        _won_within("freecell", "moves", 100, "hard"),
    ),
    "blackjack": (
        _at_least("blackjack", "hands_played", 3, "easy"),
        _chips_gained("blackjack", "medium"),
        _at_least("blackjack", "hands_won", 3, "hard"),
    ),
}

# Premium-only games' goals arrive with #2458; until then the premium slate is
# the free pool. Kept as a separate name so the slate split is real, not implied.
PREMIUM_GOAL_POOL: dict[str, tuple[Goal, Goal, Goal]] = {**FREE_GOAL_POOL}

GOAL_POOLS: dict[str, dict[str, tuple[Goal, Goal, Goal]]] = {
    "free": FREE_GOAL_POOL,
    "premium": PREMIUM_GOAL_POOL,
}

_MIN_ROTATION = 4  # two games a day, none repeated the next day (needs >= 4 to alternate)


@dataclass(frozen=True)
class Template:
    id: str
    goals: tuple[Goal, ...]


@cache
def rotation(slate: Slate, salt: int) -> tuple[str, ...]:
    """The non-Daily-Word games in salt-seeded order. Reproducible for a given salt."""
    games = sorted(g for g in GOAL_POOLS[slate] if g != ALWAYS_PRESENT)
    if len(games) < _MIN_ROTATION:
        raise ValueError(f"{slate} pool has {len(games)} rotating games; need {_MIN_ROTATION}")
    random.Random(salt).shuffle(games)
    return tuple(games)


def pick_games(day: date, slate: Slate, salt: int) -> tuple[str, str]:
    """Two games for ``day``. They step two places along the rotation each day, so
    the pair shares no game with the previous day's (and the ordinal always
    advances by one, unlike YYYYMMDD arithmetic across month ends).

    A pair is two neighbours in the rotation, so a slate has ``len(rotation)``
    distinct pairs — but only if that length is odd. With an even length the step
    of two never lands on odd positions and half the pairs never occur; a test
    fails if a pool ever reaches that state so the schedule is reconsidered."""
    order = rotation(slate, salt)
    base = (2 * day.toordinal() + salt) % len(order)
    return order[base], order[(base + 1) % len(order)]


def pick_template(day: date, slate: Slate, salt: int) -> Template:
    pool = GOAL_POOLS[slate]
    ordinal = day.toordinal()
    games = (ALWAYS_PRESENT, *pick_games(day, slate, salt))
    # Consecutive goals get consecutive tiers, so a day mixes difficulty.
    picked = [pool[game][(ordinal + salt + i) % len(TIERS)] for i, game in enumerate(games)]
    final = list(picked)
    # At most one win goal a day; who keeps it rotates by day so it is not always
    # Daily Word's. Any other win goal falls back to that game's easy goal.
    win_taken = False
    for i in range(GOALS_PER_DAY):
        idx = (ordinal + i) % GOALS_PER_DAY
        if not picked[idx].is_win:
            continue
        if win_taken:
            final[idx] = pool[picked[idx].game_type][0]
        else:
            win_taken = True
    return Template(id="+".join(g.id for g in final), goals=tuple(final))


def template_for(day: date, slate: Slate = "free") -> Template:
    return pick_template(day, slate, SALT)


@dataclass(frozen=True)
class LocalDay:
    """The player's calendar day and the UTC instants that bound it."""

    date: date
    start_utc: datetime
    end_utc: datetime


def local_day_of(day: date, tz_offset_minutes: int) -> LocalDay:
    """The window for calendar ``day`` in a client ``tz_offset_minutes`` east of UTC.

    Used for today (``local_day``) and for any past day (the streak replays the
    challenge over a range), so there is one definition of where a local day starts.
    """
    start_utc = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) - timedelta(
        minutes=tz_offset_minutes
    )
    return LocalDay(date=day, start_utc=start_utc, end_utc=start_utc + timedelta(days=1))


def local_day(tz_offset_minutes: int, utc_now: datetime | None = None) -> LocalDay:
    """Resolve "today" for a client ``tz_offset_minutes`` east of UTC (as Daily Word does)."""
    if utc_now is None:
        utc_now = datetime.now(timezone.utc)
    local_date = (utc_now + timedelta(minutes=tz_offset_minutes)).date()
    return local_day_of(local_date, tz_offset_minutes)

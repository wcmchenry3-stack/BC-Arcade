"""Per-install daily-challenge picks: personal targets (#3993) and game selection (#3994).

Pure policy, no I/O: ``history.load_install_history`` reads what an install has
played, ``service.pick_for_install`` calls ``choose_core`` with it, and
``assignments.get_or_pin`` stores the result, so a day is picked at most once per
install. Strategy: docs/DAILY-CHALLENGE-STRATEGY.md §5-§7 and §12; contract:
docs/DAILY-CHALLENGE.md §1-§3.

The day's three core goals
--------------------------
1. Daily Word ``completed`` (always).
2. and 3. Two goals chosen by **affinity** (``choose_core``), each with a personal
   **target** (``personal_target``).

Bottle Sort has no personal goals for now: "solve N new levels" pinned for today+1 and
today+2 at the first open of today could already be met by today's own solves, so it
is deferred to an owner decision. Sort still appears on shared-template days.

Every goal is one of the existing kinds with an absolute target (``final_score_at_least``,
``highest_tile_at_least``, ``won``, ``won_moves_at_most``, ``solved``), so installed app
builds word it and ``Goal.evaluate`` scores it with no per-player logic.

``serves_shared`` sends a day to the shared frozen template instead: a new install
(fewer than ``MIN_FINISHED_GAMES`` finished games of games with specs, or none in the
affinity window), or a day the install could already have been served unpinned
(``InstallHistory.always_pinnable``), so goals a device already shows never change.

Targets (``personal_target``)
-----------------------------
From the install's last ``DAILY_CHALLENGE_HISTORY_GAMES`` (10) finished, non-abandoned
games of that game before the day starts:

* **median** of the measure, **stretched** by ``DAILY_CHALLENGE_STRETCH_PCT`` (12 %):
  up for "at least" goals, down for "at most" goals (moves on a win);
* **rounded** to the measure's unit (score 50 for 2048, 10 for Sudoku, 5 for Yacht and
  moves; the nearest power of two for a 2048 tile);
* **capped at the personal best**, so beating the best is never required (an "at
  least" target is at most the best, an "at most" limit at least the fewest moves);
* **floored** at the game's minimum (the easy-tier numbers of ``FREE_GOAL_POOL``);
  the floor wins over the cap for a player whose best is below it;
* **stepped down** after two consecutive misses: when, on the last two pinned days that
  held this (game, goal type) as a personal target, the game was played and the goal
  missed, the stretch is applied the other way (a tile target halves).
  Shared-template days and days the game was not played never count.

A game with fewer than ``MIN_FINISHED_GAMES`` finished games gets its cold-start goal
(``GameSpec.cold_type`` / ``cold_target``).

Selection (``choose_core``)
---------------------------
Eligible games are passed in (free games, plus entitled premium games with specs;
never a disabled game). Affinity is the install's finished games per local day over
the last ``DAILY_CHALLENGE_AFFINITY_DAYS`` (14): yesterday weighs 14, two days ago 13,
..., 14 days ago 1. Each core slot is drawn, from the best-ranked options, with
probability proportional to its game's affinity. Options are ranked by, in order:

1. no second luck-dependent goal (at most one a day);
2. not one of yesterday's core games (only while 3 or more games have affinity);
3. a game with affinity before one without;
4. a different game from the other slot (a one-game player gets two goal types of
   the one game instead);
5. not a (game, goal type) used in the last 2 days (no repeat within 3 days);
6. a different goal archetype from the other slot.

The draw is seeded from (session_id, day, ``SALT``), never the clock.
"""

from __future__ import annotations

import math
import random
import statistics
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import TYPE_CHECKING, Literal

from daily_challenge.definitions import (
    ALWAYS_PRESENT,
    FREE_GOAL_POOL,
    GOAL_POOLS,
    SALT,
    SORT_CATALOG_GOALS,
    Goal,
    goal_from_spec,
)
from settings import Settings

if TYPE_CHECKING:
    from daily_challenge.assignments import Assignment
    from daily_challenge.history import InstallHistory

# A game (and an install) needs this many finished games for a personal target.
MIN_FINISHED_GAMES = 3
# A (game, goal type) does not repeat within this many days (today included).
NO_REPEAT_DAYS = 3
# Discovery rest rule (#3995 uses it): a game offered as the bonus and not played that
# day this many times within REST_DAYS rests for REST_DAYS after the last of them.
REST_AFTER_IGNORES = 3
REST_DAYS = 30

_settings: Settings | None = None


def _get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def stretch_pct() -> int:
    """``DAILY_CHALLENGE_STRETCH_PCT`` (default 12, 0-50)."""
    return _get_settings().daily_challenge_stretch_pct


def affinity_days() -> int:
    """``DAILY_CHALLENGE_AFFINITY_DAYS`` (default 14)."""
    return _get_settings().daily_challenge_affinity_days


def history_games() -> int:
    """``DAILY_CHALLENGE_HISTORY_GAMES`` (default 10)."""
    return _get_settings().daily_challenge_history_games


# ---------------------------------------------------------------------------
# Goal specs per game (§12 "Goals per game", the free games)
# ---------------------------------------------------------------------------

Archetype = Literal["finish", "stretch", "progress", "skill"]


@dataclass(frozen=True)
class GoalType:
    """One kind of goal a game offers. ``measure`` is set for a personal target."""

    game_type: str
    name: str
    archetype: Archetype
    kind: str
    measure: str | None = None
    at_most: bool = False
    # at_least: the lowest target; at_most: the lowest limit (a win needs more moves).
    floor: int | None = None
    unit: int = 1
    power_of_two: bool = False

    @property
    def personal(self) -> bool:
        return self.measure is not None


@dataclass(frozen=True)
class GameSpec:
    game_type: str
    types: tuple[GoalType, ...]
    # The cold-start goal type; its target is ``cold_target`` (None for fixed goals).
    cold_type: str
    cold_target: int | None = None

    def type(self, name: str) -> GoalType:
        return next(t for t in self.types if t.name == name)


def _easy_target(game: str) -> int:
    target = FREE_GOAL_POOL[game][0].target
    assert target is not None, game
    return target


GAME_SPECS: dict[str, GameSpec] = {
    "twenty48": GameSpec(
        "twenty48",
        (
            GoalType(
                "twenty48",
                "score",
                "stretch",
                "final_score_at_least",
                "final_score",
                floor=_easy_target("twenty48"),
                unit=50,
            ),
            GoalType(
                "twenty48",
                "tile",
                "skill",
                "highest_tile_at_least",
                "highest_tile",
                floor=128,
                power_of_two=True,
            ),
        ),
        cold_type="score",
        cold_target=_easy_target("twenty48"),
    ),
    "solitaire": GameSpec(
        "solitaire",
        (
            GoalType("solitaire", "win", "finish", "won"),
            GoalType(
                "solitaire",
                "win_moves",
                "stretch",
                "won_moves_at_most",
                "moves",
                at_most=True,
                floor=60,
                unit=5,
            ),
        ),
        cold_type="win",
    ),
    "freecell": GameSpec(
        "freecell",
        (
            GoalType("freecell", "win", "finish", "won"),
            GoalType(
                "freecell",
                "win_moves",
                "stretch",
                "won_moves_at_most",
                "moves",
                at_most=True,
                floor=60,
                unit=5,
            ),
        ),
        cold_type="win",
    ),
    "sudoku": GameSpec(
        "sudoku",
        (
            GoalType("sudoku", "solve", "finish", "solved"),
            GoalType(
                "sudoku",
                "score",
                "stretch",
                "final_score_at_least",
                "final_score",
                floor=100,
                unit=10,
            ),
        ),
        cold_type="solve",
    ),
    "yacht": GameSpec(
        "yacht",
        (
            GoalType(
                "yacht",
                "score",
                "stretch",
                "final_score_at_least",
                "final_score",
                floor=_easy_target("yacht"),
                unit=5,
            ),
        ),
        cold_type="score",
        cold_target=_easy_target("yacht"),
    ),
}


# (game_type, kind) -> goal type name, for goals already pinned (shared templates
# included). A kind no spec names maps to itself (e.g. the old "moves_at_least").
def goal_type_name(goal: Goal) -> str:
    spec = GAME_SPECS.get(goal.game_type)
    if spec is not None:
        for t in spec.types:
            if t.kind == goal.kind:
                return t.name
    return goal.kind


def personal_type_keys() -> list[tuple[str, str]]:
    """Every (game, goal type) with a personal target: those that can step down."""
    return [(t.game_type, t.name) for s in GAME_SPECS.values() for t in s.types if t.personal]


def build_goal(gtype: GoalType, target: int | None) -> Goal:
    """The wire goal for ``gtype`` with an absolute ``target``, through the same
    builders as the pools (``goal_from_spec``), so a pinned goal rebuilds equal."""
    tier = "medium" if gtype.personal else "easy"
    return goal_from_spec(
        {"game_type": gtype.game_type, "kind": gtype.kind, "target": target, "tier": tier}
    )


# ---------------------------------------------------------------------------
# Targets (#3993)
# ---------------------------------------------------------------------------


def _round_half_up(value: float, unit: int) -> int:
    return max(unit, math.floor(value / unit + 0.5) * unit)


def personal_target(
    gtype: GoalType,
    values: Sequence[int | float],
    *,
    best: float,
    pct: int,
    stepped_down: bool = False,
) -> int:
    """The personal target for ``gtype`` from recent ``values`` of its measure.

    ``best`` is the personal best (the highest value for "at least", the fewest for
    "at most"). See the module docstring for the rule; every step is tested."""
    if not values:
        raise ValueError("personal_target needs at least one value")
    median = statistics.median(values)
    up = 1 + pct / 100
    down = 1 - pct / 100
    floor = gtype.floor or 0
    if gtype.power_of_two:
        target = 2 ** max(1, round(math.log2(median * up)))
        if stepped_down:
            target //= 2
        best_power = 2 ** math.floor(math.log2(best)) if best >= 2 else 2
        return max(min(target, best_power), floor)
    if gtype.at_most:
        raw = median * (up if stepped_down else down)
        target = _round_half_up(raw, gtype.unit)
        best_limit = math.ceil(best / gtype.unit) * gtype.unit
        return max(target, best_limit, floor)
    raw = median * (down if stepped_down else up)
    target = _round_half_up(raw, gtype.unit)
    best_cap = int(best // gtype.unit) * gtype.unit
    return max(min(target, best_cap), floor)


# ---------------------------------------------------------------------------
# Options for one game on one day
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Option:
    game_type: str
    type_name: str
    archetype: str
    goal: Goal


def _values(gtype: GoalType, facts_list: Iterable[Mapping]) -> list[int | float]:
    out: list[int | float] = []
    for facts in facts_list:
        if gtype.at_most and facts.get("won") is not True:
            continue
        value = facts.get(gtype.measure or "")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        out.append(value)
    return out


def _shared_goal_ids() -> frozenset[str]:
    """Every goal id a shared template can hold (the live pools, Sort's catalog goals)."""
    return frozenset(
        g.id
        for pool in (*GOAL_POOLS.values(), {"sort": SORT_CATALOG_GOALS})
        for goals in pool.values()
        for g in goals
    )


def _goal_of(assignment: Assignment, game: str, type_name: str) -> Goal | None:
    return next(
        (
            g
            for g in assignment.template.goals
            if g.game_type == game and goal_type_name(g) == type_name
        ),
        None,
    )


def last_personal_occurrences(
    history: InstallHistory, game: str, type_name: str, before: date, count: int = 2
) -> list[date]:
    """The latest ``count`` pinned days before ``before`` whose (game, type) goal was a
    personal target. A goal equal to a shared-pool goal is taken as shared (a pinned
    new-install day) and skipped; a personal target that happens to equal one is
    skipped too, which only delays a step-down."""
    shared = _shared_goal_ids()
    days = sorted(
        (
            d
            for d, a in history.pinned.items()
            if d < before
            and (goal := _goal_of(a, game, type_name)) is not None
            and goal.id not in shared
        ),
        reverse=True,
    )
    return days[:count]


def stepped_down(history: InstallHistory, game: str, type_name: str) -> bool:
    """Two consecutive misses: on the last two pinned days (before the first day this
    history serves, so a day still being played never counts) that held this (game,
    goal type) as a personal target, the install played the game and no finished
    game met the goal. A day the game was not played at all is not a miss."""
    days = last_personal_occurrences(history, game, type_name, history.first_day)
    if len(days) < 2:
        return False
    for d in days:
        goal = _goal_of(history.pinned[d], game, type_name)
        assert goal is not None
        if not history.played_on(game, d) or history.met_on(goal, d):
            return False
    return True


def options_for(game: str, history: InstallHistory, day: date, *, pct: int) -> list[Option]:
    """The goals ``game`` can offer on ``day``: its cold-start goal with fewer than
    ``MIN_FINISHED_GAMES`` finished games, else every type that has the data."""
    spec = GAME_SPECS[game]
    recent = history.recent_facts(game, day, history_games())
    goals: list[tuple[GoalType, int | None]] = []
    if len(recent) < MIN_FINISHED_GAMES:
        goals.append((spec.type(spec.cold_type), spec.cold_target))
    else:
        for gtype in spec.types:
            if not gtype.personal:
                goals.append((gtype, None))
                continue
            values = _values(gtype, recent)
            if len(values) < MIN_FINISHED_GAMES:
                continue
            if gtype.at_most:
                best: int | float = min(values)
            elif gtype.measure == "final_score":
                best = max(max(values), history.best_final_score(game, day))
            else:
                best = max(values)
            target = personal_target(
                gtype,
                values,
                best=best,
                pct=pct,
                stepped_down=stepped_down(history, game, gtype.name),
            )
            goals.append((gtype, target))
    return [Option(game, t.name, t.archetype, build_goal(t, target)) for t, target in goals]


# ---------------------------------------------------------------------------
# Selection (#3994)
# ---------------------------------------------------------------------------


def serves_shared(history: InstallHistory, day: date) -> bool:
    """Whether ``day``'s pick is the shared template: a new install
    (``is_new_install``), or one that could already have been served ``day`` unpinned
    (``InstallHistory.always_pinnable``), so the goals a device may hold never change."""
    return is_new_install(history, day) or not history.always_pinnable(day)


def is_new_install(history: InstallHistory, day: date) -> bool:
    """Fewer than ``MIN_FINISHED_GAMES`` finished games before ``day``, or none in the
    affinity window: such an install gets the shared frozen template exactly."""
    if history.finished_before(day) < MIN_FINISHED_GAMES:
        return True
    return not any(history.affinity(day).values())


def _rng(session_id: str, day: date, salt: int) -> random.Random:
    # A str seed is hashed with SHA-512 (random's version 2): stable across processes.
    return random.Random(f"{session_id}|{day.isoformat()}|{salt}")


def choose_core(
    history: InstallHistory,
    day: date,
    eligible: Sequence[str],
    *,
    session_id: str,
    salt: int = SALT,
    pct: int | None = None,
) -> tuple[Goal, Goal, Goal]:
    """The day's three core goals: Daily Word, then two drawn by affinity under the
    variety guard (module docstring)."""
    pct = stretch_pct() if pct is None else pct
    rng = _rng(session_id, day, salt)
    affinity = history.affinity(day)
    options = [
        opt
        for game in sorted(eligible)
        if game in GAME_SPECS
        for opt in options_for(game, history, day, pct=pct)
    ]
    with_affinity = {o.game_type for o in options if affinity.get(o.game_type, 0) > 0}
    guard = len(with_affinity) >= 3
    yesterday = history.pinned.get(day - timedelta(days=1))
    yesterday_games = (
        {g.game_type for g in yesterday.template.goals[1:]} if yesterday is not None else set()
    )
    recent_pairs = {
        (g.game_type, goal_type_name(g))
        for back in range(1, NO_REPEAT_DAYS)
        if (a := history.pinned.get(day - timedelta(days=back))) is not None
        for g in a.template.goals[1:]
    }

    chosen: list[Option] = []
    for _slot in range(2):
        ranked: list[tuple[tuple[int, ...], Option]] = []
        for opt in options:
            if any(opt.goal.id == c.goal.id for c in chosen):
                continue
            key = (
                int(opt.goal.is_win and any(c.goal.is_win for c in chosen)),
                int(guard and opt.game_type in yesterday_games),
                int(opt.game_type not in with_affinity),
                int(any(c.game_type == opt.game_type for c in chosen)),
                int((opt.game_type, opt.type_name) in recent_pairs),
                int(any(c.archetype == opt.archetype for c in chosen)),
            )
            ranked.append((key, opt))
        if not ranked:
            break
        best_key = min(key for key, _ in ranked)
        bucket = [opt for key, opt in ranked if key == best_key]
        per_game = {
            g: sum(1 for o in bucket if o.game_type == g) for g in {o.game_type for o in bucket}
        }
        weights = [(affinity.get(o.game_type, 0) or 1) / per_game[o.game_type] for o in bucket]
        chosen.append(rng.choices(bucket, weights=weights)[0])
    if len(chosen) < 2:
        raise ValueError(f"no personal goals for {day}: eligible={list(eligible)}")
    return (FREE_GOAL_POOL[ALWAYS_PRESENT][0], chosen[0].goal, chosen[1].goal)


# ---------------------------------------------------------------------------
# Discovery candidates (for the bonus slot, #3995)
# ---------------------------------------------------------------------------


def resting(history: InstallHistory, game: str, day: date) -> bool:
    """A game offered as the bonus and not played that day ``REST_AFTER_IGNORES``
    times within ``REST_DAYS`` rests for ``REST_DAYS`` after the last of them.
    Only finished days count (before the first day this history serves)."""
    ignored = sorted(
        d
        for d, a in history.pinned.items()
        if d < min(day, history.first_day)
        and a.bonus is not None
        and a.bonus.game_type == game
        and not history.played_on(game, d)
    )
    for i in range(REST_AFTER_IGNORES - 1, len(ignored)):
        last = ignored[i]
        first = ignored[i - (REST_AFTER_IGNORES - 1)]
        if (last - first).days < REST_DAYS and day <= last + timedelta(days=REST_DAYS):
            return True
    return False


def discovery_candidates(history: InstallHistory, eligible: Iterable[str], day: date) -> list[str]:
    """Eligible games the install has not finished in the affinity window, minus any
    resting game (``resting``). Sorted, so a seeded draw over it is reproducible."""
    played = history.affinity(day)
    return sorted(
        g
        for g in eligible
        if g in GAME_SPECS and not played.get(g) and not resting(history, g, day)
    )

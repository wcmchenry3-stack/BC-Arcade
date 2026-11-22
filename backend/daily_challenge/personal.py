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

Every goal but Bottle Sort's is one of the existing kinds with an absolute target
(``final_score_at_least``, ``highest_tile_at_least``, ``won``, ``won_moves_at_most``,
``solved``, and for the premium games ``completed``, ``won_duration_ms_at_most``,
``wave_reached_at_least``, ``starting_chips_at_least``), so installed app builds word it
and ``Goal.evaluate`` scores it with no per-player logic.

Bottle Sort (#4028) gets **"solve N new levels"** (``new_levels_at_least``, target N), a
relative kind: it is met when the day's highest level solved minus the highest solved
before the day started is at least N (``definitions.facts_for``; the scorers read the
day-start best, ``service.day_start_bests``). An absolute "reach level L" pinned for
today+1 and today+2 at today's first open could already be met by today's own solves;
the relative goal cannot. N (``sort_new_levels``) is the median of the new levels solved
per day of play in the affinity window, stretched and rounded, 1-3 (1 at cold start), one
fewer after two misses, and at most the levels left in the edition the install plays
(``sort_levels_left``: 120 for the catalog, 23 for the pre-catalog levels). With no
level left Sort offers nothing. Builds from before #4028 have no copy for the kind and
word it "Play Bottle Sort"; they never mark it done offline (no ``new_levels`` fact).

Premium games (#3996)
---------------------
Blackjack, Cascade, Hearts, Mahjong and Star Swarm have specs too. ``service.eligible_games``
offers them only to an install entitled to the game, so a free install never gets one.
Three things are specific to them:

* **"Finish" and "win" read server-written facts** (``games/result_flags.py``): the apps
  send no ``won`` / ``is_complete`` for Blackjack, Hearts or Star Swarm, so their result
  models write them from the completion's outcome.
* **Blackjack's "one table up"** is ``starting_chips_at_least`` on a table ladder
  (``GoalType.ladder``: 100 / 250 / 500 chips). No existing kind says "win a run at a
  table", so the goal is "finish a run at table T or higher", which is not luck-dependent.
  T is the table above the usual one (the median of recent runs), but only once a recent
  run at the usual table or higher reached its goal (the next table unlocks on a win);
  otherwise the usual table.
* **Star Swarm's targets are per tier** (``GameSpec.partition_key``): wave and score come
  from the recent runs on the install's usual ``difficulty_tier`` (the most common one,
  the newest on a tie), and the cap is the best of those runs. The goal itself is not
  tier-bound: no existing kind asks for a tier, so a run on an easier tier can meet it.

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
  missed, the stretch is applied the other way (a tile target halves, Sort asks one
  level fewer).
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

The bonus goal (``choose_bonus``, #3995)
----------------------------------------
A personal day (never a shared-template day) may carry one optional bonus goal beside
the three core goals; it never counts toward the streak or "day complete". With
probability ``DAILY_CHALLENGE_DISCOVERY_SHARE`` (default 0.5) it is a **discovery**
goal: the cold-start goal (a finish or a low fixed score) of a ``discovery_candidates``
game. Otherwise it is a **bigger stretch**: a personal target in an affinity game with
the stretch percentage doubled, still capped at the personal best (the same
``personal_target`` rule). It is never a game of a core goal that day, never
luck-dependent (``Goal.is_win``), and null when no candidate exists. The draw uses its
own stream seeded from (session_id, day, ``SALT``, "bonus"), so adding a bonus never
changes the core picks. A discovery bonus is marked by tier ``easy`` and a stretch
bonus by tier ``medium`` in the pinned row (``bonus_kind``).
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
    CATALOG_EDITION,
    FREE_GOAL_POOL,
    GOAL_POOLS,
    SALT,
    SORT_CATALOG_GOALS,
    Goal,
    goal_from_spec,
)
from daily_challenge.game_specs import (  # noqa: F401 - re-exported as personal.*
    BLACKJACK_TABLES,
    GAME_SPECS,
    Archetype,
    GameSpec,
    GoalType,
    build_goal,
    goal_type_name,
    personal_type_keys,
)
from settings import Settings
from sort.catalog import LEVEL_COUNT

if TYPE_CHECKING:
    from daily_challenge.assignments import Assignment
    from daily_challenge.history import InstallHistory

# A game (and an install) needs this many finished games for a personal target.
MIN_FINISHED_GAMES = 3
# Builds from before the 120-level catalog top out at 23 (SORT_CATALOG_EDITION_ENFORCED).
LEGACY_SORT_LEVELS = 23
# "Solve N new levels": N is 1-3.
MIN_NEW_LEVELS, MAX_NEW_LEVELS = 1, 3
# A (game, goal type) does not repeat within this many days (today included).
NO_REPEAT_DAYS = 3
# Discovery rest rule (``resting``, #3995): a game offered as the bonus and not played
# that day this many times within REST_DAYS rests for REST_DAYS after the last of them.
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


def bonus_enabled() -> bool:
    """``DAILY_CHALLENGE_BONUS_ENABLED`` (default true): false pins no new bonus."""
    return _get_settings().daily_challenge_bonus_enabled


def discovery_share() -> float:
    """``DAILY_CHALLENGE_DISCOVERY_SHARE`` (default 0.5, 0-1): the probability a bonus
    is a discovery goal rather than a bigger stretch."""
    return _get_settings().daily_challenge_discovery_share


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
    can_step_up: bool = True,
) -> int:
    """The personal target for ``gtype`` from recent ``values`` of its measure.

    ``best`` is the personal best (the highest value for "at least", the fewest for
    "at most"). ``can_step_up`` only matters for a ladder goal. See the module docstring
    for the rule; every step is tested."""
    if not values:
        raise ValueError("personal_target needs at least one value")
    median = statistics.median(values)
    if gtype.ladder:
        usual = usual_rung(gtype, values)
        higher = [rung for rung in gtype.ladder if rung > usual]
        return higher[0] if higher and can_step_up and not stepped_down else usual
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


def usual_rung(gtype: GoalType, values: Sequence[int | float]) -> int:
    """The ladder rung at or below the median of ``values``: the install's usual table."""
    median = statistics.median(values)
    return max((rung for rung in gtype.ladder if rung <= median), default=gtype.ladder[0])


def sort_new_levels(per_day_new: Sequence[int], *, pct: int, stepped_down: bool = False) -> int:
    """N for "solve N new levels": the median of the new levels solved per day of play,
    stretched and rounded half up, 1-3; then one fewer after two misses (never under 1),
    so a fast player who missed 3 twice is asked for 2. No day yet: 1."""
    if per_day_new:
        n = math.floor(statistics.median(per_day_new) * (1 + pct / 100) + 0.5)
    else:
        n = MIN_NEW_LEVELS
    n = max(MIN_NEW_LEVELS, min(MAX_NEW_LEVELS, n))
    return max(MIN_NEW_LEVELS, n - 1) if stepped_down else n


def sort_level_cap(edition: int) -> int:
    """The last level of the edition the install plays (``InstallHistory.sort_edition``):
    the catalog's 120, or 23 for the random levels of builds from before the catalog. With
    ``SORT_CATALOG_EDITION_ENFORCED`` on the edition is always the catalog; off, it is the
    edition of the install's latest Sort row, so a catalog player past level 23 still gets
    a goal while the switch is off."""
    return LEVEL_COUNT if edition == CATALOG_EDITION else LEGACY_SORT_LEVELS


def sort_levels_left(best: int, *, edition: int) -> int:
    """The levels above ``best`` (the highest solved before the day, in ``edition``) the
    install can still solve: the most a "new levels" goal may ask for. 0 once done."""
    return max(0, sort_level_cap(edition) - best)


def sort_target(n: int, best: int, *, edition: int) -> int | None:
    """``n`` capped at the levels left, or None when none are left (no Sort goal)."""
    left = sort_levels_left(best, edition=edition)
    return min(n, left) if left > 0 else None


def _usual_partition(spec: GameSpec, facts_list: Sequence[Mapping]) -> list[Mapping]:
    """``facts_list`` (newest first) restricted to the runs on the install's usual value
    of ``spec.partition_key``: the most common, the newest on a tie."""
    key = spec.partition_key
    if key is None:
        return list(facts_list)

    def value(facts: Mapping) -> object:
        raw = facts.get(key)
        return raw if isinstance(raw, str) and raw else spec.partition_default

    values = [value(f) for f in facts_list]
    if not values:
        return []
    counts = {v: values.count(v) for v in values}
    top = max(counts.values())
    usual = next(v for v in values if counts[v] == top)
    return [f for f, v in zip(facts_list, values, strict=True) if v == usual]


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


def _table_unlocked(gtype: GoalType, facts_list: Iterable[Mapping], values: list) -> bool:
    """Whether a ladder goal may step up: a recent run at the usual rung or higher reached
    its goal (``won``), which is what unlocks the next Blackjack table. Always true off a
    ladder (the argument is not read)."""
    if not gtype.ladder:
        return True
    usual = usual_rung(gtype, values)
    for facts in facts_list:
        value = facts.get(gtype.measure or "")
        if facts.get("won") is True and isinstance(value, (int, float)) and value >= usual:
            return True
    return False


def options_for(game: str, history: InstallHistory, day: date, *, pct: int) -> list[Option]:
    """The goals ``game`` can offer on ``day``: its cold-start goal with fewer than
    ``MIN_FINISHED_GAMES`` finished games, else every type that has the data."""
    spec = GAME_SPECS[game]
    recent = history.recent_facts(game, day, history_games())
    goals: list[tuple[GoalType, int | None]] = []
    if game == "sort":
        gtype = spec.type("levels")
        n = MIN_NEW_LEVELS
        if len(recent) >= MIN_FINISHED_GAMES:
            n = sort_new_levels(
                history.sort_new_levels_per_day(day),
                pct=pct,
                stepped_down=stepped_down(history, game, gtype.name),
            )
        target = sort_target(n, history.best_final_score(game, day), edition=history.sort_edition)
        if target is not None:
            goals.append((gtype, target))
    elif len(recent) < MIN_FINISHED_GAMES:
        goals.append((spec.type(spec.cold_type), spec.cold_target))
    else:
        # Targets read the runs on the usual partition (Star Swarm's tier), if any.
        target_facts = _usual_partition(spec, recent)
        for gtype in spec.types:
            if not gtype.personal:
                goals.append((gtype, None))
                continue
            values = _values(gtype, target_facts)
            if len(values) < MIN_FINISHED_GAMES:
                continue
            if gtype.at_most:
                best: int | float = min(values)
            elif gtype.measure == "final_score" and spec.partition_key is None:
                best = max(max(values), history.best_final_score(game, day))
            else:
                best = max(values)
            target = personal_target(
                gtype,
                values,
                best=best,
                pct=pct,
                stepped_down=stepped_down(history, game, gtype.name),
                can_step_up=_table_unlocked(gtype, target_facts, values),
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


def _rng(session_id: str, day: date, salt: int, stream: str = "") -> random.Random:
    # A str seed is hashed with SHA-512 (random's version 2): stable across processes.
    # ``stream`` names an independent draw (the bonus) so it never shifts the core one.
    suffix = f"|{stream}" if stream else ""
    return random.Random(f"{session_id}|{day.isoformat()}|{salt}{suffix}")


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
# Discovery candidates and the rest rule (the bonus slot, #3995)
# ---------------------------------------------------------------------------


def resting(history: InstallHistory, game: str, day: date) -> bool:
    """A game offered as the discovery bonus and not played that day ``REST_AFTER_IGNORES``
    times within ``REST_DAYS`` rests for ``REST_DAYS`` after the last of them.
    Only finished days count (before the first day this history serves)."""
    ignored = sorted(
        d
        for d, a in history.pinned.items()
        if d < min(day, history.first_day)
        and a.bonus is not None
        and bonus_kind(a.bonus) == "discovery"
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


# ---------------------------------------------------------------------------
# The bonus goal (#3995)
# ---------------------------------------------------------------------------

BonusKind = Literal["discovery", "stretch"]
# The tier stored with a pinned bonus is its marker: a discovery goal is built "easy",
# a stretch goal is a personal target, "medium" (``build_goal``).
DISCOVERY_TIER = "easy"
STRETCH_TIER = "medium"


def bonus_kind(goal: Goal) -> BonusKind:
    """Whether a pinned bonus ``goal`` was a discovery goal or a stretch (its tier)."""
    return "discovery" if goal.tier == DISCOVERY_TIER else "stretch"


def _discovery_goal(game: str) -> Goal:
    spec = GAME_SPECS[game]
    gtype = spec.type(spec.cold_type)
    return goal_from_spec(
        {
            "game_type": game,
            "kind": gtype.kind,
            "target": spec.cold_target,
            "tier": DISCOVERY_TIER,
        }
    )


def _sort_levels_left(history: InstallHistory, day: date) -> int:
    return sort_levels_left(history.best_final_score("sort", day), edition=history.sort_edition)


def choose_bonus(
    history: InstallHistory,
    day: date,
    eligible: Sequence[str],
    core: Sequence[Goal],
    *,
    session_id: str,
    pct: int | None = None,
    share: float | None = None,
) -> Goal | None:
    """The day's optional bonus goal, or ``None`` (module docstring). The drawn kind
    falls back to the other when it has no candidate; ``None`` only when neither has."""
    pct = stretch_pct() if pct is None else pct
    share = discovery_share() if share is None else share
    rng = _rng(session_id, day, SALT, "bonus")
    core_games = {g.game_type for g in core}

    discovery = [
        _discovery_goal(g)
        for g in discovery_candidates(history, eligible, day)
        if g not in core_games
    ]
    # Not luck-dependent, and never a Sort goal once the install has no level left.
    discovery = [
        g
        for g in discovery
        if not g.is_win and (g.game_type != "sort" or _sort_levels_left(history, day) > 0)
    ]

    affinity = history.affinity(day)
    stretch: list[Option] = []
    for game in sorted(eligible):
        if game not in GAME_SPECS or game in core_games or not affinity.get(game):
            continue
        spec = GAME_SPECS[game]
        if len(history.recent_facts(game, day, history_games())) < MIN_FINISHED_GAMES:
            continue  # options_for would return the cold-start goal, not a personal target
        for opt in options_for(game, history, day, pct=min(100, pct * 2)):
            if spec.type(opt.type_name).personal and not opt.goal.is_win:
                stretch.append(opt)

    want_discovery = rng.random() < share
    if want_discovery and discovery:
        return rng.choice(discovery)
    if stretch:
        weights = [affinity[o.game_type] for o in stretch]
        return rng.choices(stretch, weights=weights)[0].goal
    if discovery:
        return rng.choice(discovery)
    return None

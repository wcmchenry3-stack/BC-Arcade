"""The per-game goal specs for the personal pick (§12 "Goals per game"): each game's goal
types, their measures, floors and cold-start goal. Split out of ``personal.py`` (file-length
cap); ``personal`` re-exports every name here, so ``personal.GAME_SPECS`` still works.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from daily_challenge.definitions import (
    FREE_GOAL_POOL,
    Goal,
    goal_from_spec,
)
from starswarm.models import DEFAULT_DIFFICULTY_TIER

# Blackjack's tables by starting chips (``TABLE_CONFIGS`` in
# ``frontend/src/game/blackjack/tables.ts``): Beginner, Intermediate, High Roller. The
# result block's ``starting_chips`` is one of them.
BLACKJACK_TABLES: tuple[int, ...] = (100, 250, 500)


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
    # An "at least" goal on a table ladder (Blackjack's starting chips): the target is
    # the rung above the usual one, or the usual one when it may not step up.
    ladder: tuple[int, ...] = ()

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
    # A facts key whose values must not be mixed in a personal target (Star Swarm's
    # ``difficulty_tier``): targets come from the runs sharing the install's usual value.
    partition_key: str | None = None
    partition_default: str | None = None

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
    # --- Premium games (#3996). Eligible only to an install entitled to the game. ---
    # A run is the game: finish = a win or a loss (``is_complete``, written by the server),
    # an abandon never counts. A win depends on the cards, so ``won`` is luck-dependent;
    # the table goal (finish at a higher table) is not.
    "blackjack": GameSpec(
        "blackjack",
        (
            GoalType("blackjack", "finish", "finish", "completed"),
            GoalType("blackjack", "win", "skill", "won"),
            GoalType(
                "blackjack",
                "table",
                "stretch",
                "starting_chips_at_least",
                "starting_chips",
                floor=BLACKJACK_TABLES[0],
                ladder=BLACKJACK_TABLES,
            ),
        ),
        # "Finish a run at Beginner": every table starts at 100 or more, so the table
        # condition adds nothing and the plain finish goal is the same goal.
        cold_type="finish",
    ),
    # Cascade: win = make the capstone, not luck-dependent. Wins take about 4.5 minutes,
    # so the time goal is a light stretch in whole minutes, above the 20 s win floor.
    "cascade": GameSpec(
        "cascade",
        (
            GoalType("cascade", "finish", "finish", "completed"),
            GoalType("cascade", "win", "skill", "won"),
            GoalType(
                "cascade",
                "win_time",
                "stretch",
                "won_duration_ms_at_most",
                "duration_ms",
                at_most=True,
                floor=120_000,
                unit=60_000,
            ),
        ),
        cold_type="finish",
    ),
    "hearts": GameSpec(
        "hearts",
        (
            GoalType("hearts", "finish", "finish", "completed"),
            GoalType("hearts", "win", "skill", "won"),
        ),
        cold_type="finish",
    ),
    # Mahjong: clear a board (a deadlock can be undone, so not luck-dependent), or clear
    # it in under a personal time, in whole minutes, above the 36 s clear floor.
    "mahjong": GameSpec(
        "mahjong",
        (
            GoalType("mahjong", "win", "finish", "won"),
            GoalType(
                "mahjong",
                "win_time",
                "stretch",
                "won_duration_ms_at_most",
                "duration_ms",
                at_most=True,
                floor=240_000,
                unit=60_000,
            ),
        ),
        cold_type="win",
    ),
    # Star Swarm has no win: finish a run, reach a wave, or score, with targets from the
    # runs on the install's usual difficulty tier.
    "starswarm": GameSpec(
        "starswarm",
        (
            GoalType("starswarm", "finish", "finish", "completed"),
            GoalType(
                "starswarm",
                "wave",
                "progress",
                "wave_reached_at_least",
                "wave_reached",
                floor=3,
            ),
            GoalType(
                "starswarm",
                "score",
                "stretch",
                "final_score_at_least",
                "final_score",
                floor=1000,
                unit=250,
            ),
        ),
        cold_type="finish",
        partition_key="difficulty_tier",
        partition_default=DEFAULT_DIFFICULTY_TIER,
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

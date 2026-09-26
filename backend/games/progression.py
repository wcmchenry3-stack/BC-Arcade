"""Arcade XP + player level — pure derivation from stats (#2391).

No DB access, no FastAPI imports, no I/O, no environment reads: this module
only transforms a ``StatsSummary`` (see ``games.service.get_stats_for_session``)
into an XP/level result. ``stats.router.get_my_stats`` calls it and returns the
four fields on ``StatsResponse`` (``GET /stats/me``).

XP rule: BASE_XP_PER_GAME for every completed game played, plus
VARIETY_BONUS_PER_GAME_TYPE for each distinct game type with at least one
completed game played (breadth bonus — supports the "not just a container of
mini-games" App Store 4.2 narrative). "Completed game played" is each game
type's ``GameTypeStats.completed_played`` count, which
``get_stats_for_session`` restricts to games with ``completed_at IS NOT NULL``
*and* an outcome other than ``abandoned`` (#2472) — not
``StatsSummary.total_games`` or ``GameTypeStats.sessions``, both of which still
count abandons as lifecycle facts.

Levels: ``LEVEL_THRESHOLDS[i]`` is the cumulative XP required to reach level
``i + 1`` (level 1 at 0 XP). The sequence must be strictly increasing.
``xp_for_next_level`` is a countdown — the XP still needed to reach the next
level from the player's current XP — so below the max level
``xp_into_level + xp_for_next_level`` always equals the gap between the
current and next thresholds. At the max level, ``xp_for_next_level`` is 0 and
``xp_into_level`` is the XP earned past the final threshold (there is no next
threshold to count down to).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from games.service import StatsSummary

# Flat XP awarded per completed game, regardless of game type.
BASE_XP_PER_GAME = 10

# Extra XP per distinct game type with at least one completed game played.
# Rewards breadth of play, not just volume in a single game.
VARIETY_BONUS_PER_GAME_TYPE = 50

# Cumulative XP required to reach each level; index 0 -> level 1 (0 XP),
# index 1 -> level 2, etc. Must start at 0 and strictly increase.
# tune post-launch
LEVEL_THRESHOLDS: Sequence[int] = (
    0,  # level 1
    100,  # level 2
    250,  # level 3
    450,  # level 4
    700,  # level 5
    1000,  # level 6
    1400,  # level 7
    1900,  # level 8
    2500,  # level 9
    3200,  # level 10
)


@dataclass(frozen=True)
class Progression:
    """Result of ``compute_progression``. See module docstring for the max-level convention."""

    arcade_xp: int
    arcade_level: int
    xp_into_level: int
    xp_for_next_level: int


def compute_progression(summary: StatsSummary) -> Progression:
    """Derive Arcade XP and level from a games stats summary.

    ``summary.by_game[name].completed_played`` is used as each game type's
    completed-game count, rather than ``summary.total_games`` or ``sessions``.
    The query behind ``StatsSummary`` excludes in-progress games from both, and
    ``completed_played`` additionally excludes abandoned ones (#2472) — quitting
    a game must earn nothing, or a player can farm XP by starting games and
    backing out. ``sessions`` deliberately still counts abandons: it is the
    lifecycle "games played" figure Profile shows, not an XP input.
    """
    completed_games = sum(stats.completed_played for stats in summary.by_game.values())
    distinct_game_types = sum(1 for stats in summary.by_game.values() if stats.completed_played > 0)

    arcade_xp = (
        completed_games * BASE_XP_PER_GAME + distinct_game_types * VARIETY_BONUS_PER_GAME_TYPE
    )

    return Progression(arcade_xp=arcade_xp, **_level_fields(arcade_xp))


def _level_fields(arcade_xp: int) -> dict[str, int]:
    """Map total XP to (arcade_level, xp_into_level, xp_for_next_level)."""
    max_level = len(LEVEL_THRESHOLDS)

    # Find the highest level whose threshold has been reached.
    level = 1
    for i, threshold in enumerate(LEVEL_THRESHOLDS):
        if arcade_xp >= threshold:
            level = i + 1
        else:
            break

    current_threshold = LEVEL_THRESHOLDS[level - 1]
    xp_into_level = arcade_xp - current_threshold

    if level >= max_level:
        # Max level: no next threshold. Convention: xp_for_next_level is 0,
        # xp_into_level keeps accruing past the final threshold.
        xp_for_next_level = 0
    else:
        # XP still needed to reach the next level (a countdown, not the
        # level's total bucket size): xp_into_level + xp_for_next_level
        # always equals the gap between the current and next threshold.
        next_threshold = LEVEL_THRESHOLDS[level]
        xp_for_next_level = next_threshold - arcade_xp

    return {
        "arcade_level": level,
        "xp_into_level": xp_into_level,
        "xp_for_next_level": xp_for_next_level,
    }

"""Unit tests for games/progression.py — pure Arcade XP + level derivation (#2391).

Fixtures are hand-built StatsSummary/GameTypeStats values; no DB access.
"""

from __future__ import annotations

from itertools import pairwise

from games.progression import (
    BASE_XP_PER_GAME,
    LEVEL_THRESHOLDS,
    VARIETY_BONUS_PER_GAME_TYPE,
    _level_fields,
    compute_progression,
)
from games.service import GameTypeStats, StatsSummary


def _game_stats(played: int) -> GameTypeStats:
    """Minimal GameTypeStats fixture — only `played` matters to progression."""
    return GameTypeStats(played=played, best=None, avg=None, last_played_at=None)


def _summary(by_game: dict[str, int]) -> StatsSummary:
    """Build a StatsSummary from {game_type_name: played_count}."""
    game_stats = {name: _game_stats(played) for name, played in by_game.items()}
    return StatsSummary(
        total_games=sum(by_game.values()),
        by_game=game_stats,
        favorite_game=next(iter(by_game), None),
    )


# ---------------------------------------------------------------------------
# LEVEL_THRESHOLDS invariants
# ---------------------------------------------------------------------------


def test_level_thresholds_start_at_zero():
    assert LEVEL_THRESHOLDS[0] == 0


def test_level_thresholds_strictly_increasing():
    for prev, nxt in pairwise(LEVEL_THRESHOLDS):
        assert nxt > prev


# ---------------------------------------------------------------------------
# Empty / minimal summaries
# ---------------------------------------------------------------------------


def test_empty_summary_is_zero_xp_level_one():
    summary = _summary({})
    result = compute_progression(summary)
    assert result.arcade_xp == 0
    assert result.arcade_level == 1
    assert result.xp_into_level == 0
    assert result.xp_for_next_level == LEVEL_THRESHOLDS[1]


def test_one_game_played_one_type():
    summary = _summary({"twenty48": 1})
    result = compute_progression(summary)
    assert result.arcade_xp == BASE_XP_PER_GAME + VARIETY_BONUS_PER_GAME_TYPE
    assert result.arcade_level == 1


# ---------------------------------------------------------------------------
# Variety bonus: spreading plays across game types beats stacking one type
# ---------------------------------------------------------------------------


def test_variety_bonus_makes_spread_plays_strictly_higher_xp():
    same_total_plays = 6

    stacked = _summary({"twenty48": same_total_plays})
    spread = _summary(
        {
            "twenty48": 2,
            "cascade": 2,
            "sudoku": 2,
        }
    )

    stacked_xp = compute_progression(stacked).arcade_xp
    spread_xp = compute_progression(spread).arcade_xp

    # Same number of completed games either way; the XP still differs only
    # because of the variety bonus.
    assert stacked_xp == same_total_plays * BASE_XP_PER_GAME + VARIETY_BONUS_PER_GAME_TYPE
    assert spread_xp == same_total_plays * BASE_XP_PER_GAME + 3 * VARIETY_BONUS_PER_GAME_TYPE
    assert spread_xp > stacked_xp


# ---------------------------------------------------------------------------
# Exact level-boundary XP
#
# Achievable arcade_xp values are constrained by BASE_XP_PER_GAME and
# VARIETY_BONUS_PER_GAME_TYPE (both multiples of 10, so real XP totals land
# on multiples of 10) — thresholds +/- 1 aren't necessarily reachable via a
# played-games fixture. These tests exercise the pure XP-to-level mapping
# directly via the internal `_level_fields` helper (also unit-tested this way
# elsewhere in this codebase, e.g. test_game_metadata.py, test_limiter.py)
# rather than going through a synthetic StatsSummary.
# ---------------------------------------------------------------------------


def test_level_boundary_just_below_at_and_above_threshold():
    threshold = LEVEL_THRESHOLDS[1]

    below = _level_fields(threshold - 1)
    at = _level_fields(threshold)
    above = _level_fields(threshold + 1)

    assert below["arcade_level"] == 1
    assert below["xp_into_level"] == LEVEL_THRESHOLDS[1] - LEVEL_THRESHOLDS[0] - 1
    assert below["xp_for_next_level"] == 1

    assert at["arcade_level"] == 2
    assert at["xp_into_level"] == 0
    assert at["xp_for_next_level"] == LEVEL_THRESHOLDS[2] - LEVEL_THRESHOLDS[1]

    assert above["arcade_level"] == 2
    assert above["xp_into_level"] == 1
    assert above["xp_for_next_level"] == LEVEL_THRESHOLDS[2] - LEVEL_THRESHOLDS[1] - 1


# ---------------------------------------------------------------------------
# Max-level behaviour
# ---------------------------------------------------------------------------


def test_max_level_reached_exactly_at_final_threshold():
    final_threshold = LEVEL_THRESHOLDS[-1]
    # One game type; played count chosen so base XP + one bonus == final_threshold.
    remaining = final_threshold - VARIETY_BONUS_PER_GAME_TYPE
    assert remaining % BASE_XP_PER_GAME == 0
    played = remaining // BASE_XP_PER_GAME

    result = compute_progression(_summary({"twenty48": played}))

    assert result.arcade_xp == final_threshold
    assert result.arcade_level == len(LEVEL_THRESHOLDS)
    assert result.xp_into_level == 0
    assert result.xp_for_next_level == 0


def test_max_level_xp_keeps_accruing_past_final_threshold():
    final_threshold = LEVEL_THRESHOLDS[-1]
    # Play a lot more games than needed to blow well past the final threshold.
    result = compute_progression(_summary({"twenty48": 10_000}))

    assert result.arcade_xp > final_threshold
    assert result.arcade_level == len(LEVEL_THRESHOLDS)
    assert result.xp_for_next_level == 0
    assert result.xp_into_level == result.arcade_xp - final_threshold
    assert result.xp_into_level >= 0


# ---------------------------------------------------------------------------
# Result invariants
# ---------------------------------------------------------------------------


def test_invariants_hold_across_many_summaries():
    fixtures = [
        {},
        {"twenty48": 1},
        {"twenty48": 5},
        {"twenty48": 3, "cascade": 4},
        {"twenty48": 1, "cascade": 1, "sudoku": 1, "mahjong": 1},
        {"twenty48": 999},
    ]
    max_level = len(LEVEL_THRESHOLDS)

    for by_game in fixtures:
        result = compute_progression(_summary(by_game))

        assert result.arcade_xp >= 0
        assert 1 <= result.arcade_level <= max_level
        assert result.xp_into_level >= 0

        if result.arcade_level < max_level:
            span = result.xp_into_level + result.xp_for_next_level
            level_idx = result.arcade_level - 1
            expected_span = LEVEL_THRESHOLDS[level_idx + 1] - LEVEL_THRESHOLDS[level_idx]
            assert span == expected_span
        else:
            assert result.xp_for_next_level == 0

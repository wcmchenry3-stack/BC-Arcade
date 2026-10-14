"""Per-IP pacing for the Locust scenarios (#3300): the aggregate stays under the limits.

Only the pure helpers in ``perf/scenarios/pacing.py`` are imported; Locust itself is
not, because importing it patches the standard library.
"""

from types import SimpleNamespace

import pytest

from perf.scenarios.pacing import (
    BOARD_IP_ROUTES,
    GAME_IP_ROUTES,
    HEADROOM,
    READ_IP_ROUTES,
    board_wait,
    game_cycle_s,
    min_cycle_s,
    read_wait,
    read_wait_bounds,
    user_count,
)
from rate_limits import (
    GAMES_COMPLETE_IP_RATE_LIMIT,
    GAMES_CREATE_IP_RATE_LIMIT,
    GAMES_EVENTS_IP_RATE_LIMIT,
    LEADERBOARD_IP_RATE_LIMIT,
    RANK_IP_RATE_LIMIT,
    STATS_IP_RATE_LIMIT,
)


def _per_min(spec: str) -> int:
    return int(spec.split(";")[0].split("/")[0])


def test_pacing_tables_match_the_configured_limits() -> None:
    assert sorted(limit for _, limit in GAME_IP_ROUTES) == sorted(
        _per_min(s)
        for s in (
            GAMES_EVENTS_IP_RATE_LIMIT,
            GAMES_CREATE_IP_RATE_LIMIT,
            GAMES_COMPLETE_IP_RATE_LIMIT,
            RANK_IP_RATE_LIMIT,
        )
    )
    assert [limit for _, limit in READ_IP_ROUTES][1:] == [_per_min(STATS_IP_RATE_LIMIT)] * 2
    assert BOARD_IP_ROUTES[0][1] == _per_min(LEADERBOARD_IP_RATE_LIMIT)


@pytest.mark.parametrize("users", [1, 5, 10, 50])
def test_game_flow_aggregate_stays_under_every_ip_limit(users: int) -> None:
    cycle = game_cycle_s(users)
    for per_game, limit in GAME_IP_ROUTES:
        assert users * per_game * 60 / cycle <= HEADROOM * limit + 1e-9


@pytest.mark.parametrize("users", [1, 10, 20, 100])
def test_read_waits_keep_aggregate_under_headroom(users: int) -> None:
    for wait, routes in ((read_wait, READ_IP_ROUTES), (board_wait, BOARD_IP_ROUTES)):
        low, high = wait(users)
        assert 0.5 <= low < high
        for share, limit in routes:
            assert users * 60 / low * share <= HEADROOM * limit + 1e-9


def test_min_cycle_scales_with_users() -> None:
    assert min_cycle_s(10, 1, 100) == pytest.approx(10 * min_cycle_s(1, 1, 100))
    assert read_wait_bounds(1, ((1.0, 10_000),)) == (0.5, 0.5 * 4 / 3)


def test_user_count_tolerates_a_missing_runner() -> None:
    assert user_count(SimpleNamespace(runner=None)) == 1
    assert user_count(SimpleNamespace()) == 1
    assert user_count(SimpleNamespace(runner=SimpleNamespace(user_count=7))) == 7

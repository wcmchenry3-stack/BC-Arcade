"""Pacing for Locust users that share one IP (#3300).

Every Locust user on a runner comes from the runner's one address, so the
per-IP backstops in ``rate_limits.py`` see the *aggregate* of all users. A
per-user wait that is fine for one user trips the limits at five. These pure
helpers derive the per-user pacing from the user count; the scenarios call them
with the live count.
"""

# Aggregate use of an IP limit the scenarios aim for at their ceiling.
HEADROOM = 0.6


def user_count(environment) -> int:
    """Current Locust user count (at least 1), tolerating a missing runner."""
    runner = getattr(environment, "runner", None)
    return max(1, int(getattr(runner, "user_count", 1) or 1))


def min_cycle_s(
    users: int, requests_per_cycle: float, ip_limit_per_min: float, headroom: float = HEADROOM
) -> float:
    """Shortest cycle (seconds) one user may take so that ``users`` users, each
    sending ``requests_per_cycle`` requests per cycle to a route limited to
    ``ip_limit_per_min`` per IP, use at most ``headroom`` of that limit."""
    users = max(1, users)
    return users * requests_per_cycle * 60.0 / (headroom * ip_limit_per_min)


def read_wait_bounds(
    users: int, routes: tuple[tuple[float, float], ...], headroom: float = HEADROOM
) -> tuple[float, float]:
    """``(min, max)`` wait between single-request tasks for ``users`` users.

    ``routes`` is ``(share, ip_limit_per_min)`` per route: the share of all requests
    that go to it, and its per-IP limit. The minimum keeps the busiest route at
    ``headroom`` of its limit at the ceiling; the maximum is a third higher.
    Never below 0.5 s.
    """
    low = max(0.5, *(min_cycle_s(users, share, limit, headroom) for share, limit in routes))
    return low, low * 4 / 3


# (requests per game, per-IP limit per minute) for each limited route of a Yacht game:
# events (13 batches), create, complete, rank. Mirrors ``rate_limits.py``; a test checks it.
GAME_IP_ROUTES = ((13, 300), (1, 100), (1, 100), (1, 300))
# (share of requests, per-IP limit per minute): catalog, stats, history.
READ_IP_ROUTES = ((0.05, 60), (0.5, 300), (0.45, 300))
# The leaderboard route.
BOARD_IP_ROUTES = ((1.0, 300),)


def game_cycle_s(users: int) -> float:
    """Shortest time one user spends on a game so ``users`` users on one IP stay
    under every per-IP limit."""
    return max(min_cycle_s(users, n, limit) for n, limit in GAME_IP_ROUTES)


def read_wait(users: int) -> tuple[float, float]:
    return read_wait_bounds(users, READ_IP_ROUTES)


def board_wait(users: int) -> tuple[float, float]:
    return read_wait_bounds(users, BOARD_IP_ROUTES)

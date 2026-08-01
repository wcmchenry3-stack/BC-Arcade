"""
BC Arcade — Locust performance test entry point.

User classes:

  YachtGameUser     — full 13-round game flow (session-isolated; safe with multiple users)
  LeaderboardUser   — concurrent leaderboard read/write (--users 10)
  ReadOnlyUser      — polling GET endpoints (--users 20)
  RateLimitVerifyUser — intentionally exhausts rate limits to verify 429 + Retry-After

Usage examples:

  # Single-user game flow (local):
  locust -f perf/locustfile.py --headless --users 1 --spawn-rate 1 \
         --run-time 120s --host http://localhost:8000 \
         YachtGameUser

  # Multi-user game flow (session isolation means no collisions):
  locust -f perf/locustfile.py --headless --users 5 --spawn-rate 1 \
         --run-time 60s --host http://localhost:8000 \
         YachtGameUser

  # Leaderboard concurrent load (local):
  locust -f perf/locustfile.py --headless --users 10 --spawn-rate 2 \
         --run-time 60s --host http://localhost:8000 \
         LeaderboardUser

  # Rate limit verification:
  locust -f perf/locustfile.py --headless --users 1 --spawn-rate 1 \
         --run-time 30s --host http://localhost:8000 \
         RateLimitVerifyUser

  # All scenarios together (default):
  locust -f perf/locustfile.py --headless --users 5 --spawn-rate 1 \
         --run-time 60s --host http://localhost:8000 --csv perf-results

See backend/perf/thresholds.json for SLO definitions.
See docs/PERFORMANCE.md for full documentation.
"""

from locust import HttpUser, between
from scenarios.game_flow import GameFlowTasks
from scenarios.leaderboard import LeaderboardTasks
from scenarios.rate_limit_test import RateLimitTasks
from scenarios.stateless_reads import StatelessReadTasks


class YachtGameUser(HttpUser):
    """
    Simulates one player completing a full 13-round game.
    Session isolation allows multiple concurrent users without state collisions.
    """

    tasks = [GameFlowTasks]
    wait_time = between(0.5, 1.5)


class LeaderboardUser(HttpUser):
    """
    Simulates concurrent players submitting and reading leaderboard scores.
    These endpoints are the safest to test with multiple concurrent users.
    Run with --users 10 as the baseline.
    """

    tasks = [LeaderboardTasks]
    wait_time = between(0.5, 2)


class ReadOnlyUser(HttpUser):
    """
    Simulates a client polling game state. Establishes the latency floor.
    Run with --users 20 to measure read throughput.
    """

    tasks = [StatelessReadTasks]
    wait_time = between(1, 3)


class RateLimitVerifyUser(HttpUser):
    """
    Verifies rate limiting fires correctly (429 + Retry-After).
    Run with --users 1 (sequential) for clean per-request status codes.
    """

    tasks = [RateLimitTasks]
    wait_time = between(0, 0.1)  # No wait — hammer as fast as possible

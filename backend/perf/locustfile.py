"""
BC Arcade — Locust performance test entry point.

User classes:

  YachtGameUser     — one Yacht game through /games (session-isolated; safe with multiple users)
  LeaderboardUser   — concurrent leaderboard reads (--users 10)
  ReadOnlyUser      — catalog, stats and history reads (--users 20)
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
    Simulates the app syncing one finished Yacht game (create, 13 event
    batches, complete, rank lookup). A fresh session per game keeps users
    apart and under the per-session write limits.
    """

    tasks = [GameFlowTasks]
    wait_time = between(0.5, 1.5)


class LeaderboardUser(HttpUser):
    """
    Simulates concurrent players reading the generic leaderboards.
    These endpoints are the safest to test with multiple concurrent users.
    Run with --users 10 as the baseline.
    """

    tasks = [LeaderboardTasks]
    # 3-4 s: keeps 10 users under 70% of the per-IP limit (scenarios/leaderboard.py).
    wait_time = between(3, 4)


class ReadOnlyUser(HttpUser):
    """
    Simulates the reads behind Home and Profile. Establishes the latency floor.
    Run with --users 20 to measure read throughput.
    """

    tasks = [StatelessReadTasks]
    # 2-3 s: keeps 20 users under 70% of the limits (scenarios/stateless_reads.py).
    wait_time = between(2, 3)


class RateLimitVerifyUser(HttpUser):
    """
    Verifies rate limiting fires correctly (429 + Retry-After).
    Run with --users 1 (sequential) for clean per-request status codes.
    """

    tasks = [RateLimitTasks]
    wait_time = between(0, 0.1)  # No wait — hammer as fast as possible

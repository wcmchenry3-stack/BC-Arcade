"""
Scenario B: Concurrent leaderboard reads.

Reads the generic boards (``GET /games/leaderboard/{game_type}``, #2618) of
two free games, which need no entitlement, and checks that a board never
lists more entries than asked for. Boards are read-only: the entries come
from finished session rows (``POST /games`` + ``PATCH /games/{id}/complete``).
The per-game ``/<game>/score(s)`` routes this used to hit were removed in #2644.

Rate limits (``games/router.py``), with perf.yml's 10 users from one runner IP:

  GET /games/leaderboard/{game_type}: 60/minute per session
                                      300/minute per IP (backstop)

Each user sends its own ``X-Session-ID`` (as the app does), so the session
limit is per user. Locust users on one runner share one IP, so ``LeaderboardUser``
derives its wait from the user count (``board_wait``, ``scenarios/pacing.py``),
keeping the aggregate at or under 60% of the 300/minute IP limit (180/minute):

  1 user:   0.5-0.67 s wait, 120 requests/min  (40% of the IP limit)
  10 users: 3.3-4.4 s wait,  180 requests/min  (60%; 18 per session = 30%)

Without a session id every user would share one IP-keyed session bucket
(60/minute) and the 10 users would exceed it.
"""

import random
import uuid

from locust import TaskSet, task

from scenarios.pacing import board_wait, user_count


def wait_bounds(environment) -> tuple[float, float]:
    return board_wait(user_count(environment))


_FREE_BOARDS = ("solitaire", "freecell")
_LIMIT = 10


class LeaderboardTasks(TaskSet):
    def on_start(self):
        self._headers = {"X-Session-ID": str(uuid.uuid4())}

    @task
    def get_board(self):
        game = random.choice(_FREE_BOARDS)
        with self.client.get(
            f"/games/leaderboard/{game}?limit={_LIMIT}",
            headers=self._headers,
            name="GET /games/leaderboard/{game_type}",
            catch_response=True,
        ) as resp:
            if resp.status_code != 200:
                resp.failure(f"HTTP {resp.status_code}")
                return
            entries = resp.json().get("entries", [])
            if len(entries) > _LIMIT:
                resp.failure(f"Board limit violated: got {len(entries)} entries (max {_LIMIT})")
            else:
                resp.success()

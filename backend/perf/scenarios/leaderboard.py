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
limit is per user. ``wait_time`` is 3-4 s (``LeaderboardUser``), so a user
makes at most 60 / 3 = 20 requests a minute, ignoring response time:

  per session: 20 / 60  = 33% of the limit
  per IP:      10 x 20 = 200 / 300 = 67% of the limit

Without a session id every user would share one IP-keyed session bucket
(60/minute) and the 10 users would exceed it.
"""

import random
import uuid

from locust import TaskSet, task

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

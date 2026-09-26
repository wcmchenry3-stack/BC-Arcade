"""
Scenario B: Concurrent leaderboard reads.

Reads the generic boards (``GET /games/leaderboard/{game_type}``, #2618) of
two free games, which need no entitlement, and checks that a board never
lists more entries than asked for. Boards are read-only: the entries come
from finished session rows (``POST /games`` + ``PATCH /games/{id}/complete``).
The per-game ``/<game>/score(s)`` routes this used to hit were removed in #2644.
"""

import random

from locust import TaskSet, task

_FREE_BOARDS = ("solitaire", "freecell")
_LIMIT = 10


class LeaderboardTasks(TaskSet):
    @task
    def get_board(self):
        game = random.choice(_FREE_BOARDS)
        with self.client.get(
            f"/games/leaderboard/{game}?limit={_LIMIT}",
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

"""
Scenario C: Read-only polling.

Simulates clients reading what the app reads on Home and Profile: the game
catalog, the player's stats and their game history. These reads establish
the latency floor for SLO calibration. (The old ``/yacht/state`` and
``/yacht/possible-scores`` polls hit server-side Yacht routes removed in
#2630.)

Each user has its own session, so the per-session limits (60/minute) aren't
shared between users.
"""

import uuid

from locust import TaskSet, task


def _check(resp) -> None:
    """Mark a response failed unless it is a 2xx (locust needs catch_response)."""
    if resp.ok:
        resp.success()
    else:
        resp.failure(f"HTTP {resp.status_code}")


class StatelessReadTasks(TaskSet):
    def on_start(self):
        self._headers = {"X-Session-ID": str(uuid.uuid4())}

    @task(2)
    def get_catalog(self):
        with self.client.get(
            "/games/catalog", name="GET /games/catalog", catch_response=True
        ) as resp:
            _check(resp)

    @task(1)
    def get_my_stats(self):
        with self.client.get(
            "/stats/me", headers=self._headers, name="GET /stats/me", catch_response=True
        ) as resp:
            _check(resp)

    @task(1)
    def get_my_games(self):
        with self.client.get(
            "/games/me", headers=self._headers, name="GET /games/me", catch_response=True
        ) as resp:
            _check(resp)

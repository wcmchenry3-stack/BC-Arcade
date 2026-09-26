"""
Scenario C: Read-only polling.

Simulates clients reading what the app reads on Home and Profile: the game
catalog, the player's stats and their game history. These reads establish
the latency floor for SLO calibration. (The old ``/yacht/state`` and
``/yacht/possible-scores`` polls hit server-side Yacht routes removed in
#2630.)

Rate limits, with perf.yml's 20 users from one runner IP:

  GET /games/catalog: 60/minute per IP (no session key)
  GET /stats/me:      60/minute per session
  GET /games/me:      60/minute per session

Each user sends its own ``X-Session-ID``. ``wait_time`` is 2-3 s
(``ReadOnlyUser``), so a user makes at most 60 / 2 = 30 requests a minute,
ignoring response time. Task weights are catalog 1, stats 10, history 9 (of 20):

  GET /games/catalog, per IP: 20 users x 30 x 1/20 = 30 / 60 = 50%
  GET /stats/me, per session:            30 x 10/20 = 15 / 60 = 25%
  GET /games/me, per session:            30 x  9/20 = 13.5 / 60 = 23%

The catalog is the one IP-keyed route, so it gets the small weight; the
expected 30/minute leaves room for the task choice being random.
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

    @task(1)
    def get_catalog(self):
        with self.client.get(
            "/games/catalog", name="GET /games/catalog", catch_response=True
        ) as resp:
            _check(resp)

    @task(10)
    def get_my_stats(self):
        with self.client.get(
            "/stats/me", headers=self._headers, name="GET /stats/me", catch_response=True
        ) as resp:
            _check(resp)

    @task(9)
    def get_my_games(self):
        with self.client.get(
            "/games/me", headers=self._headers, name="GET /games/me", catch_response=True
        ) as resp:
            _check(resp)

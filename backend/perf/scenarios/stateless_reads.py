"""
Scenario C: Read-only polling.

Simulates clients reading what the app reads on Home and Profile: the game
catalog, the player's stats and their game history. These reads establish
the latency floor for SLO calibration. (The old ``/yacht/state`` and
``/yacht/possible-scores`` polls hit server-side Yacht routes removed in
#2630.)

Rate limits, with perf.yml's 20 users from one runner IP:

  route               per session   per IP
  GET /games/catalog: -             60/minute
  GET /stats/me:      60/minute     300/minute
  GET /games/me:      60/minute     300/minute

Each user sends its own ``X-Session-ID``. ``wait_time`` is 3-4 s
(``ReadOnlyUser``), so a user makes at most 60 / 3 = 20 requests a minute,
ignoring response time. Task weights are catalog 1, stats 10, history 9 (of 20):

  GET /games/catalog, per IP:   20 users x 20 x  1/20 =  20 /  60 = 33%
  GET /stats/me, per IP:        20 users x 20 x 10/20 = 200 / 300 = 67%
  GET /games/me, per IP:        20 users x 20 x  9/20 = 180 / 300 = 60%
  GET /stats/me, per session:                  20 x 10/20 = 10 / 60 = 17%
  GET /games/me, per session:                  20 x  9/20 =  9 / 60 = 15%

(At the old 2-3 s wait the per-IP ceiling on /stats/me was 300/300, #3300.)
The catalog is IP-keyed only, so it gets the small weight; the expected
20/minute leaves room for the task choice being random.
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

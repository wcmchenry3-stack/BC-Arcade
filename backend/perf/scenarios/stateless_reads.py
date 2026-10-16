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

Each user sends its own ``X-Session-ID``. Locust users on one runner share one
IP, so the per-IP rate is the sum over all users and ``ReadOnlyUser`` derives its
wait from the user count (``read_wait``, ``scenarios/pacing.py``). Task weights
are catalog 1, stats 10, history 9 (of 20), i.e. 5%, 50% and 45% of requests. The
wait keeps the busiest route at 60% of its IP limit at the ceiling:

  users   wait         requests/min (max)   /stats/me (of 300)   /games/me (of 300)   catalog (of 60)
  1       0.5-0.67 s   120                  60 (20%)             54 (18%)             6 (10%)
  20      3.3-4.4 s    360                  180 (60%)            162 (54%)            18 (30%)

Per session the load is far below 60/minute. The catalog is IP-keyed only, so it
gets the small weight; the headroom covers the task choice being random.
"""

import uuid

from locust import TaskSet, task

from scenarios.pacing import read_wait, user_count


def wait_bounds(environment) -> tuple[float, float]:
    return read_wait(user_count(environment))


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

"""
Scenario A: One Yacht game through the session pipeline (sequential).

Yacht's engine runs on the device; the server only records the game. This
replays what the app's SyncWorker sends for one solo game: ``POST /games``,
one ``POST /games/{id}/events`` batch per round (a roll and a score),
``PATCH /games/{id}/complete``, then the result card's
``GET /games/{id}/rank``. The old server-side ``/yacht/*`` routes it used to
drive were removed in #2630.

Each game uses a fresh session id: ``POST /games`` and ``/complete`` are
limited to 10/minute per session, and a looping user would otherwise measure
its own 429s. A fresh session does not escape the per-IP backstops (#3300), and
every game comes from the runner's one IP, so games are paced.

Rate limits (``games/router.py``), with perf.yml's 1 user:

  route                          per session   per IP
  POST /games:                   10/minute     100/minute;10000/day
  POST /games/{id}/events:       60/minute     300/minute
  PATCH /games/{id}/complete:    10/minute     100/minute
  GET /games/{id}/rank:          60/minute     300/minute

Locust users on one runner share one IP, so the per-IP rate is the sum over
all users. A game is paced to a minimum cycle that depends on the user count
(``game_cycle_s``, ``scenarios/pacing.py``): the slowest of events (13 requests
a game against 300/minute), create and complete (1 against 100/minute) and rank
(1 against 300/minute), sized to use at most 60% of each IP limit:

  users   min cycle per game   games/min   events/min (of 300)   create (of 100)
  1       4.3 s                13.8        180 (60%)             14%
  5       21.7 s               13.8        180 (60%)             14%
  10      43.3 s               13.8        180 (60%)             14%

The aggregate is the same for any user count, so the 5-user run in the
``locustfile.py`` examples stays under every limit. Per session (one game):
create 1/10 = 10%, events 13/60 = 22%, complete 1/10 = 10%, rank 1/60 = 2%.
Without the pacing one user could send 390 events a minute against 300.
"""

import random
import time
import uuid

from locust import SequentialTaskSet, task

from scenarios.pacing import game_cycle_s, user_count

ROUNDS = 13


_CATEGORIES = (
    "ones",
    "twos",
    "threes",
    "fours",
    "fives",
    "sixes",
    "three_of_a_kind",
    "four_of_a_kind",
    "full_house",
    "small_straight",
    "large_straight",
    "yacht",
    "chance",
)


def _check(resp) -> None:
    """Mark a response failed unless it is a 2xx (locust needs catch_response)."""
    if resp.ok:
        resp.success()
    else:
        resp.failure(f"HTTP {resp.status_code}")


class GameFlowTasks(SequentialTaskSet):
    """Create, fill, complete and rank one Yacht game, then start over."""

    @task
    def create_game(self):
        self._started = time.monotonic()
        self._headers = {"X-Session-ID": str(uuid.uuid4())}
        self._game_id = str(uuid.uuid4())
        self._total = 0
        with self.client.post(
            "/games",
            json={"id": self._game_id, "game_type": "yacht", "metadata": {"mode": "solo"}},
            headers=self._headers,
            name="POST /games",
            catch_response=True,
        ) as resp:
            _check(resp)

    @task
    def play_rounds(self):
        for round_index in range(ROUNDS):
            value = random.randint(0, 30)
            self._total += value
            dice = [random.randint(1, 6) for _ in range(5)]
            events = [
                {
                    "event_index": 2 * round_index,
                    "event_type": "roll",
                    "data": {"held": [False] * 5, "dice": dice, "rolls_used_after": 1},
                },
                {
                    "event_index": 2 * round_index + 1,
                    "event_type": "score",
                    "data": {"category": _CATEGORIES[round_index], "value": value},
                },
            ]
            with self.client.post(
                f"/games/{self._game_id}/events",
                json={"events": events},
                headers=self._headers,
                name="POST /games/{id}/events",
                catch_response=True,
            ) as resp:
                _check(resp)

    @task
    def complete_game(self):
        with self.client.patch(
            f"/games/{self._game_id}/complete",
            json={"final_score": self._total, "outcome": "completed"},
            headers=self._headers,
            name="PATCH /games/{id}/complete",
            catch_response=True,
        ) as resp:
            _check(resp)

    @task
    def read_rank(self):
        # No display name for this session: the answer is `ranked: false`,
        # `reason: no_name`, which still runs the board checks.
        with self.client.get(
            f"/games/{self._game_id}/rank",
            headers=self._headers,
            name="GET /games/{id}/rank",
            catch_response=True,
        ) as resp:
            _check(resp)
        # Pad the game out to the cycle for the current user count.
        users = user_count(self.user.environment)
        time.sleep(max(0.0, game_cycle_s(users) - (time.monotonic() - self._started)))

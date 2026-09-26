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
its own 429s.
"""

import random
import uuid

from locust import SequentialTaskSet, task

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

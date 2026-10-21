"""
Scenario E: Replay ingestion (#3400, part of epic #3273).

``ReplayIngestTasks`` plays what the app's SyncWorker sends for one finished game
of a mix of types (Yacht, Solitaire, Blackjack, Sudoku, Star Swarm, Daily Word):
``POST /games``, the game's events in batches of ``BATCH_SIZE``, then
``PATCH /games/{id}/complete``. The events are the golden fixtures the backend's own
tests use (``scenarios/replay_payloads.py``), so each batch is a shape the per-game
validators accept, and a game stays inside its replay cap (``games/replay_caps.py``).

Checks on every response, beyond the status code:

  * an in-cap batch must come back ``accepted == len(batch)``, ``dropped == 0``:
    a load-dependent drop or cut is a failure, not a quiet 2xx;
  * about one game in ``OVER_CAP_EVERY`` is a Daily Word game with more events than
    its cap holds, and must come back 200 with ``dropped > 0`` (the cap cuts).

``ReplayRateLimitTasks`` is the rate-limit half: one session sends more than
``GAMES_EVENTS_SESSION_RATE_LIMIT`` (60/minute) event batches. The first 60 must be
200 and the rest 429 with ``Retry-After``. Those requests are named ``(rate test)``,
which ``check_thresholds.py`` leaves unchecked, so the expected 429s are not errors.

Per-IP limits: every Locust user on a runner shares one address, and
``POST /games/{id}/events`` allows 300/minute per IP (create and complete 100/minute).
A game is paced to a minimum cycle from the live user count, sized to use at most
60% of those limits (``scenarios/pacing.py``), so the run measures the server and not
its own 429s. Per session (one game of at most 3 batches) the 60/minute limit is
never near. That ceiling (about 180 event requests a minute, whatever the user count)
is why this is a latency and correctness check and not a stress test of the database.
"""

import random
import time
import uuid

from locust import SequentialTaskSet, task

from scenarios.pacing import HEADROOM, min_cycle_s, user_count
from scenarios.replay_payloads import (
    DAILY_WORD_CAP_EVENTS,
    build_game,
    over_cap_game,
    pick_game_type,
)

OVER_CAP_EVERY = 10  # one game in this many is the over-cap Daily Word game
OVER_CAP_EXTRA = 4  # guesses beyond the cap in that game
SESSION_LIMIT_PER_MIN = 60  # GAMES_EVENTS_SESSION_RATE_LIMIT (tests/test_replay_load.py)
EVENTS_IP_LIMIT_PER_MIN = 300  # GAMES_EVENTS_IP_RATE_LIMIT
CREATE_IP_LIMIT_PER_MIN = 100  # GAMES_CREATE_IP_RATE_LIMIT / GAMES_COMPLETE_IP_RATE_LIMIT


def game_cycle_s(users: int, batches: int) -> float:
    """Shortest time one user spends on a game of ``batches`` event requests."""
    return max(
        min_cycle_s(users, batches, EVENTS_IP_LIMIT_PER_MIN, HEADROOM),
        min_cycle_s(users, 1, CREATE_IP_LIMIT_PER_MIN, HEADROOM),
    )


class ReplayIngestTasks(SequentialTaskSet):
    @task
    def create_game(self):
        self._started = time.monotonic()
        self._over_cap = random.randrange(OVER_CAP_EVERY) == 0
        self._game = (
            over_cap_game(OVER_CAP_EXTRA) if self._over_cap else build_game(pick_game_type())
        )
        self._headers = {"X-Session-ID": str(uuid.uuid4())}
        self._game_id = str(uuid.uuid4())
        with self.client.post(
            "/games",
            json={
                "id": self._game_id,
                "game_type": self._game.game_type,
                "metadata": self._game.metadata,
            },
            headers=self._headers,
            name="POST /games (replay)",
            catch_response=True,
        ) as resp:
            _check(resp)

    @task
    def send_batches(self):
        for batch in self._game.batches():
            with self.client.post(
                f"/games/{self._game_id}/events",
                json={"events": batch},
                headers=self._headers,
                name="POST /games/{id}/events (replay)",
                catch_response=True,
            ) as resp:
                self._check_batch(resp, batch)

    def _check_batch(self, resp, batch) -> None:
        if not resp.ok:
            resp.failure(f"HTTP {resp.status_code}")
            return
        body = resp.json()
        if self._over_cap:
            # One batch holds the whole game: the lifecycle rows and the cap's worth of
            # guesses are stored, the extra guesses dropped on a 2xx.
            if (body["accepted"], body["dropped"]) != (DAILY_WORD_CAP_EVENTS + 2, OVER_CAP_EXTRA):
                resp.failure(f"over-cap batch not cut as the cap says: {body}")
            else:
                resp.success()
            return
        if body["accepted"] != len(batch) or body["dropped"] or body["rejected"]:
            resp.failure(f"in-cap batch not stored whole: {body}")
        else:
            resp.success()

    @task
    def complete_game(self):
        with self.client.patch(
            f"/games/{self._game_id}/complete",
            json=self._game.complete,
            headers=self._headers,
            name="PATCH /games/{id}/complete (replay)",
            catch_response=True,
        ) as resp:
            _check(resp)
        # Pad the game out to the cycle for the current user count.
        cycle = game_cycle_s(user_count(self.user.environment), len(self._game.batches()))
        time.sleep(max(0.0, cycle - (time.monotonic() - self._started)))


class ReplayRateLimitTasks(SequentialTaskSet):
    """One session sends 10 more event requests than its per-minute limit allows."""

    EXTRA = 10

    @task
    def exceed_session_limit(self):
        started = time.monotonic()
        game = build_game("daily_word")
        headers = {"X-Session-ID": str(uuid.uuid4())}
        game_id = str(uuid.uuid4())
        with self.client.post(
            "/games",
            json={"id": game_id, "game_type": game.game_type, "metadata": game.metadata},
            headers=headers,
            name="POST /games (rate test)",
            catch_response=True,
        ) as resp:
            _check(resp)
        allowed = refused = 0
        for i in range(SESSION_LIMIT_PER_MIN + self.EXTRA):
            # A lifecycle row under a new index each time: only the limiter refuses.
            event = {"event_index": i, "event_type": "game_ended", "data": {}}
            with self.client.post(
                f"/games/{game_id}/events",
                json={"events": [event]},
                headers=headers,
                name="POST /games/{id}/events (rate test)",
                catch_response=True,
            ) as resp:
                if resp.status_code == 200 and i < SESSION_LIMIT_PER_MIN:
                    allowed += 1
                    resp.success()
                elif resp.status_code == 429 and i >= SESSION_LIMIT_PER_MIN:
                    if "retry-after" in resp.headers:
                        refused += 1
                        resp.success()
                    else:
                        resp.failure("429 missing Retry-After header")
                else:
                    resp.failure(f"request {i + 1}: HTTP {resp.status_code}")
        if (allowed, refused) != (SESSION_LIMIT_PER_MIN, self.EXTRA):
            raise AssertionError(f"expected {SESSION_LIMIT_PER_MIN} ok + {self.EXTRA} 429s")
        # Let the per-IP window (300/minute) and the session window clear before the next round.
        time.sleep(max(0.0, 65.0 - (time.monotonic() - started)))


def _check(resp) -> None:
    """Mark a response failed unless it is a 2xx (locust needs catch_response)."""
    if resp.ok:
        resp.success()
    else:
        resp.failure(f"HTTP {resp.status_code}")

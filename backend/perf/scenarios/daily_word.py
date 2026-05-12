"""Daily Word performance scenario (#1195).

DailyWordTasks — simulates typical daily-word session traffic:
  @task(3)  POST /daily-word/guess  (3× weight — most frequent action)
  @task(1)  GET  /daily-word/today  (puzzle metadata fetch)

Each Locust user maintains its own X-Session-ID and puzzle_id so rate-limit
buckets are isolated. The session fetches today's puzzle_id on start, then
reuses it for all guess tasks (simulating a real player's session).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from locust import TaskSet, task


class DailyWordTasks(TaskSet):
    def on_start(self) -> None:
        self._session_id = str(uuid.uuid4())
        self._headers = {
            "X-Session-ID": self._session_id,
            "Content-Type": "application/json",
        }
        # Fetch today's puzzle_id once at session start
        resp = self.client.get(
            "/daily-word/today?tz_offset_minutes=0&lang=en",
            name="GET /daily-word/today (setup)",
        )
        if resp.status_code == 200:
            self._puzzle_id = resp.json().get("puzzle_id", "")
        else:
            local_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            self._puzzle_id = f"{local_date}:en"

    @task(3)
    def post_guess(self) -> None:
        with self.client.post(
            "/daily-word/guess",
            headers=self._headers,
            json={
                "puzzle_id": self._puzzle_id,
                "guess": "crane",
                "tz_offset_minutes": 0,
            },
            name="POST /daily-word/guess",
            catch_response=True,
        ) as resp:
            if resp.status_code in (200, 429):
                resp.success()
            else:
                resp.failure(f"Unexpected status {resp.status_code}")

    @task(1)
    def get_today(self) -> None:
        with self.client.get(
            "/daily-word/today?tz_offset_minutes=0&lang=en",
            name="GET /daily-word/today",
            catch_response=True,
        ) as resp:
            if resp.status_code == 200:
                resp.success()
            else:
                resp.failure(f"Unexpected status {resp.status_code}")

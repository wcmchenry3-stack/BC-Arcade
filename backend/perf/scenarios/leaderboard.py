"""
Scenario B: Concurrent leaderboard read/write.

The cascade leaderboard endpoints are the only ones safe to hit with
multiple concurrent users. Tests that the 10-entry cap holds under load.
"""

import random

from locust import TaskSet, task


class LeaderboardTasks(TaskSet):
    @task(2)
    def submit_score(self):
        n = self.user.environment.runner.user_count if self.user.environment.runner else 1
        name = f"LoadUser{random.randint(1, max(n, 1))}"
        with self.client.post(
            "/cascade/score",
            json={"player_name": name, "score": random.randint(100, 9999)},
            name="POST /cascade/score",
        ) as resp:
            resp.raise_for_status()

    @task(1)
    def get_scores(self):
        with self.client.get(
            "/cascade/scores",
            name="GET /cascade/scores",
        ) as resp:
            resp.raise_for_status()
            data = resp.json()
            scores = data.get("scores", [])
            if len(scores) > 10:
                resp.failure(f"Leaderboard cap violated: got {len(scores)} entries (max 10)")

"""
Scenario D: Rate limit verification.

Intentionally hammers endpoints to verify 429 responses fire correctly
and include the required Retry-After header.

Usage:
  # Verify 429 fires on /yacht/new (10/minute limit):
  locust -f perf/locustfile.py --headless --users 1 --spawn-rate 1 \
         --run-time 30s --host http://localhost:8000 RateLimitVerifyUser

  # Sustained 50-user attack — service must stay responsive:
  locust -f perf/locustfile.py --headless --users 50 --spawn-rate 10 \
         --run-time 60s --host http://localhost:8000 RateLimitVerifyUser
"""

import uuid

from locust import SequentialTaskSet, task


class RateLimitTasks(SequentialTaskSet):
    def on_start(self):
        # Each user gets its own session so sessions don't bleed into each other,
        # but all requests share the same IP bucket (key_func=_real_ip).
        self._session_id = str(uuid.uuid4())
        self._headers = {"X-Session-ID": self._session_id}

    @task
    def exhaust_new_game_limit(self):
        """POST /yacht/new 12 times; the 11th or 12th must return 429."""
        hit_429 = False
        for _ in range(12):
            with self.client.post(
                "/yacht/new",
                headers=self._headers,
                name="POST /yacht/new (rate test)",
                catch_response=True,
            ) as resp:
                if resp.status_code == 429:
                    if "retry-after" not in resp.headers:
                        resp.failure("429 missing Retry-After header")
                    else:
                        hit_429 = True
                        resp.success()
                elif resp.status_code == 200:
                    resp.success()
                else:
                    resp.failure(f"Unexpected status {resp.status_code}")
        if not hit_429:
            raise AssertionError("Expected 429 after exhausting rate limit but never received one")

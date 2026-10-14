"""Rate-limit counter storage and the process model (#3301).

The limiter keeps counters in process memory unless ``RATE_LIMIT_STORAGE_URL``
names a Redis-compatible store. The Redis tests need a real server and skip
unless ``RATE_LIMIT_STORAGE_URL`` is set (CI's ``test-postgres`` job starts one).
"""

from __future__ import annotations

import os
import re
import socket
from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from limits.storage import MemoryStorage, RedisStorage
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from limiter import build_limiter
from settings import Settings

REPO_ROOT = Path(__file__).resolve().parents[2]
REDIS_URL = os.environ.get("RATE_LIMIT_STORAGE_URL", "").strip()
needs_redis = pytest.mark.skipif(not REDIS_URL, reason="RATE_LIMIT_STORAGE_URL not set")


def _client(lim: Limiter, limit: str) -> TestClient:
    app = FastAPI()
    app.state.limiter = lim
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    @app.get("/ping")
    @lim.limit(limit)
    async def ping(request: Request) -> dict[str, bool]:
        return {"ok": True}

    return TestClient(app)


def _closed_port_url() -> str:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    return f"redis://127.0.0.1:{port}/0"


# --- render.yaml process-model guard ---------------------------------------


def _api_start_commands() -> list[tuple[str, str]]:
    config = yaml.safe_load((REPO_ROOT / "render.yaml").read_text(encoding="utf-8"))
    out = [
        (svc["name"], svc["startCommand"])
        for svc in config["services"]
        if svc.get("type") == "web" and svc.get("runtime") == "python"
    ]
    assert out, "no Python web services found in render.yaml"
    return out


def test_start_command_has_no_request_count_recycle() -> None:
    # uvicorn counts every request (429s included) toward --limit-max-requests and
    # then exits; on a single process that is downtime, an alembic re-run and
    # reset rate-limit counters, all driven by routine traffic.
    for name, cmd in _api_start_commands():
        assert "--limit-max-requests" not in cmd, f"{name}: remove --limit-max-requests"


def test_start_command_runs_a_single_worker() -> None:
    # Counters are per process unless RATE_LIMIT_STORAGE_URL is set, so several
    # workers would each allow the full limit. Before adding --workers/-w > 1, set
    # RATE_LIMIT_STORAGE_URL (a shared store) on the service and update this test.
    for name, cmd in _api_start_commands():
        for m in re.finditer(r"(?:--workers(?:\s+|=)|\s-w\s*)(\d+)", cmd):
            assert int(m.group(1)) <= 1, (
                f"{name}: multiple workers split in-memory rate limits; "
                "set RATE_LIMIT_STORAGE_URL first"
            )


# --- settings and construction ---------------------------------------------


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_unset_or_blank_url_is_none(raw: str | None) -> None:
    values = {} if raw is None else {"RATE_LIMIT_STORAGE_URL": raw}
    assert Settings.isolated(**values).rate_limit_storage_url is None


def test_url_is_stripped_and_not_in_repr() -> None:
    s = Settings.isolated(RATE_LIMIT_STORAGE_URL="  redis://:pw@host:6379/0 ")
    assert s.rate_limit_storage_url == "redis://:pw@host:6379/0"
    assert "pw@host" not in repr(s)


@pytest.mark.parametrize("url", [None, "", "  "])
def test_unset_uses_memory_storage(url: str | None) -> None:
    assert isinstance(build_limiter(url)._storage, MemoryStorage)


def test_configured_url_uses_redis_storage() -> None:
    lim = build_limiter("redis://127.0.0.1:6379/0")
    assert isinstance(lim._storage, RedisStorage)
    assert lim._storage_uri == "redis://127.0.0.1:6379/0"
    assert lim._in_memory_fallback_enabled


def test_unusable_url_falls_back_to_memory() -> None:
    assert isinstance(build_limiter("bogus://nowhere")._storage, MemoryStorage)


# --- fallback --------------------------------------------------------------


def test_unreachable_store_still_serves_and_limits_in_memory() -> None:
    client = _client(build_limiter(_closed_port_url()), "2/minute")
    codes = [client.get("/ping").status_code for _ in range(3)]
    assert codes == [200, 200, 429]


# --- real Redis ------------------------------------------------------------


@needs_redis
def test_counters_are_shared_across_instances_and_restarts() -> None:
    first = build_limiter(REDIS_URL)
    first.reset()
    client_a = _client(first, "3/minute")
    assert [client_a.get("/ping").status_code for _ in range(2)] == [200, 200]

    # A second limiter on the same store stands in for a restarted process or a
    # second instance: it sees the two hits already counted.
    client_b = _client(build_limiter(REDIS_URL), "3/minute")
    assert client_b.get("/ping").status_code == 200
    assert client_b.get("/ping").status_code == 429
    assert client_a.get("/ping").status_code == 429
    first.reset()

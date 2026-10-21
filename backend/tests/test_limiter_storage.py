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
import sentry_sdk
import yaml
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from limits.storage import RedisStorage
from sentry_sdk.integrations.redis import RedisIntegration
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from limiter import build_limiter, log_rate_limit_storage, storage_is_shared
from observability.sentry import sentry_options
from settings import Settings

pytestmark = pytest.mark.security

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


def test_start_command_pins_one_worker() -> None:
    # uvicorn takes its worker count from WEB_CONCURRENCY, which Render sets on
    # multi-CPU plans, so an absent flag can mean several processes. Counters are
    # per process unless RATE_LIMIT_STORAGE_URL is set, so each would allow the full
    # limit. Before raising this, set RATE_LIMIT_STORAGE_URL on the service.
    for name, cmd in _api_start_commands():
        found = re.findall(r"(?:--workers(?:\s+|=)|\s-w\s*)(\d+)", cmd)
        assert found == ["1"], (
            f"{name}: pass an explicit --workers 1 (WEB_CONCURRENCY would otherwise "
            "apply); more than one worker needs RATE_LIMIT_STORAGE_URL first"
        )


def test_start_command_disables_uvicorn_proxy_headers() -> None:
    # On Render, uvicorn rewrote request.client from the client-sent X-Forwarded-For
    # (#3340). limiter.py derives the IP itself and falls back to the socket peer,
    # so uvicorn must leave the peer alone, whatever FORWARDED_ALLOW_IPS says.
    for name, cmd in _api_start_commands():
        assert "--no-proxy-headers" in cmd.split(), f"{name}: add --no-proxy-headers"
        assert "--forwarded-allow-ips" not in cmd, f"{name}: remove --forwarded-allow-ips"


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
    assert not storage_is_shared(build_limiter(url))


def test_configured_url_uses_redis_storage() -> None:
    lim = build_limiter("redis://127.0.0.1:6379/0")
    assert storage_is_shared(lim)
    assert isinstance(lim._storage, RedisStorage)
    assert lim._storage_uri == "redis://127.0.0.1:6379/0"
    assert lim._in_memory_fallback_enabled
    assert not lim._swallow_errors


def test_unusable_url_falls_back_to_memory() -> None:
    assert not storage_is_shared(build_limiter("bogus://nowhere"))


def test_socket_timeouts_reach_the_connection_pool() -> None:
    kwargs = build_limiter(
        "redis://127.0.0.1:6379/0"
    )._storage.storage.connection_pool.connection_kwargs
    assert kwargs["socket_connect_timeout"] == 1
    assert kwargs["socket_timeout"] == 1


# --- startup probe ---------------------------------------------------------


def test_startup_log_in_memory_has_no_probe_or_warning(
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent: list[str] = []
    monkeypatch.setattr(sentry_sdk, "capture_message", lambda m, **kw: sent.append(m))
    with caplog.at_level("INFO", logger="audit"):
        log_rate_limit_storage(build_limiter(None))
    assert '"event": "rate_limit_storage", "shared": false' in caplog.text
    assert sent == []


def test_startup_probe_failure_warns_once_without_url(
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(
        sentry_sdk, "capture_message", lambda m, level=None: sent.append((m, level))
    )
    url = _closed_port_url()
    with caplog.at_level("INFO", logger="audit"):
        log_rate_limit_storage(build_limiter(url))
    assert '"shared": true' in caplog.text
    assert "rate_limit_storage_unreachable" in caplog.text
    assert len(sent) == 1 and sent[0][1] == "warning"
    assert url not in caplog.text and url not in sent[0][0]


@needs_redis
def test_startup_probe_succeeds_without_warning(
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent: list[str] = []
    monkeypatch.setattr(sentry_sdk, "capture_message", lambda m, **kw: sent.append(m))
    with caplog.at_level("INFO", logger="audit"):
        log_rate_limit_storage(build_limiter(REDIS_URL))
    assert "unreachable" not in caplog.text
    assert sent == []


def test_sentry_redis_integration_is_disabled() -> None:
    opts = sentry_options("https://k@o.ingest.sentry.io/1", Settings.isolated())
    assert any(isinstance(i, RedisIntegration) for i in opts["disabled_integrations"])


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

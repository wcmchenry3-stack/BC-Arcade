"""The app factory and the app-level middleware (#2993).

Pins what the refactor had to keep identical: the middleware order, the
security header set, the request log line, and that building another app does
not register any rate limit twice (#2673).
"""

from __future__ import annotations

import json
import logging

import pytest
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from slowapi.middleware import SlowAPIMiddleware
from starlette.responses import PlainTextResponse
from starlette.types import Receive, Scope, Send

import limiter as limiter_module
import main
from limiter import limiter
from middleware.body_size import MaxBodySizeMiddleware
from middleware.headers_and_log import SecurityHeadersAndLogMiddleware
from observability import sentry as sentry_setup

# Written out rather than imported, so a change to the middleware's table fails here.
EXPECTED_SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "content-security-policy": (
        "default-src 'none'; "
        "connect-src 'self' https://dev-games-api.buffingchi.com https://dev-games.buffingchi.com; "
        "frame-ancestors 'none'"
    ),
}
LOG_KEYS = ["ip", "method", "path", "status", "ms"]


def _request_logs(records: list[logging.LogRecord]) -> list[dict]:
    out = []
    for record in records:
        if record.name != "audit":
            continue
        try:
            payload = json.loads(record.getMessage())
        except ValueError:
            continue
        if isinstance(payload, dict) and "ms" in payload:
            out.append(payload)
    return out


@pytest.fixture()
def client() -> TestClient:
    limiter.reset()
    yield TestClient(main.app)
    limiter.reset()


# ---------------------------------------------------------------------------
# Middleware stack
# ---------------------------------------------------------------------------


def test_middleware_stack_order_outermost_first() -> None:
    """Headers + request log outermost; CORS wraps SlowAPI and MaxBody so 429/413
    carry CORS headers (#1739); MaxBody innermost."""
    assert [m.cls for m in main.app.user_middleware] == [
        SecurityHeadersAndLogMiddleware,
        CORSMiddleware,
        SlowAPIMiddleware,
        MaxBodySizeMiddleware,
    ]


def test_cors_configuration() -> None:
    (cors,) = [m for m in main.app.user_middleware if m.cls is CORSMiddleware]
    assert cors.kwargs == {
        "allow_origins": ["http://localhost:8081", "http://localhost:19006"],
        "allow_methods": ["GET", "POST", "PUT", "PATCH", "DELETE"],
        "expose_headers": ["Retry-After"],
        "allow_headers": ["Content-Type", "X-Session-ID", "X-Admin-Token"],
    }


@pytest.mark.parametrize(
    ("method", "path", "kwargs", "status"),
    [
        ("GET", "/health", {}, 200),
        ("GET", "/no-such-route", {}, 404),
        (
            "PUT",
            "/players/me",
            {"content": b"x" * 2000, "headers": {"Content-Length": "2000"}},
            413,
        ),
        (
            "OPTIONS",
            "/players/me",
            {
                "headers": {
                    "Origin": "http://localhost:8081",
                    "Access-Control-Request-Method": "PUT",
                }
            },
            200,
        ),
    ],
)
def test_every_response_carries_the_security_headers(
    client: TestClient, method: str, path: str, kwargs: dict, status: int
) -> None:
    res = client.request(method, path, **kwargs)
    assert res.status_code == status
    for name, value in EXPECTED_SECURITY_HEADERS.items():
        assert res.headers.get_list(name) == [value], name
    assert "server" not in res.headers


def test_429_carries_security_and_cors_headers(client: TestClient) -> None:
    statuses = []
    for _ in range(121):  # /health allows 120/minute
        res = client.get("/health", headers={"Origin": "http://localhost:8081"})
        statuses.append(res.status_code)
    assert statuses[-1] == 429
    assert res.headers["retry-after"] == "60"
    assert res.headers["access-control-allow-origin"] == "http://localhost:8081"
    for name, value in EXPECTED_SECURITY_HEADERS.items():
        assert res.headers[name] == value


# ---------------------------------------------------------------------------
# Request log line
# ---------------------------------------------------------------------------


def test_request_log_line_keys(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="audit"):
        client.get("/health")
    (line,) = _request_logs(caplog.records)
    assert list(line) == LOG_KEYS
    assert line["method"] == "GET" and line["path"] == "/health" and line["status"] == 200
    assert line["ip"] == "testclient"
    assert isinstance(line["ms"], float)


def test_request_log_events_for_413_and_429(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="audit"):
        client.put("/players/me", content=b"x" * 2000, headers={"Content-Length": "2000"})
        for _ in range(121):
            client.get("/health")
    lines = _request_logs(caplog.records)
    too_large = [x for x in lines if x["status"] == 413]
    limited = [x for x in lines if x["status"] == 429]
    assert [list(x) for x in too_large] == [[*LOG_KEYS, "event"]]
    assert too_large[0]["event"] == "body_too_large"
    assert limited and all(x["event"] == "rate_limit_exceeded" for x in limited)
    assert all("event" not in x for x in lines if x["status"] == 200)


def _app_returning(status: int, headers: dict[str, str] | None = None):
    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        await PlainTextResponse("x", status_code=status, headers=headers)(scope, receive, send)

    return app


def test_middleware_replaces_existing_headers_and_drops_server(
    caplog: pytest.LogCaptureFixture,
) -> None:
    inner = _app_returning(503, {"X-Frame-Options": "SAMEORIGIN", "Server": "inner"})
    with caplog.at_level(logging.INFO, logger="audit"):
        res = TestClient(SecurityHeadersAndLogMiddleware(inner)).get("/x")
    assert res.status_code == 503
    assert res.headers.get_list("x-frame-options") == ["DENY"]
    assert "server" not in res.headers
    (line,) = _request_logs(caplog.records)
    assert line["event"] == "server_error"
    assert list(line) == [*LOG_KEYS, "event"]


def test_unhandled_exception_propagates_without_a_log_line(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """As with the old BaseHTTPMiddleware pair: no headers, no log line; Starlette's
    ServerErrorMiddleware (outside all user middleware) makes the 500."""

    async def boom(scope: Scope, receive: Receive, send: Send) -> None:
        raise RuntimeError("boom")

    with caplog.at_level(logging.INFO, logger="audit"), pytest.raises(RuntimeError):
        TestClient(SecurityHeadersAndLogMiddleware(boom)).get("/x")
    assert _request_logs(caplog.records) == []


def test_request_log_carries_proxy_debug_when_enabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(limiter_module, "_LOG_PROXY_HEADERS", True)
    with caplog.at_level(logging.INFO, logger="audit"):
        client.get("/health")
    (line,) = _request_logs(caplog.records)
    assert list(line) == [*LOG_KEYS, "proxy"]


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def _registered_limits() -> dict[str, int]:
    return {key: len(limits) for key, limits in limiter._route_limits.items()}


def test_building_another_app_registers_no_limit_twice() -> None:
    """#2673: `importlib.reload(main)` doubled every limit; the factory must not."""
    before = _registered_limits()
    main.create_app()
    main.create_app()
    assert _registered_limits() == before
    assert before["routes.health.health_db"] == 1


def test_factory_apps_take_their_config_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", " https://a.example.com , https://b.example.com ")
    monkeypatch.setenv("ENVIRONMENT", "production")
    prod = main.create_app()
    (cors,) = [m for m in prod.user_middleware if m.cls is CORSMiddleware]
    assert cors.kwargs["allow_origins"] == ["https://a.example.com", "https://b.example.com"]
    assert prod.docs_url is None and prod.redoc_url is None and prod.openapi_url is None
    assert "/debug/error" not in {getattr(r, "path", None) for r in prod.routes}
    # The module-level app is untouched.
    (default_cors,) = [m for m in main.app.user_middleware if m.cls is CORSMiddleware]
    assert default_cors.kwargs["allow_origins"] == [
        "http://localhost:8081",
        "http://localhost:19006",
    ]


def test_debug_route_only_in_test_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "test")
    app = main.create_app()
    res = TestClient(app, raise_server_exceptions=False).get("/debug/error")
    assert res.status_code == 500
    assert "routes.debug.trigger_error" in limiter._route_limits


def test_factory_loads_proxy_trust_and_rejects_bad_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(limiter_module, "_TRUST", limiter_module._TRUST)
    monkeypatch.setattr(limiter_module, "_LOG_PROXY_HEADERS", limiter_module._LOG_PROXY_HEADERS)
    monkeypatch.setenv("TRUSTED_PROXY_MODE", "render")
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    main.create_app()
    trust = limiter_module._TRUST
    assert (trust.mode, trust.hops) == ("render", 2)
    monkeypatch.setenv("TRUSTED_PROXY_MODE", "leftmost")
    with pytest.raises(ValueError, match="TRUSTED_PROXY_MODE"):
        main.create_app()


def test_init_sentry_runs_once_and_only_with_a_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict] = []
    monkeypatch.setattr(sentry_setup.sentry_sdk, "init", lambda **kw: calls.append(kw))
    monkeypatch.setattr(sentry_setup, "_initialised", False)
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert sentry_setup.init_sentry() is False
    monkeypatch.setenv("SENTRY_DSN", "https://key@o0.ingest.sentry.io/0")
    assert sentry_setup.init_sentry() is True
    assert sentry_setup.init_sentry() is False
    assert len(calls) == 1
    assert calls[0]["dsn"] == "https://key@o0.ingest.sentry.io/0"
    assert calls[0]["send_default_pii"] is False

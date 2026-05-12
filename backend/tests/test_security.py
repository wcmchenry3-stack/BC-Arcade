"""Security tests — CORS, response headers, rate limiting, session isolation, input sanitization."""

import importlib
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings, strategies as st

from db.base import get_session_factory
from db.models import GameEntitlement


async def _grant(session_id: str, game_slug: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug=game_slug))
        await db.commit()


@pytest.fixture()
def client_default():
    """Client using the default (dev) allowed origins."""
    import main as m

    yield TestClient(m.app)


@pytest.fixture()
def client_prod():
    """Client with a production ALLOWED_ORIGINS env var."""
    from limiter import limiter

    os.environ["ALLOWED_ORIGINS"] = "https://dev-games.buffingchi.com"
    import main as m

    importlib.reload(m)
    limiter.reset()
    yield TestClient(m.app)
    os.environ.pop("ALLOWED_ORIGINS", None)
    importlib.reload(m)
    limiter.reset()


def _sid() -> str:
    return str(uuid.uuid4())


def _fake_game_id() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------


@pytest.mark.security
def test_security_headers_present(client_default):
    res = client_default.get("/health")
    assert res.headers.get("x-content-type-options") == "nosniff"
    assert res.headers.get("x-frame-options") == "DENY"
    assert res.headers.get("referrer-policy") == "strict-origin-when-cross-origin"


@pytest.mark.security
def test_csp_header_present_on_get(client_default):
    res = client_default.get("/health")
    csp = res.headers.get("content-security-policy", "")
    assert "default-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp


@pytest.mark.security
def test_csp_header_present_on_post(client_default):
    sid = _sid()
    res = client_default.patch(
        f"/cascade/score/{_fake_game_id()}",
        json={"player_name": "tester"},
        headers={"X-Session-ID": sid},
    )
    csp = res.headers.get("content-security-policy", "")
    assert "default-src" in csp


@pytest.mark.security
def test_server_header_suppressed(client_default):
    res = client_default.get("/health")
    assert "server" not in res.headers


# ---------------------------------------------------------------------------
# CORS — allowed origins (GET)
# ---------------------------------------------------------------------------


@pytest.mark.security
def test_cors_allowed_origin_localhost(client_default):
    res = client_default.get(
        "/health",
        headers={"Origin": "http://localhost:8081"},
    )
    assert res.headers.get("access-control-allow-origin") == "http://localhost:8081"


@pytest.mark.security
def test_cors_blocked_unknown_origin(client_default):
    res = client_default.get(
        "/health",
        headers={"Origin": "https://evil.example.com"},
    )
    assert "access-control-allow-origin" not in res.headers


@pytest.mark.security
def test_cors_prod_allows_frontend(client_prod):
    res = client_prod.get(
        "/health",
        headers={"Origin": "https://dev-games.buffingchi.com"},
    )
    assert res.headers.get("access-control-allow-origin") == "https://dev-games.buffingchi.com"


@pytest.mark.security
def test_cors_prod_blocks_localhost(client_prod):
    res = client_prod.get(
        "/health",
        headers={"Origin": "http://localhost:8081"},
    )
    assert "access-control-allow-origin" not in res.headers


# ---------------------------------------------------------------------------
# CORS — POST endpoints
# ---------------------------------------------------------------------------


@pytest.mark.security
def test_cors_post_allowed_origin(client_default):
    res = client_default.patch(
        f"/cascade/score/{_fake_game_id()}",
        json={"player_name": "tester"},
        headers={"Origin": "http://localhost:8081", "X-Session-ID": _sid()},
    )
    assert res.headers.get("access-control-allow-origin") == "http://localhost:8081"


@pytest.mark.security
def test_cors_post_blocked_origin(client_default):
    res = client_default.patch(
        f"/cascade/score/{_fake_game_id()}",
        json={"player_name": "tester"},
        headers={"Origin": "https://evil.example.com", "X-Session-ID": _sid()},
    )
    assert "access-control-allow-origin" not in res.headers


# ---------------------------------------------------------------------------
# CORS — preflight OPTIONS
# ---------------------------------------------------------------------------


@pytest.mark.security
def test_cors_preflight_allowed_origin(client_default):
    res = client_default.options(
        "/cascade/score/fake-id",
        headers={
            "Origin": "http://localhost:8081",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "Content-Type, X-Session-ID",
        },
    )
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == "http://localhost:8081"


@pytest.mark.security
def test_cors_preflight_blocked_origin(client_default):
    res = client_default.options(
        "/cascade/score/fake-id",
        headers={
            "Origin": "https://attacker.example.com",
            "Access-Control-Request-Method": "PATCH",
        },
    )
    assert "access-control-allow-origin" not in res.headers


@pytest.mark.security
def test_cors_null_origin_blocked(client_default):
    res = client_default.get(
        "/health",
        headers={"Origin": "null"},
    )
    assert "access-control-allow-origin" not in res.headers


# ---------------------------------------------------------------------------
# Request body size limits
# ---------------------------------------------------------------------------


@pytest.mark.security
def test_oversized_body_returns_413(client_default):
    sid = _sid()
    res = client_default.patch(
        f"/cascade/score/{_fake_game_id()}",
        content=b"x" * 2000,
        headers={
            "Content-Type": "application/json",
            "Content-Length": "2000",
            "X-Session-ID": sid,
        },
    )
    assert res.status_code == 413


@pytest.mark.security
def test_normal_body_not_rejected(client_default):
    sid = _sid()
    res = client_default.patch(
        f"/cascade/score/{_fake_game_id()}",
        json={"player_name": "tester"},
        headers={"X-Session-ID": sid},
    )
    assert res.status_code != 413


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


@pytest.mark.security
async def test_rate_limit_returns_429_after_threshold(client_default):
    """PATCH /cascade/score has a 10/minute per-session limit; 11th request must be 429."""
    sid = _sid()
    await _grant(sid, "cascade")
    game_id = _fake_game_id()
    responses = [
        client_default.patch(
            f"/cascade/score/{game_id}",
            json={"player_name": "tester"},
            headers={"X-Session-ID": sid},
        )
        for _ in range(11)
    ]
    assert any(r.status_code == 429 for r in responses)


@pytest.mark.security
async def test_rate_limit_429_has_retry_after(client_default):
    """429 responses must include Retry-After header."""
    sid = _sid()
    await _grant(sid, "cascade")
    game_id = _fake_game_id()
    responses = [
        client_default.patch(
            f"/cascade/score/{game_id}",
            json={"player_name": "tester"},
            headers={"X-Session-ID": sid},
        )
        for _ in range(11)
    ]
    rate_limited = [r for r in responses if r.status_code == 429]
    assert rate_limited, "Expected at least one 429"
    for r in rate_limited:
        assert "retry-after" in r.headers


@pytest.mark.security
async def test_cascade_score_strict_limit(client_default):
    """PATCH /cascade/score/:id has a 10/minute limit per (session, URL).

    All 11 requests target the same game_id so they share one rate-limit bucket.
    """
    fake_id = str(uuid.uuid4())
    sid = _sid()
    await _grant(sid, "cascade")
    responses = [
        client_default.patch(
            f"/cascade/score/{fake_id}",
            json={"player_name": "tester"},
            headers={"X-Session-ID": sid},
        )
        for _ in range(11)
    ]
    assert any(r.status_code == 429 for r in responses)


# ---------------------------------------------------------------------------
# Session isolation
# ---------------------------------------------------------------------------


@pytest.mark.security
def test_missing_session_id_returns_400(client_default):
    res = client_default.get("/games/me")
    assert res.status_code == 400


@pytest.mark.security
def test_invalid_uuid_session_id_returns_400(client_default):
    res = client_default.get("/games/me", headers={"X-Session-ID": "not-a-uuid"})
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Fuzz tests (Hypothesis)
# ---------------------------------------------------------------------------


@pytest.mark.security
@given(player_name=st.text(min_size=0, max_size=200))
@settings(
    max_examples=50,
    deadline=2000,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_cascade_score_string_input_never_500(client_default, player_name):
    """Arbitrary string values for player_name must never produce 5xx errors."""
    from limiter import limiter

    limiter.reset()
    res = client_default.patch(
        f"/cascade/score/{_fake_game_id()}",
        json={"player_name": player_name},
        headers={"X-Session-ID": _sid()},
    )
    assert res.status_code < 500, f"5xx for player_name={player_name!r}: {res.text}"

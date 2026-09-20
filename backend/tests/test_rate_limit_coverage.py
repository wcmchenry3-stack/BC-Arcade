"""Every HTTP route must carry a rate limit (hard rule #12, #2210).

`GET /games/catalog` shipped without a `@limiter.limit` decorator and nothing
noticed — the shared `Limiter` has no `default_limits` (a global default would
also throttle `/health` and the uptime monitor), so an omitted decorator
silently leaves a route wide open. This audit turns that omission into a
failing test.
"""

import os
import subprocess
import sys

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

import main
from limiter import limiter


def _api_routes(routes) -> list[APIRoute]:
    """Flatten `app.routes`, descending into `include_router` wrappers.

    Recent FastAPI keeps each `include_router` as a lazy `_IncludedRouter`
    (holding `original_router`) instead of copying its routes onto the app, so
    iterating `app.routes` alone sees only the handful declared in `main.py`.
    """
    found: list[APIRoute] = []
    for route in routes:
        if isinstance(route, APIRoute):
            found.append(route)
        elif hasattr(route, "original_router"):
            found.extend(_api_routes(route.original_router.routes))
    return found


def _route_key(route: APIRoute) -> str:
    # slowapi registers each decorated handler under "<module>.<function>" in
    # the private `Limiter._route_limits`, and looks limits up by the same key
    # when enforcing — so this audit sees exactly what slowapi enforces. It is
    # coupled to slowapi and FastAPI internals (both pinned in requirements.txt):
    # a rename fails loudly here (AttributeError / the route-count floor below).
    return f"{route.endpoint.__module__}.{route.endpoint.__name__}"


def test_every_api_route_has_a_rate_limit() -> None:
    routes = _api_routes(main.app.routes)
    # ~35 routes today; a floor keeps a FastAPI routing change from making the
    # audit pass vacuously (the first version of this test did exactly that).
    assert len(routes) >= 30, f"only {len(routes)} API routes found — is the walk broken?"

    unthrottled = sorted(
        _route_key(r) for r in routes if _route_key(r) not in limiter._route_limits
    )
    assert unthrottled == [], (
        "handlers without @limiter.limit (hard rule #12 — unauthenticated routes key by IP, "
        f"authenticated routes by user/session): {unthrottled}"
    )


@pytest.fixture()
def client() -> TestClient:
    return TestClient(main.app)


def test_catalog_is_rate_limited(client: TestClient) -> None:
    statuses = [client.get("/games/catalog").status_code for _ in range(61)]
    assert statuses[:60] == [200] * 60
    assert statuses[60] == 429


def test_every_api_route_has_a_rate_limit_in_test_environment() -> None:
    """`main.py` registers `/debug/error` only when ENVIRONMENT=test (the
    sentry-check job sets it), so it is invisible to the audit above unless the
    app is imported that way. Re-run the audit in a fresh interpreter with the
    variable set — the conditional route must be throttled too."""
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            __file__,
            "-k",
            "test_every_api_route_has_a_rate_limit and not test_environment",
            "--no-cov",
            "-q",
            "-p",
            "no:cacheprovider",
        ],
        env={**os.environ, "ENVIRONMENT": "test"},
        capture_output=True,
        text=True,
        timeout=120,
        check=False,  # the assert below reports the child's output
    )
    assert result.returncode == 0, result.stdout[-2000:] + result.stderr[-500:]

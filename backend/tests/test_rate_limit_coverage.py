"""Every HTTP route must carry a rate limit (hard rule #12, #2210).

`GET /games/catalog` shipped without a `@limiter.limit` decorator and nothing
noticed — the shared `Limiter` has no `default_limits` (a global default would
also throttle `/health` and the uptime monitor), so an omitted decorator
silently leaves a route wide open. This audit turns that omission into a
failing test.

Coupling, stated plainly: the audit reads slowapi's private
`Limiter._route_limits` and FastAPI's private `_IncludedRouter.original_router`
(both libraries are pinned in requirements.txt). There is no public "is this
route limited?" API, and hitting every route to find out would need valid
auth and payloads for each. Instead the private access is confined to
`_limited_handlers` / `_walk_routes`, and canary tests fail with a clear
message if either library changes shape — including the dangerous case where
the registry stops being meaningful and the audit would pass or fail
regardless of the code.
"""

import os
import subprocess
import sys

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from starlette.routing import Route

import main
from games import service as games_service
from games.router import CATALOG_RATE_LIMIT
from limiter import limiter

# FastAPI's built-in docs routes are plain Starlette routes with no handler of
# ours to decorate. They are exempt *by name*, so a new kind of route (a
# WebSocket, a Mount, an `add_route` handler) fails the audit instead of being
# skipped. NB: they are public and unthrottled today, which sits uneasily with
# rule #12 — the choice is to disable them outside development or to limit them.
FRAMEWORK_ROUTES = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}

CATALOG_KEY = "games.router.get_catalog"


def _walk_routes(routes) -> tuple[list[APIRoute], list]:
    """Flatten `app.routes` into (API routes, everything else).

    Recent FastAPI keeps each `include_router` as a lazy `_IncludedRouter`
    (holding `original_router`) instead of copying its routes onto the app, so
    iterating `app.routes` alone sees only the handful declared in `main.py`.
    """
    api: list[APIRoute] = []
    other: list = []
    for route in routes:
        if isinstance(route, APIRoute):
            api.append(route)
        elif hasattr(route, "original_router"):
            child_api, child_other = _walk_routes(route.original_router.routes)
            api.extend(child_api)
            other.extend(child_other)
        else:
            other.append(route)
    return api, other


def _route_key(route: APIRoute) -> str:
    # slowapi registers each decorated handler under "<module>.<function>" and
    # looks limits up by the same key when enforcing — so this is exactly what
    # slowapi sees.
    return f"{route.endpoint.__module__}.{route.endpoint.__name__}"


def _limited_handlers() -> set[str]:
    """Keys of the handlers slowapi will throttle (the only private-registry read)."""
    registry = getattr(limiter, "_route_limits", None)
    assert isinstance(registry, dict) and registry, (
        "slowapi's Limiter._route_limits is missing or empty — the pinned slowapi "
        "changed shape; re-derive this audit before trusting it"
    )
    return set(registry)


def _undecorated_handler() -> None:  # never registered with the limiter
    ...


def test_audit_internals_still_mean_what_the_audit_assumes() -> None:
    """Canaries: a known-limited route must be found by the walk AND present in
    the registry, and a function that was never decorated must be absent. Together
    they catch a slowapi/FastAPI change that would make the audit vacuously pass
    (registry contains everything / walk finds nothing) or fail everything."""
    api, _ = _walk_routes(main.app.routes)
    assert CATALOG_KEY in {_route_key(r) for r in api}, "route walk no longer descends into routers"
    limited = _limited_handlers()
    assert CATALOG_KEY in limited, "registry no longer keyed by '<module>.<function>'"
    assert f"{__name__}._undecorated_handler" not in limited, "registry lists undecorated handlers"


def test_every_api_route_has_a_rate_limit() -> None:
    routes, _ = _walk_routes(main.app.routes)
    # ~25 routes today (the per-game leaderboard routes went in #2644); a floor
    # keeps a FastAPI routing change from making the audit pass vacuously (the
    # first version of this test did exactly that).
    assert len(routes) >= 20, f"only {len(routes)} API routes found — is the walk broken?"

    limited = _limited_handlers()
    unthrottled = sorted(_route_key(r) for r in routes if _route_key(r) not in limited)
    assert unthrottled == [], (
        "handlers without @limiter.limit (hard rule #12 — unauthenticated routes key by IP, "
        f"authenticated routes by user/session): {unthrottled}"
    )


def test_no_two_handlers_share_a_limiter_key() -> None:
    """slowapi keys by '<module>.<function>', so two different handlers with the
    same name (say, factory-generated) would share one entry: decorating one
    would make the audit report the other as covered. The same handler mounted
    on several paths or methods is fine."""
    routes, _ = _walk_routes(main.app.routes)
    handlers_by_key: dict[str, set[int]] = {}
    for route in routes:
        handlers_by_key.setdefault(_route_key(route), set()).add(id(route.endpoint))
    ambiguous = sorted(key for key, handlers in handlers_by_key.items() if len(handlers) > 1)
    assert ambiguous == [], f"distinct handlers collide on one limiter key: {ambiguous}"


def test_no_route_type_escapes_the_audit() -> None:
    """Only `APIRoute`s can be checked; anything else (WebSocket, Mount,
    `add_route`) must be a known framework route or fail here, not be skipped."""
    _, other = _walk_routes(main.app.routes)
    unexpected = sorted(
        f"{type(r).__name__} {getattr(r, 'path', r)!r}"
        for r in other
        if not (type(r) is Route and r.path in FRAMEWORK_ROUTES)
    )
    assert (
        unexpected == []
    ), f"routes the audit cannot check — rate-limit them or exempt them by name: {unexpected}"


@pytest.fixture()
def client() -> TestClient:
    return TestClient(main.app)


def test_catalog_is_rate_limited(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def _empty_catalog(_db) -> list:
        return []

    # The limit is what is under test, not the catalog rows: no seed-data coupling.
    monkeypatch.setattr(games_service, "get_catalog", _empty_catalog)

    assert CATALOG_RATE_LIMIT.endswith("/minute"), "test assumes a per-minute window"
    allowed = int(CATALOG_RATE_LIMIT.split("/")[0])
    statuses = [client.get("/games/catalog").status_code for _ in range(allowed + 1)]
    assert statuses == [200] * allowed + [429]


def test_every_api_route_has_a_rate_limit_in_test_environment() -> None:
    """`main.py` registers `/debug/error` only when ENVIRONMENT=test (the
    sentry-check job sets it), so it is invisible to the audit above unless the
    app is imported that way. Re-run every check in this file in a fresh
    interpreter with the variable set — the conditional route must be
    throttled too."""
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            __file__,
            "-k",
            "not test_environment",  # deselect this test, or it would recurse
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

"""BC Arcade API entrypoint: ``create_app()`` builds the FastAPI app; ``app`` is what runs.

Render starts ``uvicorn main:app`` (render.yaml), so ``app = create_app()`` at
the bottom of this module stays the entrypoint. Everything with a process-wide
effect — logging setup, the client-IP trust settings, Sentry — runs inside
``create_app()`` rather than when the modules that define it are imported, so
tests can build a fresh app (for example with other ``ALLOWED_ORIGINS``) by
calling the factory instead of ``importlib.reload(main)``, which registered
every rate limit a second time (#2673).

The one exception is ``load_dotenv()`` just below: ``db.base``,
``daily_word.puzzle`` and ``daily_challenge.definitions`` read their env vars
when imported, so the local ``backend/.env`` has to be loaded before the
imports that follow, not inside the factory. It is a no-op in production
(Render injects the variables) and never overrides a variable already set.

Where things live:

- ``observability/`` — Sentry options, scrub lists and init; logging setup.
- ``middleware/`` — security headers + request log (outermost), body caps (innermost).
- ``routes/health.py`` — ``/health`` and ``/health/db``; ``routes/debug.py`` — test-only.
- this module — the lifespan and its background jobs, app-level exception
  handlers, CORS, and the middleware order.
"""

import json
import logging
import os
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # loads backend/.env when running locally; no-op in production (Render injects vars)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from daily_challenge.router import router as daily_challenge_router
from daily_word.router import router as daily_word_router
from db.base import DATABASE_URL, is_configured
from entitlements.dependencies import EntitlementError
from entitlements.router import router as entitlements_router
from entitlements.service import is_dev_override_active
from games.router import router as games_router
from jobs.lifespan import configured_jobs, start_jobs
from limiter import client_ip, configure_proxy_trust, limiter, log_proxy_trust
from logs.router import router as logs_router
from me.router import router as me_router
from middleware.body_size import DEFAULT_MAX_BODY_BYTES, MaxBodySizeMiddleware
from middleware.headers_and_log import SecurityHeadersAndLogMiddleware
from observability.log_config import configure_logging
from observability.sentry import SENTRY_SCRUBBED_KEYS, SQL_REDACTED, init_sentry
from observability.sentry import sentry_options as _sentry_options
from players.router import router as players_router
from purchases.router import router as purchases_router
from routes.health import _ping_db
from routes.health import router as health_router
from sort.router import router as sort_router
from stats.router import router as stats_router

# Names other modules and tests import from ``main`` (several moved out in #2993).
__all__ = [
    "DEFAULT_MAX_BODY_BYTES",
    "SENTRY_SCRUBBED_KEYS",
    "SQL_REDACTED",
    "MaxBodySizeMiddleware",
    "_sentry_options",
    "app",
    "create_app",
]

_audit_log = logging.getLogger("audit")

DEFAULT_ALLOWED_ORIGINS = ["http://localhost:8081", "http://localhost:19006"]
# PUT is for PUT /players/me; without it a browser preflight fails on Expo Web (#2758).
CORS_ALLOW_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]
CORS_ALLOW_HEADERS = ["Content-Type", "X-Session-ID", "X-Admin-Token"]
CORS_EXPOSE_HEADERS = ["Retry-After"]

# ---------------------------------------------------------------------------
# Lifespan: startup checks and the background jobs
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup and shutdown for the API (#2668).

    Replaces four ``@app.on_event`` hooks, which FastAPI deprecates — and which
    it stops running once a lifespan is set, so they moved together. Startup
    steps run in their previous registration order.

    The background jobs (``jobs.lifespan.configured_jobs()``: Daily Word
    retention, App Store replay, Google Play jobs) start in that order, as
    tasks in ``app.state.job_tasks`` (which tests read), and stop in reverse
    (#2994). They start before the DB health check, which can take up to
    ``DB_PING_TIMEOUT_SECONDS``, and the stack unwinds on every exit —
    including a startup that is cancelled or fails there (#2672 review).
    Stopping is bounded (#2667), a job's ``reraise_on_crash`` decides whether
    a crashed task surfaces, and ``job_tasks`` is emptied either way.
    """
    _warn_if_dev_override_active()
    app.state.job_tasks = {}
    async with AsyncExitStack() as stack:
        start_jobs(stack, configured_jobs(), app.state.job_tasks)
        await _db_health_check()
        yield


def _warn_if_dev_override_active() -> None:
    if is_dev_override_active():
        logging.getLogger("audit").warning(
            "DEV ENTITLEMENT OVERRIDE ACTIVE — all premium games unlocked for all sessions"
        )


async def _db_health_check() -> None:
    """Log DB reachability on boot. Non-fatal if DATABASE_URL is unset."""
    if not is_configured():
        _audit_log.info(json.dumps({"event": "db_unconfigured"}))
        return
    try:
        await _ping_db()
        host = DATABASE_URL.split("@")[-1] if DATABASE_URL else ""
        _audit_log.info(json.dumps({"event": "db_connected", "url": host}))
    except Exception as exc:  # noqa: BLE001
        _audit_log.error(json.dumps({"event": "db_connect_failed", "error": str(exc)}))


# ---------------------------------------------------------------------------
# App-level exception handlers
# ---------------------------------------------------------------------------


async def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    _audit_log.warning(
        json.dumps(
            {
                "event": "rate_limit_exceeded",
                "ip": client_ip(request),
                "method": request.method,
                "path": request.url.path,
            }
        )
    )
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Try again later."},
        headers={"Retry-After": "60"},
    )


async def _entitlement_error_handler(request: Request, exc: EntitlementError) -> JSONResponse:
    return JSONResponse(
        status_code=403,
        content={"detail": "not_entitled", "game": exc.game_slug},
    )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def _allowed_origins() -> list[str]:
    """CORS origins, read when the app is built.

    Deployed services set ALLOWED_ORIGINS (comma-separated full URLs, e.g.
    "https://dev-games.buffingchi.com"); unset means the local Expo dev servers.
    """
    raw = os.environ.get("ALLOWED_ORIGINS", "")
    if not raw:
        return list(DEFAULT_ALLOWED_ORIGINS)
    return [o.strip() for o in raw.split(",") if o.strip()]


def _include_routers(app: FastAPI) -> None:
    app.include_router(entitlements_router, prefix="/entitlements")
    app.include_router(daily_challenge_router, prefix="/daily-challenge")
    app.include_router(daily_word_router, prefix="/daily-word")
    app.include_router(sort_router, prefix="/sort")
    app.include_router(games_router, prefix="/games")
    app.include_router(logs_router, prefix="/logs")
    app.include_router(me_router, prefix="/me")
    app.include_router(players_router, prefix="/players")
    app.include_router(purchases_router, prefix="/purchases")
    app.include_router(stats_router, prefix="/stats")
    app.include_router(health_router)
    if os.getenv("ENVIRONMENT") == "test":
        # Test-only /debug/error (Sentry verification). Imported here so its
        # rate limit is registered only where the route exists.
        from routes.debug import router as debug_router

        app.include_router(debug_router)


def _add_middleware(app: FastAPI) -> None:
    """Register the middleware stack. The last one registered is the outermost.

    Order outermost → innermost:
      1. SecurityHeadersAndLogMiddleware — security headers on every response,
         then one JSON log line per request, 429s and 413s included
      2. CORSMiddleware — must wrap SlowAPI and MaxBody so 429 (rate-limited)
         and 413 (body-too-large) responses carry Access-Control-Allow-Origin;
         without it browsers block them and raise TypeError: Failed to fetch (#1739)
      3. SlowAPIMiddleware — rate limiting
      4. MaxBodySizeMiddleware — reject oversized bodies early
    """
    app.add_middleware(MaxBodySizeMiddleware)
    app.add_middleware(SlowAPIMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins(),
        allow_methods=CORS_ALLOW_METHODS,
        expose_headers=CORS_EXPOSE_HEADERS,
        allow_headers=CORS_ALLOW_HEADERS,
    )
    app.add_middleware(SecurityHeadersAndLogMiddleware)


def create_app() -> FastAPI:
    """Build the API: process-wide setup first, then the app, routes, handlers, middleware.

    Logging, the client-IP trust settings (a bad TRUSTED_PROXY_* value raises
    here, so the deploy stops) and Sentry are set up before the FastAPI object
    exists, in the order the old import-time code ran them; Sentry in
    particular patches Starlette/FastAPI before the app is built. Calling this
    more than once is safe: route handlers are decorated once, when their
    modules are imported, so no rate limit is registered twice, and Sentry
    initialises once per process.
    """
    configure_logging()
    configure_proxy_trust()
    log_proxy_trust()
    init_sentry()

    # The interactive docs (/docs, /redoc) and raw spec (/openapi.json) expose the
    # whole API surface publicly; a consumer game backend doesn't need them live in
    # prod, and they were unthrottled (#2464's route audit exempts FastAPI's own
    # doc routes, so this doesn't need a rate limit added).
    _is_production = os.environ.get("ENVIRONMENT") == "production"
    app = FastAPI(
        lifespan=lifespan,
        title="BC Arcade API",
        docs_url=None if _is_production else "/docs",
        redoc_url=None if _is_production else "/redoc",
        openapi_url=None if _is_production else "/openapi.json",
    )
    _include_routers(app)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)
    app.add_exception_handler(EntitlementError, _entitlement_error_handler)
    _add_middleware(app)
    return app


app = create_app()

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

import asyncio
import json
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

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

    The Daily Word retention task is held in one place, ``app.state`` (which
    tests read). The ``try`` opens as soon as it exists, so it is stopped on
    every exit — including a startup that is cancelled or fails during the
    DB health check, which can take up to ``DB_PING_TIMEOUT_SECONDS`` (#2672
    review). Stopping is bounded (#2667), and the state is reset even when a
    crashed task is re-raised.
    """
    _warn_if_dev_override_active()
    app.state.retention_task = _start_daily_word_retention()
    app.state.apple_replay_task = _start_apple_notification_replay()
    app.state.google_jobs_task = _start_google_play_jobs()
    try:
        await _db_health_check()
        yield
    finally:
        try:
            await _stop_purchase_task(app.state.google_jobs_task, "google_jobs_stop_timeout")
        finally:
            app.state.google_jobs_task = None
            try:
                await _stop_apple_notification_replay(app.state.apple_replay_task)
            finally:
                app.state.apple_replay_task = None
                try:
                    await _stop_daily_word_retention(app.state.retention_task)
                finally:
                    app.state.retention_task = None


def _warn_if_dev_override_active() -> None:
    if is_dev_override_active():
        logging.getLogger("audit").warning(
            "DEV ENTITLEMENT OVERRIDE ACTIVE — all premium games unlocked for all sessions"
        )


# Daily Word retention (#2544): prune guess records older than 14 days, at
# startup and then daily. Started and cancelled by `lifespan` above.
def _start_daily_word_retention() -> asyncio.Task | None:
    if not is_configured():
        return None
    from daily_word.retention import run_retention_loop
    from db.base import get_session_factory

    return asyncio.create_task(run_retention_loop(get_session_factory))


RETENTION_STOP_TIMEOUT_SECONDS = 5.0


async def _stop_daily_word_retention(task: asyncio.Task | None) -> None:
    """Cancel the retention task and wait for it — but only so long.

    Bounded (#2667): a prune stuck in the driver can absorb the cancel, and an
    unbounded wait held shutdown, and a TestClient exit, for good; CI hung
    ~28 min on it. After the bound it warns and moves on.

    asyncio.wait never raises the task's own outcome, so a CancelledError aimed
    at *this* coroutine — shutdown itself being cancelled — still propagates
    (#2672 review). A task that crashed is re-raised, as ``await task`` did;
    the lifespan resets its state regardless.
    """
    if task is None:
        return
    from daily_word.retention import logger as retention_logger

    task.cancel()
    done, _ = await asyncio.wait({task}, timeout=RETENTION_STOP_TIMEOUT_SECONDS)
    if not done:
        retention_logger.warning(
            "daily_word retention: task still running %.0fs after cancel; not waiting",
            RETENTION_STOP_TIMEOUT_SECONDS,
        )
    elif not task.cancelled():
        task.result()  # re-raises a crash, as `await task` did


# App Store notification-history replay (#2786, docs/IAP.md §6.5): replays the
# last 48 h of App Store Server Notifications at startup and then daily, so a
# webhook Apple gave up on is still applied. Runs only when Apple verification
# and the App Store Server API are configured; idempotent across instances
# (notificationUUID dedupe). Manual run: `python scripts/apple_replay_notifications.py`.
def _start_apple_notification_replay() -> asyncio.Task | None:
    if not is_configured():
        return None
    from purchases import apple

    verifier = apple.configured_verifier()
    if verifier is None or not verifier.has_api:
        return None
    from db.base import get_session_factory
    from purchases.apple_notifications import run_replay_loop

    return asyncio.create_task(run_replay_loop(apple.configured_verifier, get_session_factory))


async def _stop_apple_notification_replay(task: asyncio.Task | None) -> None:
    """Cancel the replay task, bounded like the retention task (#2667)."""
    await _stop_purchase_task(task, "apple_replay_stop_timeout")


async def _stop_purchase_task(task: asyncio.Task | None, timeout_event: str) -> None:
    """Cancel a background purchase job, waiting at most RETENTION_STOP_TIMEOUT_SECONDS."""
    if task is None:
        return
    task.cancel()
    done, _ = await asyncio.wait({task}, timeout=RETENTION_STOP_TIMEOUT_SECONDS)
    if not done:
        _audit_log.warning(json.dumps({"event": timeout_event}))


# Google Play jobs (#2787, docs/IAP.md §7.6): the voided-purchases poll (last
# 48 h) and the unacknowledged-purchase sweep, at startup and then daily. Runs
# only when Google verification is configured; idempotent across instances
# (per-void dedupe keys; acknowledgement is safe to repeat). Manual run:
# `python scripts/google_play_jobs.py`.
def _start_google_play_jobs() -> asyncio.Task | None:
    if not is_configured():
        return None
    from purchases import google

    if google.configured_verifier() is None:
        return None
    from db.base import get_session_factory
    from purchases.google_notifications import run_google_jobs_loop

    return asyncio.create_task(
        run_google_jobs_loop(google.configured_verifier, get_session_factory)
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

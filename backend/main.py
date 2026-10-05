import asyncio
import json
import logging
import os
import re
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # loads backend/.env when running locally; no-op in production (Render injects vars)

import sentry_sdk
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.scrubber import DEFAULT_DENYLIST, EventScrubber
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from daily_challenge.router import router as daily_challenge_router
from daily_word.router import router as daily_word_router
from db.base import DATABASE_URL, get_engine, is_configured
from entitlements.dependencies import EntitlementError
from entitlements.router import router as entitlements_router
from entitlements.service import is_dev_override_active
from games.router import router as games_router
from limiter import client_ip, limiter, log_proxy_trust, proxy_header_debug
from logs.router import router as logs_router
from me.router import router as me_router
from players.router import router as players_router
from purchases.router import router as purchases_router
from sort.router import router as sort_router
from stats.router import router as stats_router

# ---------------------------------------------------------------------------
# Audit logger — emits JSON lines; Render's log aggregator handles timestamps
# ---------------------------------------------------------------------------

logging.basicConfig(level=logging.INFO, format="%(message)s")
_audit_log = logging.getLogger("audit")
# httpx logs every request URL at INFO ("HTTP Request: GET .../tokens/<token>").
# Store API URLs carry credentials in the path (Google purchaseToken, Apple
# transaction IDs), so the HTTP client loggers only speak up for warnings (#2787).
for _http_logger in ("httpx", "httpcore"):
    logging.getLogger(_http_logger).setLevel(logging.WARNING)
log_proxy_trust()

# ---------------------------------------------------------------------------
# Sentry — no-op when SENTRY_DSN is unset (local dev)
# ---------------------------------------------------------------------------


# Keys the SDK would otherwise forward verbatim. Its default denylist knows none
# of ours (the SDK lowercases both sides, so matching is case-insensitive):
# X-Admin-Token is a secret, and X-Session-ID / session_id is the player's
# pseudonymous ID — the Privacy Policy says crash reports carry no identifier.
# The store evidence of POST /purchases/* (#840) is a bearer credential for a
# paid purchase: purchase_token (Google), signed_transaction / signedPayload
# (Apple JWS) and the store_key derived from either. Google Play (#2787) adds
# the Play API / RTDN spelling purchaseToken, the obfuscated account id (a
# session derivative), the order id, and the service-account key; the RTDN
# bearer token is "authorization", already in the SDK's default denylist.
SENTRY_SCRUBBED_KEYS = [
    "x-session-id",
    "x-admin-token",
    "session_id",
    "purchase_token",
    "signed_transaction",
    "signedPayload",
    "store_key",
    "purchaseToken",
    "obfuscatedExternalAccountId",
    "account_token",
    "orderId",
    "service_account_json",
    "service_account_info",
    # Client IP headers (#2863). The SDK's header filter already drops
    # X-Forwarded-For and X-Real-IP; the Cloudflare ones and Forwarded it does
    # not know. All five are listed so the rule does not depend on SDK
    # internals — the Privacy Policy says Sentry does not store IP addresses.
    "cf-connecting-ip",
    "true-client-ip",
    "x-forwarded-for",
    "x-real-ip",
    "forwarded",
]

# SQLAlchemy appends the statement and its bound values to every DBAPIError
# message ("[SQL: ...]", "[parameters: ...]"), and Postgres adds a
# "DETAIL:  Key (...)=(...)" line to constraint errors. Those values can be
# session ids or store keys, so they are cut before an event leaves.
_SQL_FRAGMENT = re.compile(r"\s*\[(?:SQL|parameters): .*", re.DOTALL)
_PG_DETAIL = re.compile(r"\n?[ \t]*DETAIL: [^\n]*")
SQL_REDACTED = " [SQL redacted]"


def _strip_sql(text: str) -> str:
    stripped = _PG_DETAIL.sub("", _SQL_FRAGMENT.sub("", text))
    return stripped + SQL_REDACTED if stripped != text else text


def _sentry_before_send(event: dict, hint: dict) -> dict:
    """Remove SQL statements, bound parameters and constraint details from an event."""
    for exc in (event.get("exception") or {}).get("values") or []:
        if isinstance(exc.get("value"), str):
            exc["value"] = _strip_sql(exc["value"])
    logentry = event.get("logentry")
    if isinstance(logentry, dict):
        for key in ("message", "formatted"):
            if isinstance(logentry.get(key), str):
                logentry[key] = _strip_sql(logentry[key])
    if isinstance(event.get("message"), str):
        event["message"] = _strip_sql(event["message"])
    return _redact_store_ids(event)


# Store API URLs carry credentials in their path or query: Google Play
# `.../purchases/productsv2/tokens/<purchaseToken>` and `.../products/<id>/tokens/<token>:acknowledge`,
# Apple `/inApps/v1/transactions/<transactionId>` and `/inApps/v1/history/<id>`,
# and pagination tokens (`?paginationToken=` for Apple notification history,
# `?token=` for Google voided purchases). The SDK's HTTP integrations (httpx,
# stdlib http.client) put full URLs into span descriptions and data and into
# breadcrumbs, which no key denylist catches — so every string in those is
# rewritten (#2787 security review B1). `before_send` does not run on
# transactions, hence the separate transaction and breadcrumb hooks.
_STORE_ID_PATTERNS = (
    (re.compile(r"(/tokens/)[^/?#:\s\"']+"), r"\1[redacted]"),
    (re.compile(r"(/transactions/)[^/?#\s\"']+"), r"\1[redacted]"),
    (re.compile(r"(/history/)[^/?#\s\"']+"), r"\1[redacted]"),
    (re.compile(r"((?:[?&]|^)(?:paginationToken|token)=)[^&#\s\"']+"), r"\1[redacted]"),
)


def _redact_text(text: str) -> str:
    for pattern, replacement in _STORE_ID_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def _redact_store_ids(value):
    """Recursively redact store IDs in every string of a dict / list structure."""
    if isinstance(value, str):
        return _redact_text(value)
    if isinstance(value, dict):
        return {k: _redact_store_ids(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact_store_ids(v) for v in value]
    return value


def _sentry_before_send_transaction(event: dict, hint: dict) -> dict:
    """Redact store IDs from a performance transaction (span descriptions, span data, breadcrumbs)."""
    return _redact_store_ids(event)


def _sentry_before_breadcrumb(crumb: dict, hint: dict) -> dict:
    """Redact store IDs from a breadcrumb (HTTP client breadcrumbs carry the full URL)."""
    return _redact_store_ids(crumb)


def _sentry_options(dsn: str) -> dict:
    """Build the sentry_sdk.init kwargs.

    `environment` comes from ENVIRONMENT (set per service in render.yaml) and
    defaults to "development" — sentry-sdk's own default is "production", which
    tagged every dev-API event as production (#851). `release` is the deployed
    commit, which Render injects as RENDER_GIT_COMMIT.

    Request bodies are never attached (``max_request_body_size="never"``): the
    SDK has only a global switch, and /purchases bodies are store credentials
    (#840). Frame locals are off for the same reason — the repr of a local (a
    request model, a verifier's evidence) is not caught by a key denylist.
    """
    return {
        "dsn": dsn,
        "integrations": [StarletteIntegration(), FastApiIntegration()],
        "traces_sample_rate": 0.1,
        "environment": os.environ.get("ENVIRONMENT", "development"),
        "release": os.environ.get("RENDER_GIT_COMMIT"),
        "send_default_pii": False,
        "max_request_body_size": "never",
        "include_local_variables": False,
        "event_scrubber": EventScrubber(
            denylist=DEFAULT_DENYLIST + SENTRY_SCRUBBED_KEYS, recursive=True
        ),
        "before_send": _sentry_before_send,
        # Hooks rather than disabling the HTTP integrations: they cover httpx
        # (Google Play, the Apple API client) and stdlib http.client alike,
        # including any client added later, and keep outbound-call spans for
        # latency debugging.
        "before_send_transaction": _sentry_before_send_transaction,
        "before_breadcrumb": _sentry_before_breadcrumb,
    }


_sentry_dsn = os.environ.get("SENTRY_DSN")
if _sentry_dsn:
    sentry_sdk.init(**_sentry_options(_sentry_dsn))

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

# The interactive docs (/docs, /redoc) and raw spec (/openapi.json) expose the
# whole API surface publicly; a consumer game backend doesn't need them live in
# prod, and they were unthrottled (#2464's route audit exempts FastAPI's own
# doc routes, so this doesn't need a rate limit added).
_is_production = os.environ.get("ENVIRONMENT") == "production"


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


app = FastAPI(
    lifespan=lifespan,
    title="BC Arcade API",
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
    openapi_url=None if _is_production else "/openapi.json",
)
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

# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

app.state.limiter = limiter


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


app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)


async def _entitlement_error_handler(request: Request, exc: EntitlementError) -> JSONResponse:
    return JSONResponse(
        status_code=403,
        content={"detail": "not_entitled", "game": exc.game_slug},
    )


app.add_exception_handler(EntitlementError, _entitlement_error_handler)

# ---------------------------------------------------------------------------
# CORS — scoped to known origins; set ALLOWED_ORIGINS env var (comma-separated)
# in production with full URLs (e.g. "https://dev-games.buffingchi.com").
# ---------------------------------------------------------------------------

_raw = os.environ.get("ALLOWED_ORIGINS", "")
_allowed_origins: list[str] = (
    [o.strip() for o in _raw.split(",") if o.strip()]
    if _raw
    else ["http://localhost:8081", "http://localhost:19006"]
)

# ---------------------------------------------------------------------------
# Middleware stack (registered last = outermost in Starlette)
# Order outermost → innermost:
#   1. request_logger  (@app.middleware, outermost — logs every request incl. 429s)
#   2. security_headers  (@app.middleware)
#   3. CORSMiddleware  (must wrap SlowAPI/MaxBody so 429/413 errors carry CORS headers)
#   4. SlowAPIMiddleware  (rate limiting)
#   5. MaxBodySizeMiddleware  (reject oversized bodies early, innermost)
# ---------------------------------------------------------------------------

DEFAULT_MAX_BODY_BYTES = 1_024  # 1 KB — legacy game payloads (~50 bytes max)
LARGE_BODY_BYTES = 256 * 1_024  # 256 KB — batched events + bug logs (#364)
LARGE_BODY_PREFIXES = ("/games", "/logs", "/stats")
# An Apple StoreKit 2 JWS carries its certificate chain, ~4-6 KB (#840).
PURCHASE_BODY_BYTES = 32 * 1_024
PURCHASE_BODY_PREFIX = "/purchases"


def _max_body_bytes_for(path: str) -> int:
    if path.startswith(PURCHASE_BODY_PREFIX):
        return PURCHASE_BODY_BYTES
    for prefix in LARGE_BODY_PREFIXES:
        if path.startswith(prefix):
            return LARGE_BODY_BYTES
    return DEFAULT_MAX_BODY_BYTES


def _json_error(status: int, detail: str) -> Response:
    return Response(
        content=json.dumps({"detail": detail}), status_code=status, media_type="application/json"
    )


class MaxBodySizeMiddleware:
    """Reject bodies over the path's cap (pure ASGI, so it can see the body stream).

    * A ``Content-Length`` over the cap → 413; one that is not a non-negative
      integer → 400 (it used to raise, a 500).
    * No ``Content-Length`` (chunked) on ``/purchases/*`` — which includes the
      unauthenticated App Store webhook — the body is read here, at most
      ``cap`` bytes, then handed on; more than that → 413. Other paths keep
      their previous behavior (no streaming check).
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope["path"]
        cap = _max_body_bytes_for(path)
        content_length = Headers(scope=scope).get("content-length")
        if content_length is not None:
            text = content_length.strip()
            if not (text.isascii() and text.isdigit()):
                await _json_error(400, "Invalid Content-Length.")(scope, receive, send)
                return
            if int(text) > cap:
                await _json_error(413, "Request body too large.")(scope, receive, send)
                return
            await self.app(scope, receive, send)
            return
        if not path.startswith(PURCHASE_BODY_PREFIX):
            await self.app(scope, receive, send)
            return

        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > cap:
                await _json_error(413, "Request body too large.")(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


# Register in reverse of desired execution order (last registered = outermost).
# CORSMiddleware is registered last so it wraps SlowAPI and MaxBody — this
# ensures 429 (rate-limited) and 413 (body-too-large) responses include the
# Access-Control-Allow-Origin header. Without it, browsers block those error
# responses and raise TypeError: Failed to fetch (#1739).
app.add_middleware(MaxBodySizeMiddleware)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    expose_headers=["Retry-After"],
    allow_headers=["Content-Type", "X-Session-ID", "X-Admin-Token"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next) -> Response:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # HTTPS-only for a year. Browsers ignore it on plain-HTTP responses, so local
    # dev is unaffected. No `preload`: that is a hard-to-undo list submission.
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Content-Security-Policy"] = (
        "default-src 'none'; "
        "connect-src 'self' https://dev-games-api.buffingchi.com https://dev-games.buffingchi.com; "
        "frame-ancestors 'none'"
    )
    if "server" in response.headers:
        del response.headers["server"]
    return response


@app.middleware("http")
async def request_logger(request: Request, call_next) -> Response:
    """Outermost middleware — logs every request, including 429s."""
    start = time.monotonic()
    response = await call_next(request)
    duration_ms = round((time.monotonic() - start) * 1000, 1)

    record: dict = {
        "ip": client_ip(request),
        "method": request.method,
        "path": request.url.path,
        "status": response.status_code,
        "ms": duration_ms,
    }
    if response.status_code == 429:
        record["event"] = "rate_limit_exceeded"
    elif response.status_code == 413:
        record["event"] = "body_too_large"
    elif response.status_code >= 500:
        record["event"] = "server_error"
    proxy = proxy_header_debug(request)  # None unless LOG_PROXY_HEADERS=1 (dev only)
    if proxy is not None:
        record["proxy"] = proxy

    _audit_log.info(json.dumps(record))
    return response


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


DB_PING_TIMEOUT_SECONDS = 5.0


async def _ping_db() -> None:
    """Round-trip `SELECT 1`. Raises on any connectivity failure.

    Bounded: a pooler that accepts the TCP connection and then stalls would
    otherwise hold the request for asyncpg's ~60 s connect timeout (or
    SQLAlchemy's 30 s pool timeout when the pool is exhausted), so the uptime
    monitor would see its own timeout instead of a 503 and polls would pile up.
    """
    from sqlalchemy import text

    async def _select_one() -> None:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))

    await asyncio.wait_for(_select_one(), timeout=DB_PING_TIMEOUT_SECONDS)


async def _db_health_check() -> None:
    """Log DB reachability on boot. Non-fatal if DATABASE_URL is unset."""
    if not is_configured():
        _audit_log.info(json.dumps({"event": "db_unconfigured"}))
        return
    try:
        await _ping_db()
        host = DATABASE_URL.split("@")[-1] if DATABASE_URL else ""
        _audit_log.info(json.dumps({"event": "db_connected", "url": host}))
    except Exception as exc:
        _audit_log.error(json.dumps({"event": "db_connect_failed", "error": str(exc)}))


@app.get("/health")
@limiter.limit("120/minute")
def health(request: Request) -> dict:
    return {"status": "ok"}


@app.get("/health/db")
@limiter.limit("30/minute")
async def health_db(request: Request) -> JSONResponse:
    """DB round-trip for the uptime monitor.

    `/health` never touches the database, so Render's health check alone would
    let the Supabase free-plan project idle into a pause (#2432). The error
    detail goes to the audit log only — never into the response body.
    """
    if not is_configured():
        return JSONResponse(status_code=503, content={"status": "unconfigured"})
    try:
        await _ping_db()
    except Exception as exc:
        # asyncio.TimeoutError stringifies to "" — log the type so a stall is legible.
        detail = str(exc) or type(exc).__name__
        _audit_log.error(json.dumps({"event": "db_health_failed", "error": detail}))
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return JSONResponse(content={"status": "ok"})


# ---------------------------------------------------------------------------
# Test-only route — confirms Sentry captures unhandled exceptions
# ---------------------------------------------------------------------------

if os.getenv("ENVIRONMENT") == "test":

    @app.get("/debug/error")
    @limiter.limit("5/minute")
    def trigger_error(request: Request) -> None:
        raise RuntimeError("Intentional test error for Sentry verification")

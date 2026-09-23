import asyncio
import json
import logging
import os
import time

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
from starlette.middleware.base import BaseHTTPMiddleware

from cascade.router import router as cascade_router
from daily_challenge.router import router as daily_challenge_router
from daily_word.router import router as daily_word_router
from db.base import DATABASE_URL, get_engine, is_configured
from entitlements.dependencies import EntitlementError
from entitlements.router import router as entitlements_router
from entitlements.service import is_dev_override_active
from freecell.router import router as freecell_router
from games.router import router as games_router
from hearts.router import router as hearts_router
from limiter import _real_ip, limiter
from logs.router import router as logs_router
from mahjong.router import router as mahjong_router
from me.router import router as me_router
from solitaire.router import router as solitaire_router
from sort.router import router as sort_router
from starswarm.router import router as starswarm_router
from stats.router import router as stats_router
from sudoku.router import router as sudoku_router
from yacht.router import router as yacht_router

# ---------------------------------------------------------------------------
# Audit logger — emits JSON lines; Render's log aggregator handles timestamps
# ---------------------------------------------------------------------------

logging.basicConfig(level=logging.INFO, format="%(message)s")
_audit_log = logging.getLogger("audit")

# ---------------------------------------------------------------------------
# Sentry — no-op when SENTRY_DSN is unset (local dev)
# ---------------------------------------------------------------------------


# Request headers the SDK would otherwise forward verbatim. Its default denylist
# matches keys exactly and knows neither of ours: X-Admin-Token is a secret, and
# X-Session-ID is the player's pseudonymous ID — the Privacy Policy says crash
# reports carry no identifier.
SENTRY_SCRUBBED_HEADERS = ["x-session-id", "x-admin-token"]


def _sentry_options(dsn: str) -> dict:
    """Build the sentry_sdk.init kwargs.

    `environment` comes from ENVIRONMENT (set per service in render.yaml) and
    defaults to "development" — sentry-sdk's own default is "production", which
    tagged every dev-API event as production (#851). `release` is the deployed
    commit, which Render injects as RENDER_GIT_COMMIT.
    """
    return {
        "dsn": dsn,
        "integrations": [StarletteIntegration(), FastApiIntegration()],
        "traces_sample_rate": 0.1,
        "environment": os.environ.get("ENVIRONMENT", "development"),
        "release": os.environ.get("RENDER_GIT_COMMIT"),
        "send_default_pii": False,
        "event_scrubber": EventScrubber(denylist=DEFAULT_DENYLIST + SENTRY_SCRUBBED_HEADERS),
    }


_sentry_dsn = os.environ.get("SENTRY_DSN")
if _sentry_dsn:
    sentry_sdk.init(**_sentry_options(_sentry_dsn))

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="BC Arcade API")
app.include_router(entitlements_router, prefix="/entitlements")
app.include_router(cascade_router, prefix="/cascade")
app.include_router(daily_challenge_router, prefix="/daily-challenge")
app.include_router(daily_word_router, prefix="/daily-word")
app.include_router(freecell_router, prefix="/freecell")
app.include_router(hearts_router, prefix="/hearts")
app.include_router(mahjong_router, prefix="/mahjong")
app.include_router(solitaire_router, prefix="/solitaire")
app.include_router(sort_router, prefix="/sort")
app.include_router(starswarm_router, prefix="/starswarm")
app.include_router(sudoku_router, prefix="/sudoku")
app.include_router(yacht_router, prefix="/yacht")
app.include_router(games_router, prefix="/games")
app.include_router(logs_router, prefix="/logs")
app.include_router(me_router, prefix="/me")
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
                "ip": _real_ip(request),
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


def _max_body_bytes_for(path: str) -> int:
    for prefix in LARGE_BODY_PREFIXES:
        if path.startswith(prefix):
            return LARGE_BODY_BYTES
    return DEFAULT_MAX_BODY_BYTES


class MaxBodySizeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        content_length = request.headers.get("content-length")
        if content_length:
            cap = _max_body_bytes_for(request.url.path)
            if int(content_length) > cap:
                return Response(
                    content='{"detail":"Request body too large."}',
                    status_code=413,
                    media_type="application/json",
                )
        return await call_next(request)


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
        "ip": _real_ip(request),
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

    _audit_log.info(json.dumps(record))
    return response


@app.on_event("startup")
async def _dev_entitlement_override_warning() -> None:
    if is_dev_override_active():
        logging.getLogger("audit").warning(
            "DEV ENTITLEMENT OVERRIDE ACTIVE — all premium games unlocked for all sessions"
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


@app.on_event("startup")
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
    except Exception as exc:  # noqa: BLE001
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

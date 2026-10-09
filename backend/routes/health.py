"""``GET /health`` (Render's health check) and ``GET /health/db`` (the uptime monitor, #2432).

The handlers are decorated once, at import, so building more than one app with
``main.create_app()`` never registers their rate limits twice (#2673).
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from db.base import get_engine, is_configured
from limiter import limiter
from rate_limits import (
    HEALTH_DB_IP_RATE_LIMIT,
    HEALTH_IP_RATE_LIMIT,
)

_audit_log = logging.getLogger("audit")

router = APIRouter()

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


@router.get("/health")
@limiter.limit(HEALTH_IP_RATE_LIMIT)
def health(request: Request) -> dict:
    return {"status": "ok"}


@router.get("/health/db")
@limiter.limit(HEALTH_DB_IP_RATE_LIMIT)
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

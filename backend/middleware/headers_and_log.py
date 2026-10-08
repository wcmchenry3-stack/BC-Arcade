"""Security headers and the per-request audit log line, in one pure-ASGI middleware.

Replaces two ``@app.middleware("http")`` functions (``request_logger`` outermost,
``security_headers`` inside it). Each of those was a Starlette
``BaseHTTPMiddleware``, which adds a task group and a response wrapper to every
request. This one only wraps ``send`` and acts on ``http.response.start``:

1. sets the security headers on the outgoing response and drops any app-set
   ``server`` header (what ``security_headers`` did);
2. times the request up to that message and logs one JSON line with the same
   keys as before — ``ip``, ``method``, ``path``, ``status``, ``ms``, plus
   ``event`` for 429 / 413 / 5xx and ``proxy`` when ``LOG_PROXY_HEADERS`` is on
   (what ``request_logger`` did) — before the start message is sent on.

As before, an exception that escapes the app propagates untouched: no headers
and no log line, and Starlette's ``ServerErrorMiddleware`` (outside every user
middleware) turns it into the 500.
"""

from __future__ import annotations

import json
import logging
import time

from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from limiter import client_ip, proxy_header_debug

_audit_log = logging.getLogger("audit")

SECURITY_HEADERS: tuple[tuple[str, str], ...] = (
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    # HTTPS-only for a year. Browsers ignore it on plain-HTTP responses, so local
    # dev is unaffected. No `preload`: that is a hard-to-undo list submission.
    ("Strict-Transport-Security", "max-age=31536000; includeSubDomains"),
    (
        "Content-Security-Policy",
        (
            "default-src 'none'; "
            "connect-src 'self' https://dev-games-api.buffingchi.com https://dev-games.buffingchi.com; "
            "frame-ancestors 'none'"
        ),
    ),
)


def _event_for(status: int) -> str | None:
    if status == 429:
        return "rate_limit_exceeded"
    if status == 413:
        return "body_too_large"
    if status >= 500:
        return "server_error"
    return None


class SecurityHeadersAndLogMiddleware:
    """Outermost middleware — adds security headers and logs every request, including 429s."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        start = time.monotonic()

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS:
                    headers[name] = value
                if "server" in headers:
                    del headers["server"]
                duration_ms = round((time.monotonic() - start) * 1000, 1)
                _log_request(scope, message["status"], duration_ms)
            await send(message)

        await self.app(scope, receive, send_wrapper)


def _log_request(scope: Scope, status: int, duration_ms: float) -> None:
    request = Request(scope)
    record: dict = {
        "ip": client_ip(request),
        "method": request.method,
        "path": request.url.path,
        "status": status,
        "ms": duration_ms,
    }
    event = _event_for(status)
    if event is not None:
        record["event"] = event
    proxy = proxy_header_debug(request)  # None unless LOG_PROXY_HEADERS=1 (dev only)
    if proxy is not None:
        record["proxy"] = proxy
    _audit_log.info(json.dumps(record))

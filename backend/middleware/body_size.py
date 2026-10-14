"""Per-path request body caps (pure ASGI, innermost middleware — see ``main.create_app``)."""

from __future__ import annotations

import asyncio
import json

from starlette.datastructures import Headers
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

DEFAULT_MAX_BODY_BYTES = 1_024  # 1 KB — legacy game payloads (~50 bytes max)
LARGE_BODY_BYTES = 256 * 1_024  # 256 KB — batched events + bug logs (#364)
LARGE_BODY_PREFIXES = ("/games", "/logs", "/stats")
# An Apple StoreKit 2 JWS carries its certificate chain, ~4-6 KB (#840).
PURCHASE_BODY_BYTES = 32 * 1_024
PURCHASE_BODY_PREFIX = "/purchases"
# Total time allowed to buffer a body that has no Content-Length.
BODY_READ_TIMEOUT_SECONDS = 10.0


def _max_body_bytes_for(path: str) -> int:
    if path.startswith(PURCHASE_BODY_PREFIX):
        return PURCHASE_BODY_BYTES
    for prefix in LARGE_BODY_PREFIXES:
        if path.startswith(prefix):
            return LARGE_BODY_BYTES
    return DEFAULT_MAX_BODY_BYTES


def _json_error(status: int, detail: str) -> Response:
    return Response(
        content=json.dumps({"detail": detail}),
        status_code=status,
        media_type="application/json",
        headers={"connection": "close"},
    )


async def _read_body(receive: Receive, cap: int) -> tuple[str, list[bytes]]:
    """Buffer the body; return ``(outcome, chunks)``.

    Outcome is ``ok`` / ``too_big`` / ``timed_out`` / ``disconnected``. Reads and
    decides only; it never sends.
    """
    chunks: list[bytes] = []
    size = 0
    try:
        async with asyncio.timeout(BODY_READ_TIMEOUT_SECONDS):
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return "disconnected", chunks
                chunk = message.get("body", b"")
                size += len(chunk)
                if size > cap:
                    return "too_big", chunks
                chunks.append(chunk)
                if not message.get("more_body", False):
                    return "ok", chunks
    except TimeoutError:
        return "timed_out", chunks


class MaxBodySizeMiddleware:
    """Reject bodies over the path's cap (pure ASGI, so it can see the body stream).

    * A ``Content-Length`` over the cap → 413; one that is not a non-negative
      integer → 400 (it used to raise, a 500). A request with a
      ``Transfer-Encoding`` header is treated as having no usable
      ``Content-Length`` (it is ignored, never trusted) and takes the path below.
    * No ``Content-Length`` (chunked transfer) on *any* path: the body is read
      here, at most ``cap`` bytes, then replayed to the app as a single
      message; more than ``cap`` → 413 before the app sees anything. Buffering
      (rather than a counting ``receive`` wrapper) is used because a 413 can
      only be sent while the app has not started its response, and every cap
      is <= 256 KB so the buffer is small. A body-less request costs one
      ``receive()`` call and one replayed message.
    * That read is bounded by ``BODY_READ_TIMEOUT_SECONDS``; a slower body →
      408 without calling the app. The limit applies to bodies without
      ``Content-Length`` only (see #3319 for the rest).
    * Every response sent here carries ``Connection: close``.
    * A body longer than a *declared* ``Content-Length`` needs no check here:
      uvicorn's h11/httptools parsers frame the body by the declared length,
      so surplus bytes never reach ``receive()`` as part of this request.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope["path"]
        cap = _max_body_bytes_for(path)
        headers = Headers(scope=scope)
        content_length = None if "transfer-encoding" in headers else headers.get("content-length")
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
        outcome, chunks = await _read_body(receive, cap)
        # Responses are sent outside the timeout block so a stalled send can never
        # trigger a second response.
        if outcome == "disconnected":
            return
        if outcome == "too_big":
            await _json_error(413, "Request body too large.")(scope, receive, send)
            return
        if outcome == "timed_out":
            await _json_error(408, "Request body read timed out.")(scope, receive, send)
            return
        body = b"".join(chunks)
        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)

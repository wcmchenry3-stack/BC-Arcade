"""Per-path request body caps (pure ASGI, innermost middleware — see ``main.create_app``)."""

from __future__ import annotations

import asyncio
import contextlib
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
# Total time allowed for any request body to arrive (buffered when it has no
# Content-Length, streamed through a deadline wrapper when it has one).
BODY_READ_TIMEOUT_SECONDS = 10.0


class _BodyReadTimeout(BaseException):
    """Raised from the wrapped ``receive`` when a ``Content-Length`` body is too slow.

    A ``BaseException`` on purpose: FastAPI's body parser does ``except Exception``
    around ``request.body()`` and turns it into a 400/422 response, which would
    mask the 408. Only ``_stream_with_deadline`` (the sole raiser's caller) catches it.
    """


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
      408 without calling the app.
    * A body *with* a ``Content-Length`` (within the cap) is streamed to the app
      through a ``receive`` wrapper that enforces the same total
      ``BODY_READ_TIMEOUT_SECONDS`` deadline (#3319): expiry → 408 if the app has
      not started its response, else the request is ended. No timer task is
      created (``asyncio.timeout_at`` around each ``receive``), and waiting for
      ``http.disconnect`` after the body is complete is not bounded.
    * Every response sent here carries ``Connection: close``.
    * A body longer than a *declared* ``Content-Length`` needs no check here:
      uvicorn's h11/httptools parsers frame the body by the declared length,
      so surplus bytes never reach ``receive()`` as part of this request.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def _stream_with_deadline(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Stream a ``Content-Length`` body to the app, bounding its total arrival time.

        ``receive`` is wrapped, not buffered. Each call waits at most until one
        shared deadline (``BODY_READ_TIMEOUT_SECONDS`` after the request reached
        this layer); once the final body message has been delivered, later calls
        (the app waiting for ``http.disconnect``) are not bounded. On expiry the
        app's pending ``receive()`` raises ``_BodyReadTimeout``; we then send 408
        if the app has not started a response, otherwise just end the request
        (the server closes the connection when the app returns early).
        """
        deadline = asyncio.get_running_loop().time() + BODY_READ_TIMEOUT_SECONDS
        body_done = False
        timed_out = False
        response_started = False

        async def bounded_receive() -> Message:
            nonlocal body_done, timed_out
            if body_done:
                return await receive()
            try:
                async with asyncio.timeout_at(deadline):
                    message = await receive()
            except TimeoutError:
                timed_out = True
                raise _BodyReadTimeout from None
            if message["type"] != "http.request" or not message.get("more_body", False):
                body_done = True
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        with contextlib.suppress(_BodyReadTimeout):  # handled below; others propagate
            await self.app(scope, bounded_receive, tracking_send)
        if timed_out and not response_started:
            await _json_error(408, "Request body read timed out.")(scope, receive, send)

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
            await self._stream_with_deadline(scope, receive, send)
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

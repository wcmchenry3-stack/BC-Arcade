"""Per-path request body caps (pure ASGI, innermost middleware — see ``main.create_app``)."""

from __future__ import annotations

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

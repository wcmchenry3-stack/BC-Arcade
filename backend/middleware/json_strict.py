"""Reject JSON request bodies carrying text with no UTF-8 form (#3435).

A lone UTF-16 surrogate (``"\\ud800"``) parses under stdlib ``json``, has no UTF-8
form, and Postgres refuses to store it, so any handler that persists such a string
answered 500 -- which ``SyncWorker`` retries. This layer rejects it once, before
routing, for every JSON endpoint.

Answers ``400 {"detail": "<string>"}`` (terminal, not retried). 400 rather than 422
so the normal 422 body -- ``detail`` is a list of pydantic errors -- keeps its shape;
the string ``detail`` matches the other 4xx this package's middleware sends.

Two checks, both linear in the body size and bounded by the per-path cap:

* strict UTF-8 decode of the raw bytes (a raw CESU-8 surrogate, ``ED A0 80``, or
  any other malformed sequence);
* a scan for ``\\uD800``-``\\uDFFF`` escapes: a high surrogate must be followed
  at once by a low one (the pair ``\\ud83d\\ude00`` is legitimate, an emoji), and a
  low one must follow a high. ``\\\\`` pairs are consumed first so the literal text
  ``\\\\ud800`` (an escaped backslash) is not mistaken for an escape. The regex has
  no nested quantifier and its alternatives start differently after the first
  backslash, so it cannot backtrack badly.

Sits inside ``MaxBodySizeMiddleware`` (see ``main.create_app``): that layer has
already capped or rejected the body, and chunked bodies reach this one as a single
message. The body is buffered once here and replayed as one message; later
``receive()`` calls (``http.disconnect``) go to the original ``receive``.
"""

from __future__ import annotations

import json
import re

from starlette.datastructures import Headers
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from middleware.body_size import _max_body_bytes_for

BODY_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# An escaped backslash (consumed so it cannot start an escape), or a \uD8xx-\uDFxx escape.
_ESCAPE_RE = re.compile(rb"\\\\|\\u([dD][89a-fA-F][0-9a-fA-F]{2})")
INVALID_TEXT_DETAIL = "Request body contains text that is not valid Unicode."


def has_lone_surrogate_escape(body: bytes) -> bool:
    """True if ``body`` has a ``\\uD800``-``\\uDFFF`` escape that is not half of a valid pair."""
    if b"\\u" not in body:
        return False
    pending_end = -1  # end offset of a high surrogate still waiting for its low half
    for m in _ESCAPE_RE.finditer(body):
        hex4 = m.group(1)
        if hex4 is None:  # an escaped backslash
            if pending_end != -1:
                return True
            continue
        is_high = hex4[1] in b"89abAB"
        if pending_end != -1:
            if is_high or m.start() != pending_end:
                return True
            pending_end = -1
        elif is_high:
            pending_end = m.end()
        else:
            return True  # a low surrogate with no high before it
    return pending_end != -1


def body_has_invalid_text(body: bytes) -> bool:
    """True if ``body`` is not strict UTF-8 or holds a lone surrogate escape.

    ``json.loads(bytes)`` (what Starlette's ``request.json()`` calls) autodetects
    UTF-16/32, with or without a BOM, and would rebuild an escape this byte scan
    cannot see in NUL-separated text. So the scan only vouches for what the parser
    will read as UTF-8; any other detected encoding is rejected outright.
    """
    if json.detect_encoding(body) not in ("utf-8", "utf-8-sig"):
        return True
    try:
        body.decode("utf-8")
    except UnicodeDecodeError:
        return True
    return has_lone_surrogate_escape(body)


def _is_json_content_type(headers: Headers) -> bool:
    """JSON, or no Content-Type at all (FastAPI parses such a body as JSON)."""
    raw = headers.get("content-type")
    if raw is None:
        return True
    media = raw.split(";", 1)[0].strip().lower()
    return media == "application/json" or media.endswith("+json")


def _json_error(status: int, detail: str) -> Response:
    return Response(
        content=json.dumps({"detail": detail}),
        status_code=status,
        media_type="application/json",
        headers={"connection": "close"},
    )


class StrictJsonBodyMiddleware:
    """Answer 400 to a JSON body with invalid UTF-8 or a lone surrogate escape."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") not in BODY_METHODS:
            await self.app(scope, receive, send)
            return
        if not _is_json_content_type(Headers(scope=scope)):
            await self.app(scope, receive, send)
            return
        cap = _max_body_bytes_for(scope["path"])
        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > cap:  # defence in depth: MaxBodySizeMiddleware normally gets here first
                await _json_error(413, "Request body too large.")(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        if body_has_invalid_text(body):
            await _json_error(400, INVALID_TEXT_DETAIL)(scope, receive, send)
            return
        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)

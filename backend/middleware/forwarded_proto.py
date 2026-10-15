"""Restore the request scheme from ``X-Forwarded-Proto`` (#3340).

Render terminates TLS, so uvicorn sees plain HTTP. The API starts uvicorn
with ``--no-proxy-headers`` because uvicorn's proxy-header handling also
rewrites the client address from the client-controlled ``X-Forwarded-For``
(``limiter.py`` derives client IPs itself). That flag drops the scheme too,
so a slash redirect would send an HTTPS caller to ``http://``. This
middleware restores only the scheme.

It only ever *upgrades* ``http`` → ``https`` (and ``ws`` → ``wss``), and
only when the first listed proto is ``https``: a client-sent
``X-Forwarded-Proto`` can't downgrade a request or inject another scheme.
The client address is left alone.
"""

from __future__ import annotations

from starlette.types import ASGIApp, Receive, Scope, Send

_UPGRADE = {"http": "https", "ws": "wss"}


class ForwardedProtoMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        upgraded = _UPGRADE.get(scope.get("scheme", "")) if scope["type"] in _TYPES else None
        if upgraded and _first_proto(scope) == "https":
            scope = {**scope, "scheme": upgraded}
        await self.app(scope, receive, send)


_TYPES = ("http", "websocket")


def _first_proto(scope: Scope) -> str:
    for name, value in scope.get("headers", ()):
        if name == b"x-forwarded-proto":
            return value.decode("latin-1").split(",", 1)[0].strip().lower()
    return ""

"""The request scheme survives ``--no-proxy-headers`` (#3340).

Render terminates TLS, so uvicorn sees plain HTTP. Uvicorn's own proxy-header
handling used to restore ``https`` from ``X-Forwarded-Proto``, but it also
rewrote the client address from the client-controlled ``X-Forwarded-For``, so
it is off. ``ForwardedProtoMiddleware`` restores only the scheme; otherwise a
slash redirect would send an HTTPS client to an ``http://`` URL.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient

from main import create_app
from middleware.forwarded_proto import ForwardedProtoMiddleware


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_slash_redirect_keeps_https_behind_the_proxy(client: TestClient) -> None:
    r = client.get("/health/", headers={"X-Forwarded-Proto": "https"}, follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"] == "https://testserver/health"


def test_no_forwarded_proto_leaves_the_scheme_alone(client: TestClient) -> None:
    r = client.get("/health/", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"] == "http://testserver/health"


@pytest.mark.parametrize("value", ["http", "ftp", "", "https-ish", "javascript"])
def test_only_https_upgrades_the_scheme(client: TestClient, value: str) -> None:
    # Never a downgrade or an arbitrary scheme from a client-sent header.
    r = client.get("/health/", headers={"X-Forwarded-Proto": value}, follow_redirects=False)
    assert r.headers["location"] == "http://testserver/health"


@pytest.mark.parametrize("value", ["HTTPS", " https ", "https, http", "https,https"])
def test_first_listed_proto_case_and_space_insensitive(client: TestClient, value: str) -> None:
    r = client.get("/health/", headers={"X-Forwarded-Proto": value}, follow_redirects=False)
    assert r.headers["location"] == "https://testserver/health"


def test_websocket_scope_becomes_wss() -> None:
    app = FastAPI()
    seen: dict[str, str] = {}

    @app.websocket("/ws")
    async def ws(websocket: WebSocket) -> None:
        seen["scheme"] = websocket.url.scheme
        await websocket.accept()
        await websocket.close()

    app.add_middleware(ForwardedProtoMiddleware)
    with TestClient(app).websocket_connect("/ws", headers={"X-Forwarded-Proto": "https"}):
        pass
    assert seen["scheme"] == "wss"

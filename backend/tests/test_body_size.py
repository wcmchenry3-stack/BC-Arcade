"""MaxBodySizeMiddleware enforces every path's cap with and without Content-Length (#3299)."""

from __future__ import annotations

import asyncio
import json
import os
import uuid

import pytest
from pydantic import BaseModel

from middleware.body_size import (
    DEFAULT_MAX_BODY_BYTES,
    LARGE_BODY_BYTES,
    PURCHASE_BODY_BYTES,
    MaxBodySizeMiddleware,
)

pytestmark = pytest.mark.security

CASES = [
    ("/purchases/apple/notifications", PURCHASE_BODY_BYTES),
    ("/games", LARGE_BODY_BYTES),
    ("/logs", LARGE_BODY_BYTES),
    ("/stats/summary", LARGE_BODY_BYTES),
    ("/other", DEFAULT_MAX_BODY_BYTES),
]


async def _run(path, chunks, content_length=None, extra_headers=()):
    """Drive the middleware; return (status, body the app saw, sent messages, receive calls)."""
    messages = [
        {"type": "http.request", "body": c, "more_body": i < len(chunks) - 1}
        for i, c in enumerate(chunks)
    ]
    seen: dict = {"body": None}
    sent: list = []
    consumed = 0

    async def receive():
        nonlocal consumed
        consumed += 1
        return messages.pop(0)

    async def send(m):
        sent.append(m)

    async def app(scope, rcv, snd):
        body = b""
        while True:
            m = await rcv()
            body += m.get("body", b"")
            if not m.get("more_body", False):
                break
        seen["body"] = body
        await snd({"type": "http.response.start", "status": 200, "headers": []})
        await snd({"type": "http.response.body", "body": b"ok"})

    headers = list(extra_headers)
    if content_length is not None:
        headers.append((b"content-length", str(content_length).encode()))
    scope = {"type": "http", "path": path, "headers": headers}
    await MaxBodySizeMiddleware(app)(scope, receive, send)
    status = next((m["status"] for m in sent if m["type"] == "http.response.start"), None)
    return status, seen["body"], sent, consumed


def _split(data: bytes, n: int):
    return [data[i : i + n] for i in range(0, len(data), n)] or [b""]


@pytest.mark.parametrize("path,cap", CASES)
async def test_content_length_at_cap_passes(path, cap):
    body = b"x" * cap
    status, seen, _, _ = await _run(path, [body], content_length=cap)
    assert status == 200 and seen == body


@pytest.mark.parametrize("path,cap", CASES)
async def test_content_length_over_cap_is_413(path, cap):
    status, seen, _, _ = await _run(path, [b"x" * (cap + 1)], content_length=cap + 1)
    assert status == 413 and seen is None


@pytest.mark.parametrize("path,cap", CASES)
async def test_chunked_at_cap_passes_intact(path, cap):
    body = bytes(i % 251 for i in range(cap))
    status, seen, _, _ = await _run(path, [body])
    assert status == 200 and seen == body


@pytest.mark.parametrize("path,cap", CASES)
async def test_chunked_over_cap_is_413(path, cap):
    status, seen, sent, _ = await _run(path, [b"x" * (cap + 1)])
    assert status == 413 and seen is None
    assert json.loads(sent[-1]["body"]) == {"detail": "Request body too large."}


@pytest.mark.parametrize("path,cap", CASES)
async def test_multi_chunk_at_cap_passes_intact(path, cap):
    body = bytes(i % 251 for i in range(cap))
    status, seen, _, _ = await _run(path, _split(body, 100))
    assert status == 200 and seen == body


@pytest.mark.parametrize("path,cap", CASES)
async def test_multi_chunk_over_cap_is_413_and_stops_reading(path, cap):
    chunks = _split(b"x" * (cap * 2), 100)
    status, seen, _, consumed = await _run(path, chunks)
    assert status == 413 and seen is None
    # Reading stops as soon as the cap is crossed, not after the whole body.
    assert consumed == cap // 100 + 1
    assert consumed < len(chunks)


async def test_replay_delivers_body_once_then_original_receive():
    messages = [
        {"type": "http.request", "body": b"ab", "more_body": True},
        {"type": "http.request", "body": b"cd", "more_body": False},
        {"type": "http.disconnect"},
    ]
    got: list = []

    async def receive():
        return messages.pop(0)

    async def send(m):
        pass

    async def app(scope, rcv, snd):
        got.append(await rcv())
        got.append(await rcv())

    scope = {"type": "http", "path": "/games", "headers": []}
    await MaxBodySizeMiddleware(app)(scope, receive, send)
    assert got[0] == {"type": "http.request", "body": b"abcd", "more_body": False}
    assert got[1] == {"type": "http.disconnect"}


@pytest.mark.parametrize("path,cap", CASES)
async def test_over_cap_only_after_final_chunk_is_413(path, cap):
    # Cap is crossed by the very last (small) chunk, not an early one.
    status, seen, _, _ = await _run(path, [b"x" * cap, b"y"])
    assert status == 413 and seen is None


@pytest.mark.parametrize("path,_cap", CASES)
async def test_empty_body_without_content_length_passes(path, _cap):
    status, seen, _, _ = await _run(path, [b""])
    assert status == 200 and seen == b""


@pytest.mark.parametrize("path,_cap", CASES)
async def test_disconnect_mid_body_stops_without_calling_app(path, _cap):
    messages = [
        {"type": "http.request", "body": b"{", "more_body": True},
        {"type": "http.disconnect"},
    ]
    called = False

    async def app(scope, receive, send):
        nonlocal called
        called = True

    async def receive():
        return messages.pop(0)

    async def send(m):
        raise AssertionError("nothing should be sent")

    await MaxBodySizeMiddleware(app)({"type": "http", "path": path, "headers": []}, receive, send)
    assert not called


@pytest.mark.parametrize("path,_cap", CASES)
@pytest.mark.parametrize("value", ["abc", "-1", "1e3", " 12x"])
async def test_invalid_content_length_is_400(path, _cap, value):
    status, seen, _, _ = await _run(path, [b"{}"], content_length=value)
    assert status == 400 and seen is None


# ---------------------------------------------------------------------------
# Through the real app: cap enforced for all framings on real routes
# ---------------------------------------------------------------------------

pytest_plugins = ["tests._apple_iap_harness"]

needs_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set; skipping live API tests"
)


def _padded(payload: dict, size: int) -> bytes:
    """Valid JSON of exactly ``size`` bytes (trailing whitespace padding)."""
    raw = json.dumps(payload).encode()
    assert len(raw) <= size
    return raw + b" " * (size - len(raw))


def _gen(data: bytes, n: int = 4096):
    for i in range(0, len(data), n):
        yield data[i : i + n]


def _headers():
    return {"X-Session-ID": str(uuid.uuid4()), "Content-Type": "application/json"}


def _event_route(client):
    headers = _headers()
    gid = client.post("/games", headers=headers, json={"game_type": "yacht"}).json()["id"]
    payload = {"events": [{"event_index": 0, "event_type": "game_started", "data": {}}]}
    return f"/games/{gid}/events", headers, payload, {"accepted": 1, "duplicates": 0}


def _log_route(client):
    log = {
        "id": str(uuid.uuid4()),
        "logged_at": "2026-01-01T00:00:00+00:00",
        "level": "warn",
        "source": "test",
        "message": "something happened",
        "context": {"k": "v"},
    }
    return "/logs/bug", _headers(), {"logs": [log]}, {"accepted": 1, "duplicates": 0}


ROUTES = [_event_route, _log_route]


@needs_db
@pytest.mark.parametrize("route", ROUTES)
def test_app_chunked_at_cap_reaches_handler(client, route):
    path, headers, payload, expected = route(client)
    r = client.post(path, headers=headers, content=_gen(_padded(payload, LARGE_BODY_BYTES)))
    assert r.status_code == 200, r.text
    body = r.json()
    assert {k: body[k] for k in expected} == expected


@needs_db
@pytest.mark.parametrize("route", ROUTES)
def test_app_chunked_just_over_cap_is_413(client, route):
    path, headers, payload, _ = route(client)
    r = client.post(path, headers=headers, content=_gen(_padded(payload, LARGE_BODY_BYTES + 1)))
    assert r.status_code == 413


@needs_db
@pytest.mark.parametrize("route", ROUTES)
def test_app_content_length_over_cap_is_413(client, route):
    path, headers, payload, _ = route(client)
    r = client.post(path, headers=headers, content=_padded(payload, LARGE_BODY_BYTES + 1))
    assert r.status_code == 413


@needs_db
def test_app_chunked_purchases_webhook_at_cap_not_rejected_for_size(client, apple_verifier):
    path = "/purchases/apple/notifications"
    body = _padded({"signedPayload": "not-a-jws"}, PURCHASE_BODY_BYTES)
    r = client.post(path, headers=_headers(), content=_gen(body))
    assert r.status_code == 400, r.text


@needs_db
def test_app_chunked_purchases_webhook_over_cap_is_413(client, apple_verifier):
    path = "/purchases/apple/notifications"
    body = _padded({"signedPayload": "not-a-jws"}, PURCHASE_BODY_BYTES + 1)
    r = client.post(path, headers=_headers(), content=_gen(body))
    assert r.status_code == 413


async def test_slow_body_times_out_with_408(monkeypatch):
    import middleware.body_size as bs

    monkeypatch.setattr(bs, "BODY_READ_TIMEOUT_SECONDS", 0.05)
    first = True
    called = False
    sent: list = []

    async def receive():
        nonlocal first
        if first:
            first = False
            return {"type": "http.request", "body": b"x", "more_body": True}
        await asyncio.sleep(5)
        return {"type": "http.disconnect"}

    async def send(m):
        sent.append(m)

    async def app(scope, rcv, snd):
        nonlocal called
        called = True

    scope = {"type": "http", "path": "/games", "headers": []}
    await MaxBodySizeMiddleware(app)(scope, receive, send)
    assert not called
    assert sent[0]["status"] == 408
    assert json.loads(sent[-1]["body"]) == {"detail": "Request body read timed out."}


async def test_multi_chunk_within_timeout_passes():
    body = b"x" * 1000
    status, seen, _, _ = await _run("/games", _split(body, 10))
    assert status == 200 and seen == body


TE = ((b"transfer-encoding", b"chunked"),)


@pytest.mark.parametrize("path,cap", CASES)
async def test_transfer_encoding_ignores_content_length_over_cap_body(path, cap):
    # A small, lying Content-Length must not let an over-cap body through.
    status, seen, _, _ = await _run(path, [b"x" * (cap + 1)], content_length=1, extra_headers=TE)
    assert status == 413 and seen is None


@pytest.mark.parametrize("path,cap", CASES)
async def test_transfer_encoding_ignores_content_length_under_cap_body(path, cap):
    body = b"x" * cap
    status, seen, _, _ = await _run(path, _split(body, 100), content_length=1, extra_headers=TE)
    assert status == 200 and seen == body


async def test_transfer_encoding_with_invalid_content_length_is_not_400():
    status, seen, _, _ = await _run("/games", [b"{}"], content_length="abc", extra_headers=TE)
    assert status == 200 and seen == b"{}"


def _headers_of(sent):
    start = next(m for m in sent if m["type"] == "http.response.start")
    return {k.lower(): v for k, v in start["headers"]}


async def test_error_responses_close_the_connection(monkeypatch):
    import middleware.body_size as bs

    _, _, sent, _ = await _run("/other", [b"x"], content_length=DEFAULT_MAX_BODY_BYTES + 1)
    assert _headers_of(sent)[b"connection"] == b"close"
    _, _, sent, _ = await _run("/other", [b"x"], content_length="abc")
    assert _headers_of(sent)[b"connection"] == b"close"
    _, _, sent, _ = await _run("/other", [b"x" * (DEFAULT_MAX_BODY_BYTES + 1)])
    assert _headers_of(sent)[b"connection"] == b"close"

    monkeypatch.setattr(bs, "BODY_READ_TIMEOUT_SECONDS", 0.05)
    sent2: list = []

    async def receive():
        await asyncio.sleep(5)

    async def send(m):
        sent2.append(m)

    async def app(scope, rcv, snd):
        raise AssertionError("app must not run")

    scope = {"type": "http", "path": "/other", "headers": []}
    await MaxBodySizeMiddleware(app)(scope, receive, send)
    assert _headers_of(sent2)[b"connection"] == b"close"


async def test_stalled_413_send_does_not_trigger_a_second_response(monkeypatch):
    import middleware.body_size as bs

    monkeypatch.setattr(bs, "BODY_READ_TIMEOUT_SECONDS", 0.05)
    sent: list = []

    async def receive():
        return {"type": "http.request", "body": b"x" * (DEFAULT_MAX_BODY_BYTES + 1)}

    async def send(m):
        sent.append(m)
        if m["type"] == "http.response.start":
            await asyncio.sleep(0.2)  # outlasts the read timeout

    async def app(scope, rcv, snd):
        raise AssertionError("app must not run")

    scope = {"type": "http", "path": "/other", "headers": []}
    await MaxBodySizeMiddleware(app)(scope, receive, send)
    starts = [m for m in sent if m["type"] == "http.response.start"]
    assert len(starts) == 1 and starts[0]["status"] == 413


# --- Content-Length bodies: total arrival deadline (#3319) -------------------


def _cl_scope(length: int, path: str = "/games") -> dict:
    return {
        "type": "http",
        "path": path,
        "headers": [(b"content-length", str(length).encode())],
    }


async def test_stalled_content_length_body_gets_408_within_deadline(monkeypatch):
    import middleware.body_size as bs

    monkeypatch.setattr(bs, "BODY_READ_TIMEOUT_SECONDS", 0.05)
    first = True
    sent: list = []
    app_saw: list = []

    async def receive():
        nonlocal first
        if first:
            first = False
            return {"type": "http.request", "body": b"x", "more_body": True}
        await asyncio.sleep(30)  # client sends nothing more
        return {"type": "http.disconnect"}

    async def send(m):
        sent.append(m)

    async def app(scope, rcv, snd):
        while True:
            m = await rcv()
            app_saw.append(m)
            if not m.get("more_body", False):
                break
        await snd({"type": "http.response.start", "status": 200, "headers": []})

    started = asyncio.get_running_loop().time()
    await MaxBodySizeMiddleware(app)(_cl_scope(100), receive, send)
    assert asyncio.get_running_loop().time() - started < 2
    assert [m["status"] for m in sent if m["type"] == "http.response.start"] == [408]
    assert json.loads(sent[-1]["body"]) == {"detail": "Request body read timed out."}
    assert (b"connection", b"close") in sent[0]["headers"]
    assert len(app_saw) == 1  # streamed through, not buffered


async def test_deadline_is_total_not_per_chunk(monkeypatch):
    import middleware.body_size as bs

    monkeypatch.setattr(bs, "BODY_READ_TIMEOUT_SECONDS", 0.2)
    sent: list = []

    async def receive():  # a drip: every chunk arrives well inside the limit
        await asyncio.sleep(0.06)
        return {"type": "http.request", "body": b"x", "more_body": True}

    async def send(m):
        sent.append(m)

    async def app(scope, rcv, snd):
        while (await rcv()).get("more_body", False):
            pass

    started = asyncio.get_running_loop().time()
    await MaxBodySizeMiddleware(app)(_cl_scope(1000), receive, send)
    assert asyncio.get_running_loop().time() - started < 2
    assert sent[0]["status"] == 408


async def test_stalled_content_length_after_response_started_ends_request(monkeypatch):
    import middleware.body_size as bs

    monkeypatch.setattr(bs, "BODY_READ_TIMEOUT_SECONDS", 0.05)
    sent: list = []

    async def receive():
        await asyncio.sleep(30)
        return {"type": "http.disconnect"}

    async def send(m):
        sent.append(m)

    async def app(scope, rcv, snd):
        await snd({"type": "http.response.start", "status": 200, "headers": []})
        await rcv()  # blocks on the stalled body

    started = asyncio.get_running_loop().time()
    await MaxBodySizeMiddleware(app)(_cl_scope(100), receive, send)
    assert asyncio.get_running_loop().time() - started < 2
    # no 408 stacked on the started 200
    assert [m["status"] for m in sent if m["type"] == "http.response.start"] == [200]


async def test_content_length_body_within_deadline_is_unaffected(monkeypatch):
    import middleware.body_size as bs

    monkeypatch.setattr(bs, "BODY_READ_TIMEOUT_SECONDS", 5.0)
    body = b"x" * 600
    status, seen, _, _ = await _run("/games", _split(body, 6), content_length=len(body))
    assert status == 200 and seen == body


async def test_content_length_wait_for_disconnect_after_body_is_not_bounded(monkeypatch):
    import middleware.body_size as bs

    monkeypatch.setattr(bs, "BODY_READ_TIMEOUT_SECONDS", 0.05)
    sent: list = []
    got: list = []
    queue = [{"type": "http.request", "body": b"hi", "more_body": False}]

    async def receive():
        if queue:
            return queue.pop(0)
        await asyncio.sleep(0.2)  # outlasts the deadline: idle wait after the body
        return {"type": "http.disconnect"}

    async def send(m):
        sent.append(m)

    async def app(scope, rcv, snd):
        await rcv()
        await snd({"type": "http.response.start", "status": 200, "headers": []})
        got.append(await rcv())  # e.g. a disconnect listener

    await MaxBodySizeMiddleware(app)(_cl_scope(2), receive, send)
    assert got == [{"type": "http.disconnect"}]
    assert [m["status"] for m in sent if m["type"] == "http.response.start"] == [200]


async def test_content_length_disconnect_mid_body_is_passed_through():
    sent: list = []
    got: list = []
    msgs = [
        {"type": "http.request", "body": b"x", "more_body": True},
        {"type": "http.disconnect"},
    ]

    async def receive():
        return msgs.pop(0)

    async def send(m):
        sent.append(m)

    async def app(scope, rcv, snd):
        got.append(await rcv())
        got.append(await rcv())

    await MaxBodySizeMiddleware(app)(_cl_scope(100), receive, send)
    assert got[1] == {"type": "http.disconnect"}
    assert sent == []


async def test_stalled_content_length_leaves_no_pending_tasks(monkeypatch):
    import middleware.body_size as bs

    monkeypatch.setattr(bs, "BODY_READ_TIMEOUT_SECONDS", 0.05)
    before = asyncio.all_tasks()

    async def receive():
        await asyncio.sleep(30)
        return {"type": "http.disconnect"}

    async def send(m):
        pass

    async def app(scope, rcv, snd):
        await rcv()

    await MaxBodySizeMiddleware(app)(_cl_scope(100), receive, send)
    assert asyncio.all_tasks() == before


# --- Real FastAPI body-model routes: the timeout must reach our layer (#3319) -


class _Payload(BaseModel):
    a: int


async def _stalled_post(app, path: str, monkeypatch):
    import middleware.body_size as bs

    monkeypatch.setattr(bs, "BODY_READ_TIMEOUT_SECONDS", 0.05)
    first = True
    sent: list = []

    async def receive():
        nonlocal first
        if first:
            first = False
            return {"type": "http.request", "body": b'{"a":', "more_body": True}
        await asyncio.sleep(30)
        return {"type": "http.disconnect"}

    async def send(m):
        sent.append(m)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "query_string": b"",
        "client": ("127.0.0.1", 1),
        "server": ("test", 80),
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", b"100"),
        ],
    }
    started = asyncio.get_running_loop().time()
    await app(scope, receive, send)
    assert asyncio.get_running_loop().time() - started < 2
    return sent


def _model_app():
    from fastapi import FastAPI

    app = FastAPI()

    @app.post("/model")
    async def model_route(p: _Payload):
        return {"ok": True}

    app.add_middleware(MaxBodySizeMiddleware)
    return app


async def test_stalled_body_on_fastapi_body_model_route_is_408(monkeypatch):
    sent = await _stalled_post(_model_app(), "/model", monkeypatch)
    starts = [m for m in sent if m["type"] == "http.response.start"]
    assert [m["status"] for m in starts] == [408]
    assert (b"connection", b"close") in starts[0]["headers"]
    assert json.loads(sent[-1]["body"]) == {"detail": "Request body read timed out."}


@pytest.mark.parametrize("path", ["/logs/bug", "/games"])
async def test_stalled_body_on_real_app_route_is_408(monkeypatch, path):
    """Real stack, incl. StrictJsonBodyMiddleware, which buffers JSON bodies via receive() (#3435)."""
    from main import create_app

    sent = await _stalled_post(create_app(), path, monkeypatch)
    starts = [m for m in sent if m["type"] == "http.response.start"]
    assert [m["status"] for m in starts] == [408]
    assert (b"connection", b"close") in starts[0]["headers"]

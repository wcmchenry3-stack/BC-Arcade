"""MaxBodySizeMiddleware enforces every path's cap with and without Content-Length (#3299)."""

from __future__ import annotations

import json
import os
import uuid

import pytest

from middleware.body_size import (
    DEFAULT_MAX_BODY_BYTES,
    LARGE_BODY_BYTES,
    PURCHASE_BODY_BYTES,
    MaxBodySizeMiddleware,
)

CASES = [
    ("/purchases/apple/notifications", PURCHASE_BODY_BYTES),
    ("/games", LARGE_BODY_BYTES),
    ("/logs", LARGE_BODY_BYTES),
    ("/stats/summary", LARGE_BODY_BYTES),
    ("/other", DEFAULT_MAX_BODY_BYTES),
]


async def _run(path, chunks, content_length=None, trailing=None):
    """Drive the middleware; return (status or None, body the app saw or None)."""
    messages = [
        {"type": "http.request", "body": c, "more_body": i < len(chunks) - 1}
        for i, c in enumerate(chunks)
    ]
    if trailing:
        messages.extend(trailing)
    seen: dict = {"body": None}
    sent: list = []

    async def receive():
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

    headers = []
    if content_length is not None:
        headers.append((b"content-length", str(content_length).encode()))
    scope = {"type": "http", "path": path, "headers": headers}
    await MaxBodySizeMiddleware(app)(scope, receive, send)
    status = next((m["status"] for m in sent if m["type"] == "http.response.start"), None)
    return status, seen["body"], sent


def _split(data: bytes, n: int):
    return [data[i : i + n] for i in range(0, len(data), n)] or [b""]


@pytest.mark.parametrize("path,cap", CASES)
async def test_content_length_at_cap_passes(path, cap):
    body = b"x" * cap
    status, seen, _ = await _run(path, [body], content_length=cap)
    assert status == 200 and seen == body


@pytest.mark.parametrize("path,cap", CASES)
async def test_content_length_over_cap_is_413(path, cap):
    status, seen, _ = await _run(path, [b"x" * (cap + 1)], content_length=cap + 1)
    assert status == 413 and seen is None


@pytest.mark.parametrize("path,cap", CASES)
async def test_chunked_at_cap_passes_intact(path, cap):
    body = bytes(i % 251 for i in range(cap))
    status, seen, _ = await _run(path, [body])
    assert status == 200 and seen == body


@pytest.mark.parametrize("path,cap", CASES)
async def test_chunked_over_cap_is_413(path, cap):
    status, seen, sent = await _run(path, [b"x" * (cap + 1)])
    assert status == 413 and seen is None
    assert json.loads(sent[-1]["body"]) == {"detail": "Request body too large."}


@pytest.mark.parametrize("path,cap", CASES)
async def test_multi_chunk_at_cap_passes_intact(path, cap):
    body = bytes(i % 251 for i in range(cap))
    status, seen, _ = await _run(path, _split(body, 100))
    assert status == 200 and seen == body


@pytest.mark.parametrize("path,cap", CASES)
async def test_multi_chunk_over_cap_is_413(path, cap):
    status, seen, _ = await _run(path, _split(b"x" * (cap + 1), 100))
    assert status == 413 and seen is None


@pytest.mark.parametrize("path,cap", CASES)
async def test_over_cap_only_after_final_chunk_is_413(path, cap):
    # Cap is crossed by the very last (small) chunk, not an early one.
    status, seen, _ = await _run(path, [b"x" * cap, b"y"])
    assert status == 413 and seen is None


@pytest.mark.parametrize("path,_cap", CASES)
async def test_empty_body_without_content_length_passes(path, _cap):
    status, seen, _ = await _run(path, [b""])
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
    status, seen, _ = await _run(path, [b"{}"], content_length=value)
    assert status == 400 and seen is None


# ---------------------------------------------------------------------------
# Through the real app: cap enforced for all framings on real routes
# ---------------------------------------------------------------------------

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


def _route_cases(client):
    sid = str(uuid.uuid4())
    headers = {"X-Session-ID": sid, "Content-Type": "application/json"}
    gid = client.post("/games", headers=headers, json={"game_type": "yacht"}).json()["id"]
    return headers, [
        (f"/games/{gid}/events", {"events": []}),
        ("/logs/bug", {"logs": []}),
    ]


@needs_db
@pytest.mark.parametrize("route", [0, 1])
def test_app_chunked_at_cap_not_rejected_for_size(client, route):
    headers, cases = _route_cases(client)
    path, payload = cases[route]
    r = client.post(path, headers=headers, content=_gen(_padded(payload, LARGE_BODY_BYTES)))
    assert r.status_code != 413


@needs_db
@pytest.mark.parametrize("route", [0, 1])
def test_app_chunked_over_cap_is_413(client, route):
    headers, cases = _route_cases(client)
    path, payload = cases[route]
    r = client.post(path, headers=headers, content=_gen(_padded(payload, LARGE_BODY_BYTES + 1)))
    assert r.status_code == 413


@needs_db
@pytest.mark.parametrize("route", [0, 1])
def test_app_content_length_over_cap_is_413(client, route):
    headers, cases = _route_cases(client)
    path, payload = cases[route]
    r = client.post(path, headers=headers, content=_padded(payload, LARGE_BODY_BYTES + 1))
    assert r.status_code == 413

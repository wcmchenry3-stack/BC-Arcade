"""StrictJsonBodyMiddleware rejects lone surrogates / invalid UTF-8 with a terminal 400 (#3435)."""

from __future__ import annotations

import json
import time
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory
from db.models import GameEntitlement
from middleware.json_strict import (
    INVALID_TEXT_DETAIL,
    StrictJsonBodyMiddleware,
    body_has_invalid_text,
    has_lone_surrogate_escape,
)
from tests._helpers import session_headers as _headers

pytestmark = pytest.mark.security

# --- detector ---------------------------------------------------------------


@pytest.mark.parametrize(
    "raw",
    [
        rb'"\ud800"',  # lone high
        rb'"\udc00"',  # lone low
        rb'"\uDBFF"',  # upper-case hex, lone high
        rb'"a\ud800b"',  # high followed by text
        rb'"\ud800\ud800"',  # two highs
        rb'"\udc00\ud800"',  # low before high
        rb'"\ud83d\\ude00"',  # high followed by an escaped backslash
        rb'"\ud83d x\ude00"',  # pair split by text
        rb'"\\\ud800"',  # escaped backslash, then a real lone escape
    ],
)
def test_lone_surrogate_escapes_are_detected(raw: bytes) -> None:
    assert has_lone_surrogate_escape(raw)
    assert body_has_invalid_text(raw)


@pytest.mark.parametrize(
    "raw",
    [
        b'"\\ud83d\\ude00"',  # a valid pair (emoji)
        b'"\\uD83D\\uDE00"',
        b'"\\ud800\\udc00"',
        rb'"\\ud800"',  # escaped backslash then literal text, not an escape
        rb'"\\\\ud800"',
        b'"\\ud7ff \\ue000 \\u00e9"',  # neighbours of the surrogate range
        b'"\\u0041"',
        b'"plain \xf0\x9f\x98\x80"',  # raw UTF-8 emoji
        b"",
    ],
)
def test_legitimate_text_is_not_flagged(raw: bytes) -> None:
    assert not body_has_invalid_text(raw)


@pytest.mark.parametrize("raw", [b'"\xed\xa0\x80"', b'"\xff"', b'"\xc3"'])
def test_invalid_utf8_is_flagged(raw: bytes) -> None:
    assert body_has_invalid_text(raw)


def test_detector_is_linear_on_adversarial_input() -> None:
    bodies = [b'"' + b"\\ud800\\" * 100_000, b"\\u" * 100_000, b"\\\\" * 200_000 + b"\\ud800"]
    start = time.perf_counter()
    for body in bodies:
        body_has_invalid_text(body)
    assert time.perf_counter() - start < 2.0


# --- ASGI behaviour ---------------------------------------------------------


async def _run(path, chunks, *, method="POST", content_type="application/json", extra=None):
    """Drive the middleware; return (status, body the app saw, response body, receive calls)."""
    messages = [
        {"type": "http.request", "body": c, "more_body": i < len(chunks) - 1}
        for i, c in enumerate(chunks)
    ]
    messages.append({"type": "http.disconnect"})
    sent: list = []
    seen: dict = {"body": None, "app_called": False, "after": None}
    receives = 0

    async def receive():
        nonlocal receives
        receives += 1
        return messages.pop(0)

    async def send(m):
        sent.append(m)

    async def app(scope, rcv, snd):
        seen["app_called"] = True
        body = b""
        while True:
            m = await rcv()
            body += m.get("body", b"")
            if not m.get("more_body", False):
                break
        seen["body"] = body
        seen["after"] = (await rcv())["type"]  # later receives reach the original
        await snd({"type": "http.response.start", "status": 200, "headers": []})
        await snd({"type": "http.response.body", "body": b"ok"})

    headers = [(b"content-type", content_type.encode())] if content_type else []
    scope = {"type": "http", "method": method, "path": path, "headers": headers, **(extra or {})}
    await StrictJsonBodyMiddleware(app)(scope, receive, send)
    status = next((m["status"] for m in sent if m["type"] == "http.response.start"), None)
    resp = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status, seen, resp, receives


async def test_lone_surrogate_gets_400_and_app_is_not_called() -> None:
    status, seen, resp, _ = await _run("/games", [b'{"a": "\\ud8', b'00"}'])
    assert status == 400
    assert json.loads(resp) == {"detail": INVALID_TEXT_DETAIL}
    assert not seen["app_called"]


async def test_valid_body_is_replayed_as_one_message_and_later_receive_passes_through() -> None:
    body = b'{"a": "\\ud83d\\ude00"}'
    status, seen, _, receives = await _run("/games", [body[:5], body[5:]])
    assert status == 200
    assert seen["body"] == body
    assert seen["after"] == "http.disconnect"
    assert receives == 3  # two chunks, then the app's own disconnect read


@pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
async def test_methods_without_a_body_are_not_read(method: str) -> None:
    status, seen, _, _ = await _run("/games", [b'"\\ud800"'], method=method)
    assert status == 200
    assert seen["app_called"]


async def test_non_json_content_type_is_not_checked() -> None:
    status, seen, _, _ = await _run("/games", [b"\\ud800"], content_type="text/plain")
    assert status == 200 and seen["app_called"]


@pytest.mark.parametrize(
    "content_type", ["", "application/json; charset=utf-8", "application/x+json"]
)
async def test_json_like_or_missing_content_type_is_checked(content_type: str) -> None:
    status, _, _, _ = await _run("/stats/x", [b'"\\ud800"'], content_type=content_type)
    assert status == 400


async def test_disconnect_while_reading_never_calls_the_app() -> None:
    status, seen, _, _ = await _run("/games", [])
    assert status is None and not seen["app_called"]


async def test_over_cap_body_is_413_not_buffered_further() -> None:
    status, seen, _, _ = await _run("/other", [b"x" * 600, b"x" * 600])
    assert status == 413
    assert not seen["app_called"]


async def test_lifespan_scope_passes_through() -> None:
    called = []

    async def app(scope, receive, send):
        called.append(scope["type"])

    await StrictJsonBodyMiddleware(app)({"type": "lifespan"}, None, None)
    assert called == ["lifespan"]


# --- every JSON endpoint class, through the real app -------------------------

BAD = '"\\ud800"'


def _post(client: TestClient, method: str, url: str, sid: str, raw: str):
    return client.request(method, url, headers=_headers(sid), content=raw)


def _assert_terminal_400(r) -> None:
    assert r.status_code == 400, r.text
    assert r.json() == {"detail": INVALID_TEXT_DETAIL}
    assert r.headers["content-type"].startswith("application/json")


@pytest.fixture
async def game(client: TestClient, session_id: str) -> str:
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug="yacht"))
        await db.commit()
    r = client.post("/games", headers=_headers(session_id), json={"game_type": "yacht"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _log(**over) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "logged_at": datetime.now(UTC).isoformat(),
        "level": "warn",
        "source": "test",
        "message": "m",
        "context": {"k": "v"},
        **over,
    }


def test_games_create_with_a_lone_surrogate_is_400(client: TestClient, session_id: str) -> None:
    raw = '{"game_type": "yacht", "metadata": {"note": @@}}'.replace("@@", BAD)
    _assert_terminal_400(_post(client, "POST", "/games", session_id, raw))


@pytest.mark.parametrize("field", ["message", "source", "level"])
def test_bug_log_string_fields_with_a_lone_surrogate_are_400(
    client: TestClient, session_id: str, field: str
) -> None:
    raw = json.dumps({"logs": [_log(**{field: "XX"})]}).replace('"XX"', BAD)
    _assert_terminal_400(_post(client, "POST", "/logs/bug", session_id, raw))


def test_event_fields_with_a_lone_surrogate_are_400(
    client: TestClient, session_id: str, game: str
) -> None:
    for ev in (
        '{"event_index": 0, "event_type": "roll", "data": {"d": @@}}'.replace("@@", BAD),
        '{"event_index": 0, "event_type": @@, "data": {}}'.replace("@@", BAD),
    ):
        _assert_terminal_400(
            _post(
                client,
                "POST",
                f"/games/{game}/events",
                session_id,
                '{"events": [@@]}'.replace("@@", ev),
            )
        )


def test_complete_result_with_a_lone_surrogate_is_400(
    client: TestClient, session_id: str, game: str
) -> None:
    raw = '{"final_score": 1, "outcome": "completed", "result": {"k": @@}}'.replace("@@", BAD)
    _assert_terminal_400(_post(client, "PATCH", f"/games/{game}/complete", session_id, raw))


def test_stats_path_class_with_a_lone_surrogate_is_400(client: TestClient, session_id: str) -> None:
    # No /stats route takes a JSON body; the check runs before routing, so the path
    # class is covered even where the app would otherwise answer 404/405.
    _assert_terminal_400(
        _post(client, "POST", "/stats/summary", session_id, '{"a": @@}'.replace("@@", BAD))
    )


def test_invalid_utf8_bytes_are_400(client: TestClient, session_id: str) -> None:
    r = client.post(
        "/games",
        headers=_headers(session_id),
        content=b'{"game_type": "yacht", "x": "\xed\xa0\x80"}',
    )
    _assert_terminal_400(r)


def test_a_valid_surrogate_pair_is_accepted(client: TestClient, session_id: str, game: str) -> None:
    pair = '"\\ud83d\\ude00"'
    r = _post(
        client,
        "POST",
        f"/games/{game}/events",
        session_id,
        '{"events": [{"event_index": 0, "event_type": "roll", "data": {"d": @@}}]}'.replace(
            "@@", pair
        ),
    )
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == 1
    r = _post(
        client,
        "POST",
        "/logs/bug",
        session_id,
        json.dumps({"logs": [_log(message="XX")]}).replace('"XX"', pair),
    )
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == 1


def test_normal_422_body_shape_is_unchanged(client: TestClient, session_id: str) -> None:
    r = _post(client, "POST", "/games", session_id, '{"game_type": 5}')
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert isinstance(detail, list)
    assert set(detail[0]) >= {"type", "loc", "msg", "input"}

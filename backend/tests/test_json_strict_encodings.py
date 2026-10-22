"""StrictJsonBodyMiddleware vs encodings the JSON parser autodetects (Codex P2 on #3485).

``json.loads(bytes)`` reads BOM-less UTF-16/32 and would rebuild a lone surrogate
the byte scan cannot see in NUL-separated text, so such bodies are rejected.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory
from db.models import GameEntitlement
from middleware.json_strict import INVALID_TEXT_DETAIL, body_has_invalid_text
from tests._helpers import session_headers as _headers

pytestmark = pytest.mark.security

_LONE = '{"final_score": 1, "outcome": "completed", "result": {"note": "\\ud800"}}'
_ENCODINGS = ["utf-16-le", "utf-16-be", "utf-16", "utf-32-le", "utf-32-be", "utf-32"]


@pytest.fixture
async def game(client: TestClient, session_id: str) -> str:
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug="yacht"))
        await db.commit()
    r = client.post("/games", headers=_headers(session_id), json={"game_type": "yacht"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _assert_400(r) -> None:
    assert r.status_code == 400, r.text
    assert r.json() == {"detail": INVALID_TEXT_DETAIL}


@pytest.mark.parametrize("encoding", _ENCODINGS)
def test_non_utf8_encodings_are_rejected_by_the_detector(encoding: str) -> None:
    assert body_has_invalid_text(_LONE.encode(encoding))
    # even with no lone surrogate: the byte scan cannot vouch for them
    assert body_has_invalid_text('{"a": "b"}'.encode(encoding))


def test_utf8_and_utf8_with_bom_are_still_accepted() -> None:
    ok = '{"a": "\\ud83d\\ude00 é"}'
    assert not body_has_invalid_text(ok.encode("utf-8"))
    assert not body_has_invalid_text(ok.encode("utf-8-sig"))
    assert body_has_invalid_text('{"a": "\\ud800"}'.encode("utf-8-sig"))


@pytest.mark.parametrize("encoding", _ENCODINGS)
def test_lone_surrogate_in_other_encodings_is_400_end_to_end(
    client: TestClient, session_id: str, game: str, encoding: str
) -> None:
    r = client.patch(
        f"/games/{game}/complete", headers=_headers(session_id), content=_LONE.encode(encoding)
    )
    _assert_400(r)


def test_charset_parameter_does_not_bypass(client: TestClient, session_id: str, game: str) -> None:
    headers = {**_headers(session_id), "Content-Type": "application/json; charset=utf-16"}
    r = client.patch(f"/games/{game}/complete", headers=headers, content=_LONE.encode("utf-16-le"))
    _assert_400(r)


def test_upper_case_hex_in_a_key_is_400(client: TestClient, session_id: str, game: str) -> None:
    r = client.patch(
        f"/games/{game}/complete",
        headers=_headers(session_id),
        content=b'{"final_score": 1, "outcome": "completed", "result": {"k\\uD800": 1}}',
    )
    _assert_400(r)

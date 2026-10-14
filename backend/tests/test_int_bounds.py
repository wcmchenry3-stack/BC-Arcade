"""Integer request bounds (#3304).

A number outside its column's range used to reach the database: Postgres raises
at insert, which the API answered with a 500 (SQLite stores 64-bit integers, so
the rest of the suite never saw it). Every request int that is stored in a
32-bit ``Integer`` or 16-bit ``SmallInteger`` column is now bounded in pydantic,
so it is a 422 before the database is touched.

``test_int_bounds_postgres.py`` shows the overflow itself on a real Postgres.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from int_bounds import INT32_MAX, INT32_MIN
from tests._helpers import session_headers

OVER = INT32_MAX + 1  # 2**31


def _new_game(client: TestClient, sid: str) -> str:
    r = client.post("/games", headers=session_headers(sid), json={"game_type": "twenty48"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------------------------------------------------------------------------
# POST /games/{id}/events, PATCH /games/{id}/complete
# ---------------------------------------------------------------------------


def test_event_index_at_int32_max_is_accepted(client: TestClient, session_id: str) -> None:
    gid = _new_game(client, session_id)
    r = client.post(
        f"/games/{gid}/events",
        headers=session_headers(session_id),
        json={"events": [{"event_index": INT32_MAX, "event_type": "move"}]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["accepted"] == 1


def test_event_index_above_int32_max_is_422(client: TestClient, session_id: str) -> None:
    gid = _new_game(client, session_id)
    r = client.post(
        f"/games/{gid}/events",
        headers=session_headers(session_id),
        json={"events": [{"event_index": OVER, "event_type": "move"}]},
    )
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("field", ["final_score", "duration_ms"])
def test_complete_field_at_int32_max_is_accepted(
    client: TestClient, session_id: str, field: str
) -> None:
    gid = _new_game(client, session_id)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=session_headers(session_id),
        json={field: INT32_MAX, "outcome": "win"},
    )
    assert r.status_code == 200, r.text
    assert r.json()[field] == INT32_MAX


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("final_score", OVER),
        ("final_score", INT32_MIN - 1),
        ("duration_ms", OVER),
        ("duration_ms", -1),
    ],
)
def test_complete_field_outside_int32_is_422(
    client: TestClient, session_id: str, field: str, value: int
) -> None:
    gid = _new_game(client, session_id)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=session_headers(session_id),
        json={field: value, "outcome": "win"},
    )
    assert r.status_code == 422, r.text


def test_complete_final_score_at_int32_min_is_accepted(client: TestClient, session_id: str) -> None:
    # Negative scores are stored, not rejected (a 400 would dead-letter the game).
    gid = _new_game(client, session_id)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=session_headers(session_id),
        json={"final_score": INT32_MIN, "outcome": "loss"},
    )
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("field", ["final_score", "duration_ms"])
def test_twenty48_result_field_bounds(client: TestClient, session_id: str, field: str) -> None:
    """The Twenty48 result block mirrors the two columns; it shares their bound."""
    ok = client.patch(
        f"/games/{_new_game(client, session_id)}/complete",
        headers=session_headers(session_id),
        json={"outcome": "win", "result": {field: INT32_MAX}},
    )
    assert ok.status_code == 200, ok.text
    over = client.patch(
        f"/games/{_new_game(client, session_id)}/complete",
        headers=session_headers(session_id),
        json={"outcome": "win", "result": {field: OVER}},
    )
    assert over.status_code in (400, 422), over.text


@pytest.mark.parametrize("value", [-(2**31) - 5, -1, 0])
def test_twenty48_nonpositive_duration_is_unknown(
    client: TestClient, session_id: str, value: int
) -> None:
    gid = _new_game(client, session_id)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=session_headers(session_id),
        json={"outcome": "win", "result": {"duration_ms": value}},
    )
    assert r.status_code == 200, r.text
    detail = client.get(f"/games/{gid}", headers=session_headers(session_id)).json()
    assert detail["metadata"].get("duration_ms") is None

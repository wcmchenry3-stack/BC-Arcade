"""Integer request bounds and the admin token rules (#3304).

A number outside its column's range used to reach the database: Postgres raises
at insert, which the API answered with a 500 (SQLite stores 64-bit integers, so
the rest of the suite never saw it). Every request int that is stored in a
32-bit ``Integer`` or 16-bit ``SmallInteger`` column is now bounded in pydantic,
so it is a 422 before the database is touched. The admin token must be at least
32 characters when set, and the admin route has a per-IP limit.

``test_int_bounds_postgres.py`` shows the overflow itself on a real Postgres.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from int_bounds import INT16_MAX, INT32_MAX, INT32_MIN
from rate_limits import CATALOG_ADMIN_IP_RATE_LIMIT
from settings import ADMIN_API_TOKEN_MIN_LENGTH, Settings
from tests._helpers import session_headers, set_admin_token

OVER = INT32_MAX + 1  # 2**31
_ADMIN = "a" * ADMIN_API_TOKEN_MIN_LENGTH


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


# ---------------------------------------------------------------------------
# PATCH /games/catalog/{game_type_id} (SmallInteger primary key)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("game_type_id", [0, -1, INT16_MAX + 1, OVER])
def test_catalog_patch_id_outside_smallint_is_422(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, game_type_id: int
) -> None:
    set_admin_token(client, monkeypatch, _ADMIN)
    r = client.patch(
        f"/games/catalog/{game_type_id}",
        headers={"X-Admin-Token": _ADMIN, "X-Session-ID": str(uuid.uuid4())},
        json={"is_premium": True},
    )
    assert r.status_code == 422, r.text


def test_catalog_patch_id_at_smallint_max_reaches_the_lookup(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    set_admin_token(client, monkeypatch, _ADMIN)
    r = client.patch(
        f"/games/catalog/{INT16_MAX}",
        headers={"X-Admin-Token": _ADMIN, "X-Session-ID": str(uuid.uuid4())},
        json={"is_premium": True},
    )
    assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# ADMIN_API_TOKEN: minimum length
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("length", [1, 16, ADMIN_API_TOKEN_MIN_LENGTH - 1])
def test_short_admin_token_fails_settings_validation(length: int) -> None:
    with pytest.raises(ValidationError, match=r"ADMIN_API_TOKEN must be at least 32 characters"):
        Settings.isolated(ADMIN_API_TOKEN="x" * length)


@pytest.mark.parametrize("length", [ADMIN_API_TOKEN_MIN_LENGTH, 64])
def test_long_enough_admin_token_is_accepted(length: int) -> None:
    s = Settings.isolated(ADMIN_API_TOKEN="x" * length)
    assert s.admin_api_token.get_secret_value() == "x" * length


def test_unset_or_empty_admin_token_still_disables_admin() -> None:
    assert Settings.isolated().admin_api_token.get_secret_value() == ""
    assert Settings.isolated(ADMIN_API_TOKEN="").admin_api_token.get_secret_value() == ""


def test_short_admin_token_in_the_environment_fails_at_boot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ADMIN_API_TOKEN", "too-short")
    with pytest.raises(ValidationError, match="ADMIN_API_TOKEN"):
        Settings()


# ---------------------------------------------------------------------------
# PATCH /games/catalog/{id}: per-IP limit
# ---------------------------------------------------------------------------


def test_admin_route_is_limited_per_ip_across_rotating_sessions(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    set_admin_token(client, monkeypatch, _ADMIN)
    count, per = CATALOG_ADMIN_IP_RATE_LIMIT.split(";")[0].split("/")
    assert per == "minute", "test assumes the first window is per-minute"
    allowed = int(count)

    def call() -> int:
        # A fresh session each call: only the IP bucket can fill.
        return client.patch(
            "/games/catalog/1",
            headers={"X-Admin-Token": "wrong", "X-Session-ID": str(uuid.uuid4())},
            json={"is_premium": True},
        ).status_code

    statuses = [call() for _ in range(allowed + 1)]
    assert statuses == [403] * allowed + [429]


# ---------------------------------------------------------------------------
# Review round 1: stripped admin token, Twenty48 non-positive duration
# ---------------------------------------------------------------------------


def test_admin_token_is_stripped_before_the_length_check() -> None:
    s = Settings.isolated(ADMIN_API_TOKEN=" " + "k" * 32 + "\n")
    assert s.admin_api_token.get_secret_value() == "k" * 32


def test_padded_admin_token_matches_the_stripped_header(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    padded = Settings.isolated(ADMIN_API_TOKEN=" " + "k" * 32 + "\n")
    monkeypatch.setattr(client.app.state, "settings", padded)
    r = client.patch(
        f"/games/catalog/{INT16_MAX}",
        headers={"X-Admin-Token": "k" * 32, "X-Session-ID": str(uuid.uuid4())},
        json={"is_premium": True},
    )
    assert r.status_code == 404, r.text  # past the token check


def test_whitespace_only_admin_token_leaves_admin_disabled() -> None:
    assert Settings.isolated(ADMIN_API_TOKEN=" " * 32).admin_api_token.get_secret_value() == ""


def test_short_admin_token_with_padding_is_rejected() -> None:
    with pytest.raises(ValidationError, match="at least 32 characters"):
        Settings.isolated(ADMIN_API_TOKEN="  " + "k" * 31 + "\n")


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

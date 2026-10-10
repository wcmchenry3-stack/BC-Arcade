"""Tests for GET /games/catalog and PATCH /games/catalog/{id} (#1049, #1150)."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from games import catalog_cache
from tests._helpers import session_headers, set_admin_token

_ADMIN_TOKEN = "test-admin-token-1150"


@pytest.fixture(autouse=True)
def admin_token(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    set_admin_token(client, monkeypatch, _ADMIN_TOKEN)


def _admin_headers() -> dict[str, str]:
    return {
        "X-Admin-Token": _ADMIN_TOKEN,
        "Content-Type": "application/json",
    }


def _get_game_id(client: TestClient, name: str) -> int:
    items = client.get("/games/catalog").json()["items"]
    return next(g["id"] for g in items if g["name"] == name)


# ---------------------------------------------------------------------------
# GET /games/catalog
# ---------------------------------------------------------------------------


def test_catalog_returns_all_active_games(client: TestClient) -> None:
    r = client.get("/games/catalog")
    assert r.status_code == 200
    names = {g["name"] for g in r.json()["items"]}
    assert {
        "yacht",
        "blackjack",
        "cascade",
        "hearts",
        "sudoku",
        "mahjong",
        "starswarm",
        "freecell",
        "solitaire",
        "twenty48",
    }.issubset(names)


def test_catalog_fields_present(client: TestClient) -> None:
    r = client.get("/games/catalog")
    assert r.status_code == 200
    item = r.json()["items"][0]
    for field in (
        "id",
        "name",
        "display_name",
        "icon_emoji",
        "sort_order",
        "is_active",
        "is_premium",
        "category",
    ):
        assert field in item, f"missing field: {field}"


def test_catalog_premium_flags(client: TestClient) -> None:
    r = client.get("/games/catalog")
    assert r.status_code == 200
    by_name = {g["name"]: g for g in r.json()["items"]}
    for premium in ("cascade", "hearts", "starswarm", "blackjack", "mahjong"):
        assert by_name[premium]["is_premium"] is True, f"{premium} should be premium"
    for free in ("yacht", "solitaire", "freecell", "sort", "twenty48", "sudoku"):
        assert by_name[free]["is_premium"] is False, f"{free} should be free"


def test_catalog_categories(client: TestClient) -> None:
    r = client.get("/games/catalog")
    assert r.status_code == 200
    by_name = {g["name"]: g for g in r.json()["items"]}
    assert by_name["yacht"]["category"] == "dice"
    assert by_name["blackjack"]["category"] == "card"
    assert by_name["cascade"]["category"] == "arcade"
    assert by_name["sudoku"]["category"] == "puzzle"


def test_catalog_no_session_required(client: TestClient) -> None:
    r = client.get("/games/catalog")
    assert r.status_code == 200


def test_catalog_cache_control_header(client: TestClient) -> None:
    r = client.get("/games/catalog")
    assert r.status_code == 200
    assert r.headers.get("Cache-Control") == "public, max-age=300"


# ---------------------------------------------------------------------------
# PATCH /games/catalog/{id} — auth
# ---------------------------------------------------------------------------


def test_patch_requires_admin_token(client: TestClient) -> None:
    gid = _get_game_id(client, "blackjack")
    r = client.patch(f"/games/catalog/{gid}", json={"is_premium": True})
    assert r.status_code == 403


def test_patch_wrong_admin_token_rejected(client: TestClient) -> None:
    gid = _get_game_id(client, "blackjack")
    r = client.patch(
        f"/games/catalog/{gid}",
        json={"is_premium": True},
        headers={"X-Admin-Token": "wrong-token", "Content-Type": "application/json"},
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# PATCH /games/catalog/{id} — mutations
# ---------------------------------------------------------------------------


def test_patch_game_type_is_premium(client: TestClient) -> None:
    # A free game, so the cleanup below restores its real value.
    gid = _get_game_id(client, "twenty48")
    try:
        r = client.patch(
            f"/games/catalog/{gid}",
            json={"is_premium": True},
            headers=_admin_headers(),
        )
        assert r.status_code == 200
        assert r.json()["is_premium"] is True
    finally:
        client.patch(
            f"/games/catalog/{gid}",
            json={"is_premium": False},
            headers=_admin_headers(),
        )


def test_patch_game_type_category(client: TestClient) -> None:
    gid = _get_game_id(client, "blackjack")
    try:
        r = client.patch(
            f"/games/catalog/{gid}",
            json={"category": "strategy"},
            headers=_admin_headers(),
        )
        assert r.status_code == 200
        assert r.json()["category"] == "strategy"
    finally:
        client.patch(
            f"/games/catalog/{gid}",
            json={"category": "card"},
            headers=_admin_headers(),
        )


def test_patch_game_type_not_found(client: TestClient) -> None:
    r = client.patch(
        "/games/catalog/9999",
        json={"is_premium": True},
        headers=_admin_headers(),
    )
    assert r.status_code == 404


def test_patch_game_type_no_op(client: TestClient) -> None:
    gid = _get_game_id(client, "yacht")
    r = client.patch(f"/games/catalog/{gid}", json={}, headers=_admin_headers())
    assert r.status_code == 200
    assert r.json()["name"] == "yacht"


# ---------------------------------------------------------------------------
# PATCH /games/catalog/{id} — schema validation
# ---------------------------------------------------------------------------


def test_patch_category_empty_string_rejected(client: TestClient) -> None:
    gid = _get_game_id(client, "blackjack")
    r = client.patch(
        f"/games/catalog/{gid}",
        json={"category": ""},
        headers=_admin_headers(),
    )
    assert r.status_code == 422


def test_patch_category_too_long_rejected(client: TestClient) -> None:
    gid = _get_game_id(client, "blackjack")
    r = client.patch(
        f"/games/catalog/{gid}",
        json={"category": "x" * 65},
        headers=_admin_headers(),
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# PATCH /games/catalog/{id} — invalidates the catalog cache (#2966)
# ---------------------------------------------------------------------------


def test_patch_invalidates_the_catalog_cache(client: TestClient) -> None:
    """The tier change applies to the next request, not one cache TTL later."""
    gid = _get_game_id(client, "twenty48")
    headers = session_headers(str(uuid.uuid4()))
    # Free: creating a game loads the cache with twenty48 as free.
    assert client.post("/games", headers=headers, json={"game_type": "twenty48"}).status_code == 200
    assert catalog_cache._snapshot is not None
    try:
        r = client.patch(
            f"/games/catalog/{gid}", json={"is_premium": True}, headers=_admin_headers()
        )
        assert r.status_code == 200
        assert catalog_cache._snapshot is None
        r = client.post("/games", headers=headers, json={"game_type": "twenty48"})
        assert r.status_code == 403
        assert r.json()["detail"] == "not_entitled"
    finally:
        client.patch(f"/games/catalog/{gid}", json={"is_premium": False}, headers=_admin_headers())
    assert client.post("/games", headers=headers, json={"game_type": "twenty48"}).status_code == 200

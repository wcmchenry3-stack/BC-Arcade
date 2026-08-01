"""Tests for GET /games/catalog and PATCH /games/catalog/{id} (#1049, #1150)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

_ADMIN_TOKEN = "test-admin-token-1150"


@pytest.fixture()
def client() -> Iterator[TestClient]:
    from main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def set_admin_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_API_TOKEN", _ADMIN_TOKEN)


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
    for premium in ("cascade", "hearts", "sudoku", "starswarm", "yacht"):
        assert by_name[premium]["is_premium"] is True, f"{premium} should be premium"
    for free in ("blackjack", "solitaire", "freecell", "mahjong", "twenty48"):
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
    gid = _get_game_id(client, "blackjack")
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

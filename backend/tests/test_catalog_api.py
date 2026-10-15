"""Tests for GET /games/catalog (#1049, #1150)."""

from __future__ import annotations

from fastapi.testclient import TestClient

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

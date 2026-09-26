"""Tests for entitlement enforcement (#1051).

Acceptance criteria:
- POST /games with a premium game_type and no entitlement → 403
- POST /games with a free game_type → proceeds normally
- A premium game's board (GET /games/leaderboard/{game_type}) without
  entitlement → 403
- Entitled session passes through without error
- Free game boards are unaffected
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory
from db.models import GameEntitlement

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def client() -> Iterator[TestClient]:
    from main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def session_id() -> str:
    return str(uuid.uuid4())


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


async def _grant(session_id: str, game_slug: str) -> None:
    """Insert a GameEntitlement row for this session/game."""
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug=game_slug))
        await db.commit()


# ---------------------------------------------------------------------------
# POST /games — premium game blocked
# ---------------------------------------------------------------------------


def test_create_game_premium_no_entitlement_returns_403(
    client: TestClient, session_id: str
) -> None:
    r = client.post(
        "/games",
        json={"game_type": "cascade"},
        headers=_headers(session_id),
    )
    assert r.status_code == 403
    body = r.json()
    assert body["detail"] == "not_entitled"
    assert body["game"] == "cascade"


def test_create_game_premium_hearts_no_entitlement_returns_403(
    client: TestClient, session_id: str
) -> None:
    r = client.post(
        "/games",
        json={"game_type": "hearts"},
        headers=_headers(session_id),
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# POST /games — free game allowed
# ---------------------------------------------------------------------------


def test_create_game_free_no_entitlement_proceeds(client: TestClient, session_id: str) -> None:
    r = client.post(
        "/games",
        json={"game_type": "yacht"},
        headers=_headers(session_id),
    )
    # yacht is free (since 2026-09-23) — should not be gated (201 or 200, not 403)
    assert r.status_code != 403


# ---------------------------------------------------------------------------
# POST /games — entitled premium game allowed
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_create_game_entitled_premium_proceeds(client: TestClient, session_id: str) -> None:
    await _grant(session_id, "cascade")
    r = client.post(
        "/games",
        json={"game_type": "cascade"},
        headers=_headers(session_id),
    )
    assert r.status_code != 403


# ---------------------------------------------------------------------------
# Premium boards — gated. The per-game routers these tests used to hit
# (/cascade/*, /hearts/*, /mahjong/*, /starswarm/*) were removed in #2644;
# every board is GET /games/leaderboard/{game_type}.
# ---------------------------------------------------------------------------

_PREMIUM_BOARDS = ("cascade", "hearts", "mahjong", "starswarm")
_FREE_BOARDS = ("freecell", "solitaire", "sudoku")


@pytest.mark.parametrize("game", _PREMIUM_BOARDS)
def test_premium_board_no_entitlement_returns_403(
    client: TestClient, session_id: str, game: str
) -> None:
    r = client.get(f"/games/leaderboard/{game}", headers=_headers(session_id))
    assert r.status_code == 403
    assert r.json()["game"] == game


@pytest.mark.anyio
@pytest.mark.parametrize("game", _PREMIUM_BOARDS)
async def test_premium_board_entitled_session_passes(
    client: TestClient, session_id: str, game: str
) -> None:
    await _grant(session_id, game)
    r = client.get(f"/games/leaderboard/{game}", headers=_headers(session_id))
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Free boards — unaffected
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("game", _FREE_BOARDS)
def test_free_board_not_gated(client: TestClient, session_id: str, game: str) -> None:
    query = "?difficulty=easy" if game == "sudoku" else ""
    r = client.get(f"/games/leaderboard/{game}{query}", headers=_headers(session_id))
    assert r.status_code == 200, r.text

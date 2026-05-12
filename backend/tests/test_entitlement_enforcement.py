"""Tests for entitlement enforcement (#1051).

Acceptance criteria:
- POST /games with a premium game_type and no entitlement → 403
- POST /games with a free game_type → proceeds normally
- Any route on /cascade/*, /hearts/*, /sudoku/*, /starswarm/* without
  entitlement → 403
- Entitled session passes through without error
- Free game routes are unaffected
"""

from __future__ import annotations

import uuid
from typing import Iterator

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
        json={"game_type": "blackjack"},
        headers=_headers(session_id),
    )
    # blackjack is free — should not be gated (201 or 200, not 403)
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
# /cascade/* — gated
# ---------------------------------------------------------------------------


def test_cascade_scores_no_entitlement_returns_403(client: TestClient, session_id: str) -> None:
    r = client.get("/cascade/scores", headers=_headers(session_id))
    assert r.status_code == 403
    assert r.json()["game"] == "cascade"


def test_cascade_patch_no_entitlement_returns_403(client: TestClient, session_id: str) -> None:
    game_id = str(uuid.uuid4())
    r = client.patch(
        f"/cascade/score/{game_id}",
        json={"player_name": "Alice"},
        headers=_headers(session_id),
    )
    assert r.status_code == 403


@pytest.mark.anyio
async def test_cascade_entitled_session_passes(client: TestClient, session_id: str) -> None:
    await _grant(session_id, "cascade")
    r = client.get("/cascade/scores", headers=_headers(session_id))
    assert r.status_code != 403


# ---------------------------------------------------------------------------
# /hearts/* — gated
# ---------------------------------------------------------------------------


def test_hearts_scores_no_entitlement_returns_403(client: TestClient, session_id: str) -> None:
    r = client.get("/hearts/scores", headers=_headers(session_id))
    assert r.status_code == 403
    assert r.json()["game"] == "hearts"


def test_hearts_submit_no_entitlement_returns_403(client: TestClient, session_id: str) -> None:
    r = client.post(
        "/hearts/score",
        json={"player_name": "Bob", "score": 42},
        headers=_headers(session_id),
    )
    assert r.status_code == 403


@pytest.mark.anyio
async def test_hearts_entitled_session_passes(client: TestClient, session_id: str) -> None:
    await _grant(session_id, "hearts")
    r = client.get("/hearts/scores", headers=_headers(session_id))
    assert r.status_code != 403


# ---------------------------------------------------------------------------
# /sudoku/* — gated
# ---------------------------------------------------------------------------


def test_sudoku_scores_no_entitlement_returns_403(client: TestClient, session_id: str) -> None:
    r = client.get("/sudoku/scores/easy", headers=_headers(session_id))
    assert r.status_code == 403
    assert r.json()["game"] == "sudoku"


@pytest.mark.anyio
async def test_sudoku_entitled_session_passes(client: TestClient, session_id: str) -> None:
    await _grant(session_id, "sudoku")
    r = client.get("/sudoku/scores/easy", headers=_headers(session_id))
    assert r.status_code != 403


# ---------------------------------------------------------------------------
# /starswarm/* — gated
# ---------------------------------------------------------------------------


def test_starswarm_leaderboard_no_entitlement_returns_403(
    client: TestClient, session_id: str
) -> None:
    r = client.get("/starswarm/leaderboard", headers=_headers(session_id))
    assert r.status_code == 403
    assert r.json()["game"] == "starswarm"


def test_starswarm_submit_no_entitlement_returns_403(client: TestClient, session_id: str) -> None:
    r = client.post(
        "/starswarm/score",
        json={
            "player_id": "Carol",
            "score": 100,
            "wave_reached": 3,
        },
        headers=_headers(session_id),
    )
    assert r.status_code == 403


@pytest.mark.anyio
async def test_starswarm_entitled_session_passes(client: TestClient, session_id: str) -> None:
    await _grant(session_id, "starswarm")
    r = client.get("/starswarm/leaderboard", headers=_headers(session_id))
    assert r.status_code != 403


# ---------------------------------------------------------------------------
# Free game routes — unaffected
# ---------------------------------------------------------------------------


def test_freecell_not_gated(client: TestClient, session_id: str) -> None:
    r = client.get("/freecell/scores", headers=_headers(session_id))
    assert r.status_code != 403


def test_solitaire_not_gated(client: TestClient, session_id: str) -> None:
    r = client.get("/solitaire/scores", headers=_headers(session_id))
    assert r.status_code != 403

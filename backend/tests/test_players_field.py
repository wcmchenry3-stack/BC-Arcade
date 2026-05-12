"""Tests for players[] as a first-class field on game records (#543)."""

from __future__ import annotations

import os
import uuid
from typing import Iterator

import pytest
from pydantic import ValidationError

from games.schemas import CreateGameRequest, PlayerRef

# ---------------------------------------------------------------------------
# PlayerRef unit tests
# ---------------------------------------------------------------------------


def test_player_ref_valid() -> None:
    ref = PlayerRef(player_id="abc-123")
    assert ref.player_id == "abc-123"


def test_player_ref_empty_string_rejected() -> None:
    with pytest.raises(ValidationError):
        PlayerRef(player_id="")


def test_player_ref_too_long_rejected() -> None:
    with pytest.raises(ValidationError):
        PlayerRef(player_id="x" * 129)


# ---------------------------------------------------------------------------
# CreateGameRequest — players field
# ---------------------------------------------------------------------------


def test_create_game_request_defaults_players_to_empty_list() -> None:
    req = CreateGameRequest(game_type="yacht")
    assert req.players == []


def test_create_game_request_accepts_explicit_players() -> None:
    req = CreateGameRequest(
        game_type="yacht",
        players=[{"player_id": "user-abc"}],
    )
    assert len(req.players) == 1
    assert req.players[0].player_id == "user-abc"


def test_create_game_request_rejects_invalid_player_ref() -> None:
    with pytest.raises(ValidationError):
        CreateGameRequest(game_type="yacht", players=[{"player_id": ""}])


# ---------------------------------------------------------------------------
# API-level tests (require DATABASE_URL)
# ---------------------------------------------------------------------------

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)


@pytest.fixture()
def client() -> Iterator:
    from db.base import is_configured

    assert is_configured()
    from main import app
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


async def _grant(session_id: str, game_slug: str) -> None:
    from db.base import get_session_factory
    from db.models import GameEntitlement

    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug=game_slug))
        await db.commit()


@pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)
async def test_create_game_stores_players_from_session(client) -> None:
    """When players is omitted, the session id is stored as the sole player."""
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    r = client.post("/games", headers=_headers(sid), json={"game_type": "yacht"})
    assert r.status_code == 200
    gid = r.json()["id"]

    r2 = client.get(f"/games/{gid}", headers=_headers(sid))
    assert r2.status_code == 200
    body = r2.json()
    assert body["players"] == [{"player_id": sid}]


@pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)
async def test_create_game_stores_explicit_players(client) -> None:
    """When players is provided, the given list is persisted."""
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    custom_id = str(uuid.uuid4())
    r = client.post(
        "/games",
        headers=_headers(sid),
        json={"game_type": "yacht", "players": [{"player_id": custom_id}]},
    )
    assert r.status_code == 200
    gid = r.json()["id"]

    r2 = client.get(f"/games/{gid}", headers=_headers(sid))
    assert r2.status_code == 200
    assert r2.json()["players"] == [{"player_id": custom_id}]


@pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)
async def test_game_history_includes_players(client) -> None:
    """GET /games/me items include the players field."""
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    client.post("/games", headers=_headers(sid), json={"game_type": "yacht"})

    r = client.get("/games/me", headers=_headers(sid))
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) >= 1
    assert "players" in items[0]
    assert items[0]["players"] == [{"player_id": sid}]

"""Read-side tests for #365 (stats, history, detail)."""

from __future__ import annotations

import os
import uuid
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory, is_configured
from db.models import GameEntitlement

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


async def _grant(session_id: str, game_slug: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug=game_slug))
        await db.commit()


def _create_and_complete(
    client: TestClient, sid: str, *, game_type: str, final_score: int, outcome: str = "win"
) -> str:
    r = client.post("/games", headers=_headers(sid), json={"game_type": game_type})
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={"final_score": final_score, "outcome": outcome, "duration_ms": 10_000},
    )
    assert r.status_code == 200, r.text
    return gid


# ---------------------------------------------------------------------------
# GET /stats/me
# ---------------------------------------------------------------------------


def test_stats_me_empty_session(client: TestClient) -> None:
    r = client.get("/stats/me", headers=_headers(str(uuid.uuid4())))
    assert r.status_code == 200
    body = r.json()
    assert body["total_games"] == 0
    assert body["by_game"] == {}
    assert body["favorite_game"] is None


async def test_stats_me_aggregates_per_game(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    _create_and_complete(client, sid, game_type="yacht", final_score=100)
    _create_and_complete(client, sid, game_type="yacht", final_score=300)
    _create_and_complete(client, sid, game_type="twenty48", final_score=15_000)

    r = client.get("/stats/me", headers=_headers(sid))
    assert r.status_code == 200
    body = r.json()
    assert body["total_games"] == 3
    assert body["by_game"]["yacht"]["played"] == 2
    assert body["by_game"]["yacht"]["best"] == 300
    assert body["by_game"]["yacht"]["avg"] == 200.0
    assert body["by_game"]["twenty48"]["played"] == 1
    assert body["favorite_game"] == "yacht"


def test_stats_me_blackjack_uses_chip_shape(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    _create_and_complete(client, sid, game_type="blackjack", final_score=1500)
    _create_and_complete(client, sid, game_type="blackjack", final_score=2400)

    r = client.get("/stats/me", headers=_headers(sid))
    body = r.json()
    bj = body["by_game"]["blackjack"]
    assert bj["played"] == 2
    assert bj["best_chips"] == 2400
    assert bj["current_chips"] == 2400
    # non-blackjack fields should be absent or null on this entry
    assert bj.get("best") is None
    assert bj.get("avg") is None


# ---------------------------------------------------------------------------
# GET /games/me (history with cursor pagination)
# ---------------------------------------------------------------------------


async def test_games_me_history_pagination(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    for s in (10, 20, 30, 40, 50):
        _create_and_complete(client, sid, game_type="yacht", final_score=s)

    r = client.get("/games/me?limit=2", headers=_headers(sid))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["items"]) == 2
    assert body["next_cursor"] is not None

    r2 = client.get(f"/games/me?limit=2&cursor={body['next_cursor']}", headers=_headers(sid))
    assert r2.status_code == 200
    assert len(r2.json()["items"]) == 2


async def test_games_me_filters_by_session(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    other = str(uuid.uuid4())
    await _grant(sid, "yacht")
    await _grant(other, "yacht")
    _create_and_complete(client, sid, game_type="yacht", final_score=100)
    _create_and_complete(client, other, game_type="yacht", final_score=200)

    r = client.get("/games/me", headers=_headers(sid))
    items = r.json()["items"]
    assert all(item["final_score"] == 100 for item in items)


# ---------------------------------------------------------------------------
# GET /games/{id}
# ---------------------------------------------------------------------------


async def test_game_detail_returns_row(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    gid = _create_and_complete(client, sid, game_type="yacht", final_score=250)
    r = client.get(f"/games/{gid}", headers=_headers(sid))
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == gid
    assert body["final_score"] == 250
    assert body.get("events") is None


async def test_game_detail_include_events(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    r = client.post("/games", headers=_headers(sid), json={"game_type": "yacht"})
    gid = r.json()["id"]
    client.post(
        f"/games/{gid}/events",
        headers=_headers(sid),
        json={
            "events": [
                {"event_index": 0, "event_type": "game_started", "data": {}},
                {"event_index": 1, "event_type": "roll", "data": {"dice": [1, 2, 3, 4, 5]}},
            ]
        },
    )

    r = client.get(f"/games/{gid}?include_events=1", headers=_headers(sid))
    assert r.status_code == 200
    body = r.json()
    assert len(body["events"]) == 2
    assert body["events"][0]["event_type"] == "game_started"


async def test_game_detail_cross_session_forbidden(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    gid = _create_and_complete(client, sid, game_type="yacht", final_score=100)
    other = str(uuid.uuid4())
    r = client.get(f"/games/{gid}", headers=_headers(other))
    assert r.status_code == 403


def test_game_detail_not_found(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    r = client.get(f"/games/{uuid.uuid4()}", headers=_headers(sid))
    assert r.status_code == 404

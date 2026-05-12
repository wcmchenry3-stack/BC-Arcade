"""End-to-end tests for the games write API (#364).

Requires DATABASE_URL — skipped otherwise. Hits the live DB via the FastAPI
TestClient. Cleans up any rows it creates on teardown.
"""

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


@pytest.fixture()
def session_id() -> str:
    return str(uuid.uuid4())


async def _grant(session_id: str, game_slug: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug=game_slug))
        await db.commit()


@pytest.fixture(autouse=True)
async def _yacht_entitlement(session_id: str) -> None:
    await _grant(session_id, "yacht")


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


def _new_game(client: TestClient, sid: str, game_type: str = "yacht") -> str:
    r = client.post("/games", headers=_headers(sid), json={"game_type": game_type})
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------------------------------------------------------------------------
# /games
# ---------------------------------------------------------------------------


def test_create_game_happy_path(client: TestClient, session_id: str) -> None:
    r = client.post("/games", headers=_headers(session_id), json={"game_type": "yacht"})
    assert r.status_code == 200
    body = r.json()
    assert uuid.UUID(body["id"])
    assert body["started_at"]


def test_create_game_requires_session_header(client: TestClient) -> None:
    r = client.post("/games", json={"game_type": "yacht"})
    assert r.status_code == 400


def test_create_game_rejects_unknown_game_type(client: TestClient, session_id: str) -> None:
    r = client.post("/games", headers=_headers(session_id), json={"game_type": "bogus"})
    assert r.status_code == 400


def test_create_game_client_id_idempotent(client: TestClient, session_id: str) -> None:
    game_id = str(uuid.uuid4())
    r1 = client.post(
        "/games",
        headers=_headers(session_id),
        json={"id": game_id, "game_type": "yacht"},
    )
    r2 = client.post(
        "/games",
        headers=_headers(session_id),
        json={"id": game_id, "game_type": "yacht"},
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"] == game_id


def test_create_game_cross_session_id_rejected(client: TestClient, session_id: str) -> None:
    game_id = str(uuid.uuid4())
    other_sid = str(uuid.uuid4())
    r1 = client.post(
        "/games",
        headers=_headers(session_id),
        json={"id": game_id, "game_type": "yacht"},
    )
    assert r1.status_code == 200
    r2 = client.post(
        "/games",
        headers=_headers(other_sid),
        json={"id": game_id, "game_type": "yacht"},
    )
    assert r2.status_code == 403


# ---------------------------------------------------------------------------
# /games/:id/events
# ---------------------------------------------------------------------------


def test_append_events_happy_path(client: TestClient, session_id: str) -> None:
    gid = _new_game(client, session_id)
    r = client.post(
        f"/games/{gid}/events",
        headers=_headers(session_id),
        json={
            "events": [
                {"event_index": 0, "event_type": "game_started", "data": {}},
                {"event_index": 1, "event_type": "roll", "data": {"dice": [1, 2, 3, 4, 5]}},
            ]
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accepted"] == 2
    assert body["duplicates"] == 0


def test_append_events_idempotent(client: TestClient, session_id: str) -> None:
    gid = _new_game(client, session_id)
    payload = {
        "events": [
            {"event_index": 0, "event_type": "game_started", "data": {}},
            {"event_index": 1, "event_type": "roll", "data": {"dice": [6, 6, 6, 6, 6]}},
        ]
    }
    r1 = client.post(f"/games/{gid}/events", headers=_headers(session_id), json=payload)
    r2 = client.post(f"/games/{gid}/events", headers=_headers(session_id), json=payload)
    assert r1.json()["accepted"] == 2
    assert r2.json()["accepted"] == 0
    assert r2.json()["duplicates"] == 2


def test_append_events_rejects_unknown_event_type(client: TestClient, session_id: str) -> None:
    gid = _new_game(client, session_id)
    r = client.post(
        f"/games/{gid}/events",
        headers=_headers(session_id),
        json={
            "events": [
                {"event_index": 0, "event_type": "bogus_type", "data": {}},
            ]
        },
    )
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "bogus_type" in detail["rejected"]


def test_append_events_cross_session_forbidden(client: TestClient, session_id: str) -> None:
    gid = _new_game(client, session_id)
    other = str(uuid.uuid4())
    r = client.post(
        f"/games/{gid}/events",
        headers=_headers(other),
        json={"events": [{"event_index": 0, "event_type": "game_started", "data": {}}]},
    )
    assert r.status_code == 403


def test_append_events_batch_size_cap(client: TestClient, session_id: str) -> None:
    gid = _new_game(client, session_id)
    events = [{"event_index": i, "event_type": "roll", "data": {}} for i in range(201)]
    r = client.post(f"/games/{gid}/events", headers=_headers(session_id), json={"events": events})
    assert r.status_code == 422  # Pydantic validation


def test_append_events_gap_tolerant(client: TestClient, session_id: str) -> None:
    gid = _new_game(client, session_id)
    r = client.post(
        f"/games/{gid}/events",
        headers=_headers(session_id),
        json={
            "events": [
                {"event_index": 0, "event_type": "game_started", "data": {}},
                {"event_index": 5, "event_type": "roll", "data": {}},
                {"event_index": 10, "event_type": "score", "data": {}},
            ]
        },
    )
    assert r.status_code == 200
    assert r.json()["accepted"] == 3


# ---------------------------------------------------------------------------
# /games/:id/complete
# ---------------------------------------------------------------------------


def test_complete_game_happy_path(client: TestClient, session_id: str) -> None:
    gid = _new_game(client, session_id)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(session_id),
        json={"final_score": 250, "outcome": "win", "duration_ms": 60_000},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["final_score"] == 250
    assert body["outcome"] == "win"
    assert body["completed_at"] is not None


def test_complete_game_idempotent(client: TestClient, session_id: str) -> None:
    gid = _new_game(client, session_id)
    r1 = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(session_id),
        json={"final_score": 100, "outcome": "win"},
    )
    r2 = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(session_id),
        json={"final_score": 999, "outcome": "loss"},  # ignored
    )
    assert r1.json()["final_score"] == 100
    assert r2.json()["final_score"] == 100
    assert r2.json()["outcome"] == "win"


def test_complete_game_rejects_invalid_outcome(client: TestClient, session_id: str) -> None:
    gid = _new_game(client, session_id)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(session_id),
        json={"outcome": "bogus"},
    )
    assert r.status_code == 400


# #514: prior to this fix the set of valid outcomes only covered the blackjack
# result vocabulary (`win` / `loss` / `push` / `blackjack`) plus `abandoned`,
# so every natural game-end from a score-based game (yacht, cascade, twenty48)
# came back 400 on `outcome="completed"`. Cover both vocabularies explicitly.
@pytest.mark.parametrize(
    "outcome",
    [
        # Result vocabulary
        "win",
        "loss",
        "push",
        "blackjack",
        # Lifecycle vocabulary (#514)
        "completed",
        "abandoned",
        "kept_playing",
    ],
)
def test_complete_game_accepts_valid_outcomes(
    client: TestClient, session_id: str, outcome: str
) -> None:
    gid = _new_game(client, session_id)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(session_id),
        json={"final_score": 100, "outcome": outcome, "duration_ms": 5_000},
    )
    assert r.status_code == 200, r.text
    assert r.json()["outcome"] == outcome


def test_complete_game_cross_session_forbidden(client: TestClient, session_id: str) -> None:
    gid = _new_game(client, session_id)
    other = str(uuid.uuid4())
    r = client.patch(f"/games/{gid}/complete", headers=_headers(other), json={"final_score": 10})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Rate limiting — per session
# ---------------------------------------------------------------------------


async def test_games_create_rate_limit_per_session(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    codes = [
        client.post("/games", headers=_headers(sid), json={"game_type": "yacht"}).status_code
        for _ in range(12)
    ]
    assert 429 in codes
    # Different session should not be rate-limited
    other = str(uuid.uuid4())
    await _grant(other, "yacht")
    r = client.post("/games", headers=_headers(other), json={"game_type": "yacht"})
    assert r.status_code == 200

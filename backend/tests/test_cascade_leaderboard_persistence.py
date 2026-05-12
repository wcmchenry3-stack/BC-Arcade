"""#366: cascade leaderboard survives across engine dispose + reload.

The in-memory leaderboard that preceded #366 lost every score on restart.
This test exercises the DB-backed replacement by:
  1. Creating and completing a game via the unified games pipeline
  2. Disposing the engine pool (proxy for a process restart)
  3. Re-opening a fresh TestClient and asserting the score is still visible

Uses a dedicated SQLite file so the autouse clean_db_tables fixture in
conftest.py does NOT wipe the row (we disable that fixture for this module).
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from db.base import get_engine, get_session_factory
from db.models import GameEntitlement


@pytest.fixture(autouse=True)
async def _clean_db_tables():
    yield


async def test_cascade_score_survives_engine_dispose() -> None:
    from main import app

    sid = str(uuid.uuid4())
    headers = {"X-Session-ID": sid}

    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=sid, game_slug="cascade"))
        await db.commit()

    with TestClient(app) as c1:
        # Create game
        r = c1.post("/games", json={"game_type": "cascade"}, headers=headers)
        assert r.status_code in (200, 201), r.text
        game_id = r.json()["id"]

        # Complete with score
        r = c1.patch(
            f"/games/{game_id}/complete",
            json={"final_score": 4242, "outcome": "completed"},
            headers=headers,
        )
        assert r.status_code == 200, r.text

        # Set player name
        r = c1.patch(
            f"/cascade/score/{game_id}",
            json={"player_name": "PersistenceTester"},
            headers=headers,
        )
        assert r.status_code == 200, r.text

    # Proxy for "backend restart" — drop connection pool.
    engine = get_engine()
    await engine.dispose()

    with TestClient(app) as c2:
        r = c2.get("/cascade/scores", headers=headers)
        assert r.status_code == 200
        scores = r.json()["scores"]
        assert any(
            s["player_name"] == "PersistenceTester" and s["score"] == 4242 for s in scores
        ), f"Expected persisted score in {scores!r}"

    # Manual cleanup since clean_db_tables is disabled.
    from sqlalchemy import text

    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM games"))

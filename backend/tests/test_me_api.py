"""Tests for DELETE /me — user data deletion (#1923)."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from db.base import get_session_factory, is_configured
from db.models import BugLog, GameEntitlement

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


@pytest.fixture()
def other_session_id() -> str:
    return str(uuid.uuid4())


async def _grant(session_id: str, game_slug: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug=game_slug))
        await db.commit()


async def _seed_bug_log(session_id: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(
            BugLog(
                session_id=session_id,
                logged_at=datetime.now(timezone.utc),
                level="warn",
                source="test",
                message="test bug log",
            )
        )
        await db.commit()


async def _count_entitlements(session_id: str) -> int:
    factory = get_session_factory()
    async with factory() as db:
        result = await db.execute(
            select(func.count())
            .select_from(GameEntitlement)
            .where(GameEntitlement.session_id == session_id)
        )
        return result.scalar_one()


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


@pytest.fixture(autouse=True)
async def _seed_entitlement(session_id: str) -> None:
    await _grant(session_id, "yacht")


# ---------------------------------------------------------------------------
# DELETE /me
# ---------------------------------------------------------------------------


def test_delete_me_returns_204_for_empty_session(client: TestClient) -> None:
    # Use a brand-new UUID unrelated to the session_id fixture so there is
    # guaranteed to be no data for this session.
    sid = str(uuid.uuid4())
    r = client.delete("/me", headers=_headers(sid))
    assert r.status_code == 204
    assert r.content == b""


def test_delete_me_requires_session_header(client: TestClient) -> None:
    r = client.delete("/me")
    assert r.status_code == 400


def test_delete_me_removes_games(client: TestClient, session_id: str) -> None:
    r = client.post("/games", headers=_headers(session_id), json={"game_type": "yacht"})
    assert r.status_code == 200

    r = client.delete("/me", headers=_headers(session_id))
    assert r.status_code == 204

    r = client.get("/games/me", headers=_headers(session_id))
    assert r.status_code == 200
    assert r.json()["items"] == []


async def test_delete_me_removes_entitlements(client: TestClient, session_id: str) -> None:
    assert await _count_entitlements(session_id) == 1

    r = client.delete("/me", headers=_headers(session_id))
    assert r.status_code == 204

    assert await _count_entitlements(session_id) == 0


async def test_delete_me_removes_bug_logs(client: TestClient, session_id: str) -> None:
    await _seed_bug_log(session_id)

    r = client.delete("/me", headers=_headers(session_id))
    assert r.status_code == 204

    factory = get_session_factory()
    async with factory() as db:
        count = (
            await db.execute(
                select(func.count()).select_from(BugLog).where(BugLog.session_id == session_id)
            )
        ).scalar_one()
    assert count == 0


def test_delete_me_is_idempotent(client: TestClient, session_id: str) -> None:
    r = client.delete("/me", headers=_headers(session_id))
    assert r.status_code == 204

    r = client.delete("/me", headers=_headers(session_id))
    assert r.status_code == 204


async def test_delete_me_does_not_affect_other_sessions(
    client: TestClient, session_id: str, other_session_id: str
) -> None:
    await _grant(other_session_id, "yacht")
    assert await _count_entitlements(other_session_id) == 1

    r = client.delete("/me", headers=_headers(session_id))
    assert r.status_code == 204

    assert await _count_entitlements(other_session_id) == 1

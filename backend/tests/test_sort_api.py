"""Tests for /sort/levels (#1173). Sort ranks on the generic board (#2625)."""

import uuid

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory
from db.models import GameEntitlement
from main import app

client = TestClient(app)

_SID = str(uuid.uuid4())
_HEADERS = {"X-Session-ID": _SID}


async def _grant(session_id: str, game_slug: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug=game_slug))
        await db.commit()


@pytest.fixture(autouse=True)
async def _sort_entitlement():
    await _grant(_SID, "sort")


# ---------------------------------------------------------------------------
# GET /sort/levels
# ---------------------------------------------------------------------------


class TestGetLevels:
    def test_returns_23_levels(self):
        res = client.get("/sort/levels", headers=_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert len(data["levels"]) == 23

    def test_level_has_id_and_bottles(self):
        res = client.get("/sort/levels", headers=_HEADERS)
        level = res.json()["levels"][0]
        assert "id" in level
        assert "bottles" in level
        assert isinstance(level["bottles"], list)

    def test_levels_sequential_ids(self):
        levels = client.get("/sort/levels", headers=_HEADERS).json()["levels"]
        ids = [lvl["id"] for lvl in levels]
        assert ids == list(range(1, 24))

    def test_consecutive_calls_return_different_levels(self):
        r1 = client.get("/sort/levels", headers=_HEADERS).json()["levels"]
        r2 = client.get("/sort/levels", headers=_HEADERS).json()["levels"]
        assert r1 != r2

"""Tests for /sort/levels, /sort/score, and /sort/scores (#1173)."""

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


def _submit(player_name: str, level_reached: int):
    return client.post(
        "/sort/score",
        json={"player_name": player_name, "level_reached": level_reached},
        headers=_HEADERS,
    )


# ---------------------------------------------------------------------------
# GET /sort/levels
# ---------------------------------------------------------------------------


class TestGetLevels:
    def test_returns_20_levels(self):
        res = client.get("/sort/levels", headers=_HEADERS)
        assert res.status_code == 200
        data = res.json()
        assert len(data["levels"]) == 20

    def test_level_has_id_and_bottles(self):
        res = client.get("/sort/levels", headers=_HEADERS)
        level = res.json()["levels"][0]
        assert "id" in level
        assert "bottles" in level
        assert isinstance(level["bottles"], list)

    def test_levels_sequential_ids(self):
        levels = client.get("/sort/levels", headers=_HEADERS).json()["levels"]
        ids = [lvl["id"] for lvl in levels]
        assert ids == list(range(1, 21))

    def test_consecutive_calls_return_different_levels(self):
        r1 = client.get("/sort/levels", headers=_HEADERS).json()["levels"]
        r2 = client.get("/sort/levels", headers=_HEADERS).json()["levels"]
        assert r1 != r2


# ---------------------------------------------------------------------------
# POST /sort/score
# ---------------------------------------------------------------------------


class TestSubmitScore:
    def test_valid_submission_returns_201(self):
        res = _submit("Alice", 5)
        assert res.status_code == 201
        body = res.json()
        assert body["player_name"] == "Alice"
        assert body["level_reached"] == 5
        assert body["rank"] == 1

    def test_level_1_accepted(self):
        assert _submit("Alice", 1).status_code == 201

    def test_level_20_accepted(self):
        assert _submit("Alice", 20).status_code == 201

    def test_level_0_returns_422(self):
        assert (
            client.post(
                "/sort/score", json={"player_name": "Bob", "level_reached": 0}, headers=_HEADERS
            ).status_code
            == 422
        )

    def test_level_21_returns_422(self):
        assert (
            client.post(
                "/sort/score", json={"player_name": "Bob", "level_reached": 21}, headers=_HEADERS
            ).status_code
            == 422
        )

    def test_missing_player_name_returns_422(self):
        assert (
            client.post("/sort/score", json={"level_reached": 5}, headers=_HEADERS).status_code
            == 422
        )

    def test_empty_player_name_returns_422(self):
        assert _submit("", 5).status_code == 422

    def test_name_too_long_returns_422(self):
        assert _submit("x" * 33, 5).status_code == 422


# ---------------------------------------------------------------------------
# GET /sort/scores
# ---------------------------------------------------------------------------


class TestGetScores:
    def test_empty_initially(self):
        res = client.get("/sort/scores", headers=_HEADERS)
        assert res.status_code == 200
        assert res.json()["scores"] == []

    def test_returns_submitted_entries(self):
        _submit("Alice", 10)
        _submit("Bob", 7)
        scores = client.get("/sort/scores", headers=_HEADERS).json()["scores"]
        assert len(scores) == 2

    def test_ordered_by_level_reached_descending(self):
        _submit("Alice", 5)
        _submit("Bob", 15)
        _submit("Carol", 10)
        scores = client.get("/sort/scores", headers=_HEADERS).json()["scores"]
        assert [s["level_reached"] for s in scores] == [15, 10, 5]

    def test_capped_at_ten_entries(self):
        from limiter import limiter

        for i in range(1, 16):
            limiter.reset()
            _submit(f"Player{i}", i)
        scores = client.get("/sort/scores", headers=_HEADERS).json()["scores"]
        assert len(scores) == 10
        assert scores[0]["level_reached"] == 15


# ---------------------------------------------------------------------------
# Rank in submission response
# ---------------------------------------------------------------------------


class TestSubmitRank:
    def test_first_submission_rank_1(self):
        assert _submit("Alice", 10).json()["rank"] == 1

    def test_lower_level_ranked_lower(self):
        from limiter import limiter

        limiter.reset()
        _submit("Alice", 10)
        limiter.reset()
        assert _submit("Bob", 5).json()["rank"] == 2

    def test_off_leaderboard_returns_rank_11(self):
        from limiter import limiter

        for i in range(10):
            limiter.reset()
            _submit(f"Top{i}", 20)
        limiter.reset()
        assert _submit("Lowly", 1).json()["rank"] == 11


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------


class TestRateLimit:
    def test_sixth_submission_returns_429(self):
        from limiter import limiter

        for i in range(5):
            assert _submit(f"Player{i}", i + 1).status_code == 201

        assert _submit("Excess", 10).status_code == 429
        limiter.reset()


# ---------------------------------------------------------------------------
# Tie-break ordering — older entry wins
# ---------------------------------------------------------------------------


class TestTieBreak:
    def test_older_entry_ranks_higher_on_tie(self):
        from limiter import limiter

        limiter.reset()
        _submit("Alice", 10)
        limiter.reset()
        body = _submit("Bob", 10).json()

        scores = client.get("/sort/scores", headers=_HEADERS).json()["scores"]
        assert scores[0]["player_name"] == "Alice"
        assert scores[1]["player_name"] == "Bob"
        assert body["rank"] == 2

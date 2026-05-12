"""Tests for /hearts/score and /hearts/scores (#605).

Mirrors ``test_solitaire_api.py`` — the Hearts leaderboard follows the
same Cascade/Solitaire pattern. Score is max(0, 100 − human_cumulative)
so higher = better performance.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

import hearts.router as hearts_router_module
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
async def _hearts_entitlement():
    await _grant(_SID, "hearts")


@pytest.fixture(autouse=True)
def reset_leaderboard():
    hearts_router_module.reset_leaderboard()
    yield
    hearts_router_module.reset_leaderboard()


def _submit(player_name: str, score: int):
    return client.post(
        "/hearts/score", json={"player_name": player_name, "score": score}, headers=_HEADERS
    )


# ---------------------------------------------------------------------------
# POST /hearts/score
# ---------------------------------------------------------------------------


class TestSubmitScore:
    def test_valid_submission_returns_201(self):
        res = _submit("Alice", 80)
        assert res.status_code == 201
        body = res.json()
        assert body["player_name"] == "Alice"
        assert body["score"] == 80
        assert body["rank"] == 1

    def test_zero_score_accepted(self):
        res = _submit("Alice", 0)
        assert res.status_code == 201

    def test_missing_player_name_returns_422(self):
        res = client.post("/hearts/score", json={"score": 50}, headers=_HEADERS)
        assert res.status_code == 422

    def test_missing_score_returns_422(self):
        res = client.post("/hearts/score", json={"player_name": "Bob"}, headers=_HEADERS)
        assert res.status_code == 422

    def test_empty_player_name_returns_422(self):
        res = _submit("", 50)
        assert res.status_code == 422

    def test_name_too_long_returns_422(self):
        res = _submit("x" * 33, 50)
        assert res.status_code == 422

    def test_negative_score_returns_422(self):
        res = _submit("Alice", -1)
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# GET /hearts/scores
# ---------------------------------------------------------------------------


class TestGetScores:
    def test_empty_initially(self):
        res = client.get("/hearts/scores", headers=_HEADERS)
        assert res.status_code == 200
        assert res.json()["scores"] == []

    def test_returns_submitted_entries(self):
        _submit("Alice", 80)
        _submit("Bob", 60)
        scores = client.get("/hearts/scores", headers=_HEADERS).json()["scores"]
        assert len(scores) == 2

    def test_ordered_by_score_descending(self):
        _submit("Alice", 40)
        _submit("Bob", 90)
        _submit("Carol", 70)
        scores = client.get("/hearts/scores", headers=_HEADERS).json()["scores"]
        assert [s["score"] for s in scores] == [90, 70, 40]

    def test_capped_at_ten_entries(self):
        from limiter import limiter

        for i in range(15):
            limiter.reset()
            _submit(f"Player{i}", i * 5)
        scores = client.get("/hearts/scores", headers=_HEADERS).json()["scores"]
        assert len(scores) == 10
        assert scores[0]["score"] == 70  # top score is 14 * 5


# ---------------------------------------------------------------------------
# Rank in submission response
# ---------------------------------------------------------------------------


class TestSubmitRank:
    def test_first_submission_rank_1(self):
        assert _submit("Alice", 80).json()["rank"] == 1

    def test_lower_score_ranked_lower(self):
        from limiter import limiter

        limiter.reset()
        _submit("Alice", 80)
        limiter.reset()
        assert _submit("Bob", 50).json()["rank"] == 2

    def test_off_leaderboard_returns_rank_11(self):
        from limiter import limiter

        for i in range(10):
            limiter.reset()
            _submit(f"Top{i}", 1000)
        limiter.reset()
        assert _submit("Lowly", 1).json()["rank"] == 11


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------


class TestRateLimit:
    def test_sixth_submission_returns_429(self):
        from limiter import limiter

        for i in range(5):
            assert _submit(f"Player{i}", i * 10).status_code == 201

        assert _submit("Excess", 99).status_code == 429
        limiter.reset()


# ---------------------------------------------------------------------------
# Tie-break ordering — older entry wins
# ---------------------------------------------------------------------------


class TestTieBreak:
    def test_older_score_ranks_higher_on_tie(self):
        from limiter import limiter

        limiter.reset()
        _submit("Alice", 75)
        limiter.reset()
        body = _submit("Bob", 75).json()

        scores = client.get("/hearts/scores", headers=_HEADERS).json()["scores"]
        assert scores[0]["player_name"] == "Alice"
        assert scores[1]["player_name"] == "Bob"
        assert body["rank"] == 2

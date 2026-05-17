"""Tests for /yacht/score and /yacht/scores (#1597).

Mirrors test_hearts_api.py. Score transform is max(0, 400 - raw_score)
so higher transformed score = better performance.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

import yacht.router as yacht_router_module
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
async def _yacht_entitlement():
    await _grant(_SID, "yacht")


@pytest.fixture(autouse=True)
def reset_leaderboard():
    yacht_router_module.reset_leaderboard()
    yield
    yacht_router_module.reset_leaderboard()


def _submit(player_name: str, score: int, difficulty: str = "easy"):
    return client.post(
        "/yacht/score",
        json={"player_name": player_name, "score": score, "difficulty": difficulty},
        headers=_HEADERS,
    )


# ---------------------------------------------------------------------------
# POST /yacht/score
# ---------------------------------------------------------------------------


class TestSubmitScore:
    def test_valid_submission_returns_201(self):
        res = _submit("Alice", 200)
        assert res.status_code == 201
        body = res.json()
        assert body["player_name"] == "Alice"
        assert body["rank"] == 1
        assert "timestamp" in body

    def test_zero_score_accepted(self):
        res = _submit("Alice", 0)
        assert res.status_code == 201

    def test_missing_player_name_returns_422(self):
        res = client.post("/yacht/score", json={"score": 200, "difficulty": "easy"}, headers=_HEADERS)
        assert res.status_code == 422

    def test_missing_score_returns_422(self):
        res = client.post(
            "/yacht/score", json={"player_name": "Bob", "difficulty": "easy"}, headers=_HEADERS
        )
        assert res.status_code == 422

    def test_empty_player_name_returns_422(self):
        res = _submit("", 200)
        assert res.status_code == 422

    def test_name_too_long_returns_422(self):
        res = _submit("x" * 33, 200)
        assert res.status_code == 422

    def test_negative_score_returns_422(self):
        res = _submit("Alice", -1)
        assert res.status_code == 422

    def test_invalid_difficulty_returns_422(self):
        res = client.post(
            "/yacht/score",
            json={"player_name": "Alice", "score": 200, "difficulty": "legendary"},
            headers=_HEADERS,
        )
        assert res.status_code == 422

    def test_missing_difficulty_returns_422(self):
        res = client.post(
            "/yacht/score",
            json={"player_name": "Alice", "score": 200},
            headers=_HEADERS,
        )
        assert res.status_code == 422

    def test_score_over_400_returns_422(self):
        res = _submit("Alice", 401)
        assert res.status_code == 422

    def test_difficulty_stored_and_returned(self):
        res = _submit("Alice", 200, difficulty="hard")
        assert res.status_code == 201
        assert res.json()["difficulty"] == "hard"


# ---------------------------------------------------------------------------
# Score transform
# ---------------------------------------------------------------------------


class TestScoreTransform:
    def test_raw_300_transforms_to_100(self):
        res = _submit("Alice", 300)
        assert res.status_code == 201
        body = res.json()
        assert body["raw_score"] == 300
        assert body["score"] == 100

    def test_raw_0_transforms_to_400(self):
        res = _submit("Alice", 0)
        assert res.status_code == 201
        body = res.json()
        assert body["raw_score"] == 0
        assert body["score"] == 400

    def test_transform_capped_at_400(self):
        # Any raw_score >= 400 transforms to 0 (not negative)
        res = _submit("Alice", 400)
        assert res.status_code == 201
        assert res.json()["score"] == 0

    def test_transform_appears_in_leaderboard(self):
        _submit("Alice", 300)
        scores = client.get("/yacht/scores", headers=_HEADERS).json()["scores"]
        assert scores[0]["raw_score"] == 300
        assert scores[0]["score"] == 100


# ---------------------------------------------------------------------------
# GET /yacht/scores
# ---------------------------------------------------------------------------


class TestGetScores:
    def test_empty_initially(self):
        res = client.get("/yacht/scores", headers=_HEADERS)
        assert res.status_code == 200
        assert res.json()["scores"] == []

    def test_returns_submitted_entries(self):
        _submit("Alice", 200)
        _submit("Bob", 250)
        scores = client.get("/yacht/scores", headers=_HEADERS).json()["scores"]
        assert len(scores) == 2

    def test_ordered_by_transformed_score_descending(self):
        # Lower raw score = higher transformed score = ranked first
        from limiter import limiter

        limiter.reset()
        _submit("Carol", 300)   # transformed 100
        limiter.reset()
        _submit("Alice", 100)   # transformed 300
        limiter.reset()
        _submit("Bob", 200)     # transformed 200
        scores = client.get("/yacht/scores", headers=_HEADERS).json()["scores"]
        assert [s["score"] for s in scores] == [300, 200, 100]

    def test_capped_at_ten_entries(self):
        from limiter import limiter

        for i in range(11):
            limiter.reset()
            _submit(f"Player{i}", i * 10)
        scores = client.get("/yacht/scores", headers=_HEADERS).json()["scores"]
        assert len(scores) == 10
        # Top entry: raw=0 → transformed=400
        assert scores[0]["score"] == 400
        # Lowest included: raw=90 → transformed=310; raw=100 → 300 excluded
        assert scores[-1]["score"] == 310
        assert all(s["score"] != 300 for s in scores)


# ---------------------------------------------------------------------------
# Rank in submission response
# ---------------------------------------------------------------------------


class TestSubmitRank:
    def test_first_submission_rank_1(self):
        assert _submit("Alice", 100).json()["rank"] == 1

    def test_lower_raw_score_ranked_higher(self):
        from limiter import limiter

        limiter.reset()
        _submit("Alice", 100)   # transformed 300
        limiter.reset()
        body = _submit("Bob", 200).json()   # transformed 200 → rank 2
        assert body["rank"] == 2

    def test_off_leaderboard_returns_rank_11(self):
        from limiter import limiter

        for i in range(10):
            limiter.reset()
            _submit(f"Top{i}", 0)   # all transformed to 400
        limiter.reset()
        body = _submit("Lowly", 399).json()   # transformed 1 → off board
        assert body["rank"] == 11


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
        _submit("Alice", 200)   # transformed 200, submitted first
        limiter.reset()
        _submit("Bob", 200)     # transformed 200, submitted second

        scores = client.get("/yacht/scores", headers=_HEADERS).json()["scores"]
        assert scores[0]["player_name"] == "Alice"
        assert scores[1]["player_name"] == "Bob"

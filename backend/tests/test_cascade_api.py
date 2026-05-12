"""Tests for the Cascade leaderboard API (#477).

All leaderboard entries are now created via the unified games pipeline:
  1. POST /games          → creates the game row (handled by SyncWorker in prod)
  2. PATCH /games/:id/complete → records final_score
  3. PATCH /cascade/score/:id  → sets player_name, returns rank

GET /cascade/scores remains unchanged.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory
from db.models import GameEntitlement
from main import app

client = TestClient(app)

TEST_SESSION = str(uuid.uuid4())
SESSION_HEADERS = {"X-Session-ID": TEST_SESSION}


async def _grant(session_id: str, game_slug: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug=game_slug))
        await db.commit()


@pytest.fixture(autouse=True)
async def _cascade_entitlement():
    await _grant(TEST_SESSION, "cascade")


def _create_game(session_id: str = TEST_SESSION) -> str:
    """POST /games and return the new game_id."""
    res = client.post(
        "/games",
        json={"game_type": "cascade"},
        headers={"X-Session-ID": session_id},
    )
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


def _complete_game(game_id: str, score: int, session_id: str = TEST_SESSION) -> None:
    """PATCH /games/:id/complete."""
    from limiter import limiter

    limiter.reset()
    res = client.patch(
        f"/games/{game_id}/complete",
        json={"final_score": score, "outcome": "completed"},
        headers={"X-Session-ID": session_id},
    )
    assert res.status_code == 200, res.text


def _set_name(game_id: str, player_name: str, session_id: str = TEST_SESSION):
    """PATCH /cascade/score/:id — sets player_name, returns ScoreEntry."""
    return client.patch(
        f"/cascade/score/{game_id}",
        json={"player_name": player_name},
        headers={"X-Session-ID": session_id},
    )


def _submit(player_name: str, score: int, session_id: str = TEST_SESSION):
    """Create + complete + name a game in one call. Returns the PATCH response."""
    from limiter import limiter

    limiter.reset()
    gid = _create_game(session_id)
    _complete_game(gid, score, session_id)
    return _set_name(gid, player_name, session_id)


# ---------------------------------------------------------------------------
# PATCH /cascade/score/{game_id}
# ---------------------------------------------------------------------------


class TestSetPlayerName:
    def test_valid_update_returns_200_with_score_entry(self):
        gid = _create_game()
        _complete_game(gid, 500)
        res = _set_name(gid, "Alice")
        assert res.status_code == 200
        body = res.json()
        assert body["player_name"] == "Alice"
        assert body["score"] == 500
        assert body["rank"] == 1

    def test_missing_player_name_returns_422(self):
        gid = _create_game()
        _complete_game(gid, 100)
        res = client.patch(
            f"/cascade/score/{gid}",
            json={},
            headers=SESSION_HEADERS,
        )
        assert res.status_code == 422

    def test_empty_player_name_returns_422(self):
        gid = _create_game()
        _complete_game(gid, 100)
        res = _set_name(gid, "")
        assert res.status_code == 422

    def test_unknown_game_id_returns_404(self):
        unknown_id = str(uuid.uuid4())
        res = _set_name(unknown_id, "Alice")
        assert res.status_code == 404

    async def test_wrong_session_returns_404(self):
        other_a = str(uuid.uuid4())
        other_b = str(uuid.uuid4())
        await _grant(other_a, "cascade")
        await _grant(other_b, "cascade")
        gid = _create_game(session_id=other_a)
        res = _set_name(gid, "Alice", session_id=other_b)
        assert res.status_code == 404

    def test_missing_session_header_returns_400(self):
        gid = _create_game()
        _complete_game(gid, 100)
        res = client.patch(f"/cascade/score/{gid}", json={"player_name": "Alice"})
        assert res.status_code == 400

    def test_can_update_player_name_on_already_named_game(self):
        gid = _create_game()
        _complete_game(gid, 200)
        _set_name(gid, "Alice")
        res = _set_name(gid, "AliceUpdated")
        assert res.status_code == 200
        assert res.json()["player_name"] == "AliceUpdated"


# ---------------------------------------------------------------------------
# GET /cascade/scores
# ---------------------------------------------------------------------------


class TestGetScores:
    def test_empty_initially(self):
        res = client.get("/cascade/scores", headers=SESSION_HEADERS)
        assert res.status_code == 200
        assert res.json()["scores"] == []

    def test_returns_submitted_entries(self):
        _submit("Alice", 300)
        _submit("Bob", 100)
        res = client.get("/cascade/scores", headers=SESSION_HEADERS)
        scores = res.json()["scores"]
        assert len(scores) == 2

    def test_ordered_by_score_descending(self):
        _submit("Alice", 100)
        _submit("Bob", 500)
        _submit("Carol", 250)
        scores = client.get("/cascade/scores", headers=SESSION_HEADERS).json()["scores"]
        assert scores[0]["score"] == 500
        assert scores[1]["score"] == 250
        assert scores[2]["score"] == 100

    def test_capped_at_ten_entries(self):
        from limiter import limiter

        for i in range(15):
            limiter.reset()
            _submit(f"Player{i}", i * 10)
        scores = client.get("/cascade/scores", headers=SESSION_HEADERS).json()["scores"]
        assert len(scores) == 10
        assert scores[0]["score"] == 140


# ---------------------------------------------------------------------------
# Rank in submission response
# ---------------------------------------------------------------------------


class TestSubmitRank:
    def test_first_submission_rank_1(self):
        assert _submit("Alice", 500).json()["rank"] == 1

    def test_lower_score_ranked_lower(self):
        _submit("Alice", 500)
        body = _submit("Bob", 200).json()
        assert body["rank"] == 2

    def test_highest_score_takes_rank_1(self):
        _submit("Alice", 200)
        body = _submit("Bob", 500).json()
        assert body["rank"] == 1

    def test_middle_insert(self):
        for name, score in [("A", 500), ("B", 300), ("C", 100)]:
            _submit(name, score)
        body = _submit("Middle", 400).json()
        assert body["rank"] == 2

    def test_new_tie_ranks_below_existing(self):
        _submit("Alice", 500)
        body = _submit("Tied", 500).json()
        assert body["rank"] == 2

    def test_off_leaderboard_returns_rank_11(self):
        for i in range(10):
            _submit(f"Top{i}", 1000)
        body = _submit("Lowly", 1).json()
        assert body["rank"] == 11

    def test_middle_insert_renumbers_tail(self):
        for name, score in [("A", 500), ("B", 300), ("C", 100)]:
            _submit(name, score)
        _submit("Middle", 400)
        scores = client.get("/cascade/scores", headers=SESSION_HEADERS).json()["scores"]
        ranks_by_name = {s["player_name"]: s["rank"] for s in scores}
        assert ranks_by_name == {"A": 1, "Middle": 2, "B": 3, "C": 4}

    def test_leaderboard_returns_sequential_ranks(self):
        for name, score in [("A", 500), ("B", 300), ("C", 100)]:
            _submit(name, score)
        scores = client.get("/cascade/scores", headers=SESSION_HEADERS).json()["scores"]
        assert [s["rank"] for s in scores] == [1, 2, 3]


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------


class TestRateLimit:
    def test_eleventh_set_name_returns_429(self):
        """PATCH /cascade/score/:id is limited to 10/minute per (session, URL).

        slowapi uses URL-based key scoping by default, so the bucket is keyed
        on (session_id, /cascade/score/<game_id>). We exhaust the limit by
        calling set_name 11 times on the *same* game ID.
        """
        from limiter import limiter

        limiter.reset()
        gid = _create_game()
        _complete_game(gid, 100)
        limiter.reset()

        # First 10 set-name calls on the same game should succeed
        for i in range(10):
            res = _set_name(gid, f"Player{i}")
            assert res.status_code == 200, f"call {i+1} returned {res.status_code}"

        # 11th on the same URL should be rate-limited
        res = _set_name(gid, "Excess")
        assert res.status_code == 429

        limiter.reset()


# ---------------------------------------------------------------------------
# Tie-break ordering
# ---------------------------------------------------------------------------


class TestTieBreak:
    def test_older_score_ranks_higher_on_tie(self):
        _submit("Alice", 100)
        _submit("Bob", 100)
        scores = client.get("/cascade/scores", headers=SESSION_HEADERS).json()["scores"]
        assert scores[0]["player_name"] == "Alice"
        assert scores[1]["player_name"] == "Bob"

    def test_new_tie_response_rank_is_2(self):
        _submit("Alice", 100)
        body = _submit("Bob", 100).json()
        assert body["rank"] == 2


# ---------------------------------------------------------------------------
# Duplicate player names
# ---------------------------------------------------------------------------


class TestDuplicateNames:
    def test_duplicate_name_both_entries_kept(self):
        _submit("Alice", 100)
        _submit("Alice", 200)
        scores = client.get("/cascade/scores", headers=SESSION_HEADERS).json()["scores"]
        alice_entries = [s for s in scores if s["player_name"] == "Alice"]
        assert len(alice_entries) == 2

    def test_duplicate_name_ordered_by_score(self):
        _submit("Alice", 100)
        _submit("Alice", 200)
        scores = client.get("/cascade/scores", headers=SESSION_HEADERS).json()["scores"]
        alice_scores = [s["score"] for s in scores if s["player_name"] == "Alice"]
        assert alice_scores == [200, 100]

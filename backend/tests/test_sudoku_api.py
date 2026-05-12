"""Tests for /sudoku/score and /sudoku/scores/{difficulty} (#615, #901).

All leaderboard entries are now created via the unified games pipeline:
  1. POST /games          → creates the game row (handled by SyncWorker in prod)
  2. PATCH /games/:id/complete → records final_score
  3. PATCH /sudoku/score/:id  → sets player_name, returns rank

GET /sudoku/scores/{difficulty} remains unchanged.
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
async def _sudoku_entitlement():
    await _grant(TEST_SESSION, "sudoku")


def _create_game(
    difficulty: str = "easy", variant: str = "classic", session_id: str = TEST_SESSION
) -> str:
    """POST /games and return the new game_id."""
    res = client.post(
        "/games",
        json={"game_type": "sudoku", "metadata": {"difficulty": difficulty, "variant": variant}},
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
    """PATCH /sudoku/score/:id — sets player_name, returns ScoreEntry."""
    return client.patch(
        f"/sudoku/score/{game_id}",
        json={"player_name": player_name},
        headers={"X-Session-ID": session_id},
    )


def _submit(
    player_name: str,
    score: int,
    difficulty: str = "easy",
    variant: str = "classic",
    session_id: str = TEST_SESSION,
):
    """Create + complete + name a game in one call. Returns the PATCH response."""
    from limiter import limiter

    limiter.reset()
    gid = _create_game(difficulty, variant, session_id)
    _complete_game(gid, score, session_id)
    return _set_name(gid, player_name, session_id)


# ---------------------------------------------------------------------------
# PATCH /sudoku/score/{game_id}
# ---------------------------------------------------------------------------


class TestSetPlayerName:
    def test_valid_update_returns_200_with_score_entry(self):
        gid = _create_game()
        _complete_game(gid, 80)
        res = _set_name(gid, "Alice")
        assert res.status_code == 200
        body = res.json()
        assert body["player_name"] == "Alice"
        assert body["score"] == 80
        assert body["rank"] == 1

    def test_missing_player_name_returns_422(self):
        gid = _create_game()
        _complete_game(gid, 100)
        res = client.patch(
            f"/sudoku/score/{gid}",
            json={},
            headers=SESSION_HEADERS,
        )
        assert res.status_code == 422

    def test_empty_player_name_returns_422(self):
        gid = _create_game()
        _complete_game(gid, 100)
        assert _set_name(gid, "").status_code == 422

    def test_name_too_long_returns_422(self):
        gid = _create_game()
        _complete_game(gid, 100)
        assert _set_name(gid, "x" * 33).status_code == 422

    def test_unknown_game_id_returns_404(self):
        res = client.patch(
            f"/sudoku/score/{uuid.uuid4()}",
            json={"player_name": "Ghost"},
            headers=SESSION_HEADERS,
        )
        assert res.status_code == 404

    async def test_wrong_session_returns_403(self):
        """A game owned by session A must not be claimable by session B."""
        other_session = str(uuid.uuid4())
        await _grant(other_session, "sudoku")
        gid = _create_game(session_id=other_session)
        _complete_game(gid, 200, session_id=other_session)
        res = client.patch(
            f"/sudoku/score/{gid}",
            json={"player_name": "Thief"},
            headers=SESSION_HEADERS,
        )
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# GET /sudoku/scores/{difficulty}
# ---------------------------------------------------------------------------


class TestGetScores:
    def test_empty_initially(self):
        res = client.get("/sudoku/scores/easy", headers=SESSION_HEADERS)
        assert res.status_code == 200
        assert res.json()["scores"] == []

    def test_returns_submitted_entries_for_difficulty(self):
        _submit("Alice", 90, "easy")
        _submit("Bob", 60, "easy")
        scores = client.get("/sudoku/scores/easy", headers=SESSION_HEADERS).json()["scores"]
        assert len(scores) == 2

    def test_ordered_by_score_descending(self):
        from limiter import limiter

        limiter.reset()
        _submit("Alice", 40, "medium")
        limiter.reset()
        _submit("Bob", 180, "medium")
        limiter.reset()
        _submit("Carol", 120, "medium")
        scores = client.get("/sudoku/scores/medium", headers=SESSION_HEADERS).json()["scores"]
        assert [s["score"] for s in scores] == [180, 120, 40]

    def test_invalid_difficulty_path_returns_422(self):
        assert client.get("/sudoku/scores/impossible", headers=SESSION_HEADERS).status_code == 422

    def test_capped_at_ten_entries(self):
        from limiter import limiter

        for i in range(15):
            limiter.reset()
            _submit(f"Player{i}", i * 10, "hard")
        scores = client.get("/sudoku/scores/hard", headers=SESSION_HEADERS).json()["scores"]
        assert len(scores) == 10
        assert scores[0]["score"] == 140


# ---------------------------------------------------------------------------
# Difficulty isolation — the critical contract
# ---------------------------------------------------------------------------


class TestDifficultyIsolation:
    def test_easy_submission_absent_from_hard(self):
        _submit("EasyPlayer", 100, "easy")
        hard = client.get("/sudoku/scores/hard", headers=SESSION_HEADERS).json()["scores"]
        assert hard == []

    def test_hard_submission_absent_from_easy(self):
        _submit("HardPlayer", 290, "hard")
        easy = client.get("/sudoku/scores/easy", headers=SESSION_HEADERS).json()["scores"]
        assert easy == []

    def test_three_tiers_kept_separate(self):
        from limiter import limiter

        limiter.reset()
        _submit("E", 100, "easy")
        limiter.reset()
        _submit("M", 200, "medium")
        limiter.reset()
        _submit("H", 300, "hard")

        easy = client.get("/sudoku/scores/easy", headers=SESSION_HEADERS).json()["scores"]
        medium = client.get("/sudoku/scores/medium", headers=SESSION_HEADERS).json()["scores"]
        hard = client.get("/sudoku/scores/hard", headers=SESSION_HEADERS).json()["scores"]

        assert [s["player_name"] for s in easy] == ["E"]
        assert [s["player_name"] for s in medium] == ["M"]
        assert [s["player_name"] for s in hard] == ["H"]


# ---------------------------------------------------------------------------
# Rank semantics
# ---------------------------------------------------------------------------


class TestSubmitRank:
    def test_first_submission_rank_1(self):
        assert _submit("Alice", 90, "easy").json()["rank"] == 1

    def test_off_leaderboard_returns_rank_11(self):
        from limiter import limiter

        for i in range(10):
            limiter.reset()
            _submit(f"Top{i}", 1000, "medium")
        limiter.reset()
        assert _submit("Lowly", 1, "medium").json()["rank"] == 11


# ---------------------------------------------------------------------------
# Rate limiter — PATCH /sudoku/score/{game_id} is 10/min
# ---------------------------------------------------------------------------


class TestRateLimit:
    def test_eleventh_set_name_returns_429(self):
        """PATCH /sudoku/score/:id is limited to 10/minute per (session, URL).

        slowapi buckets on (session_id, URL), so we exhaust the limit by
        calling set_name 11 times on the *same* game ID.
        """
        from limiter import limiter

        limiter.reset()
        gid = _create_game("easy")
        _complete_game(gid, 100)
        limiter.reset()

        for i in range(10):
            res = _set_name(gid, f"Player{i}")
            assert res.status_code == 200, f"call {i + 1} returned {res.status_code}"

        res = _set_name(gid, "Excess")
        assert res.status_code == 429

        limiter.reset()

"""Tests for /starswarm/score and /starswarm/leaderboard (#898).

DB-backed leaderboard — mirrors solitaire/cascade pattern. The autouse
_clean_db_tables fixture in conftest.py handles per-test DB isolation.
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import starswarm.router as starswarm_router_module
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
async def _starswarm_entitlement():
    await _grant(_SID, "starswarm")


@pytest.fixture(autouse=True)
def reset_leaderboard():
    starswarm_router_module.reset_leaderboard()
    yield
    starswarm_router_module.reset_leaderboard()


def _submit(player_id: str, score: int, wave_reached: int = 1):
    return client.post(
        "/starswarm/score",
        json={"player_id": player_id, "score": score, "wave_reached": wave_reached},
        headers=_HEADERS,
    )


# ---------------------------------------------------------------------------
# POST /starswarm/score
# ---------------------------------------------------------------------------


class TestSubmitScore:
    def test_valid_submission_returns_200(self):
        res = _submit("alice", 500, wave_reached=3)
        assert res.status_code == 200
        body = res.json()
        assert "scores" in body
        assert body["scores"][0]["player_id"] == "alice"
        assert body["scores"][0]["score"] == 500
        assert body["scores"][0]["wave_reached"] == 3
        assert body["scores"][0]["rank"] == 1

    def test_missing_player_id_returns_422(self):
        res = client.post(
            "/starswarm/score", json={"score": 100, "wave_reached": 1}, headers=_HEADERS
        )
        assert res.status_code == 422

    def test_missing_score_returns_422(self):
        res = client.post(
            "/starswarm/score", json={"player_id": "alice", "wave_reached": 1}, headers=_HEADERS
        )
        assert res.status_code == 422

    def test_missing_wave_reached_returns_422(self):
        res = client.post(
            "/starswarm/score", json={"player_id": "alice", "score": 100}, headers=_HEADERS
        )
        assert res.status_code == 422

    def test_empty_player_id_returns_422(self):
        res = _submit("", 100)
        assert res.status_code == 422

    def test_negative_score_returns_422(self):
        res = _submit("alice", -1)
        assert res.status_code == 422

    def test_zero_wave_reached_returns_422(self):
        res = client.post(
            "/starswarm/score",
            json={"player_id": "alice", "score": 0, "wave_reached": 0},
            headers=_HEADERS,
        )
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# GET /starswarm/leaderboard
# ---------------------------------------------------------------------------


class TestGetLeaderboard:
    def test_empty_initially(self):
        res = client.get("/starswarm/leaderboard", headers=_HEADERS)
        assert res.status_code == 200
        assert res.json()["scores"] == []

    def test_returns_submitted_entries(self):
        _submit("alice", 300)
        _submit("bob", 100)
        scores = client.get("/starswarm/leaderboard", headers=_HEADERS).json()["scores"]
        assert len(scores) == 2

    def test_ordered_descending_by_score(self):
        from limiter import limiter

        _submit("alice", 100)
        limiter.reset()
        _submit("bob", 500)
        limiter.reset()
        _submit("carol", 250)
        scores = client.get("/starswarm/leaderboard", headers=_HEADERS).json()["scores"]
        assert [s["score"] for s in scores] == [500, 250, 100]
        assert scores[0]["rank"] == 1

    def test_capped_at_ten_entries(self):
        from limiter import limiter

        for i in range(15):
            limiter.reset()
            _submit(f"player{i}", (i + 1) * 10)
        scores = client.get("/starswarm/leaderboard", headers=_HEADERS).json()["scores"]
        assert len(scores) == 10
        assert scores[0]["score"] == 150  # highest score first

    def test_wave_reached_preserved(self):
        _submit("alice", 200, wave_reached=7)
        scores = client.get("/starswarm/leaderboard", headers=_HEADERS).json()["scores"]
        assert scores[0]["wave_reached"] == 7


# ---------------------------------------------------------------------------
# Tie-break ordering — older entry wins
# ---------------------------------------------------------------------------


class TestTieBreak:
    def test_older_entry_ranks_higher_on_tie(self):
        from limiter import limiter

        _submit("alice", 100)
        limiter.reset()
        _submit("bob", 100)

        scores = client.get("/starswarm/leaderboard", headers=_HEADERS).json()["scores"]
        assert scores[0]["player_id"] == "alice"
        assert scores[1]["player_id"] == "bob"


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


class TestRateLimit:
    def test_eleventh_submission_returns_429(self):
        from limiter import limiter

        for i in range(10):
            assert _submit(f"player{i}", i + 1).status_code == 200

        res = _submit("excess", 999)
        assert res.status_code == 429
        assert "Retry-After" in res.headers
        limiter.reset()

    def test_leaderboard_get_not_rate_limited_at_low_volume(self):
        for _ in range(5):
            assert client.get("/starswarm/leaderboard", headers=_HEADERS).status_code == 200


# ---------------------------------------------------------------------------
# Async unit tests for internal helpers — covers branches the HTTP layer
# cannot exercise (missing game_type) and ensures _top10 loop coverage.
# asyncio_mode = "auto" (pyproject.toml) runs these natively in the event loop.
# ---------------------------------------------------------------------------


class TestInternalHelpers:
    async def test_game_type_id_raises_500_when_missing(self):
        """Lines 49-54: HTTPException(500) when starswarm GameType absent from DB."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_session = AsyncMock()
        mock_session.execute.return_value = mock_result

        with pytest.raises(HTTPException) as exc_info:
            await starswarm_router_module._starswarm_game_type_id(mock_session)

        assert exc_info.value.status_code == 500
        assert "missing" in exc_info.value.detail

    async def test_top10_returns_leaderboard_entries(self):
        """Lines 74-86: _top10 correctly builds LeaderboardEntry list from DB rows."""
        mock_game = MagicMock()
        mock_game.final_score = 750
        mock_game.game_metadata = {"player_name": "tester", "wave_reached": 5}
        mock_game.completed_at = datetime(2024, 1, 1, tzinfo=timezone.utc)

        mock_scalars = MagicMock()
        mock_scalars.all.return_value = [mock_game]
        mock_execute_result = MagicMock()
        mock_execute_result.scalars.return_value = mock_scalars

        mock_session = AsyncMock()
        mock_session.execute.return_value = mock_execute_result

        with patch.object(
            starswarm_router_module, "_starswarm_game_type_id", AsyncMock(return_value=1)
        ):
            entries = await starswarm_router_module._top10(mock_session)

        assert len(entries) == 1
        assert entries[0].player_id == "tester"
        assert entries[0].score == 750
        assert entries[0].wave_reached == 5
        assert entries[0].rank == 1
        assert "2024" in entries[0].timestamp

    async def test_top10_falls_back_on_missing_metadata(self):
        """Lines 76-84: _top10 defaults player_id='anon', wave_reached=1 when metadata absent."""
        mock_game = MagicMock()
        mock_game.final_score = 100
        mock_game.game_metadata = {}
        mock_game.completed_at = datetime(2024, 6, 1, tzinfo=timezone.utc)

        mock_scalars = MagicMock()
        mock_scalars.all.return_value = [mock_game]
        mock_execute_result = MagicMock()
        mock_execute_result.scalars.return_value = mock_scalars

        mock_session = AsyncMock()
        mock_session.execute.return_value = mock_execute_result

        with patch.object(
            starswarm_router_module, "_starswarm_game_type_id", AsyncMock(return_value=1)
        ):
            entries = await starswarm_router_module._top10(mock_session)

        assert entries[0].player_id == "anon"
        assert entries[0].wave_reached == 1

    async def test_top10_empty_when_no_rows(self):
        """Lines 74-86: _top10 returns [] when DB has no scores."""
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_execute_result = MagicMock()
        mock_execute_result.scalars.return_value = mock_scalars

        mock_session = AsyncMock()
        mock_session.execute.return_value = mock_execute_result

        with patch.object(
            starswarm_router_module, "_starswarm_game_type_id", AsyncMock(return_value=1)
        ):
            entries = await starswarm_router_module._top10(mock_session)

        assert entries == []

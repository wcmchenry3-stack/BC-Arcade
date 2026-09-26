"""Completions from older builds store a certain win as ``win`` (#2703).

Builds before #2627 / #2628 / #2631 are still installed and keep completing
Mahjong, Blackjack and Twenty48 games as ``completed`` / ``kept_playing``.
``complete_game`` applies the same rules migration 0028 applied to the rows
stored before it (``games.legacy_outcomes``), so those wins count from now on
too. Current builds' payloads are stored exactly as sent.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from games.legacy_outcomes import might_be_legacy_win
from tests.test_generic_leaderboard import _grant_all, _headers, _sid

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)

_FRESH_BOARD = [2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]
_WON_BOARD = [2048, 512, 64, 8, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]


@pytest.fixture()
def client() -> Iterator[TestClient]:
    from main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
async def sid() -> str:
    sid = _sid()
    await _grant_all(sid)
    return sid


def _play(
    client: TestClient,
    sid: str,
    game_type: str,
    body: dict,
    *,
    metadata: dict | None = None,
    initial_board: list | None = None,
) -> tuple[dict, dict]:
    """Create, send the game_started event if any, complete; ``(PATCH body, GET row)``."""
    r = client.post(
        "/games",
        headers=_headers(sid),
        json={"game_type": game_type, "metadata": metadata or {}},
    )
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    if initial_board is not None:
        r = client.post(
            f"/games/{gid}/events",
            headers=_headers(sid),
            json={
                "events": [
                    {
                        "event_index": 0,
                        "event_type": "game_started",
                        "data": {"initial_board": initial_board},
                    }
                ]
            },
        )
        assert r.status_code == 200, r.text
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    row = client.get(f"/games/{gid}", headers=_headers(sid)).json()
    return r.json(), row


def _t48(outcome: str, tile: int) -> dict:
    result = {"final_score": 20_480, "highest_tile": tile, "move_count": 900, "outcome": outcome}
    return {"final_score": 20_480, "outcome": outcome, "duration_ms": 60_000, "result": result}


def _mahjong(outcome: str, won: bool) -> dict:
    return {
        "final_score": 1220 if won else 300,
        "outcome": outcome,
        "duration_ms": 60_000,
        "result": {"won": won, "pairs": 72 if won else 30},
    }


def _blackjack(outcome: str, final_chips: int) -> dict:
    return {
        "final_score": final_chips,
        "outcome": outcome,
        "duration_ms": 60_000,
        "result": {
            "hands_won": 3,
            "hands_played": 5,
            "starting_chips": 1000,
            "final_chips": final_chips,
        },
    }


# ---------------------------------------------------------------------------
# older builds' certain wins become win
# ---------------------------------------------------------------------------


async def test_an_older_mahjong_cleared_board_is_stored_as_a_win(
    client: TestClient, sid: str
) -> None:
    state, row = _play(client, sid, "mahjong", _mahjong("completed", True))
    assert state["outcome"] == "win"
    assert row["outcome"] == "win"
    assert row["metadata"] == {"won": True, "pairs": 72}


async def test_an_older_blackjack_cash_out_is_stored_as_a_win(client: TestClient, sid: str) -> None:
    _, row = _play(client, sid, "blackjack", _blackjack("completed", 1500))
    assert row["outcome"] == "win"


async def test_an_older_twenty48_first_2048_is_stored_as_a_win(
    client: TestClient, sid: str
) -> None:
    _, row = _play(client, sid, "twenty48", _t48("kept_playing", 2048), initial_board=_FRESH_BOARD)
    assert row["outcome"] == "win"
    # The result block's own outcome agrees with the row.
    assert row["metadata"]["outcome"] == "win"
    assert row["metadata"]["highest_tile"] == 2048


async def test_stats_count_an_older_builds_wins(client: TestClient, sid: str) -> None:
    _play(client, sid, "mahjong", _mahjong("completed", True))
    _play(client, sid, "mahjong", _mahjong("completed", False))
    _play(client, sid, "blackjack", _blackjack("completed", 1500))
    _play(client, sid, "blackjack", _blackjack("completed", 0))
    by_game = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]
    assert (by_game["mahjong"]["won"], by_game["mahjong"]["lost"]) == (1, 0)
    assert (by_game["blackjack"]["won"], by_game["blackjack"]["lost"]) == (1, 0)


# ---------------------------------------------------------------------------
# anything short of certain stays as sent
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("game_type", "body", "board"),
    [
        pytest.param("mahjong", _mahjong("completed", False), None, id="mahjong-not-cleared"),
        pytest.param("blackjack", _blackjack("completed", 0), None, id="blackjack-bust"),
        pytest.param(
            "twenty48", _t48("kept_playing", 2048), _WON_BOARD, id="twenty48-board-already-won"
        ),
        pytest.param("twenty48", _t48("completed", 4096), _WON_BOARD, id="twenty48-later-over"),
        pytest.param("twenty48", _t48("kept_playing", 2048), None, id="twenty48-no-start-event"),
        pytest.param("twenty48", _t48("completed", 1024), _FRESH_BOARD, id="twenty48-below-2048"),
    ],
)
async def test_an_older_build_finish_that_is_not_a_certain_win_is_unchanged(
    client: TestClient, sid: str, game_type: str, body: dict, board: list | None
) -> None:
    _, row = _play(client, sid, game_type, body, initial_board=board)
    assert row["outcome"] == body["outcome"]
    assert row["metadata"] == body["result"]


# ---------------------------------------------------------------------------
# current builds are stored exactly as sent
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("game_type", "body"),
    [
        pytest.param("mahjong", _mahjong("win", True), id="mahjong-win"),
        pytest.param("mahjong", _mahjong("loss", False), id="mahjong-loss"),
        pytest.param("mahjong", _mahjong("abandoned", True), id="mahjong-abandoned"),
        pytest.param("blackjack", _blackjack("win", 2700), id="blackjack-win"),
        pytest.param("blackjack", _blackjack("loss", 0), id="blackjack-loss"),
        pytest.param("blackjack", _blackjack("abandoned", 800), id="blackjack-abandoned"),
        pytest.param("twenty48", _t48("win", 2048), id="twenty48-win"),
        pytest.param("twenty48", _t48("loss", 512), id="twenty48-loss"),
    ],
)
async def test_current_build_completions_are_unchanged(
    client: TestClient, sid: str, game_type: str, body: dict
) -> None:
    _, row = _play(client, sid, game_type, body, initial_board=_FRESH_BOARD)
    assert row["outcome"] == body["outcome"]
    assert row["metadata"] == body["result"]


async def test_other_games_are_never_rewritten(client: TestClient, sid: str) -> None:
    body = {"outcome": "completed", "result": {"won": True, "moves": 87}}
    _, row = _play(client, sid, "solitaire", body)
    assert row["outcome"] == "completed"


def test_only_legacy_outcomes_of_the_three_games_are_checked() -> None:
    assert might_be_legacy_win("mahjong", "completed")
    assert might_be_legacy_win("twenty48", "kept_playing")
    assert might_be_legacy_win("blackjack", "completed")
    assert not might_be_legacy_win("mahjong", "win")
    assert not might_be_legacy_win("blackjack", "kept_playing")
    assert not might_be_legacy_win("solitaire", "completed")
    assert not might_be_legacy_win("twenty48", None)


async def test_only_the_completed_row_is_rewritten(client: TestClient, sid: str) -> None:
    """The statement is scoped to the game being completed: another stored row
    that matches the rule (the migration's job) is left alone."""
    from datetime import datetime, timezone

    from sqlalchemy import select

    from db.base import get_session_factory
    from db.models import Game, GameType

    async with get_session_factory()() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == "mahjong"))
        ).scalar_one()
        stored = Game(
            session_id=str(uuid.uuid4()),
            game_type_id=gt_id,
            completed_at=datetime(2026, 9, 1, tzinfo=timezone.utc),
            outcome="completed",
            game_metadata={"won": True, "pairs": 72},
        )
        db.add(stored)
        await db.commit()
        stored_id = stored.id

    _, row = _play(client, sid, "mahjong", _mahjong("completed", True))
    assert row["outcome"] == "win"
    async with get_session_factory()() as db:
        outcome = (await db.execute(select(Game.outcome).where(Game.id == stored_id))).scalar_one()
    assert outcome == "completed"

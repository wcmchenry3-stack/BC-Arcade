"""The final leaderboard tie-break is the server's receipt time (#2765).

``completed_at`` is reported by the device and accepted anywhere in
[now - 1 year, now + 24 h], so a slow clock or a forged request used to win
every tie. Ties now go to the completion the server received first
(``games.received_at``), falling back to ``completed_at`` for a row without one.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory
from db.models import Game
from tests._helpers import session_headers as _headers
from tests.test_generic_leaderboard import (
    _board,
    _game_type_id,
    _grant_all,
    _set_name,
    _sid,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)

SCORE = 640
NOW = datetime.now(UTC)


async def _complete_via_api(
    client: TestClient, name: str, *, completed_at: datetime | None, score: int = SCORE
) -> tuple[str, str]:
    """Create and complete a Solitaire game through the API; returns (sid, game id)."""
    sid = _sid()
    await _grant_all(sid)
    await _set_name(sid, name)
    r = client.post("/games", headers=_headers(sid), json={"game_type": "solitaire"})
    assert r.status_code == 200, r.text
    game_id = r.json()["id"]
    body: dict = {"final_score": score, "outcome": "completed"}
    if completed_at is not None:
        body["completed_at"] = completed_at.isoformat()
    r = client.patch(f"/games/{game_id}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    return sid, game_id


async def _insert(
    sid: str,
    *,
    score: int,
    completed_at: datetime,
    received_at: datetime | None,
) -> uuid.UUID:
    game_id = uuid.uuid4()
    gt_id = await _game_type_id("solitaire")
    async with get_session_factory()() as db:
        db.add(
            Game(
                id=game_id,
                session_id=sid,
                game_type_id=gt_id,
                game_metadata={},
                players=[],
                final_score=score,
                outcome="completed",
                started_at=completed_at - timedelta(seconds=30),
                completed_at=completed_at,
                received_at=received_at,
            )
        )
        await db.commit()
    return game_id


def _order(body: dict, *names: str) -> list[str]:
    return [e["player_name"] for e in body["entries"] if e["player_name"] in names]


async def test_slow_device_clock_does_not_win_the_tie(client: TestClient) -> None:
    await _complete_via_api(client, "Rcv Fast B", completed_at=None)
    # Completed second, but the device clock says three days ago.
    await _complete_via_api(client, "Rcv Slow A", completed_at=NOW - timedelta(days=3))
    body = _board(client, "solitaire?limit=100")
    assert _order(body, "Rcv Fast B", "Rcv Slow A") == ["Rcv Fast B", "Rcv Slow A"]


async def test_forged_year_old_timestamp_loses_the_tie(client: TestClient) -> None:
    await _complete_via_api(client, "Rcv Honest", completed_at=None)
    await _complete_via_api(client, "Rcv Forger", completed_at=NOW - timedelta(days=360))
    body = _board(client, "solitaire?limit=100")
    assert _order(body, "Rcv Honest", "Rcv Forger") == ["Rcv Honest", "Rcv Forger"]


async def test_complete_stamps_server_time_not_the_device_time(client: TestClient) -> None:
    _, game_id = await _complete_via_api(client, "Rcv Stamp", completed_at=NOW - timedelta(days=3))
    async with get_session_factory()() as db:
        game = await db.get(Game, uuid.UUID(game_id))
        assert game is not None and game.received_at is not None
        assert game.completed_at is not None
        received = game.received_at.replace(tzinfo=UTC)
        assert abs(received - datetime.now(UTC)) < timedelta(minutes=1)
        assert received - game.completed_at.replace(tzinfo=UTC) > timedelta(days=2)


async def test_received_order_wins_when_completed_at_is_reversed(client: TestClient) -> None:
    first, second = _sid(), _sid()
    await _set_name(first, "Rcv First")
    await _set_name(second, "Rcv Second")
    base = NOW - timedelta(hours=2)
    # "Second" claims the earlier completion but arrived later.
    await _insert(first, score=SCORE, completed_at=base + timedelta(hours=1), received_at=base)
    await _insert(
        second, score=SCORE, completed_at=base - timedelta(days=5), received_at=base + timedelta(1)
    )
    body = _board(client, "solitaire?limit=100", first)
    assert _order(body, "Rcv First", "Rcv Second") == ["Rcv First", "Rcv Second"]


async def test_received_order_wins_when_completed_at_is_equal(client: TestClient) -> None:
    a, b = _sid(), _sid()
    await _set_name(a, "Rcv Eq Late")
    await _set_name(b, "Rcv Eq Early")
    same = NOW - timedelta(hours=3)
    await _insert(a, score=SCORE, completed_at=same, received_at=same + timedelta(minutes=5))
    await _insert(b, score=SCORE, completed_at=same, received_at=same + timedelta(minutes=1))
    body = _board(client, "solitaire?limit=100")
    assert _order(body, "Rcv Eq Late", "Rcv Eq Early") == ["Rcv Eq Early", "Rcv Eq Late"]


async def test_row_without_received_at_falls_back_to_completed_at(client: TestClient) -> None:
    a, b = _sid(), _sid()
    await _set_name(a, "Rcv Legacy Late")
    await _set_name(b, "Rcv Legacy Early")
    t = NOW - timedelta(days=30)
    await _insert(a, score=SCORE, completed_at=t + timedelta(hours=1), received_at=None)
    await _insert(b, score=SCORE, completed_at=t, received_at=None)
    body = _board(client, "solitaire?limit=100")
    assert _order(body, "Rcv Legacy Late", "Rcv Legacy Early") == [
        "Rcv Legacy Early",
        "Rcv Legacy Late",
    ]


async def test_best_row_per_player_uses_the_receipt_key(client: TestClient) -> None:
    """Two equal-score rows for one player: the one received first is the entry,
    wherever the device clock put the other."""
    me, rival = _sid(), _sid()
    await _grant_all(me)
    await _set_name(me, "Rcv Me")
    await _set_name(rival, "Rcv Rival")
    base = NOW - timedelta(hours=5)
    # Rival is received between my two rows.
    await _insert(me, score=SCORE, completed_at=base - timedelta(days=9), received_at=base)
    await _insert(
        rival,
        score=SCORE,
        completed_at=base + timedelta(hours=1),
        received_at=base + timedelta(hours=1),
    )
    keep = await _insert(
        me,
        score=SCORE,
        completed_at=base - timedelta(days=300),
        received_at=base + timedelta(hours=2),
    )
    body = _board(client, "solitaire?limit=100", me)
    assert _order(body, "Rcv Me", "Rcv Rival") == ["Rcv Me", "Rcv Rival"]
    mine = [e for e in body["entries"] if e["player_name"] == "Rcv Me"]
    assert len(mine) == 1
    # The kept row is the earliest received, not the one with the oldest completed_at.
    assert not mine[0]["completed_at"].startswith(str((base - timedelta(days=300)).year) + "-")
    assert keep is not None


async def test_me_rank_and_game_rank_agree_with_the_list(client: TestClient) -> None:
    early, late = _sid(), _sid()
    await _grant_all(early)
    await _grant_all(late)
    await _set_name(early, "Rcv Rank Early")
    await _set_name(late, "Rcv Rank Late")
    base = NOW - timedelta(hours=7)
    # "Late" forged an old device time but was received after "Early".
    await _insert(early, score=SCORE, completed_at=base, received_at=base)
    late_game = await _insert(
        late,
        score=SCORE,
        completed_at=base - timedelta(days=200),
        received_at=base + timedelta(hours=1),
    )
    body = _board(client, "solitaire?limit=100", late)
    listed = {e["player_name"]: e["rank"] for e in body["entries"]}
    assert listed["Rcv Rank Early"] < listed["Rcv Rank Late"]
    r = client.get(f"/games/{late_game}/rank", headers=_headers(late))
    assert r.status_code == 200, r.text
    assert r.json()["rank"] == listed["Rcv Rank Late"]

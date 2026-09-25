"""Stale-session sweep (#2621): games left open > 24 h are closed as abandoned.

The sweep runs on read, per player, at the start of ``/stats/me`` and
``/games/me``. A real completion that arrives later replaces the swept values.
"""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select, text

from db.base import get_engine, get_session_factory, is_configured
from db.models import Game, GameType
from games import service
from games.service import STALE_GAME_AFTER, sweep_stale_games

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping stale-sweep tests",
)

_NOW = datetime.now(timezone.utc)


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


def _utc(ts: datetime | None) -> datetime | None:
    """SQLite hands timestamps back naive; they are UTC."""
    if ts is None or ts.tzinfo is not None:
        return ts
    return ts.replace(tzinfo=timezone.utc)


async def _add(
    sid: str,
    *,
    started_ago: timedelta,
    game_type: str = "yacht",
    completed_ago: timedelta | None = None,
    **fields,
) -> uuid.UUID:
    factory = get_session_factory()
    async with factory() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == game_type))
        ).scalar_one()
        game = Game(
            session_id=sid,
            game_type_id=gt_id,
            started_at=_NOW - started_ago,
            completed_at=_NOW - completed_ago if completed_ago is not None else None,
            outcome=fields.get("outcome"),
            final_score=fields.get("final_score"),
            duration_ms=fields.get("duration_ms"),
            game_metadata=fields.get("metadata", {}),
        )
        db.add(game)
        await db.commit()
        return game.id


async def _get(game_id: uuid.UUID) -> Game:
    factory = get_session_factory()
    async with factory() as db:
        return (await db.execute(select(Game).where(Game.id == game_id))).scalar_one()


async def _sweep(sid: str, now: datetime = _NOW) -> int:
    factory = get_session_factory()
    async with factory() as db:
        return await sweep_stale_games(db, session_id=sid, now=now)


# ---------------------------------------------------------------------------
# The sweep itself
# ---------------------------------------------------------------------------


async def test_a_23_hour_open_row_is_untouched() -> None:
    sid = str(uuid.uuid4())
    gid = await _add(sid, started_ago=timedelta(hours=23))
    assert await _sweep(sid) == 0
    g = await _get(gid)
    assert g.completed_at is None
    assert g.outcome is None
    assert "swept" not in g.game_metadata


async def test_a_25_hour_open_row_is_swept_as_abandoned() -> None:
    sid = str(uuid.uuid4())
    gid = await _add(sid, started_ago=timedelta(hours=25), metadata={"player_name": "Ann"})
    assert await _sweep(sid) == 1
    g = await _get(gid)
    assert g.outcome == "abandoned"
    assert abs(_utc(g.completed_at) - (_utc(g.started_at) + STALE_GAME_AFTER)) < timedelta(
        milliseconds=1
    )
    assert g.game_metadata == {"player_name": "Ann", "swept": True}
    assert g.duration_ms is None
    assert g.final_score is None


async def test_a_completed_row_is_untouched() -> None:
    sid = str(uuid.uuid4())
    gid = await _add(
        sid,
        started_ago=timedelta(hours=30),
        completed_ago=timedelta(hours=29),
        outcome="completed",
        final_score=200,
        duration_ms=60_000,
    )
    before = await _get(gid)
    assert await _sweep(sid) == 0
    after = await _get(gid)
    assert (after.outcome, after.final_score, after.duration_ms) == ("completed", 200, 60_000)
    assert after.completed_at == before.completed_at
    assert after.game_metadata == {}


async def test_the_sweep_is_idempotent() -> None:
    sid = str(uuid.uuid4())
    gid = await _add(sid, started_ago=timedelta(hours=25))
    assert await _sweep(sid) == 1
    first = await _get(gid)
    # A later run — even much later — matches nothing: the row is no longer open.
    assert await _sweep(sid, now=_NOW + timedelta(days=3)) == 0
    second = await _get(gid)
    assert second.completed_at == first.completed_at
    assert second.game_metadata == first.game_metadata == {"swept": True}


async def test_the_sweep_is_scoped_to_the_callers_session() -> None:
    mine, theirs = str(uuid.uuid4()), str(uuid.uuid4())
    their_gid = await _add(theirs, started_ago=timedelta(hours=25))
    assert await _sweep(mine) == 0
    assert (await _get(their_gid)).completed_at is None


# ---------------------------------------------------------------------------
# Late completions
# ---------------------------------------------------------------------------


async def test_a_late_real_completion_replaces_a_swept_row(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    gid = await _add(sid, started_ago=timedelta(hours=30), metadata={"player_name": "Ann"})
    assert await _sweep(sid) == 1

    # A long-offline device flushes its queue: events, then the completion.
    r = client.post(
        f"/games/{gid}/events",
        headers=_headers(sid),
        json={"events": [{"event_index": 0, "event_type": "game_started", "data": {}}]},
    )
    assert r.status_code == 200, r.text
    finished_at = _NOW - timedelta(hours=29)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={
            "final_score": 240,
            "outcome": "completed",
            "duration_ms": 3_600_000,
            "completed_at": finished_at.isoformat(),
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["outcome"], body["final_score"], body["duration_ms"]) == (
        "completed",
        240,
        3_600_000,
    )

    g = await _get(gid)
    assert abs(_utc(g.completed_at) - finished_at) < timedelta(milliseconds=1)
    # The flag is gone: the row is back under "first completion wins".
    assert g.game_metadata == {"player_name": "Ann"}

    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={"final_score": 1, "outcome": "abandoned", "duration_ms": 1},
    )
    assert r.status_code == 200
    assert r.json()["final_score"] == 240


async def test_a_late_completion_on_a_normally_completed_row_is_ignored(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    gid = await _add(
        sid,
        started_ago=timedelta(hours=30),
        completed_ago=timedelta(hours=29),
        outcome="completed",
        final_score=200,
        duration_ms=60_000,
    )
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={"final_score": 999, "outcome": "completed", "duration_ms": 1},
    )
    assert r.status_code == 200
    assert (r.json()["final_score"], r.json()["duration_ms"]) == (200, 60_000)
    r = client.post(
        f"/games/{gid}/events",
        headers=_headers(sid),
        json={"events": [{"event_index": 0, "event_type": "game_started", "data": {}}]},
    )
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# On read: /stats/me and /games/me
# ---------------------------------------------------------------------------


async def test_stats_me_counts_a_swept_game_as_played_but_it_earns_no_xp(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    await _add(
        sid,
        started_ago=timedelta(hours=2),
        completed_ago=timedelta(hours=1),
        outcome="completed",
        final_score=150,
    )
    baseline = client.get("/stats/me", headers=_headers(sid)).json()
    assert baseline["by_game"]["yacht"]["played"] == 1

    await _add(sid, started_ago=timedelta(hours=25))
    body = client.get("/stats/me", headers=_headers(sid)).json()
    assert body["total_games"] == 2
    assert body["by_game"]["yacht"]["played"] == 2
    assert body["by_game"]["yacht"]["best"] == 150
    assert body["arcade_xp"] == baseline["arcade_xp"]


async def test_games_me_lists_a_swept_game_as_abandoned(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    gid = await _add(sid, started_ago=timedelta(hours=25))
    items = client.get("/games/me", headers=_headers(sid)).json()["items"]
    assert [(i["id"], i["outcome"], i["metadata"]) for i in items] == [
        (str(gid), "abandoned", {"swept": True})
    ]
    assert items[0]["completed_at"] is not None
    assert items[0]["duration_ms"] is None


async def test_a_swept_row_never_supplies_the_latest_metadata(client: TestClient) -> None:
    # Blackjack reads its run aggregates from the latest row's metadata. A swept
    # row's completed_at (started_at + 24 h) can postdate newer games; its stale
    # aggregates must not win.
    sid = str(uuid.uuid4())
    await _add(
        sid,
        game_type="blackjack",
        started_ago=timedelta(hours=3),
        completed_ago=timedelta(hours=2),
        outcome="win",
        final_score=1200,
        metadata={"total_runs": 5, "current_table": "high"},
    )
    await _add(
        sid,
        game_type="blackjack",
        started_ago=timedelta(hours=25),  # swept to completed_at = now − 1 h
        metadata={"total_runs": 4, "current_table": "low"},
    )
    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["played"] == 2
    assert (bj["total_runs"], bj["current_table"]) == (5, "high")


def _count_statements(client: TestClient, sid: str) -> list[str]:
    statements: list[str] = []

    def record(_conn, _cursor, statement, *_rest) -> None:
        statements.append(statement)

    engine = get_engine().sync_engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        assert client.get("/stats/me", headers=_headers(sid)).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return statements


async def test_the_sweep_adds_one_query_to_stats_me(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = str(uuid.uuid4())
    await _add(sid, started_ago=timedelta(hours=2), completed_ago=timedelta(hours=1))
    # Warm-up: the first streak read freezes the window's daily templates (an INSERT).
    _count_statements(client, sid)
    with_sweep = _count_statements(client, sid)

    async def no_sweep(*_args, **_kwargs) -> int:
        return 0

    monkeypatch.setattr(service, "sweep_stale_games", no_sweep)
    without_sweep = _count_statements(client, sid)

    assert len(with_sweep) - len(without_sweep) == 1, with_sweep
    assert [s for s in with_sweep if s.lstrip().upper().startswith("UPDATE GAMES")]


@pytest.mark.parametrize("path", ["/stats/me", "/games/me"])
async def test_a_failing_sweep_never_breaks_the_read(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    path: str,
) -> None:
    sid = str(uuid.uuid4())
    await _add(
        sid,
        started_ago=timedelta(hours=2),
        completed_ago=timedelta(hours=1),
        outcome="completed",
        final_score=150,
    )

    async def broken_sweep(session, **_kwargs) -> int:
        # A real DB error inside the session's transaction, so the rollback
        # path is exercised too (Postgres aborts the transaction on error).
        await session.execute(text("UPDATE no_such_table SET x = 1"))
        return 0

    monkeypatch.setattr(service, "sweep_stale_games", broken_sweep)
    with caplog.at_level(logging.ERROR, logger="games.service"):
        r = client.get(path, headers=_headers(sid))
    assert r.status_code == 200, r.text
    if path == "/stats/me":
        assert r.json()["by_game"]["yacht"]["played"] == 1
    else:
        assert len(r.json()["items"]) == 1
    errors = [rec for rec in caplog.records if rec.levelno >= logging.ERROR]
    assert any("stale-session sweep failed" in rec.getMessage() for rec in errors)
    assert all(rec.exc_info for rec in errors if "sweep" in rec.getMessage())
    # No session id in what reaches Sentry.
    assert all(sid not in rec.getMessage() for rec in errors)

"""The stale-sweep gate on /stats/me (#2966): games/sweep_gate.py."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from db.base import get_session_factory
from db.models import Game, GameType
from games import sweep, sweep_gate
from tests._helpers import session_headers

_NOW = datetime.now(UTC)


@pytest.fixture(autouse=True)
def _fresh_now() -> None:
    """Re-read the clock per test: the real sweep closes games by wall-clock time,
    so an import-time _NOW drifts from it as the suite runs (a game 23 h 50 min
    old at import is already stale ten minutes later)."""
    global _NOW
    _NOW = datetime.now(UTC)


async def _add_open(sid: str, started_ago: timedelta) -> uuid.UUID:
    """An open game written straight to the DB, as another worker would."""
    factory = get_session_factory()
    async with factory() as db:
        gt_id = (await db.execute(select(GameType.id).where(GameType.name == "yacht"))).scalar_one()
        game = Game(session_id=sid, game_type_id=gt_id, started_at=_NOW - started_ago)
        db.add(game)
        await db.commit()
        return game.id


async def _outcome(game_id: uuid.UUID) -> str | None:
    factory = get_session_factory()
    async with factory() as db:
        return (await db.execute(select(Game.outcome).where(Game.id == game_id))).scalar_one()


@pytest.fixture()
def sweeps(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Session ids the real sweep ran for."""
    calls: list[str] = []
    real = sweep.sweep_stale_games_safely

    async def counting(session, *, session_id: str) -> bool:
        calls.append(session_id)
        return await real(session, session_id=session_id)

    monkeypatch.setattr(sweep, "sweep_stale_games_safely", counting)
    return calls


async def _gate(sid: str, now: datetime | None = None) -> None:
    factory = get_session_factory()
    async with factory() as db:
        await sweep_gate.sweep_if_due(db, session_id=sid, now=now or _NOW)


async def test_the_sweep_is_skipped_within_the_hour_then_runs_again(sweeps: list[str]) -> None:
    sid = str(uuid.uuid4())
    await _gate(sid)
    await _gate(sid, _NOW + timedelta(minutes=59))
    assert sweeps == [sid]

    # A stale game another worker created: picked up by the hourly re-sweep.
    gid = await _add_open(sid, timedelta(hours=25))
    await _gate(sid, _NOW + timedelta(minutes=59))
    assert await _outcome(gid) is None
    await _gate(sid, _NOW + sweep_gate.MAX_SKIP)
    assert sweeps == [sid, sid]
    assert await _outcome(gid) == "abandoned"


async def test_an_open_game_near_24_hours_brings_the_sweep_forward(sweeps: list[str]) -> None:
    sid = str(uuid.uuid4())
    await _add_open(sid, timedelta(hours=23, minutes=50))
    await _gate(sid)
    await _gate(sid, _NOW + timedelta(minutes=9))
    assert sweeps == [sid]
    await _gate(sid, _NOW + timedelta(minutes=10))
    assert sweeps == [sid, sid]


async def test_a_game_created_on_this_process_brings_the_sweep_forward(
    sweeps: list[str],
) -> None:
    sid = str(uuid.uuid4())
    await _gate(sid)
    sweep_gate.note_open_game(sid, _NOW - timedelta(hours=24, minutes=5))
    await _gate(sid, _NOW + timedelta(minutes=1))
    assert sweeps == [sid, sid]

    # A fresh game cannot turn stale within the hour: no change.
    sweep_gate.note_open_game(sid, (_NOW + timedelta(minutes=1)).replace(tzinfo=None))
    await _gate(sid, _NOW + timedelta(minutes=2))
    assert sweeps == [sid, sid]


def test_note_open_game_ignores_a_session_it_does_not_track() -> None:
    sweep_gate.note_open_game("untracked", _NOW)
    assert "untracked" not in sweep_gate._next_due


@pytest.mark.parametrize("tracked", [False, True])
async def test_a_game_noted_during_the_oldest_open_lookup_is_not_lost(
    monkeypatch: pytest.MonkeyPatch, tracked: bool
) -> None:
    """POST /games commits a backdated game while sweep_if_due awaits its lookup:
    the deadline recorded afterwards keeps that game's earlier stale time."""
    sid = str(uuid.uuid4())
    if tracked:
        await _gate(sid)  # an expired entry exists while the next sweep runs
    real_lookup = sweep_gate._oldest_open_start
    backdated_stale_at = _NOW + timedelta(minutes=5)

    async def lookup_racing_a_create(db, session_id):
        oldest = await real_lookup(db, session_id)  # sees no open game
        sweep_gate.note_open_game(session_id, backdated_stale_at - timedelta(hours=24))
        return oldest

    monkeypatch.setattr(sweep_gate, "_oldest_open_start", lookup_racing_a_create)
    await _gate(sid, _NOW + sweep_gate.MAX_SKIP if tracked else _NOW)
    assert sweep_gate._next_due[sid] == backdated_stale_at
    assert sweep_gate._in_flight == {}


async def test_a_failed_sweep_is_retried_on_the_next_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def failing(session, *, session_id: str) -> bool:
        calls.append(session_id)
        return False

    monkeypatch.setattr(sweep, "sweep_stale_games_safely", failing)
    sid = str(uuid.uuid4())
    await _gate(sid)
    await _gate(sid)
    assert calls == [sid, sid]
    assert sid not in sweep_gate._next_due


async def test_a_failed_oldest_open_lookup_records_nothing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def broken(_db, _sid):
        raise RuntimeError("boom")

    monkeypatch.setattr(sweep_gate, "_oldest_open_start", broken)
    sid = str(uuid.uuid4())
    await _gate(sid)
    assert sid not in sweep_gate._next_due
    assert "stale-sweep gate lookup failed (RuntimeError)" in caplog.text
    assert sid not in caplog.text


async def test_the_table_is_a_bounded_lru(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sweep_gate, "MAX_SESSIONS", 2)
    await _gate("a")
    await _gate("b")
    await _gate("a")  # skipped, but marks "a" recently used
    await _gate("c")
    assert list(sweep_gate._next_due) == ["a", "c"]


async def test_stats_me_picks_up_a_backdated_game_created_through_the_api(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    headers = session_headers(sid)
    assert client.get("/stats/me", headers=headers).json()["total_games"] == 0
    r = client.post(
        "/games",
        headers=headers,
        json={"game_type": "yacht", "started_at": (_NOW - timedelta(hours=26)).isoformat()},
    )
    assert r.status_code == 200, r.text
    assert client.get("/stats/me", headers=headers).json()["total_games"] == 1

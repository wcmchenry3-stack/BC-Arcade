"""Replay retention and the storage-budget check (#3292)."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select, update

from db.base import get_session_factory
from db.dialect import dialect_name
from db.models import EventType, Game, GameEntitlement, GameEvent, GameType
from games import replay_storage
from games.replay_storage import (
    BudgetReading,
    DailyGate,
    StorageSize,
    check_storage_budget,
    crossed_threshold,
    measure_storage,
    prune_replay_events,
    read_budget,
    replay_storage_job,
    retention_cutoff,
    run_daily,
)
from jobs import lifespan as jobs_lifespan
from observability import report
from payload_size import jsonb_bytes
from settings import Settings
from tests._helpers import session_headers as _headers

NOW = datetime(2026, 10, 14, 10, 0, tzinfo=UTC)
MB = 1024 * 1024

# ---------------------------------------------------------------------------
# Unit
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("pct", "expected"),
    [(0, None), (49, None), (50, 0.5), (74, 0.5), (75, 0.75), (89, 0.75), (90, 0.9), (150, 0.9)],
)
def test_crossed_threshold(pct: int, expected: float | None) -> None:
    assert crossed_threshold(pct, 100) == expected


def test_retention_cutoff_is_now_minus_the_window() -> None:
    assert retention_cutoff(NOW, timedelta(days=30)) == datetime(2026, 9, 14, 10, 0, tzinfo=UTC)


def test_settings_defaults_and_bounds(monkeypatch: pytest.MonkeyPatch) -> None:
    s = Settings.isolated()
    assert (
        s.replay_retention_days,
        s.replay_storage_budget_mb,
        s.replay_job_hour_utc,
        s.database_plan_mb,
    ) == (30, 250, 9, 500)
    for env, bad in (
        ("REPLAY_RETENTION_DAYS", 0),
        ("REPLAY_STORAGE_BUDGET_MB", 0),
        ("REPLAY_STORAGE_BUDGET_MB", 501),
        ("REPLAY_JOB_HOUR_UTC", 22),
        ("DATABASE_PLAN_MB", 0),
        ("DATABASE_PLAN_MB", 10_001),
    ):
        with pytest.raises(ValidationError):
            Settings.isolated(**{env: bad})
    assert Settings.isolated(REPLAY_STORAGE_BUDGET_MB=500).replay_storage_budget_mb == 500
    assert Settings.isolated(DATABASE_PLAN_MB=10_000).database_plan_mb == 10_000
    # 21 + the 3-hour window ends at midnight; 22 would run past it.
    assert Settings.isolated(REPLAY_JOB_HOUR_UTC=21).replay_job_hour_utc == 21
    monkeypatch.setenv("REPLAY_RETENTION_DAYS", "7")
    assert Settings().replay_retention_days == 7


def test_module_reads_its_settings_lazily(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        replay_storage,
        "_settings",
        Settings.isolated(
            REPLAY_RETENTION_DAYS=10,
            REPLAY_STORAGE_BUDGET_MB=3,
            REPLAY_JOB_HOUR_UTC=2,
            DATABASE_PLAN_MB=8,
        ),
    )
    assert replay_storage.retention() == timedelta(days=10)
    assert replay_storage.budget_bytes() == 3 * MB
    assert replay_storage.plan_bytes() == 8 * MB
    assert replay_storage.job_hour_utc() == 2


def test_get_settings_builds_once(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(replay_storage, "_settings", None)
    first = replay_storage._get_settings()
    assert replay_storage._get_settings() is first


def test_daily_gate_runs_once_a_day_inside_the_window() -> None:
    gate = DailyGate(hour=lambda: 9)
    assert not gate.due(NOW.replace(hour=8, minute=59))
    assert gate.due(NOW.replace(hour=9))
    assert gate.due(NOW.replace(hour=11, minute=59))
    # Outside the 3-hour window: a process started in the evening waits for tomorrow.
    assert not gate.due(NOW.replace(hour=12))
    assert not gate.due(NOW.replace(hour=23))
    gate.done(NOW.replace(hour=9))
    assert not gate.due(NOW.replace(hour=10))
    assert gate.due(NOW.replace(hour=9) + timedelta(days=1))
    assert replay_storage.RUN_WINDOW_HOURS == 3


# ---------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    calls: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: calls.append((m, kw)))
    return calls


@pytest.fixture
def hook(monkeypatch: pytest.MonkeyPatch) -> list[tuple[StorageSize, BudgetReading]]:
    calls: list[tuple[StorageSize, BudgetReading]] = []
    real = replay_storage.on_budget_exceeded

    def spy(size: StorageSize, reading: BudgetReading) -> None:
        calls.append((size, reading))
        real(size, reading)

    monkeypatch.setattr(replay_storage, "on_budget_exceeded", spy)
    return calls


def _measured(events_bytes: int, database_bytes: int = 20 * MB):
    async def measure(_session) -> StorageSize:
        return StorageSize(events_bytes=events_bytes, database_bytes=database_bytes)

    return measure


async def _check(
    events_bytes: int, database_bytes: int = 20 * MB, budget: int = 100 * MB, plan: int = 500 * MB
) -> float | None:
    async with get_session_factory()() as db:
        reading = await check_storage_budget(
            db, budget=budget, plan=plan, measure=_measured(events_bytes, database_bytes)
        )
    assert reading is not None
    return reading.threshold


async def test_budget_under_half_reports_nothing(sent, hook) -> None:
    assert await _check(49 * MB) is None
    assert sent == [] and hook == []


@pytest.mark.parametrize(("pct", "level"), [(50, "info"), (75, "warning")])
async def test_budget_reports_one_event_per_threshold(sent, hook, pct: int, level: str) -> None:
    assert await _check(pct * MB) == pct / 100
    assert len(sent) == 1
    msg, kw = sent[0]
    assert msg == f"Replay storage at {pct}% of budget"
    assert kw["level"] == level
    assert kw["fingerprint"] == [replay_storage.BUDGET_FINGERPRINT, str(pct)]
    assert kw["tags"]["basis"] == "game_events"
    assert kw["contexts"]["replay_storage"] == {
        "basis": "game_events",
        "game_events_bytes": pct * MB,
        "budget_bytes": 100 * MB,
        "game_events_ratio": pct / 100,
        "database_bytes": 20 * MB,
        "plan_bytes": 500 * MB,
        "database_ratio": 0.04,
    }
    assert hook == []


async def test_the_90_percent_hook_runs_at_90_and_not_at_89(
    sent, hook, caplog: pytest.LogCaptureFixture
) -> None:
    assert await _check(89 * MB) == 0.75
    assert hook == []
    with caplog.at_level(logging.WARNING, logger="games.replay_storage"):
        assert await _check(90 * MB) == 0.9
    assert len(hook) == 1
    assert hook[0][0] == StorageSize(90 * MB, 20 * MB)
    assert hook[0][1].basis == "game_events"
    assert [kw["level"] for _, kw in sent] == ["warning", "error"]
    assert any("#3279" in r.getMessage() for r in caplog.records)


async def test_the_database_against_its_plan_reports_when_it_is_fuller(sent, hook) -> None:
    """A small game_events in a nearly full database still reports, and at 90 % hooks."""
    assert await _check(10 * MB, database_bytes=376 * MB) == 0.75  # 75.2 % of 500 MB
    assert sent[0][1]["tags"]["basis"] == "database"
    assert hook == []
    assert await _check(10 * MB, database_bytes=449 * MB) == 0.75  # 89.8 %
    assert hook == []
    assert await _check(10 * MB, database_bytes=450 * MB) == 0.9
    assert len(hook) == 1 and hook[0][1].basis == "database"


def test_read_budget_picks_the_higher_ratio() -> None:
    size = StorageSize(events_bytes=60, database_bytes=80)
    assert read_budget(size, 100, 100) == BudgetReading("database", 0.8, 0.75)
    assert read_budget(size, 100, 1000) == BudgetReading("game_events", 0.6, 0.5)


async def test_budget_defaults_to_the_configured_values(
    monkeypatch: pytest.MonkeyPatch, sent, hook
) -> None:
    monkeypatch.setattr(
        replay_storage,
        "_settings",
        Settings.isolated(REPLAY_STORAGE_BUDGET_MB=1, DATABASE_PLAN_MB=1_000),
    )
    async with get_session_factory()() as db:
        reading = await check_storage_budget(db, measure=_measured(MB))
    assert reading is not None and reading.threshold == 0.9
    assert sent[0][1]["contexts"]["replay_storage"]["plan_bytes"] == 1_000 * MB
    assert len(hook) == 1


async def test_measure_storage_on_this_database(sent) -> None:
    async with get_session_factory()() as db:
        size = await measure_storage(db)
        if dialect_name(db) == "sqlite":
            assert size is None
            assert await check_storage_budget(db, budget=1) is None
            assert sent == []
        else:
            assert size is not None
            assert 0 < size.events_bytes <= size.database_bytes


# ---------------------------------------------------------------------------
# Retention (integration)
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
async def _yacht_entitlement(session_id: str) -> None:
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug="yacht"))
        await db.commit()


def _game_with_events(client: TestClient, sid: str, rolls: int = 3) -> str:
    r = client.post("/games", headers=_headers(sid), json={"game_type": "yacht"})
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    events = [{"event_index": 0, "event_type": "game_started", "data": {}}]
    events += [
        {"event_index": i, "event_type": "roll", "data": {"dice": [i, 1, 1, 1, 1]}}
        for i in range(1, rolls + 1)
    ]
    events.append({"event_index": rolls + 1, "event_type": "game_ended", "data": {}})
    r = client.post(f"/games/{gid}/events", headers=_headers(sid), json={"events": events})
    assert r.status_code == 200, r.text
    return gid


async def _age(gid: str, when: datetime) -> None:
    async with get_session_factory()() as db:
        await db.execute(
            update(GameEvent).where(GameEvent.game_id == uuid.UUID(gid)).values(occurred_at=when)
        )
        await db.commit()


async def _kinds(gid: str) -> list[str]:
    async with get_session_factory()() as db:
        rows = await db.execute(
            select(EventType.name)
            .join(GameEvent, EventType.id == GameEvent.event_type_id)
            .where(GameEvent.game_id == uuid.UUID(gid))
            .order_by(GameEvent.event_index)
        )
        return list(rows.scalars())


async def _game_exists(gid: str) -> bool:
    async with get_session_factory()() as db:
        return await db.get(Game, uuid.UUID(gid)) is not None


async def test_prune_deletes_only_old_replay_rows(client: TestClient, session_id: str) -> None:
    now = datetime.now(UTC)
    old = _game_with_events(client, session_id)
    fresh = _game_with_events(client, session_id)
    await _age(old, now - timedelta(days=31))
    await _age(fresh, now - timedelta(days=29))

    async with get_session_factory()() as db:
        pruned = await prune_replay_events(db, now=now, keep=timedelta(days=30))

    assert pruned >= 3
    assert await _kinds(old) == ["game_started", "game_ended"]
    assert await _kinds(fresh) == ["game_started", "roll", "roll", "roll", "game_ended"]
    assert await _game_exists(old) and await _game_exists(fresh)


async def _direct_game(game_type: str, names: list[str], when: datetime) -> uuid.UUID:
    """A game of ``game_type`` with one row per name, all received at ``when``."""
    async with get_session_factory()() as db:
        type_id = (
            await db.execute(select(GameType.id).where(GameType.name == game_type))
        ).scalar_one()
        ids = dict(
            (
                await db.execute(
                    select(EventType.name, EventType.id).where(EventType.game_type_id == type_id)
                )
            ).all()
        )
        game = Game(
            session_id=str(uuid.uuid4()), game_type_id=type_id, game_metadata={}, players=[]
        )
        db.add(game)
        await db.flush()
        db.add_all(
            [
                GameEvent(
                    game_id=game.id,
                    event_index=i,
                    event_type_id=ids[name],
                    data={"n": i},
                    occurred_at=when,
                )
                for i, name in enumerate(names)
            ]
        )
        await db.commit()
        return game.id


async def test_prune_never_deletes_the_keep_list(client: TestClient) -> None:
    """``wave_completed`` and ``guess_submitted`` are summaries kept for good
    (owner decision #3317); they still count toward the caps."""
    assert {"wave_completed", "guess_submitted"} <= replay_storage.KEPT_EVENT_NAMES
    now = datetime.now(UTC)
    old = now - timedelta(days=400)
    swarm = await _direct_game(
        "starswarm", ["game_started", "wave_completed", "wave_completed"], old
    )
    word = await _direct_game("daily_word", ["game_started", "guess_submitted", "game_ended"], old)
    async with get_session_factory()() as db:
        await prune_replay_events(db, now=now, keep=timedelta(days=30))
    assert await _kinds(str(swarm)) == ["game_started", "wave_completed", "wave_completed"]
    assert await _kinds(str(word)) == ["game_started", "guess_submitted", "game_ended"]


async def test_prune_runs_in_bounded_batches(client: TestClient, session_id: str) -> None:
    now = datetime.now(UTC)
    gid = _game_with_events(client, session_id, rolls=5)
    # Far older than anything else in the shared test database could be.
    await _age(gid, now - timedelta(days=3000))
    keep = timedelta(days=2999)

    async with get_session_factory()() as db:
        # Two batches of two: four rows go and the loop stops at its bound.
        assert await prune_replay_events(db, now=now, keep=keep, batch_size=2, max_batches=2) == 4
    assert await _kinds(gid) == ["game_started", "roll", "game_ended"]

    async with get_session_factory()() as db:
        # A short batch ends the loop; a second run finds nothing.
        assert await prune_replay_events(db, now=now, keep=keep, batch_size=2) == 1
        assert await prune_replay_events(db, now=now, keep=keep, batch_size=2) == 0
    assert await _kinds(gid) == ["game_started", "game_ended"]


async def _counters(gid: str) -> tuple[int, int, list]:
    async with get_session_factory()() as db:
        game = await db.get(Game, uuid.UUID(gid))
        assert game is not None
        data = list(
            (await db.execute(select(GameEvent.data).where(GameEvent.game_id == game.id))).scalars()
        )
        return game.event_count, game.event_bytes, data


async def test_prune_lowers_the_game_counters_by_what_it_deletes(
    client: TestClient, session_id: str
) -> None:
    """Retention lowers ``event_count`` / ``event_bytes`` with each batch (#3318),
    so a swept or still-open game does not keep counting rows it no longer has."""
    now = datetime.now(UTC)
    gid = _game_with_events(client, session_id, rolls=5)
    await _age(gid, now - timedelta(days=3100))
    async with get_session_factory()() as db:
        assert (
            await prune_replay_events(
                db, now=now, keep=timedelta(days=3099), batch_size=2, max_batches=10
            )
            == 5
        )
    count, size, data = await _counters(gid)
    assert count == len(data) == 2  # game_started and game_ended
    assert size == sum(jsonb_bytes(d) for d in data)


async def test_prune_never_takes_a_pre_0035_games_counters_below_zero(
    client: TestClient, session_id: str
) -> None:
    now = datetime.now(UTC)
    gid = _game_with_events(client, session_id, rolls=3)
    await _age(gid, now - timedelta(days=3200))
    async with get_session_factory()() as db:
        # A game from before migration 0035: its rows are stored, its counters 0.
        await db.execute(
            update(Game).where(Game.id == uuid.UUID(gid)).values(event_count=0, event_bytes=0)
        )
        await db.commit()
        await prune_replay_events(db, now=now, keep=timedelta(days=3199))
    count, size, _ = await _counters(gid)
    assert (count, size) == (0, 0)


async def test_prune_defaults_to_the_configured_retention(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(replay_storage, "_settings", Settings.isolated(REPLAY_RETENTION_DAYS=5))
    now = datetime.now(UTC)
    gid = _game_with_events(client, session_id, rolls=1)
    await _age(gid, now - timedelta(days=6))
    async with get_session_factory()() as db:
        await prune_replay_events(db, now=now)
    assert await _kinds(gid) == ["game_started", "game_ended"]


# ---------------------------------------------------------------------------
# The daily job
# ---------------------------------------------------------------------------


async def test_run_daily_prunes_then_checks_the_budget_once_a_day(
    monkeypatch: pytest.MonkeyPatch, sent, hook
) -> None:
    calls: list[str] = []

    async def fake_prune(db, **kw) -> int:
        calls.append("prune")
        return 0

    async def fake_measure(db) -> StorageSize:
        calls.append("measure")
        return StorageSize(events_bytes=95 * MB, database_bytes=120 * MB)

    monkeypatch.setattr(replay_storage, "prune_replay_events", fake_prune)
    monkeypatch.setattr(replay_storage, "measure_storage", fake_measure)
    monkeypatch.setattr(
        replay_storage, "_settings", Settings.isolated(REPLAY_STORAGE_BUDGET_MB=100)
    )
    gate = DailyGate(hour=lambda: 9)

    assert not await run_daily(get_session_factory, gate, now=NOW.replace(hour=8))
    assert await run_daily(get_session_factory, gate, now=NOW)
    assert not await run_daily(get_session_factory, gate, now=NOW + timedelta(hours=1))
    assert calls == ["prune", "measure"]
    assert len(hook) == 1 and len(sent) == 1


async def test_a_run_locked_by_another_instance_is_skipped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def locked(db) -> bool:
        return False

    async def fake_prune(db, **kw) -> int:  # pragma: no cover - must not run
        calls.append("prune")
        return 0

    monkeypatch.setattr(replay_storage, "try_run_lock", locked)
    monkeypatch.setattr(replay_storage, "prune_replay_events", fake_prune)
    gate = DailyGate(hour=lambda: 9)
    assert not await run_daily(get_session_factory, gate, now=NOW)
    assert calls == []
    # The other instance has today's run: this one does not retry it hourly.
    assert not gate.due(NOW + timedelta(hours=1))


async def test_the_run_lock_is_free_on_sqlite() -> None:
    async with get_session_factory()() as db:
        if dialect_name(db) == "sqlite":
            assert await replay_storage.try_run_lock(db) is True


async def test_a_failed_run_is_retried_next_tick(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = 0

    async def flaky_prune(db, **kw) -> int:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("database unavailable")
        return 0

    async def no_measure(db) -> None:
        return None

    monkeypatch.setattr(replay_storage, "prune_replay_events", flaky_prune)
    monkeypatch.setattr(replay_storage, "measure_storage", no_measure)
    reported: list[BaseException] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_exception", reported.append)
    gate = DailyGate(hour=lambda: datetime.now(UTC).hour)

    task = asyncio.create_task(
        replay_storage_job(get_session_factory, interval_s=0.01, gate=gate).loop()
    )
    for _ in range(300):
        if gate.last_run is not None:
            break
        await asyncio.sleep(0.01)
    task.cancel()
    await asyncio.wait({task}, timeout=5)

    assert attempts == 2
    assert len(reported) == 1 and isinstance(reported[0], RuntimeError)
    assert gate.last_run == datetime.now(UTC).date()


def test_the_job_is_configured_after_daily_word_retention() -> None:
    names = [job.name for job in jobs_lifespan.configured_jobs()]
    # Both storage jobs run: replay storage (#3292) and bug-log retention (#3298).
    assert names[:3] == ["daily_word_retention", "replay_storage", "bug_logs_retention"]
    job = jobs_lifespan.replay_storage_job()
    assert job is not None
    assert job.interval_s == replay_storage.TICK_INTERVAL_S
    assert job.reraise_on_crash is False


def test_the_job_is_off_without_a_database(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(jobs_lifespan, "is_configured", lambda: False)
    assert jobs_lifespan.replay_storage_job() is None


async def test_fail_safe_a_full_budget_never_blocks_play(
    client: TestClient, session_id: str, sent, hook
) -> None:
    """At (and over) the budget the server only reports; play carries on."""
    assert await _check(200 * MB) == 0.9
    assert len(hook) == 1
    gid = _game_with_events(client, session_id)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(session_id),
        json={"final_score": 200, "outcome": "completed", "duration_ms": 1_000},
    )
    assert r.status_code == 200, r.text
    assert client.get("/games/leaderboard/yacht").status_code == 200

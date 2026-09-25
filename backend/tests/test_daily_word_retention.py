"""Retention for daily_word_progress (#2544): 14 days, pruned in-process daily."""

from __future__ import annotations

import asyncio
import logging
import pathlib
import re
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from daily_word import retention
from daily_word.retention import RETENTION, prune_expired_progress, run_retention_loop
from db.base import get_session_factory
from db.models import DailyWordProgress

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


async def _add(session_id: str, updated_at: datetime) -> None:
    async with get_session_factory()() as db:
        db.add(
            DailyWordProgress(
                session_id=session_id,
                puzzle_id="2026-09-01:en",
                guesses=["nymph"],
                solved=False,
                updated_at=updated_at,
            )
        )
        await db.commit()


async def _remaining() -> list[str]:
    async with get_session_factory()() as db:
        return sorted((await db.execute(select(DailyWordProgress.session_id))).scalars())


_EVENT_QUEUE_CONFIG = (
    pathlib.Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "game"
    / "_shared"
    / "eventQueueConfig.ts"
)


def _offline_queue_ttl() -> timedelta:
    """The longest TTL_MS in the app's event-queue config, read from the source
    so a change there is seen here (#2661 review). Each is written as a product
    of integer literals, e.g. `7 * 24 * 60 * 60 * 1000`."""
    exprs = re.findall(r"TTL_MS:\s*([\d\s*]+?)\s*,", _EVENT_QUEUE_CONFIG.read_text())
    assert exprs, "no TTL_MS values found — has eventQueueConfig.ts moved or changed shape?"
    longest_ms = 0
    for expr in exprs:
        ms = 1
        for factor in expr.split("*"):
            ms *= int(factor.strip())
        longest_ms = max(longest_ms, ms)
    return timedelta(milliseconds=longest_ms)


def test_retention_outlasts_the_offline_sync_window() -> None:
    """A game finished offline can complete as late as the app's event queue
    keeps it, and completion reads this table (#2541). Keep rows at least
    twice as long."""
    ttl = _offline_queue_ttl()
    assert ttl >= timedelta(days=1), f"implausible TTL parsed: {ttl}"
    assert RETENTION >= ttl * 2, f"retention {RETENTION} is under twice the queue TTL {ttl}"


async def test_prune_deletes_only_rows_past_retention() -> None:
    await _add("stale", NOW - RETENTION - timedelta(minutes=1))
    await _add("fresh", NOW - RETENTION + timedelta(minutes=1))
    await _add("today", NOW)

    async with get_session_factory()() as db:
        pruned = await prune_expired_progress(db, now=NOW)

    assert pruned == 1
    assert await _remaining() == ["fresh", "today"]


async def test_prune_is_a_no_op_on_an_empty_or_current_table() -> None:
    async with get_session_factory()() as db:
        assert await prune_expired_progress(db, now=NOW) == 0
    await _add("today", NOW)
    async with get_session_factory()() as db:
        assert await prune_expired_progress(db, now=NOW) == 0
    assert await _remaining() == ["today"]


async def _run_until(task: asyncio.Task, done) -> None:
    for _ in range(300):
        if done():
            break
        await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def test_loop_survives_a_failed_prune_and_reports_it_once(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A failure must not end the loop (or the app); it is reported and the
    next cycle tries again. Reported exactly once: logged at WARNING, because
    sentry-sdk's logging integration makes an ERROR record a second event."""
    calls = 0
    reported: list[BaseException] = []

    async def flaky_prune(db, **_kw) -> int:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("database unavailable")
        return 0

    monkeypatch.setattr(retention, "prune_expired_progress", flaky_prune)
    monkeypatch.setattr(retention.sentry_sdk, "capture_exception", reported.append)

    with caplog.at_level(logging.INFO, logger="daily_word.retention"):
        task = asyncio.create_task(run_retention_loop(get_session_factory, interval_s=0.01))
        await _run_until(task, lambda: calls >= 2)

    assert calls >= 2, "the loop stopped after the failure"
    assert len(reported) == 1 and isinstance(reported[0], RuntimeError)
    failures = [r for r in caplog.records if "prune failed" in r.getMessage()]
    assert [r.levelno for r in failures] == [logging.WARNING]
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


async def test_a_stalled_prune_times_out_and_the_loop_carries_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A pooler that accepts the connection and then stalls must not hang the
    loop forever (#2661 review)."""
    calls = 0
    reported: list[BaseException] = []

    async def stalling_prune(db, **_kw) -> int:
        nonlocal calls
        calls += 1
        if calls == 1:
            await asyncio.sleep(3600)
        return 0

    monkeypatch.setattr(retention, "prune_expired_progress", stalling_prune)
    monkeypatch.setattr(retention.sentry_sdk, "capture_exception", reported.append)

    task = asyncio.create_task(
        run_retention_loop(get_session_factory, interval_s=0.01, timeout_s=0.05)
    )
    await _run_until(task, lambda: calls >= 2)

    assert calls >= 2, "the loop hung on the stalled prune"
    assert len(reported) == 1 and isinstance(reported[0], TimeoutError)


async def test_a_factory_that_raises_does_not_end_the_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Building the engine from a malformed DATABASE_URL raises. That happens
    inside the loop's error handling, so it is reported instead of aborting
    startup (#2661 review)."""
    attempts = 0
    reported: list[BaseException] = []

    def broken_factory_getter():
        nonlocal attempts
        attempts += 1
        raise ValueError("Could not parse SQLAlchemy URL")

    monkeypatch.setattr(retention.sentry_sdk, "capture_exception", reported.append)

    task = asyncio.create_task(run_retention_loop(broken_factory_getter, interval_s=0.01))
    await _run_until(task, lambda: attempts >= 2)

    assert attempts >= 2
    assert reported and all(isinstance(e, ValueError) for e in reported)


def test_app_starts_the_loop_and_stops_it_on_shutdown() -> None:
    import main

    with TestClient(main.app):
        task = main.app.state.retention_task
        assert task is not None and not task.done()
    assert main.app.state.retention_task is None
    # cancelled() alone: done() would also be true for a loop that had crashed.
    assert task.cancelled()


def test_app_still_starts_when_the_session_factory_cannot_be_built(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A malformed DATABASE_URL makes get_session_factory() raise. Startup used
    to call it outside any error handling, which aborted the whole app —
    including /health (#2661 review). Now the loop calls it, and survives."""
    import db.base
    import main

    reported: list[BaseException] = []
    monkeypatch.setattr(retention.sentry_sdk, "capture_exception", reported.append)

    def broken() -> None:
        raise ValueError("Could not parse SQLAlchemy URL")

    monkeypatch.setattr(db.base, "get_session_factory", broken)

    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200
        task = main.app.state.retention_task
        assert task is not None and not task.done(), "the retention loop died"

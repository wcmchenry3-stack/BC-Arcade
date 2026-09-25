"""Retention for daily_word_progress (#2544): 14 days, pruned in-process daily."""

from __future__ import annotations

import asyncio
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


def test_retention_outlasts_the_offline_sync_window() -> None:
    """A game finished offline can complete up to 7 days late (the app's event
    queue TTL), and completion reads this table (#2541). Keep rows longer."""
    assert RETENTION >= timedelta(days=7) * 2


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


async def test_loop_survives_a_failed_prune_and_reports_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failure must not end the loop (or the app); it is reported and the
    next cycle tries again."""
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

    task = asyncio.create_task(run_retention_loop(get_session_factory(), interval_s=0.01))
    for _ in range(200):
        if calls >= 2:
            break
        await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert calls >= 2, "the loop stopped after the failure"
    assert len(reported) == 1
    assert isinstance(reported[0], RuntimeError)


def test_app_starts_the_loop_and_stops_it_on_shutdown() -> None:
    import main

    with TestClient(main.app):
        task = main._retention_task
        assert task is not None and not task.done()
    assert main._retention_task is None
    assert task.cancelled() or task.done()

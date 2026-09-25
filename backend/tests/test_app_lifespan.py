"""App startup/shutdown runs through one lifespan handler (#2668)."""

from __future__ import annotations

import asyncio
import json
import logging

import pytest
from fastapi.testclient import TestClient


def test_no_on_event_hooks_remain() -> None:
    """Once a lifespan is set FastAPI stops running @app.on_event handlers, so
    a hook added the old way would silently never fire. Every app.on_event or
    included router.on_event lands in these lists, so this also stands in for
    a no-DeprecationWarning check."""
    import main

    assert main.app.router.on_startup == []
    assert main.app.router.on_shutdown == []


def _audit_events(records: list[logging.LogRecord]) -> list[str]:
    events = []
    for record in records:
        try:
            payload = json.loads(record.getMessage())
        except ValueError:
            continue
        if isinstance(payload, dict) and "event" in payload:
            events.append(payload["event"])
    return events


def test_startup_runs_the_db_health_check(caplog: pytest.LogCaptureFixture) -> None:
    """Any of its three outcomes shows it ran; which one depends on the DB the
    run is pointed at (conftest also supports an external DATABASE_URL)."""
    import main

    with caplog.at_level(logging.INFO, logger="audit"), TestClient(main.app):
        pass
    outcomes = {"db_connected", "db_connect_failed", "db_unconfigured"}
    assert outcomes & set(_audit_events(caplog.records))


def test_a_failed_startup_still_cancels_the_retention_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The task exists before the DB health check runs, so a startup that fails
    or is cancelled there must still cancel it (#2672 review)."""
    import main

    created: list[asyncio.Task] = []
    start = main._start_daily_word_retention

    def recording_start():
        task = start()
        created.append(task)
        return task

    async def failing_health_check() -> None:
        raise RuntimeError("startup interrupted")

    monkeypatch.setattr(main, "_start_daily_word_retention", recording_start)
    monkeypatch.setattr(main, "_db_health_check", failing_health_check)

    with pytest.raises(RuntimeError, match="startup interrupted"), TestClient(main.app):
        pass

    assert created and created[0] is not None
    assert created[0].cancelled()
    assert main.app.state.retention_task is None


async def test_stopping_does_not_swallow_its_own_cancellation() -> None:
    """If shutdown itself is cancelled while waiting for the task, that
    cancellation must propagate, not be mistaken for the task's own (#2672
    review)."""
    import main

    async def slow_to_stop() -> None:
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            await asyncio.sleep(3600)  # still winding down when shutdown is cancelled

    task = asyncio.create_task(slow_to_stop())
    await asyncio.sleep(0)
    stopper = asyncio.create_task(main._stop_daily_word_retention(task))
    await asyncio.sleep(0.01)
    stopper.cancel()

    with pytest.raises(asyncio.CancelledError):
        await stopper
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


async def test_stopping_surfaces_a_task_that_crashed() -> None:
    """A task that ends in an error is re-raised, as ``await task`` did (#2667),
    rather than silently absorbed."""
    import main

    async def fails_on_cancel() -> None:
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            raise RuntimeError("cleanup failed") from None

    task = asyncio.create_task(fails_on_cancel())
    await asyncio.sleep(0)
    with pytest.raises(RuntimeError, match="cleanup failed"):
        await main._stop_daily_word_retention(task)


def test_shutdown_resets_state_even_when_the_task_crashed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The lifespan clears app.state.retention_task however stopping ends."""
    import main
    from daily_word import retention

    async def crashes_on_cancel(_get_session_factory, **_kw) -> None:
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            raise RuntimeError("cleanup failed") from None

    monkeypatch.setattr(retention, "run_retention_loop", crashes_on_cancel)

    with pytest.raises(RuntimeError, match="cleanup failed"), TestClient(main.app):
        assert main.app.state.retention_task is not None
    assert main.app.state.retention_task is None

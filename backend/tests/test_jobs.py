"""PeriodicJob (loop, crash and stop policy) and the job lifespan wiring (#2994)."""

from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack

import pytest

from jobs import lifespan as jobs_lifespan
from jobs import periodic
from jobs.periodic import PeriodicJob
from observability import report


def make_job(
    name: str = "job",
    *,
    run=None,
    reraise_on_crash: bool = False,
    timeout_s: float = 1.0,
    events: list | None = None,
) -> PeriodicJob:
    async def default_run() -> None:
        return None

    log = events if events is not None else []
    return PeriodicJob(
        name=name,
        run=run or default_run,
        interval_s=42.0,
        timeout_s=timeout_s,
        subsystem_tag=f"tests.{name}",
        fingerprint=f"{name}-failed",
        on_failure=lambda exc: log.append(("failure", type(exc))),
        on_stop_timeout=lambda waited: log.append(("stop_timeout", waited)),
        reraise_on_crash=reraise_on_crash,
    )


class StopLoop(Exception):
    """Raised by a fake sleep to end the otherwise endless loop."""


def fake_sleep_after(cycles: int, sleeps: list[float]):
    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) == cycles:
            raise StopLoop

    return fake_sleep


# -- loop --------------------------------------------------------------------


async def test_loop_runs_then_sleeps_the_interval() -> None:
    runs: list[int] = []

    async def run() -> None:
        runs.append(1)

    sleeps: list[float] = []
    with pytest.raises(StopLoop):
        await make_job(run=run).loop(sleep=fake_sleep_after(3, sleeps))
    assert len(runs) == 3 and sleeps == [42.0] * 3


async def test_loop_reports_a_failure_once_and_carries_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[tuple[BaseException, dict]] = []
    calls = 0

    def capture(exc: BaseException) -> None:
        scope = report.sentry_sdk.get_current_scope()
        captured.append((exc, {"tags": dict(scope._tags), "fingerprint": scope._fingerprint}))

    monkeypatch.setattr(report.sentry_sdk, "capture_exception", capture)

    async def run() -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("boom")

    events: list = []
    sleeps: list[float] = []
    with pytest.raises(StopLoop):
        await make_job("replay", run=run, events=events).loop(sleep=fake_sleep_after(2, sleeps))
    assert calls == 2, "the loop stopped after the failure"
    assert events == [("failure", RuntimeError)]
    assert len(captured) == 1 and isinstance(captured[0][0], RuntimeError)
    assert captured[0][1] == {
        "tags": {"subsystem": "tests.replay"},
        "fingerprint": ["replay-failed"],
    }


async def test_loop_times_out_a_stalled_run(monkeypatch: pytest.MonkeyPatch) -> None:
    reported: list[BaseException] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_exception", reported.append)
    calls = 0

    async def run() -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            await asyncio.sleep(3600)

    sleeps: list[float] = []
    with pytest.raises(StopLoop):
        await make_job(run=run, timeout_s=0.05).loop(sleep=fake_sleep_after(2, sleeps))
    assert calls == 2
    assert len(reported) == 1 and isinstance(reported[0], TimeoutError)


async def test_loop_does_not_swallow_cancellation() -> None:
    task = asyncio.create_task(make_job().loop())
    await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


# -- stop: crash handling with and without reraise_on_crash -------------------


async def _crashing_task() -> asyncio.Task:
    async def fails_on_cancel() -> None:
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            raise RuntimeError("cleanup failed") from None

    task = asyncio.create_task(fails_on_cancel())
    await asyncio.sleep(0)
    return task


async def test_stop_reraises_a_crash_when_reraise_on_crash() -> None:
    task = await _crashing_task()
    with pytest.raises(RuntimeError, match="cleanup failed"):
        await make_job(reraise_on_crash=True).stop(task)


async def test_stop_swallows_a_crash_without_reraise_on_crash() -> None:
    task = await _crashing_task()
    await make_job(reraise_on_crash=False).stop(task)
    assert task.done() and isinstance(task.exception(), RuntimeError)


async def test_stop_a_clean_cancel_is_quiet_either_way() -> None:
    for reraise in (True, False):
        events: list = []
        task = asyncio.create_task(asyncio.sleep(3600))
        await asyncio.sleep(0)
        await make_job(reraise_on_crash=reraise, events=events).stop(task)
        assert task.cancelled() and events == []


async def test_stop_without_a_task_is_a_noop() -> None:
    await make_job().stop(None)


async def test_stop_is_bounded_and_says_so() -> None:
    release = asyncio.Event()

    async def stubborn() -> None:
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            await release.wait()  # absorbs the first cancel

    events: list = []
    task = asyncio.create_task(stubborn())
    await asyncio.sleep(0)
    await make_job(events=events).stop(task, timeout=0.01)
    assert not task.done() and events == [("stop_timeout", 0.01)]
    release.set()
    await task


async def test_stop_defaults_to_the_module_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(periodic, "STOP_TIMEOUT_S", 0.02)
    release = asyncio.Event()

    async def stubborn() -> None:
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            await release.wait()

    events: list = []
    task = asyncio.create_task(stubborn())
    await asyncio.sleep(0)
    await make_job(events=events).stop(task)
    assert events == [("stop_timeout", 0.02)]
    release.set()
    await task


async def test_stopping_does_not_swallow_its_own_cancellation() -> None:
    async def slow_to_stop() -> None:
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            await asyncio.sleep(3600)

    task = asyncio.create_task(slow_to_stop())
    await asyncio.sleep(0)
    stopper = asyncio.create_task(make_job().stop(task))
    await asyncio.sleep(0.01)
    stopper.cancel()
    with pytest.raises(asyncio.CancelledError):
        await stopper
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


# -- start/stop order and clean shutdown ---------------------------------------


def _recording_job(name: str, order: list[str], **kw) -> PeriodicJob:
    async def loop(sleep=asyncio.sleep) -> None:
        order.append(f"start:{name}")
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            order.append(f"stop:{name}")
            raise

    job = make_job(name, **kw)
    job.loop = loop  # type: ignore[method-assign]
    return job


async def test_jobs_start_in_list_order_and_stop_in_reverse() -> None:
    order: list[str] = []
    jobs = [_recording_job(n, order) for n in ("retention", "apple", "google")]
    tasks: dict[str, asyncio.Task] = {}
    async with AsyncExitStack() as stack:
        jobs_lifespan.start_jobs(stack, jobs, tasks)
        await asyncio.sleep(0.01)
        assert list(tasks) == ["retention", "apple", "google"]
        assert order == ["start:retention", "start:apple", "start:google"]
    assert order[3:] == ["stop:google", "stop:apple", "stop:retention"]
    assert tasks == {}


async def test_clean_shutdown_cancels_every_task() -> None:
    order: list[str] = []
    jobs = [_recording_job(n, order) for n in ("a", "b")]
    tasks: dict[str, asyncio.Task] = {}
    async with AsyncExitStack() as stack:
        jobs_lifespan.start_jobs(stack, jobs, tasks)
        started = list(tasks.values())
        await asyncio.sleep(0.01)
    assert all(t.cancelled() for t in started)
    assert tasks == {}


async def test_one_crashed_stop_does_not_skip_the_others() -> None:
    """A reraising crash in a job that stops first still lets the jobs started
    before it stop, and the crash surfaces only after all of them have."""
    order: list[str] = []

    async def crashing_loop(sleep=asyncio.sleep) -> None:
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            order.append("stop:retention")
            raise RuntimeError("retention crashed") from None

    retention = _recording_job("retention", order, reraise_on_crash=True)
    retention.loop = crashing_loop  # type: ignore[method-assign]
    apple = _recording_job("apple", order, reraise_on_crash=False)
    tasks: dict[str, asyncio.Task] = {}
    with pytest.raises(RuntimeError, match="retention crashed"):
        async with AsyncExitStack() as stack:
            # retention is started last, so it stops (and raises) first.
            jobs_lifespan.start_jobs(stack, [apple, retention], tasks)
            await asyncio.sleep(0.01)
    assert order[-2:] == ["stop:retention", "stop:apple"]
    assert tasks == {}


async def test_start_jobs_rejects_duplicate_names() -> None:
    order: list[str] = []
    jobs = [_recording_job("apple", order), _recording_job("apple", order)]
    tasks: dict[str, asyncio.Task] = {}
    async with AsyncExitStack() as stack:
        with pytest.raises(ValueError, match="duplicate job name"):
            jobs_lifespan.start_jobs(stack, jobs, tasks)
    assert tasks == {}


async def test_a_purchase_job_crash_is_swallowed_at_shutdown() -> None:
    async def crashing_loop(sleep=asyncio.sleep) -> None:
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            raise RuntimeError("apple crashed") from None

    job = make_job("apple", reraise_on_crash=False)
    job.loop = crashing_loop  # type: ignore[method-assign]
    tasks: dict[str, asyncio.Task] = {}
    async with AsyncExitStack() as stack:
        jobs_lifespan.start_jobs(stack, [job], tasks)
        await asyncio.sleep(0.01)
    assert tasks == {}


def test_configured_jobs_order_and_filtering(monkeypatch: pytest.MonkeyPatch) -> None:
    a, c = make_job("retention"), make_job("google")
    monkeypatch.setattr(jobs_lifespan, "retention_job", lambda: a)
    monkeypatch.setattr(jobs_lifespan, "apple_replay_job", lambda: None)
    monkeypatch.setattr(jobs_lifespan, "google_jobs_job", lambda: c)
    assert jobs_lifespan.configured_jobs() == [a, c]


def test_the_real_jobs_carry_the_documented_crash_policy() -> None:
    """Owner decision on #2994: retention re-raises a crash, the purchase jobs do not."""
    from daily_word.retention import retention_job
    from purchases.apple_notifications import apple_replay_job
    from purchases.google_notifications import google_jobs_job

    def factory():
        raise AssertionError("not called")

    assert retention_job(factory).reraise_on_crash is True
    assert apple_replay_job(lambda: None, factory).reraise_on_crash is False
    assert google_jobs_job(lambda: None, factory).reraise_on_crash is False


def test_jobs_are_off_without_a_database(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(jobs_lifespan, "is_configured", lambda: False)
    assert jobs_lifespan.configured_jobs() == []

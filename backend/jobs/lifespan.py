"""Which background jobs run, and their start/stop around the app's lifetime (#2994).

``main.lifespan`` calls ``configured_jobs()`` and ``start_jobs()``. Jobs start in
list order and stop in reverse (the last started is stopped first); each stop is
bounded, and one job's failed stop never skips the others'.
"""

from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack

from db.base import is_configured
from jobs.periodic import PeriodicJob


def retention_job() -> PeriodicJob | None:
    """Daily Word retention (#2544); needs a database."""
    if not is_configured():
        return None
    from daily_word.retention import retention_job as build
    from db.base import get_session_factory

    return build(get_session_factory)


def apple_replay_job() -> PeriodicJob | None:
    """App Store notification-history replay (#2786, docs/IAP.md §6.5).

    Only when Apple verification and the App Store Server API are configured.
    """
    if not is_configured():
        return None
    from purchases import apple

    verifier = apple.configured_verifier()
    if verifier is None or not verifier.has_api:
        return None
    from db.base import get_session_factory
    from purchases.apple_notifications import apple_replay_job as build

    return build(apple.configured_verifier, get_session_factory)


def google_jobs_job() -> PeriodicJob | None:
    """Google Play voided-purchases poll + acknowledgement sweep (#2787, docs/IAP.md §7.6).

    Only when Google verification is configured.
    """
    if not is_configured():
        return None
    from purchases import google

    if google.configured_verifier() is None:
        return None
    from db.base import get_session_factory
    from purchases.google_notifications import google_jobs_job as build

    return build(google.configured_verifier, get_session_factory)


def configured_jobs() -> list[PeriodicJob]:
    """The jobs to run, in start order; a job that is not configured is left out."""
    candidates = [retention_job(), apple_replay_job(), google_jobs_job()]
    return [job for job in candidates if job is not None]


def start_jobs(
    stack: AsyncExitStack, jobs: list[PeriodicJob], tasks: dict[str, asyncio.Task]
) -> None:
    """Start each job as a task in ``tasks`` and register its stop on ``stack``.

    ``stack`` unwinds last-in-first-out and keeps unwinding when a stop raises
    (a crashed ``reraise_on_crash`` job), so every task is stopped and removed
    from ``tasks``; the error then surfaces.
    """
    names = [job.name for job in jobs]
    if len(set(names)) != len(names) or set(names) & set(tasks):
        raise ValueError(f"duplicate job name in {names}")
    for job in jobs:
        tasks[job.name] = asyncio.create_task(job.loop())
        stack.push_async_callback(_stop_job, job, tasks)


async def _stop_job(job: PeriodicJob, tasks: dict[str, asyncio.Task]) -> None:
    try:
        await job.stop(tasks[job.name])
    finally:
        del tasks[job.name]

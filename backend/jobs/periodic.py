"""``PeriodicJob``: the one loop, and the one stop policy, for in-process background jobs (#2994).

Daily Word retention, the App Store replay and the Google Play jobs each had
a copy of the same ``while True`` loop and their own stop helper. A job is now
data: what to run, how often, how long one run may take, and how a failure is
tagged. A new job is one ``PeriodicJob(...)`` plus one line in
``jobs.lifespan.configured_jobs``.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from observability.report import report_exception

# How long shutdown waits for a cancelled job (#2667). A run stuck in the driver
# can absorb the cancel, and an unbounded wait held shutdown, and a TestClient
# exit, for good; CI hung ~28 min on it.
STOP_TIMEOUT_S = 5.0


@dataclass
class PeriodicJob:
    """A coroutine run now and then every ``interval_s``, until cancelled.

    ``run`` is called afresh each cycle and bounded by ``timeout_s``. Any
    exception from it, including that timeout, is passed to ``on_failure``
    (the job's own log line), reported to Sentry under ``subsystem_tag`` and
    ``fingerprint``, and retried next cycle: a failing job never takes the app
    down, and at one attempt per interval it cannot flood.

    ``reraise_on_crash`` is the shutdown policy: ``stop`` re-raises a task that
    ended in an error when True (retention), and swallows it when False (the
    purchase jobs). ``on_stop_timeout`` receives the seconds waited.
    """

    name: str
    run: Callable[[], Awaitable[object]]
    interval_s: float
    timeout_s: float
    subsystem_tag: str
    fingerprint: str
    on_failure: Callable[[BaseException], None]
    on_stop_timeout: Callable[[float], None]
    reraise_on_crash: bool = False

    async def loop(self, sleep: Callable[[float], Awaitable[None]] = asyncio.sleep) -> None:
        """Run, then sleep ``interval_s``, forever. ``sleep`` is injectable for tests."""
        while True:
            try:
                await asyncio.wait_for(self.run(), timeout=self.timeout_s)
            except Exception as exc:  # noqa: BLE001 - any failure waits for the next cycle
                self.on_failure(exc)
                report_exception(exc, subsystem=self.subsystem_tag, fingerprint=self.fingerprint)
            await sleep(self.interval_s)

    async def stop(self, task: asyncio.Task | None, timeout: float | None = None) -> None:
        """Cancel ``task`` and wait for it, but only ``timeout`` (default ``STOP_TIMEOUT_S``).

        ``asyncio.wait`` never raises the task's own outcome, so a
        CancelledError aimed at *this* coroutine (shutdown itself being
        cancelled) still propagates (#2672 review).
        """
        if task is None:
            return
        if timeout is None:
            timeout = STOP_TIMEOUT_S
        task.cancel()
        done, _ = await asyncio.wait({task}, timeout=timeout)
        if not done:
            self.on_stop_timeout(timeout)
        elif self.reraise_on_crash and not task.cancelled():
            task.result()  # re-raises a crash, as `await task` did

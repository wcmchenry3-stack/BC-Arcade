"""One Sentry reporter for caught exceptions and dropped/rejected results (#2994).

``report_exception`` is for background jobs; ``report_event`` is for messages
such as a dropped or rejected game result; ``Throttle`` limits a noisy reporter
to one event per window.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Mapping
from typing import Any

import sentry_sdk


def report_exception(exc: BaseException, *, subsystem: str, fingerprint: str) -> None:
    """Capture ``exc`` once, tagged ``subsystem`` and grouped by ``fingerprint``.

    The tag and fingerprint live on a throwaway scope, so they never leak onto
    other events. Callers log at WARNING, not ERROR: sentry-sdk's logging
    integration turns an ERROR record into a second, untagged event.
    """
    with sentry_sdk.new_scope() as scope:
        scope.set_tag("subsystem", subsystem)
        scope.fingerprint = [fingerprint]
        sentry_sdk.capture_exception(exc)


def report_event(
    message: str,
    *,
    level: str,
    fingerprint: list[str],
    tags: Mapping[str, str],
    context: Mapping[str, Mapping[str, Any]] | None = None,
    extras: Mapping[str, Any] | None = None,
) -> None:
    """Send ``message`` to Sentry with an explicit fingerprint, tags and context.

    ``context`` maps a Sentry context name to its fields; ``extras`` are the
    flat "additional data" fields. Callers pass field paths and error types
    only: no session id and no result values (the privacy policy says crash
    reports carry no identifier). Everything lives on a throwaway scope, so
    nothing leaks onto other events.
    """
    scope_kwargs: dict[str, Any] = {"fingerprint": list(fingerprint), "tags": dict(tags)}
    if context:
        scope_kwargs["contexts"] = {name: dict(fields) for name, fields in context.items()}
    if extras:
        scope_kwargs["extras"] = dict(extras)
    sentry_sdk.capture_message(message, level=level, **scope_kwargs)


class Throttle:
    """Allow one call per ``window_s`` seconds (monotonic clock).

    ``allow()`` is check-and-set: it returns True for the first call in a
    window and records it, False for the rest until the window has passed.
    """

    def __init__(self, window_s: float) -> None:
        self.window_s = window_s
        self._last: float | None = None
        self._lock = threading.Lock()

    def allow(self) -> bool:
        with self._lock:
            now = time.monotonic()
            if self._last is not None and now - self._last < self.window_s:
                return False
            self._last = now
            return True


# One throttle per (game_type, reason): a client retrying a rejected completion,
# or a bad build, must not send one Sentry event per request (#3293). The
# fingerprint is already fixed, so a throttled call loses no grouping.
_REJECTED_WINDOW_S = 300.0
_rejected_throttles: dict[tuple[str, str], Throttle] = {}
_rejected_suppressed: dict[tuple[str, str], int] = {}
_rejected_throttles_lock = threading.Lock()


def _rejected_throttle(game_type: str, reason: str) -> Throttle:
    key = (game_type, reason)
    throttle = _rejected_throttles.get(key)
    if throttle is None:
        with _rejected_throttles_lock:
            throttle = _rejected_throttles.get(key)
            if throttle is None:
                throttle = _rejected_throttles[key] = Throttle(_REJECTED_WINDOW_S)
    return throttle


def report_rejected_result(game_type: str, reason: str, context: Mapping[str, Any]) -> None:
    """A completion result rejected, or partly dropped, server-side (#2449).

    One Sentry issue per game and reason. Shared by ``games.sessions`` (a 400
    on ``/complete``) and the game modules that drop part of an otherwise valid
    result (Yacht's cards), so both always group the same way. Field paths and
    error types only: no session id and no result values. At most one event per
    (game type, reason) per five minutes per process (#3293); the count of reports
    held back since the last one is sent as ``suppressed`` in the next event.
    """
    key = (game_type, reason)
    if not _rejected_throttle(game_type, reason).allow():
        with _rejected_throttles_lock:
            _rejected_suppressed[key] = _rejected_suppressed.get(key, 0) + 1
        return
    with _rejected_throttles_lock:
        suppressed = _rejected_suppressed.pop(key, 0)
    rejection = dict(context)
    if suppressed:
        rejection["suppressed"] = suppressed
    report_event(
        f"PATCH /games/{{id}}/complete rejected: {reason} ({game_type})",
        level="error",
        fingerprint=["games-complete-result-rejected", game_type, reason],
        tags={"game_type": game_type},
        context={"result_rejection": rejection},
    )

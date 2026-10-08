"""One Sentry reporter for exceptions caught by background jobs (#2994)."""

from __future__ import annotations

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

"""Small helpers shared by the Apple and Google store modules (#2998).

Each was copied byte-for-byte (or nearly) between ``apple_store``,
``apple_notifications``, ``google_play`` and the old ``google_notifications``. All
logging goes to the ``audit`` logger, as before.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Literal

from observability.report import KeyedThrottle, report_event
from settings import Settings

_log = logging.getLogger("audit")

# A misconfiguration persists until a deploy fixes it; one Sentry event an hour per
# (platform, reason) is enough to see it (#3313).
MISCONFIGURED_WINDOW_S = 3600.0
MISCONFIGURED_MAX_PER_HOUR = 10
_misconfigured_throttle = KeyedThrottle(MISCONFIGURED_WINDOW_S, MISCONFIGURED_MAX_PER_HOUR)

# The event-name prefix each platform has always used for its misconfiguration
# report (log event ``<prefix>_misconfigured`` and the Sentry message).
_MISCONFIGURED_PREFIX = {"apple": "apple_iap", "google": "google_play"}


# The APPLE_* / GOOGLE_* store config, built from the environment on first use and
# kept for the process (like ``entitlements.service._settings``; ``create_app()`` does
# not pass its own here). A test overrides it with
# ``monkeypatch.setattr(_common, "_settings", Settings.isolated(...))``, or resets it
# to ``None`` after changing env vars (``tests/_helpers.StoreEnv``).
_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def misconfigured(platform: Literal["apple", "google"], reason: str) -> None:
    """Report why a store's verification stays dormant: the reason code only.

    Never an exception text or a variable's value (a private key or the
    service-account key). Goes to the audit log and, as a message, to Sentry,
    so a set-but-broken configuration is not silent (IAP.md §6.6, §7.6).
    """
    event = f"{_MISCONFIGURED_PREFIX[platform]}_misconfigured"
    _log.warning(json.dumps({"event": event, "reason": reason}))
    # It runs on every store call while the config is broken, so Sentry gets at most one
    # event per (platform, reason) per hour and 10 an hour in all (#3313). ``reason`` is
    # one of a fixed set of codes, so the message and fingerprint stay low-cardinality.
    suppressed = _misconfigured_throttle.allow((platform, reason))
    if suppressed is None:
        return
    report_event(
        f"{event}: {reason}",
        level="warning",
        fingerprint=[event, reason],
        tags={"platform": platform, "reason": reason},
        extras={"suppressed": suppressed} if suppressed else None,
    )


def ms_to_datetime(value: int | None) -> datetime | None:
    """Epoch milliseconds (as Apple sends them) as aware UTC, or None for None."""
    return None if value is None else datetime.fromtimestamp(value / 1000, tz=UTC)


def log_event(event: str, **fields: object) -> None:
    """One JSON ``info`` line on the audit logger: ``{"event": event, **fields}``."""
    _log.info(json.dumps({"event": event, **fields}))

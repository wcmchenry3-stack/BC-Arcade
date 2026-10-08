"""Small helpers shared by the Apple and Google store modules (#2998).

Each was copied byte-for-byte (or nearly) between ``apple_store``,
``apple_notifications``, ``google_play`` and the old ``google_notifications``. All
logging goes to the ``audit`` logger, as before.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from typing import Literal

import sentry_sdk

_log = logging.getLogger("audit")

# The event-name prefix each platform has always used for its misconfiguration
# report (log event ``<prefix>_misconfigured`` and the Sentry message).
_MISCONFIGURED_PREFIX = {"apple": "apple_iap", "google": "google_play"}


def env_str(name: str) -> str:
    """``os.environ[name]`` stripped, or ``""`` when unset or empty."""
    return (os.environ.get(name) or "").strip()


def misconfigured(platform: Literal["apple", "google"], reason: str) -> None:
    """Report why a store's verification stays dormant: the reason code only.

    Never an exception text or a variable's value (a private key or the
    service-account key). Goes to the audit log and, as a message, to Sentry,
    so a set-but-broken configuration is not silent (IAP.md §6.6, §7.6).
    """
    event = f"{_MISCONFIGURED_PREFIX[platform]}_misconfigured"
    _log.warning(json.dumps({"event": event, "reason": reason}))
    sentry_sdk.capture_message(f"{event}: {reason}", level="warning")


def ms_to_datetime(value: int | None) -> datetime | None:
    """Epoch milliseconds (as Apple sends them) as aware UTC, or None for None."""
    return None if value is None else datetime.fromtimestamp(value / 1000, tz=UTC)


def log_event(event: str, **fields: object) -> None:
    """One JSON ``info`` line on the audit logger: ``{"event": event, **fields}``."""
    _log.info(json.dumps({"event": event, **fields}))

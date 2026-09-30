"""Replay missed App Store Server Notifications by hand (#2786, docs/IAP.md §6.5).

The API runs the same replay in-process at startup and daily (``main.py``).
Use this after an outage longer than the 48 h default window, or to check the
wiring. Run from ``backend/`` with the service's environment (Render shell):

    python scripts/apple_replay_notifications.py            # last 48 hours
    python scripts/apple_replay_notifications.py --hours 168

Does nothing (exit 2) unless ``DATABASE_URL``, ``APPLE_BUNDLE_ID`` and the
App Store Server API key (``APPLE_IAP_ISSUER_ID`` / ``APPLE_IAP_KEY_ID`` /
``APPLE_IAP_PRIVATE_KEY``) are set. Safe to repeat: every notification is
deduplicated by its ``notificationUUID``. Apple keeps 180 days of history.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.base import get_session_factory, is_configured
from purchases import apple
from purchases.apple_notifications import replay_notification_history


async def _main(hours: int) -> int:
    if not is_configured():
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    result = await replay_notification_history(
        apple.configured_verifier(), get_session_factory(), window=timedelta(hours=hours)
    )
    if result is None:
        print("Apple verification or the App Store Server API is not configured", file=sys.stderr)
        return 2
    print(
        f"fetched={result.fetched} applied={result.applied} failed={result.failed} "
        f"skipped_environments={result.skipped_environments}"
    )
    return 1 if result.skipped_environments else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--hours", type=int, default=48, help="window to replay (max 4320)")
    args = parser.parse_args()
    sys.exit(asyncio.run(_main(min(max(args.hours, 1), 180 * 24))))

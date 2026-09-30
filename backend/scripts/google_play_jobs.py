"""Run the Google Play purchase jobs by hand (#2787, docs/IAP.md §7.6).

The API runs the same jobs in-process at startup and daily (``main.py``):
the voided-purchases poll (revokes refunded / charged-back purchases) and the
acknowledgement sweep (acknowledges owned purchases still unacknowledged
inside Google's 3-day window). Use this after an outage, or to check the
wiring. Run from ``backend/`` with the service's environment (Render shell):

    python scripts/google_play_jobs.py                 # voided: last 48 h, then sweep
    python scripts/google_play_jobs.py --hours 720     # voided: last 30 days (the API maximum)
    python scripts/google_play_jobs.py --sweep-only

Does nothing (exit 2) unless ``DATABASE_URL`` and the Google variables
(``GOOGLE_PLAY_PACKAGE_NAME``, ``GOOGLE_PLAY_SERVICE_ACCOUNT_JSON``,
``GOOGLE_RTDN_AUDIENCE``, ``GOOGLE_RTDN_PUSH_SA``) are set. Safe to repeat:
each voided purchase has its own dedupe key, and acknowledgement is idempotent.
Exit 1 when the Play API failed or anything could not be applied.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.base import get_session_factory, is_configured
from purchases import google
from purchases.google_notifications import acknowledge_sweep, poll_voided_purchases


async def _main(hours: int, sweep_only: bool) -> int:
    if not is_configured():
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    verifier = google.configured_verifier()
    if verifier is None:
        print("Google Play verification is not configured", file=sys.stderr)
        return 2
    code = 0
    if not sweep_only:
        voided = await poll_voided_purchases(
            verifier, get_session_factory(), window=timedelta(hours=hours)
        )
        assert voided is not None
        print(
            f"voided: fetched={voided.fetched} applied={voided.applied} failed={voided.failed} "
            f"api_failed={voided.api_failed} truncated={voided.truncated}"
        )
        if voided.api_failed or voided.failed:
            code = 1
    swept = await acknowledge_sweep(verifier, get_session_factory())
    assert swept is not None
    print(
        f"ack sweep: candidates={swept.candidates} acknowledged={swept.acknowledged} "
        f"failed={swept.failed}"
    )
    return 1 if swept.failed else code


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--hours", type=int, default=48, help="voided window (max 720)")
    parser.add_argument("--sweep-only", action="store_true", help="only the acknowledgement sweep")
    args = parser.parse_args()
    sys.exit(asyncio.run(_main(min(max(args.hours, 1), 30 * 24), args.sweep_only)))

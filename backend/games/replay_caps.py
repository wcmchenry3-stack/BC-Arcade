"""Per-game caps on stored replay events (#3292, epic #3273).

A *replay event* is any game event that is not a lifecycle event
(``LIFECYCLE_EVENT_NAMES``). Lifecycle rows are what history, sweeps and the
boards rely on, so they are never capped and never pruned; replay rows are
the per-move / per-wave detail, which is only worth keeping while it fits the
storage budget (docs/DATA-INVENTORY.md §2a).

``append_events`` stops storing a game's replay events once it holds
``max_events`` of them or ``max_bytes`` of their JSON. Over the cap the events
are dropped and the batch still succeeds (2xx), so a device drains its queue
and never retries. One Sentry warning per game type per hour says it happened.

The caps are config, not a registry: ``DEFAULT_CAP`` plus per-game overrides
in ``CAPS_BY_GAME_TYPE``. #3278 replaces this with the full event registry.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from observability.report import Throttle, report_event

# Kept by retention and never capped. Matches the app's P1 queue tier
# (``LIFECYCLE_EVENTS`` in frontend/src/game/_shared/eventQueueConfig.ts).
LIFECYCLE_EVENT_NAMES: frozenset[str] = frozenset({"game_started", "game_ended", "hand_resolved"})


@dataclass(frozen=True)
class ReplayCap:
    """The most replay events, and replay JSON bytes, one game may store."""

    max_events: int
    max_bytes: int


# ~40 KB is the estimate for a fully recorded game (docs/DATA-INVENTORY.md §2a);
# the default leaves room for a long game without letting one fill the budget.
DEFAULT_CAP = ReplayCap(max_events=1_000, max_bytes=64 * 1024)

# Per game type overrides. Star Swarm sends at most one ``wave_completed`` per
# wave, each at most 4 KB, and caps a run at 64 KB on the device (#3251).
CAPS_BY_GAME_TYPE: dict[str, ReplayCap] = {
    "starswarm": ReplayCap(max_events=200, max_bytes=64 * 1024),
}

# One cap report per game type per hour.
CAP_REPORT_WINDOW_S = 60 * 60
CAP_FINGERPRINT = "games-replay-cap-reached"


def is_replay_event(name: str) -> bool:
    return name not in LIFECYCLE_EVENT_NAMES


def cap_for(game_type: str | None) -> ReplayCap:
    """The cap for ``game_type``; ``DEFAULT_CAP`` when it has no override."""
    if game_type is None:
        return DEFAULT_CAP
    return CAPS_BY_GAME_TYPE.get(game_type, DEFAULT_CAP)


def event_bytes(data: Any) -> int:
    """The size of one event's ``data`` as stored: its JSON text, in bytes.

    ``json.dumps``'s default separators match Postgres' ``jsonb::text`` output,
    which ``stored_replay_totals`` measures with ``octet_length``.
    """
    return len(json.dumps(data, default=str).encode())


@dataclass(frozen=True)
class CapDecision:
    """Which candidates fit: the indices into the list ``apply_cap`` was given."""

    kept: list[int]
    dropped: int
    reason: str | None  # "events" or "bytes" when anything was dropped


def apply_cap(
    cap: ReplayCap, stored_events: int, stored_bytes: int, sizes: Iterable[int]
) -> CapDecision:
    """Keep replay events, in order, while the game stays within ``cap``.

    ``stored_events`` / ``stored_bytes`` are the game's replay totals already
    in the database; ``sizes`` are the new events' byte sizes in batch order.
    The first event that would go over a cap ends the game's recording: it
    and every later one are dropped, so a stored replay has no gaps.
    """
    kept: list[int] = []
    dropped = 0
    reason: str | None = None
    count, total = stored_events, stored_bytes
    for i, size in enumerate(sizes):
        if reason is None:
            if count + 1 > cap.max_events:
                reason = "events"
            elif total + size > cap.max_bytes:
                reason = "bytes"
        if reason is not None:
            dropped += 1
            continue
        count += 1
        total += size
        kept.append(i)
    return CapDecision(kept=kept, dropped=dropped, reason=reason)


_throttles: dict[str, Throttle] = {}


def report_cap_reached(game_type: str, decision: CapDecision, cap: ReplayCap) -> None:
    """One Sentry warning per game type per hour; counts and caps only, no ids."""
    throttle = _throttles.setdefault(game_type, Throttle(CAP_REPORT_WINDOW_S))
    if not throttle.allow():
        return
    report_event(
        f"POST /games/{{id}}/events: replay cap reached ({game_type})",
        level="warning",
        fingerprint=[CAP_FINGERPRINT, game_type],
        tags={"game_type": game_type, "subsystem": "games.replay_caps"},
        context={
            "replay_cap": {
                "reason": decision.reason,
                "dropped": decision.dropped,
                "max_events": cap.max_events,
                "max_bytes": cap.max_bytes,
            }
        },
    )

"""Per-game caps on stored game events (#3292, epic #3273).

A *replay event* is any game event that is not a lifecycle event
(``LIFECYCLE_EVENT_NAMES``): the per-move / per-wave detail, which is only
worth keeping while it fits the storage budget (docs/DATA-INVENTORY.md §2a).
Lifecycle rows are what history, sweeps and the boards rely on; retention
never prunes them, so they get their own, looser cap (``LIFECYCLE_CAP``) that
only a misbehaving client reaches.

``append_events`` stores a game's replay events only while it holds fewer
than ``max_events`` of them and their bytes (JSON plus ``ROW_OVERHEAD_BYTES``
per row) stay within ``max_bytes``, taken in ``event_index`` order. The first
replay event that does not fit sets the game's cutoff (``REPLAY_CUTOFF_KEY``
in its metadata, server-written only) to its index: stored replay rows at or
above it are deleted and later ones dropped, so the stored replay is always a
prefix by index, even though the app sends a game's rows tier by tier. The
kill switch (``REPLAY_RECORDING_ENABLED=false``, ``games.sessions``) cuts the
same way, marked ``REPLAY_PAUSED_KEY``. ``games.sessions._within_caps`` has
the full rule. Over a cap the events are dropped and the batch still succeeds
(2xx), so a device drains its queue and never retries. One Sentry warning per game type
per hour per kind of cap says it happened.

The caps are config, not a registry: ``DEFAULT_CAP`` plus per-game overrides
in ``CAPS_BY_GAME_TYPE``. #3278 replaces this with the full event registry.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from observability.report import Throttle, report_event
from payload_size import jsonb_bytes

# Never capped as replay and never pruned. Matches the app's P1 queue tier
# (``LIFECYCLE_EVENTS`` in frontend/src/game/_shared/eventQueueConfig.ts;
# tests/test_replay_caps.py checks the two stay in step).
LIFECYCLE_EVENT_NAMES: frozenset[str] = frozenset({"game_started", "game_ended", "hand_resolved"})

# Replay events retention keeps anyway: per-game summaries, not move logs
# (owner decision #3317). They still count toward the per-game caps.
RETENTION_KEEP_NAMES: frozenset[str] = frozenset({"wave_completed", "guess_submitted"})

# What one stored row costs beyond its JSON: tuple header, the other columns
# and the two index entries. Measured on PG16 at about 230 B/row including
# indexes; 200 is the round figure charged against the byte caps.
ROW_OVERHEAD_BYTES = 200


@dataclass(frozen=True)
class ReplayCap:
    """The most replay events, and replay bytes (JSON + row overhead), one game may store."""

    max_events: int
    max_bytes: int


# 500 events of ~130 B JSON + 200 B overhead ≈ 160 KB. Yacht uses this cap
# (#3282): the app sends one ``turn_completed`` per player per round, 26 events
# for a 13-round vs-computer game. The scripted fixture game
# (tests/fixtures/yacht_turn_events_v1.json) is 5,611 B as ``jsonb::text`` +
# 26 x 200 B overhead = 10,811 B; a worst-case game (every turn three rolls, 16
# hold taps, 12 alternatives, the computer's EVs: 556 B as ``jsonb::text``) is
# 26 x (556 + 200) = 19,656 B, 12% of this cap and 26 of its 500 events
# (tests/test_yacht_turn_event.py). Builds from before #3282 send the human's
# ``roll`` / ``score`` instead (a 13-round game: <= 39 rolls + 13 scores, ~16 KB).
DEFAULT_CAP = ReplayCap(max_events=500, max_bytes=160 * 1024)

# Star Swarm: one ``wave_completed`` per wave, a run of ≤ 200 waves, at most
# 64 KB of JSON per run on the device (#3251), plus 200 × 200 B overhead.
STARSWARM_CAP = ReplayCap(max_events=200, max_bytes=64 * 1024 + 200 * ROW_OVERHEAD_BYTES)

# The byte figures below are measured from the app's emitters, in the form the
# database stores (``jsonb::text``: ", " and ": " separators, UTF-8), with
# realistic large values, plus ROW_OVERHEAD_BYTES per row.

# owner decision #3317: 2048 sends one ``move`` per swipe; 2,000 events, and
# bytes sized so 2,000 moves fit with ROW_OVERHEAD_BYTES. A move measures
# <= 135 B (Twenty48Screen.tsx: direction, score_delta, score_after,
# highest_tile_after, is_game_over, has_won) + 200 B overhead = 335 B; 345 B
# leaves 10 B of margin for longer numbers: 2,000 x 345 B = 690,000 B.
# Lower it again once #3286 compacts moves. The GameRecorder envelope (``v``,
# ``unit``, ``t_ms``, ``actor``: about 35-40 B per event) is not in this figure:
# re-measure when 2048 adopts the recorder (#3286).
TWENTY48_CAP = ReplayCap(max_events=2_000, max_bytes=2_000 * 345)

# Blackjack, per round (#3284, blackjack/events.py; frontend/src/game/blackjack/
# replay.ts). The replay-tier row is ONE ``round_played`` per round: the bet, the
# deal, every action with the card it drew, the dealer's play and the recorder's
# envelope: 111-221 B of jsonb for the app's golden rounds (a split with a double and
# a dealer bust is the 221), about 360 B with the 200 B row overhead. ``hand_resolved``
# is lifecycle (its own cap below) and not counted here. 2,000 events / 560,000 B hold
# ~1,550 such rounds (1,330 of the heaviest). The figure is unchanged, but a run is held
# to the device's cap (``BLACKJACK_SESSION_MAX_BYTES`` = 96 KB, ~440 rounds) long before
# it. The old shapes (``bet_placed``, ``hand_dealt``, ``player_action``: 4.2 rows and
# ~1,090 B a round) still arrive from builds before #3284 and still fit ~480 rounds.
BLACKJACK_CAP = ReplayCap(max_events=2_000, max_bytes=400 * 1_400)

# Cascade: provisional until the Cascade refactor (not measured; owner, #3318).
CASCADE_CAP = ReplayCap(max_events=3_000, max_bytes=1_000 * 900)

CAPS_BY_GAME_TYPE: dict[str, ReplayCap] = {
    "blackjack": BLACKJACK_CAP,
    "cascade": CASCADE_CAP,
    "starswarm": STARSWARM_CAP,
    "twenty48": TWENTY48_CAP,
}


@dataclass(frozen=True)
class LifecycleCap:
    """Per-name counts and total bytes of one game's lifecycle rows."""

    max_counts: Mapping[str, int]
    max_bytes: int


# The app sends one ``game_started`` (event_index 0, ``gameEventClient.startGame``)
# and one ``game_ended`` (``completeGame``) per game id: a restart is a new game
# id, and a resume adopts the open id without a new ``game_started``. 4 leaves
# room for retries under new indices without letting a client spam rows that
# retention never prunes. ``hand_resolved`` is one per Blackjack hand (and per
# split hand): 1,000 is a very long session. Bytes: since #3284 a hand_resolved
# carries the hand's cards: ~105-115 B of jsonb (four cards, five-digit chips and
# the recorder's envelope), so 1,000 of them at + 200 B overhead ≈ 314 KB, plus 8
# start/end rows at up to 8 KB (the app's ``MAX_EVENT_PAYLOAD_BYTES``) + overhead
# ≈ 67 KB, so 381 KB of the 384 KB (tests/test_replay_caps.py).
LIFECYCLE_CAP = LifecycleCap(
    max_counts={"game_started": 4, "game_ended": 4, "hand_resolved": 1_000},
    max_bytes=384 * 1024,
)

# One cap report per game type per kind per hour.
CAP_REPORT_WINDOW_S = 60 * 60
CAP_FINGERPRINT = "games-replay-cap-reached"
LIFECYCLE_CAP_FINGERPRINT = "games-lifecycle-cap-reached"


def is_replay_event(name: str) -> bool:
    return name not in LIFECYCLE_EVENT_NAMES


def cap_for(game_type: str | None) -> ReplayCap:
    """The cap for ``game_type``; ``DEFAULT_CAP`` when it has no override."""
    if game_type is None:
        return DEFAULT_CAP
    return CAPS_BY_GAME_TYPE.get(game_type, DEFAULT_CAP)


def json_bytes(data: Any) -> int:
    """``payload_size.jsonb_bytes``: the length of the stored row's ``jsonb::text``.

    What ``stored_event_totals`` measures with ``octet_length``, and what the
    #3298 counters charge, so a new event's estimate and the stored row's size
    agree, exponent floats included (jsonb prints ``1.5e+300`` as 301 digits).
    """
    return jsonb_bytes(data)


def event_bytes(data: Any) -> int:
    """What one event costs against a byte cap: its JSON plus ``ROW_OVERHEAD_BYTES``."""
    return json_bytes(data) + ROW_OVERHEAD_BYTES


@dataclass
class StoredTotals:
    """A game's stored rows: replay count and bytes, lifecycle counts by name and bytes.

    Bytes include ``ROW_OVERHEAD_BYTES`` per row.
    """

    replay_events: int = 0
    replay_bytes: int = 0
    lifecycle_counts: dict[str, int] = field(default_factory=dict)
    lifecycle_bytes: int = 0

    def add(self, name: str, count: int, data_bytes: int) -> None:
        total = data_bytes + count * ROW_OVERHEAD_BYTES
        if is_replay_event(name):
            self.replay_events += count
            self.replay_bytes += total
        else:
            self.lifecycle_counts[name] = self.lifecycle_counts.get(name, 0) + count
            self.lifecycle_bytes += total


@dataclass(frozen=True)
class CapDecision:
    """Which candidates fit: the indices into the list the cap was given."""

    kept: list[int]
    dropped: int
    reason: str | None  # "events", "bytes", "cutoff" or a lifecycle name


def apply_cap(
    cap: ReplayCap, stored_events: int, stored_bytes: int, sizes: Iterable[int]
) -> CapDecision:
    """Keep replay events, in order, while the game stays within ``cap``.

    ``stored_events`` / ``stored_bytes`` are the game's replay totals already
    in the database; ``sizes`` are the new events' ``event_bytes`` in batch
    order. The first event that would go over a cap ends the game's
    recording: it and every later one are dropped.
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


def first_misfit(cap: ReplayCap, rows: Iterable[tuple[int, int]]) -> tuple[int, str] | None:
    """The first replay row that does not fit ``cap``, as ``(event_index, reason)``.

    ``rows`` are ``(event_index, event_bytes)`` of every replay row the game
    would hold, stored and new together, in ``event_index`` order: the stored
    replay is a prefix by index, so a row is charged only for the rows below it,
    never for a higher-index row that arrived first (the cut at the misfit
    deletes those). ``None`` when everything fits. ``reason`` is ``"events"`` or
    ``"bytes"``.
    """
    total = 0
    for count, (idx, size) in enumerate(rows):
        if count + 1 > cap.max_events:
            return idx, "events"
        if total + size > cap.max_bytes:
            return idx, "bytes"
        total += size
    return None


def apply_lifecycle_cap(
    cap: LifecycleCap,
    stored_counts: Mapping[str, int],
    stored_bytes: int,
    items: Iterable[tuple[str, int]],
) -> CapDecision:
    """Keep lifecycle rows, in order, while each name's count and the bytes fit.

    Unlike replay, a dropped row does not end the game's recording: a later
    ``game_ended`` still lands when an earlier, oversized row did not.
    """
    kept: list[int] = []
    dropped = 0
    reason: str | None = None
    counts = dict(stored_counts)
    total = stored_bytes
    for i, (name, size) in enumerate(items):
        limit = cap.max_counts.get(name)
        if limit is not None and counts.get(name, 0) + 1 > limit:
            dropped += 1
            reason = reason or name
            continue
        if total + size > cap.max_bytes:
            dropped += 1
            reason = reason or "bytes"
            continue
        counts[name] = counts.get(name, 0) + 1
        total += size
        kept.append(i)
    return CapDecision(kept=kept, dropped=dropped, reason=reason)


_throttles: dict[tuple[str, str], Throttle] = {}


def _allow(kind: str, game_type: str) -> bool:
    throttle = _throttles.setdefault((kind, game_type), Throttle(CAP_REPORT_WINDOW_S))
    return throttle.allow()


def report_cap_reached(game_type: str, decision: CapDecision, cap: ReplayCap) -> None:
    """One Sentry warning per game type per hour; counts and caps only, no ids."""
    if not _allow("replay", game_type):
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


def report_lifecycle_cap_reached(
    game_type: str, decision: CapDecision, cap: LifecycleCap = LIFECYCLE_CAP
) -> None:
    """One Sentry warning per game type per hour; counts and caps only, no ids."""
    if not _allow("lifecycle", game_type):
        return
    report_event(
        f"POST /games/{{id}}/events: lifecycle cap reached ({game_type})",
        level="warning",
        fingerprint=[LIFECYCLE_CAP_FINGERPRINT, game_type],
        tags={"game_type": game_type, "subsystem": "games.replay_caps"},
        context={
            "lifecycle_cap": {
                "reason": decision.reason,
                "dropped": decision.dropped,
                "max_counts": dict(cap.max_counts),
                "max_bytes": cap.max_bytes,
            }
        },
    )

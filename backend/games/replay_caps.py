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
# (owner decision #3317). They still count toward the per-game caps. The app
# uploads them from every session, sampled or not (#3279, D5): its
# RETENTION_KEEP_TYPES mirrors this list (tests/test_replay_dial.py).
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
# Solitaire and FreeCell use this cap too (#3289): the
# app sends one ``moves`` event per 25 actions, so a typical 300-action game is 12 rows,
# 5,850 B as ``jsonb::text`` + 12 x 200 B overhead (tests/fixtures/solitaire_moves_v1.json
# is a real won game), and the most the app sends is bounded per game by counts it saves
# with the game (1,200 actions, 60 rows, partial chunks from flushes included; the 20 KB
# byte cap restarts on every resume): 34,209 B with overhead in the worst mix (frontend
# replay.bench.test.ts), 21% of this cap and 61 of its 500 events
# (tests/test_card_game_moves.py).
DEFAULT_CAP = ReplayCap(max_events=500, max_bytes=160 * 1024)

# Mahjong (#3285) has no cap of its own: ``DEFAULT_CAP`` holds it. The app sends
# ``moves`` events of up to 25 actions (a pair is ``[143, 142]``: 10 B, a shuffle
# of a full 144-tile board ~950 B), so a cleared game is about 4 rows: 3,655 B of
# ``jsonb::text`` + 4 x 200 B overhead = 4,455 B (tests/test_mahjong_replay.py
# reads the fixture games). Even a player who shuffles and undoes all game cannot
# reach the cap, or the epic's 40 KB a game: the device stops at 20 KB of JSON
# (MAHJONG_SESSION_MAX_BYTES) and at 20 rows (MAHJONG_MAX_UNITS, the row-overhead
# half: the 200 B a row costs is invisible to a byte cap). Worst cases, stored:
# 20 rows of one full-board shuffle each (also one-action chunks from
# backgrounding the app after every shuffle) 28,920 B; 20 rows of 25 hints
# 7,380 B; 20 rows of one hint 4,980 B. A game that long needs a cap of its own
# only if that changes.

# Star Swarm: one ``wave_completed`` per wave, a run of ≤ 200 waves, at most
# 64 KB of compact JSON per run on the device (#3251), and (#3394, epic #3390,
# owner decision D4) at most 64 ``wave_timeline`` rows, 16 KB of compact JSON per
# run (docs/games/starswarm-diagnostics.md). 264 events. Bytes are what the
# database stores, ``jsonb::text`` (", " and ": " separators), plus 200 B a row:
# waves measure 1.143 x their compact size (the shared fixture, 2,248 B from
# 1,968 B), so 64 KB is 74,900 B (budgeted 1.15 x, 75,400 B); timelines at most
# 1.27 x (the three worked examples: 1.24-1.26 x; budgeted 1.30 x), 16 KB is
# 21,300 B; plus 264 x 200 B = 52,800 B. The first version of this figure counted the
# device's compact bytes as if they were stored (D4: 142,912 B); the jsonb re-check
# (tests/test_replay_caps.py) needs 149,500 B. Both parts are bounded on the device.
# The wave budget (1.15 x) is only just above the measured 1.143 x; if it is ever
# short the cap fails safe: rows are kept as a prefix, so only tail timelines drop.
_STARSWARM_WAVE_JSONB_BYTES = 75_400
_STARSWARM_TIMELINE_JSONB_BYTES = 21_300
STARSWARM_CAP = ReplayCap(
    max_events=264,
    max_bytes=_STARSWARM_WAVE_JSONB_BYTES
    + _STARSWARM_TIMELINE_JSONB_BYTES
    + 264 * ROW_OVERHEAD_BYTES,
)

# The byte figures below are measured from the app's emitters, in the form the
# database stores (``jsonb::text``: ", " and ": " separators, UTF-8), with
# realistic large values, plus ROW_OVERHEAD_BYTES per row.

# owner decision #3317: 2048 sends one ``move`` per swipe; 2,000 events, and
# bytes sized so 2,000 moves fit with ROW_OVERHEAD_BYTES. A move measures
# <= 135 B (Twenty48Screen.tsx: direction, score_delta, score_after,
# highest_tile_after, is_game_over, has_won) + 200 B overhead = 335 B; 345 B
# leaves 10 B of margin for longer numbers: 2,000 x 345 B = 690,000 B.
# Since #3286 the app sends ``moves`` events instead: 25 swipes each, as
# ``[direction, cell, value, gained, total]`` plus the recorder's envelope. A
# worst-case 2,000-swipe game is 80 rows of 769 B JSON (``jsonb::text``) + 200 B
# overhead = 969 B, 77,520 B in all (11% of this figure; tests/test_replay_caps.py).
# The app itself stops a game at 1,250 moves / 60 rows (``MAX_RECORDED_MOVES``,
# ``MAX_RECORDED_ROWS`` in twenty48/replay.ts): at most 46,061 B stored, over the
# 40 KB plan by owner decision #3373 (every win recorded in full).
# The figure stays for now because builds from before #3286 still send one
# ``move`` per swipe; lower it once they are gone.
TWENTY48_CAP = ReplayCap(max_events=2_000, max_bytes=2_000 * 345)

# Hearts (#3283, hearts/events.py, docs/games/hearts.md): no override, ``DEFAULT_CAP``.
# A hand is two rows: a ``hand_opened`` (the deal and the pass, <= 232 B JSON) and a
# ``hand_played`` (its 13 tricks and score, <= 264 B); a background mid-hand adds a row
# (a part). The 200 B row overhead is most of what a small row costs, so a hand is not
# sixteen rows (one per trick: ~55 KB for an 11-hand game). The 100-point rule ends a game
# within 16 hands (4 x 99 = 396 < 16 x 26), so the longest game is 32 rows: at the widest
# digits every number can have (``jsonb::text`` plus 200 B a row) 15,054 B, 6% of this cap's
# events and 9% of its bytes, and under half of the 40 KB a game the storage plan assumes.
# A real six-hand game is 12 rows and 5,392 B; an 11-hand game about 22 rows and 10 KB.
# A background or blur mid-hand makes a part (a row), so the app bounds them: at most 3 a
# hand before its last row, a blur only for 3+ tricks. The costliest game it can then make
# (16 hands, backgrounded after every trick, widest digits, the last hand left) is 80 rows
# and 28,494 B, under the 40 KB plan; with a part after every trick it would be 224 rows
# and 69,481 B.
# tests/test_hearts_replay_events.py holds these figures.

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

# Sudoku (#3288) has no cap of its own: it records ``entries`` events, one per 32
# player actions (digits, notes, erases, undos, hints), as short int lists
# (``[op, cell, digit]``). A typical full chunk is ~330 B of JSON and 436 B as
# ``jsonb::text`` (~14 B an entry), 636 B with ROW_OVERHEAD_BYTES; the worst
# possible one (every entry ``[0, 80, 9, 1]``, 10-digit numbers) is 411 B / 747 B.
# A heavy hard game (315 entries) is 10 rows and 6.3 KB, far inside DEFAULT_CAP.
# The device stops at 64 KB of JSON a session, which stored is at most 159 worst-case
# rows and 118,773 B: still inside DEFAULT_CAP's 500 events / 160 KB
# (tests/test_sudoku_replay_events.py), so the default holds. The app also stops
# at 50 rows a game (``MAX_REPLAY_ROWS``, saved with the game): the app hands over a
# row on every background or blur, so a much-interrupted game would otherwise make
# many tiny rows, each costing the 200 B overhead, and its device byte budget
# resets with every process. 50 worst-case rows are 37 KB, 50 one-entry rows ~14 KB,
# and 10% of the 500-event cap.

# Daily Word (#3287, owner decision #3368): ONE ``guess_submitted`` per game,
# holding every scored guess (``g``, ``t``, ``d``) and the refusal count
# (``rj``); refusals take no row of their own. The app records it when the game
# ends (win, loss, abandon), so a game stores 1 event; 4 leaves room for a
# resumed game's second session. An event is <= 238 B as ``jsonb::text`` (the
# worst: six guesses with accents and 99 refusals; the envelope ``v``, ``unit``,
# ``t_ms`` included) + ROW_OVERHEAD_BYTES = 438 B per game. The typical game
# (3-4 guesses) is 129-148 B + 200 B = 329-348 B (the fixture games in
# tests/fixtures/daily_word_guess_events_v1.json), under 1% of the 40 KB
# a recorded game is planned at. The cap is 4 x 600 B = 2,400 B. Lifecycle rows
# are not counted. Retention keeps these rows (RETENTION_KEEP_NAMES): they are
# unpruned, ~350 B per game, until the owner revisits that.
DAILY_WORD_CAP = ReplayCap(max_events=4, max_bytes=4 * 600)

# Cascade: provisional until the Cascade refactor (not measured; owner, #3318).
CASCADE_CAP = ReplayCap(max_events=3_000, max_bytes=1_000 * 900)

CAPS_BY_GAME_TYPE: dict[str, ReplayCap] = {
    "blackjack": BLACKJACK_CAP,
    "cascade": CASCADE_CAP,
    "daily_word": DAILY_WORD_CAP,
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

"""Cutting a game's stored replay to fit its caps (#3292, epic #3273).

``append_events`` (``games.sessions``) admits a batch through #3298's ceilings,
then hands what they admitted to ``within_caps`` here: the per-type replay caps
(``games.replay_caps``), the lifecycle caps and the kill switch. A game's stored
replay is always a prefix by ``event_index``; the first replay row that does not
fit, or that the server dropped for any other reason, sets the game's cutoff,
and stored replay rows at or above it are deleted.

A cut does **not** lower the game's #3298 counters (``games.event_count`` /
``event_bytes``): they total the rows *written*, and only retention
(``games.replay_storage``), which ages rows out, lowers them. Otherwise a
client could send ever-lower batches that each displace the stored rows above
and churn past the per-game and per-session ceilings (#3318 review round 5).
"""

from __future__ import annotations

import heapq
import uuid
from typing import Any

from sqlalchemy import Text, cast, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from db.dialect import dialect_name
from db.models import EventType, Game, GameEvent
from games import replay_caps
from games.filters import (
    REPLAY_CAPPED_KEY,
    REPLAY_CUTOFF_KEY,
    REPLAY_PAUSED_KEY,
    is_replay_capped,
    replay_cutoff,
)


def lower_cut(cut: int | None, name: str, idx: int) -> int | None:
    """``cut`` lowered to ``idx`` when a replay (non-lifecycle) row at ``idx`` was dropped."""
    if replay_caps.is_replay_event(name) and (cut is None or idx < cut):
        return idx
    return cut


async def within_caps(
    session: AsyncSession,
    game: Game,
    type_name: str | None,
    rows: list[dict[str, Any]],
    names: dict[int, str],
    *,
    ceiling_cut: int | None = None,
    recording: bool = True,
) -> tuple[list[dict[str, Any]], bool]:
    """``rows`` less the events over the game's caps (#3292), and whether the game changed.

    A game's stored replay is always a prefix by ``event_index``. The app sends
    a game's rows tier by tier (lifecycle, mid, granular), so a higher-index
    ``score`` can land before the lower-index ``roll`` rows; the cut is
    therefore by index, not by arrival:

    * The game's stored replay rows and the batch's are merged in
      ``event_index`` order and taken while they fit
      ``replay_caps.cap_for(type_name)``. The first that does not (stored or
      new) sets the game's cutoff (``REPLAY_CUTOFF_KEY``) to its index, and
      stored replay rows at or above it — the ones that arrived early — are
      deleted. A stored row above the cut is not charged to the rows below it,
      so a cut removes only what it must.
    * From then on replay rows at or above the cutoff are dropped; one below it
      is stored if the merged prefix still fits, and otherwise lowers the cutoff
      the same way.
    * ``recording`` false (``REPLAY_RECORDING_ENABLED``, the kill switch) drops every replay
      row and cuts the same way at the lowest dropped index, so switching it
      back on never leaves a hole.
    * ``ceiling_cut``: the lowest replay index #3298's admission dropped in this
      batch (a per-game or per-session ceiling, the per-event size cap, or the
      game module refusing the row) cuts
      the same way, marked ``REPLAY_CAPPED_KEY``; dropping only lifecycle rows
      cuts nothing.

    The reason is kept too: ``REPLAY_CAPPED_KEY`` or ``REPLAY_PAUSED_KEY``,
    each written once. Lifecycle rows past ``LIFECYCLE_CAP`` are dropped one by
    one and never cut anything. Costs one aggregate query over the game's
    stored rows (``stored_event_totals``), only when a row in the batch needs
    it, plus a primary-key range read of the stored replay rows below the cut
    (index and size, at most ``max_events + 1`` rows) when the batch has a
    replay row to place, and a primary-key range ``DELETE`` when the cutoff
    moves (at most the game's capped rows). Cap drops are reported, throttled
    per game type.
    """
    if not rows and ceiling_cut is None:
        return rows, False
    game_type = type_name or "unknown"
    # Replay positions in event_index order: the cap is a prefix by index.
    replay_pos = sorted(
        (p for p, r in enumerate(rows) if replay_caps.is_replay_event(names[r["event_type_id"]])),
        key=lambda p: rows[p]["event_index"],
    )
    replay_set = set(replay_pos)
    life_pos = [p for p in range(len(rows)) if p not in replay_set]
    dropped: set[int] = set()
    changed = False
    cutoff = replay_cutoff(game.game_metadata)
    # The cut in force for this batch: the stored cutoff, or a ceiling's, if lower.
    limit = min((c for c in (cutoff, ceiling_cut) if c is not None), default=None)
    below = [p for p in replay_pos if limit is None or rows[p]["event_index"] < limit]
    below_set = set(below)
    above = [p for p in replay_pos if p not in below_set]

    # Only lifecycle rows need the aggregate totals; replay rows are placed
    # against the stored replay rows themselves (below).
    totals = replay_caps.StoredTotals()
    if life_pos:
        totals = await stored_event_totals(session, game.id)

    # (index, reason) of every cut this batch makes; the lowest one is applied.
    cuts: list[tuple[int, str]] = []
    if ceiling_cut is not None:
        cuts.append((ceiling_cut, REPLAY_CAPPED_KEY))
    cap = replay_caps.cap_for(type_name)
    cap_dropped, cap_reason = 0, None
    if replay_pos and not recording:
        # The no-release kill switch (until #3279). Not a cap: nothing reported.
        dropped |= replay_set
        cuts.append((rows[replay_pos[0]]["event_index"], REPLAY_PAUSED_KEY))
    elif replay_pos:
        # Rows the kill switch or the cutoff drops need no stored rows; skip the
        # read when nothing in the batch is below the cut.
        stored = await _stored_replay_sizes(session, game.id, limit, cap) if below else []
        misfits, cut_at, cap_dropped, cap_reason = _replay_misfits(
            cap, stored, rows, below, len(above) if is_replay_capped(game.game_metadata) else 0
        )
        dropped |= set(above) | set(misfits)
        if cut_at is not None:
            cuts.append((cut_at, REPLAY_CAPPED_KEY))

    if cuts:
        new_cutoff, reason_key = min(cuts)
        if cutoff is None or new_cutoff < cutoff:
            await _cut_replay(session, game, new_cutoff, reason_key)
            changed = True
    if cap_dropped:
        replay_caps.report_cap_reached(
            game_type, replay_caps.CapDecision(kept=[], dropped=cap_dropped, reason=cap_reason), cap
        )

    if life_pos:
        decision = replay_caps.apply_lifecycle_cap(
            replay_caps.LIFECYCLE_CAP,
            totals.lifecycle_counts,
            totals.lifecycle_bytes,
            (
                (names[rows[p]["event_type_id"]], replay_caps.event_bytes(rows[p]["data"]))
                for p in life_pos
            ),
        )
        if decision.dropped:
            dropped |= set(life_pos) - {life_pos[k] for k in decision.kept}
            replay_caps.report_lifecycle_cap_reached(game_type, decision)

    return [r for p, r in enumerate(rows) if p not in dropped], changed


def _replay_misfits(
    cap: replay_caps.ReplayCap,
    stored: list[tuple[int, int]],
    rows: list[dict[str, Any]],
    below: list[int],
    already_cut: int,
) -> tuple[list[int], int | None, int, str | None]:
    """Positions in ``below`` that do not fit ``cap``, the index to cut at, and what to report.

    ``stored`` are the game's stored replay rows below the cut in force, as
    ``(event_index, event_bytes)`` in index order; ``below`` the batch's replay
    positions below it, in index order. The two are merged by index and taken
    while they fit (``replay_caps.first_misfit``): the cut is at the first
    misfit, which may be a stored row, and every batch row at or above it is a
    misfit. ``already_cut`` counts rows a cap's earlier cutoff dropped, reported
    as ``"cutoff"`` when nothing new overflows.
    """
    reason: str | None = "cutoff" if already_cut else None
    if not below:
        return [], None, already_cut, reason
    new = [(rows[p]["event_index"], replay_caps.event_bytes(rows[p]["data"])) for p in below]
    merged = heapq.merge(stored, new)
    misfit = replay_caps.first_misfit(cap, merged)
    if misfit is None:
        return [], None, already_cut, reason
    cut_at, why = misfit
    misfits = [p for p in below if rows[p]["event_index"] >= cut_at]
    return misfits, cut_at, already_cut + len(misfits), why


def event_size_sql(session: AsyncSession):
    """A stored row's size in SQL: ``octet_length(data::text)`` on Postgres.

    Equal to ``payload_size.jsonb_bytes`` of the row (tests/test_replay_storage_pg.py).
    SQLite keeps JSON as text written with ASCII escapes, so its ``length`` is only
    close; it is used there for the cap totals, never to lower a counter.
    """
    if dialect_name(session) == "sqlite":
        return func.length(GameEvent.data)
    return func.octet_length(cast(GameEvent.data, Text))


async def _stored_replay_sizes(
    session: AsyncSession, game_id: uuid.UUID, limit: int | None, cap: replay_caps.ReplayCap
) -> list[tuple[int, int]]:
    """The game's stored replay rows below ``limit``: ``(event_index, event_bytes)``, by index.

    At most ``cap.max_events + 1`` rows: the merged prefix overflows by then, so
    rows past them never decide the cut. Read through the primary key's
    ``game_id`` prefix.
    """
    stmt = (
        select(GameEvent.event_index, event_size_sql(session))
        .join(EventType, EventType.id == GameEvent.event_type_id)
        .where(
            GameEvent.game_id == game_id,
            EventType.name.notin_(replay_caps.LIFECYCLE_EVENT_NAMES),
        )
        .order_by(GameEvent.event_index)
        .limit(cap.max_events + 1)
    )
    if limit is not None:
        stmt = stmt.where(GameEvent.event_index < limit)
    return [
        (int(idx), int(size) + replay_caps.ROW_OVERHEAD_BYTES)
        for idx, size in await session.execute(stmt)
    ]


async def _cut_replay(
    session: AsyncSession, game: Game, cutoff: int, reason_key: str | None
) -> None:
    """Lower ``game``'s replay cutoff to ``cutoff`` and delete stored replay rows at or above it.

    The metadata is reassigned, not mutated (the JSONB column is not a
    MutableDict), and written with the batch's commit; the reason flag is set
    only if it is not already. The row is held FOR UPDATE, so no concurrent
    batch or completion races it. The ``DELETE`` is a range on the primary key
    ``(game_id, event_index)``. The game's #3298 counters are left as they are:
    they total the rows written, so displacing stored rows cannot buy a client
    more writes (module docstring).
    """
    metadata = {**(game.game_metadata or {}), REPLAY_CUTOFF_KEY: cutoff}
    if reason_key is not None:
        metadata[reason_key] = True
    game.game_metadata = metadata
    flag_modified(game, "game_metadata")
    await session.execute(
        delete(GameEvent)
        .where(
            GameEvent.game_id == game.id,
            GameEvent.event_index >= cutoff,
            GameEvent.event_type_id.in_(
                select(EventType.id).where(EventType.name.notin_(replay_caps.LIFECYCLE_EVENT_NAMES))
            ),
        )
        .execution_options(synchronize_session=False)
    )


async def stored_event_totals(
    session: AsyncSession, game_id: uuid.UUID
) -> replay_caps.StoredTotals:
    """``game_id``'s stored rows by event type name: counts and bytes (JSON + overhead).

    Grouped by name through ``event_types``, so rows of a deprecated (or since
    renamed-away) type still count. Read through the primary key's
    ``game_id`` prefix.
    """
    size = event_size_sql(session)
    rows = await session.execute(
        select(EventType.name, func.count(), func.coalesce(func.sum(size), 0))
        .select_from(GameEvent)
        .join(EventType, EventType.id == GameEvent.event_type_id)
        .where(GameEvent.game_id == game_id)
        .group_by(EventType.name)
    )
    totals = replay_caps.StoredTotals()
    for name, count, data_bytes in rows:
        totals.add(name, int(count), int(data_bytes))
    return totals

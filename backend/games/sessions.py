"""Session writes for the games API: create, append events, complete (#364).

Idempotency strategy:
- Games: client may supply `id`; re-creating with the same id returns existing.
- Events: `(game_id, event_index)` is the composite PK. We use dialect-aware
  `INSERT ... ON CONFLICT DO NOTHING` so repeat batches are safe.
- Caps (#3292): a game's replay and lifecycle events past their caps in
  ``games.replay_caps`` are dropped, but the batch still answers 2xx. The game
  row is taken FOR UPDATE, so one game's batches run one at a time.
- Complete: re-completing a finished game returns its existing state without
  overwriting — except a row closed by the stale-session sweep (#2621), which a
  real completion replaces.

Also home to ``GameServiceError``, the error every games module raises; an
app-level handler in ``main.py`` turns it into the HTTP response (#2993).
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified

from db.dialect import dialect_insert, dialect_name
from db.locks import EVENTS_NAMESPACE, lock_session
from db.models import Game, GameEvent
from games import catalog_cache, replay_cut
from games.boards.limits import check_completion_limits, merge_result_metadata
from games.catalog_cache import GameTypeRow
from games.filters import (
    is_swept,
    without_server_flags,
    without_swept,
)
from games.legacy_outcomes import might_be_legacy_win, win_update
from games.protocol import GameModule
from games.registry import get_module
from observability.report import report_rejected_result
from payload_size import json_bytes, jsonb_bytes
from players.service import remember_legacy_opt_in
from settings import Settings
from vocab import GameOutcome

logger = logging.getLogger(__name__)

_VALID_OUTCOMES = frozenset(v.value for v in GameOutcome)

_settings: Settings | None = None


def _get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def _max_result_bytes() -> int:
    """``MAX_RESULT_BYTES`` (settings.py), read lazily."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings.max_result_bytes


def _replay_recording_enabled() -> bool:
    """``REPLAY_RECORDING_ENABLED`` (settings.py), read lazily: the replay kill switch."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings.replay_recording_enabled


# Rolling window of the per-session event-bytes ceiling (#3298).
SESSION_EVENT_WINDOW = timedelta(hours=24)
_TS_WINDOW_LOW = timedelta(days=365)
_TS_WINDOW_HIGH = timedelta(hours=24)


def _validate_client_timestamp(ts: datetime, now: datetime) -> datetime | None:
    """Return ts if it falls within [now − 1 year, now + 24 h]; else None.

    Normalises naive datetimes to UTC. A skewed or bogus client clock falls
    back to server-side stamping rather than poisoning the history table.
    """
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    if ts < now - _TS_WINDOW_LOW or ts > now + _TS_WINDOW_HIGH:
        return None
    return ts


class GameServiceError(Exception):
    """Base error raised by the games service — answered as HTTP by ``main.py``'s handler."""

    def __init__(self, status_code: int, detail: str | dict):
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))


@dataclass
class AppendResult:
    accepted: int
    duplicates: int
    rejected: list[str]
    dropped: int = 0


async def _resolve_game_type(session: AsyncSession, name: str) -> GameTypeRow:
    gt = await catalog_cache.get_game_type(session, name)
    if gt is None or not gt.is_active:
        raise GameServiceError(400, f"Unknown or inactive game_type: {name!r}")
    return gt


async def create_game(
    session: AsyncSession,
    *,
    session_id: str,
    client_id: uuid.UUID | None,
    game_type_name: str,
    metadata: dict[str, Any],
    players: list[dict[str, Any]],
    started_at: datetime | None = None,
) -> Game:
    # 413, not 422: a terminal 4xx the client dead-letters, so it never retries (#3298).
    if json_bytes([metadata, players]) > _get_settings().max_game_metadata_bytes:
        raise GameServiceError(413, "Game metadata and players are too large.")
    gt = await _resolve_game_type(session, game_type_name)

    if client_id is not None:
        existing = (
            await session.execute(select(Game).where(Game.id == client_id))
        ).scalar_one_or_none()
        if existing is not None:
            if existing.session_id != session_id:
                raise GameServiceError(403, "Game belongs to a different session.")
            return existing

    now = datetime.now(UTC)
    game = Game(
        id=client_id or uuid.uuid4(),
        session_id=session_id,
        game_type_id=gt.id,
        # The sweep and replay-cap flags are server-written only (#2621, #3292).
        game_metadata=without_server_flags(metadata),
        players=players,
    )
    valid_started_at = _validate_client_timestamp(started_at, now) if started_at else None
    if valid_started_at is not None:
        game.started_at = valid_started_at
    session.add(game)
    # A name in the creation metadata (builds before #2624) was the player
    # joining the boards: keep that choice, under a generated name (#2778).
    await remember_legacy_opt_in(session, session_id, (metadata or {}).get("player_name"))
    # No refresh: Game's eager_defaults loads started_at in the INSERT (#2966).
    await session.commit()
    return game


async def _get_owned_game(
    session: AsyncSession,
    game_id: uuid.UUID,
    session_id: str,
    *,
    for_update: bool = False,
    with_game_type: bool = False,
) -> Game:
    stmt = select(Game).where(Game.id == game_id)
    if with_game_type:
        # A separate SELECT on game_types: FOR UPDATE below locks only the game row.
        stmt = stmt.options(selectinload(Game.game_type))
    if for_update:
        # Postgres: hold the row until commit. SQLite renders no FOR UPDATE.
        stmt = stmt.with_for_update()
    game = (await session.execute(stmt)).scalar_one_or_none()
    if game is None:
        raise GameServiceError(404, "Game not found.")
    if game.session_id != session_id:
        raise GameServiceError(403, "Game belongs to a different session.")
    return game


def _upsert_ignore(session: AsyncSession, table, rows: list[dict]):
    """Dialect-aware INSERT ... ON CONFLICT DO NOTHING.

    Postgres and SQLite both support on_conflict_do_nothing via their
    dialect-specific insert() constructors, so the API test suite can run
    against either backend.
    """
    return dialect_insert(session, table).values(rows).on_conflict_do_nothing()


async def _session_event_bytes(session: AsyncSession, session_id: str) -> int:
    """Event bytes stored by the session's games created in the last 24 h (#3298)."""
    return (
        await session.execute(
            select(func.coalesce(func.sum(Game.event_bytes), 0)).where(
                Game.session_id == session_id,
                Game.created_at > datetime.now(UTC) - SESSION_EVENT_WINDOW,
            )
        )
    ).scalar_one()


async def _stored_indices(
    session: AsyncSession, game_id: uuid.UUID, indices: list[int]
) -> set[int]:
    """Which of ``indices`` the game already has stored."""
    if not indices:
        return set()
    return set(
        (
            await session.execute(
                select(GameEvent.event_index).where(
                    GameEvent.game_id == game_id, GameEvent.event_index.in_(indices)
                )
            )
        )
        .scalars()
        .all()
    )


async def _admit_events(
    session: AsyncSession,
    game: Game,
    session_id: str,
    candidates: list[tuple[str, int, dict[str, Any]]],
    event_type_map: dict[str, int],
    module: GameModule | None,
) -> tuple[list[dict[str, Any]], list[int], int, int | None]:
    """Rows to insert, their byte sizes, how many events were dropped (#3298), and
    the lowest ``event_index`` of a replay event dropped here (#3292), if any: by a
    ceiling, by the per-event size cap or by the game's own check. Every
    server-side drop of a replay row cuts the game's replay there, so the stored
    replay has no gaps.

    Drops an event the game's own check refuses (not counted as dropped), one over
    ``MAX_EVENT_DATA_BYTES``, and every event once a ceiling is reached. Sizes are
    ``payload_size.jsonb_bytes``, the stored row's ``jsonb::text`` length, so the
    counters charged here are exactly what a cut or retention later subtracts.
    """
    cfg = _get_settings()
    # Read after the lock, by column: the ``game`` loaded earlier may be stale.
    game_events_n, game_bytes = (
        await session.execute(select(Game.event_count, Game.event_bytes).where(Game.id == game.id))
    ).one()
    session_bytes = await _session_event_bytes(session, session_id)
    rows: list[dict[str, Any]] = []
    row_bytes: list[int] = []
    dropped = 0
    ceiling_cut: int | None = None
    for name, idx, data in candidates:
        if (
            game_events_n >= cfg.max_events_per_game
            or game_bytes >= cfg.max_event_bytes_per_game
            or session_bytes >= cfg.max_event_bytes_per_session_day
        ):
            dropped += 1
            ceiling_cut = replay_cut.lower_cut(ceiling_cut, name, idx)
            continue
        if module is not None:
            # The game's own check (#3250): None drops this event, not the batch.
            # The client still gets a 2xx, so its queue row drains. Runs after
            # the 400 above, so a refused batch reports nothing. A refused replay
            # row cuts the replay there, like every server-side drop (#3318 N2).
            data = module.validate_event(name, data)
            if data is None:
                ceiling_cut = replay_cut.lower_cut(ceiling_cut, name, idx)
                continue
        # Per-event size cap (#3298): drop the one event with a 2xx. A 413 would
        # make the client split the batch and dead-letter row by row. Data with a
        # lone surrogate (``"\ud800"``) has no UTF-8 form and Postgres cannot store
        # it: dropped the same way, rather than a 500 the client would retry.
        try:
            size = jsonb_bytes(data)
        except UnicodeEncodeError:
            size = None
        if size is None or size > cfg.max_event_data_bytes:
            dropped += 1
            ceiling_cut = replay_cut.lower_cut(ceiling_cut, name, idx)
            continue
        game_events_n += 1
        game_bytes += size
        session_bytes += size
        row_bytes.append(size)
        rows.append(
            {
                "game_id": game.id,
                "event_index": idx,
                "event_type_id": event_type_map[name],
                "data": data,
            }
        )
    return rows, row_bytes, dropped, ceiling_cut


async def _store_events(
    session: AsyncSession,
    game_id: uuid.UUID,
    rows: list[dict[str, Any]],
    row_bytes: list[int],
) -> None:
    """Insert the rows and advance the game's counters in one transaction."""
    await session.execute(_upsert_ignore(session, GameEvent.__table__, rows))
    await session.execute(
        update(Game)
        .where(Game.id == game_id)
        .values(
            event_bytes=Game.event_bytes + sum(row_bytes),
            event_count=Game.event_count + len(rows),
        )
    )
    await session.commit()


async def append_events(
    session: AsyncSession,
    *,
    game_id: uuid.UUID,
    session_id: str,
    events: list[dict[str, Any]],
) -> AppendResult:
    # One lock order for the append path: the session's advisory lock first (#3298,
    # a bounded 2 s wait, then 503), then the game row FOR UPDATE (#3292). The row
    # lock keeps a completion (which takes only the row lock) from interleaving
    # with a replay cut that rewrites the game's metadata; taking it second means
    # a request waiting on the session lock never holds the row meanwhile.
    await lock_session(session, session_id, EVENTS_NAMESPACE)
    game = await _get_owned_game(session, game_id, session_id, for_update=True)
    # A swept row is still open as far as the device is concerned: a long-offline
    # queue flushes its events before the completion that replaces the sweep.
    if game.completed_at is not None and not is_swept(game.game_metadata):
        raise GameServiceError(409, "Game is already completed.")

    event_type_map = await catalog_cache.event_type_ids(session, game.game_type_id)

    rejected: set[str] = set()
    seen_indices: set[int] = set()
    candidates: list[tuple[str, int, dict[str, Any]]] = []
    type_name = await catalog_cache.game_type_name(session, game.game_type_id)
    module = get_module(type_name) if type_name else None

    for ev in events:
        name = ev["event_type"]
        idx = ev["event_index"]
        if name not in event_type_map:
            rejected.add(name)
            continue
        if idx in seen_indices:
            # duplicate within the same batch → ignore second occurrence
            continue
        seen_indices.add(idx)
        candidates.append((name, idx, ev["data"]))

    if rejected:
        raise GameServiceError(
            400,
            {"error": "unknown_event_type", "rejected": sorted(rejected)},
        )

    # Ceilings (#3298): a game past its stored-event count or bytes, or a session past
    # its rolling-24 h event bytes, stops growing. They are read from the running
    # totals on ``games`` (no scan of ``game_events``) and advanced per event, so a
    # batch stops at the ceiling. The per-session advisory lock (Postgres, taken
    # first, above) makes concurrent appends for one session take turns: the totals
    # are read after the lock and the insert commits in the same transaction. A
    # ceiling is checked before each event is added, so a game or session ends at
    # most one event over it. Dropped with a 2xx, not an error: the client
    # dead-letters any 4xx, while a 2xx drains the row.
    stored = await _stored_indices(session, game.id, [c[1] for c in candidates])
    duplicates = sum(1 for _, idx, _ in candidates if idx in stored)
    rows, row_bytes, dropped, ceiling_cut = await _admit_events(
        session,
        game,
        session_id,
        [c for c in candidates if c[1] not in stored],
        event_type_map,
        module,
    )
    # Then the replay caps (#3292) on what the ceilings admitted: per-type replay
    # caps cut by event_index, lifecycle caps, and the kill switch. Only rows not
    # already stored are charged, so a retried batch still answers with its
    # duplicates. Their drops count in ``dropped`` too. A replay row a ceiling
    # dropped (or the size cap, or the game's own check) cuts the game's replay at its
    # index, as a cap does (``ceiling_cut``).
    names = {i: n for n, i in event_type_map.items()}
    sizes = {r["event_index"]: b for r, b in zip(rows, row_bytes, strict=True)}
    kept, changed = await replay_cut.within_caps(
        session,
        game,
        type_name,
        rows,
        names,
        ceiling_cut=ceiling_cut,
        recording=_replay_recording_enabled(),
    )
    dropped += len(rows) - len(kept)
    rows, row_bytes = kept, [sizes[r["event_index"]] for r in kept]
    if rows:
        await _store_events(session, game.id, rows, row_bytes)
    elif changed:
        # A cut with nothing to insert: commit the metadata and the delete.
        await session.commit()
    else:
        # Nothing to write: end the transaction now, releasing the session lock early.
        await session.rollback()

    return AppendResult(
        accepted=len(rows),
        duplicates=duplicates,
        rejected=[],
        dropped=dropped,
    )


async def complete_game(  # noqa: PLR0913 - keyword-only fields of one completion
    session: AsyncSession,
    *,
    game_id: uuid.UUID,
    session_id: str,
    final_score: int | None,
    outcome: str | None,
    duration_ms: int | None,
    completed_at: datetime | None = None,
    result: dict[str, Any] | None = None,
) -> Game:
    """Finish the caller's game; returns it with ``game.game_type`` loaded.

    The router builds its response from ``game.game_type.name``, so the type
    is loaded with the game (and reloaded by the final refresh) rather than
    re-selected afterwards (#2993).
    """
    # FOR UPDATE: on Postgres a concurrent sweep waits for this completion, then
    # finds the row no longer open (#2621).
    game = await _get_owned_game(session, game_id, session_id, for_update=True, with_game_type=True)
    if game.completed_at is not None and not is_swept(game.game_metadata):
        return game  # idempotent — do not overwrite

    if outcome is not None and outcome not in _VALID_OUTCOMES:
        raise GameServiceError(400, f"Invalid outcome: {outcome!r}")

    name = game.game_type.name
    mod = get_module(name)
    # The server flags are server-written only: a result must not set them (#2621, #3292).
    validated_result = without_server_flags(
        await _validate_result(session, game, result, name, mod, final_score)
    )
    # Optional per-game hook: a game whose score is part of its result block
    # fills in a missing ``final_score`` from it, or rejects one that doesn't
    # match it (Blackjack's closing chips, #2745).
    if mod is not None:
        try:
            final_score = mod.derive_final_score(final_score, outcome, validated_result)
        except ValueError as e:
            _report_rejected_result(name, "final_score mismatch", {"outcome": outcome})
            raise GameServiceError(400, f"Invalid final_score for {name}: {e}") from e
    # The board's caps and value types (#2618, absorbs #2215).
    violation = check_completion_limits(name, mod, game, final_score, validated_result)
    if violation is not None:
        _report_rejected_result(
            violation.game_type, "over board limit", {"field": violation.metric}
        )
        raise GameServiceError(400, violation.detail)

    now = datetime.now(UTC)
    valid_completed_at = _validate_client_timestamp(completed_at, now) if completed_at else None
    game.completed_at = valid_completed_at if valid_completed_at is not None else now
    # Server time, never the device's: orders ties on the boards (#2765).
    game.received_at = now
    game.final_score = final_score
    game.outcome = outcome
    game.duration_ms = duration_ms
    # Reassign (never mutate in place) — the JSONB column isn't a MutableDict.
    # Creation-time keys win unless they hold null (merge_result_metadata);
    # the limit check above merged the same way.
    game.game_metadata = merge_result_metadata(without_swept(game.game_metadata), validated_result)
    # Always write metadata, in this same UPDATE, even when it looks unchanged:
    # a sweep that committed after the row was read (where FOR UPDATE is not
    # available — SQLite) set the flag in the database, and the completion must
    # still leave the row finished and unflagged. A real completion replaces a
    # sweep and puts the row back under "first completion wins" (#2621).
    flag_modified(game, "game_metadata")
    if might_be_legacy_win(name, outcome):
        # An older build's certain win is stored as ``win`` (#2703), by the
        # same rule migration 0028 applied to the rows stored before it. One
        # UPDATE on this row, in this transaction, after the completion above
        # is flushed; the refresh below reads back what it stored.
        await session.flush()
        await session.execute(win_update(name, dialect_name(session), game_id=game.id))
    await session.commit()
    await session.refresh(game)
    return game


async def _validate_result(
    session: AsyncSession,
    game: Game,
    result: dict[str, Any] | None,
    name: str,
    mod: GameModule | None,
    final_score: int | None = None,
) -> dict:
    """Validate *result* against the game module's ``result_model`` (#2449).

    ``name`` and ``mod`` are the game's type name and registered module, as
    ``complete_game`` resolved them. Games without a registered module or a
    ``result_model`` accept any dict unvalidated. Only fields the client
    actually sent are returned. The request body's ``final_score`` (what becomes
    ``games.final_score``) is handed to the model as ``context={"final_score": ...}``
    so a model can reconcile its block against it; models that don't read it
    are unaffected. Results over ``MAX_RESULT_BYTES`` are
    rejected — unvalidated games have no other bound.
    """
    if not result:
        return {}
    if len(json.dumps(result, default=str)) > _max_result_bytes():
        _report_rejected_result(name, "result too large", {"keys": sorted(result)[:20]})
        raise GameServiceError(400, "Result too large.")
    result_model = mod.result_model if mod is not None else None
    if result_model is None:
        return dict(result)
    try:
        validated = result_model.model_validate(
            result, context={"final_score": final_score}
        ).model_dump(exclude_unset=True)
    except ValidationError as e:
        errors = e.errors()
        fields = ", ".join(".".join(str(p) for p in err["loc"]) for err in errors)
        _report_rejected_result(
            name,
            "invalid result",
            {"fields": fields, "error_types": sorted({err["type"] for err in errors})},
        )
        raise GameServiceError(400, f"Invalid result for {name}: {fields}") from e
    # Optional per-game hook: correct a validated result against server-side
    # state the client cannot be trusted on (Daily Word's guess record, #2541).
    if mod is not None:
        validated = await mod.reconcile_result(session, game, validated)
    return validated


def _report_rejected_result(game_type: str, reason: str, extra: dict[str, Any]) -> None:
    """Send a rejected completion result to Sentry (#2449).

    A 400 on ``/complete`` is dead-lettered by the app's sync worker, so the
    game's score is lost — this must be visible server-side, not just in the
    client's own report. Field paths and error types only: no session id (the
    privacy policy says crash reports carry no identifier) and no result values.
    """
    report_rejected_result(game_type, reason, extra)

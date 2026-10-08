"""Session writes for the games API: create, append events, complete (#364).

Idempotency strategy:
- Games: client may supply `id`; re-creating with the same id returns existing.
- Events: `(game_id, event_index)` is the composite PK. We use dialect-aware
  `INSERT ... ON CONFLICT DO NOTHING` so repeat batches are safe.
- Complete: re-completing a finished game returns its existing state without
  overwriting — except a row closed by the stale-session sweep (#2621), which a
  real completion replaces.

Also home to ``GameServiceError``, the error every games module raises and the
router translates to HTTP.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import sentry_sdk
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from db.dialect import dialect_insert, dialect_name
from db.models import Game, GameEvent, GameType
from games import catalog_cache
from games.catalog_cache import GameTypeRow
from games.filters import is_swept, without_swept
from games.leaderboard import check_completion_limits, merge_result_metadata
from games.legacy_outcomes import might_be_legacy_win, win_update
from games.protocol import GameModule
from games.registry import get_module
from players.service import remember_legacy_opt_in
from vocab import GameOutcome

logger = logging.getLogger(__name__)

_VALID_OUTCOMES = frozenset(v.value for v in GameOutcome)

_MAX_RESULT_BYTES = 8192
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
    """Base error raised by the games service — translated to HTTP by the router."""

    def __init__(self, status_code: int, detail: str | dict):
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))


@dataclass
class AppendResult:
    accepted: int
    duplicates: int
    rejected: list[str]


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
        # The sweep flag is server-written only (#2621).
        game_metadata=without_swept(metadata),
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
    session: AsyncSession, game_id: uuid.UUID, session_id: str, *, for_update: bool = False
) -> Game:
    stmt = select(Game).where(Game.id == game_id)
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


async def append_events(
    session: AsyncSession,
    *,
    game_id: uuid.UUID,
    session_id: str,
    events: list[dict[str, Any]],
) -> AppendResult:
    game = await _get_owned_game(session, game_id, session_id)
    # A swept row is still open as far as the device is concerned: a long-offline
    # queue flushes its events before the completion that replaces the sweep.
    if game.completed_at is not None and not is_swept(game.game_metadata):
        raise GameServiceError(409, "Game is already completed.")

    event_type_map = await catalog_cache.event_type_ids(session, game.game_type_id)

    valid_rows: list[dict[str, Any]] = []
    valid_indices: list[int] = []
    rejected: set[str] = set()
    seen_indices: set[int] = set()

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
        valid_indices.append(idx)
        valid_rows.append(
            {
                "game_id": game.id,
                "event_index": idx,
                "event_type_id": event_type_map[name],
                "data": ev["data"],
            }
        )

    if rejected:
        raise GameServiceError(
            400,
            {"error": "unknown_event_type", "rejected": sorted(rejected)},
        )

    duplicates = 0
    if valid_rows:
        # Pre-check which indices already exist so we can count duplicates.
        existing = (
            (
                await session.execute(
                    select(GameEvent.event_index).where(
                        GameEvent.game_id == game.id,
                        GameEvent.event_index.in_(valid_indices),
                    )
                )
            )
            .scalars()
            .all()
        )
        existing_set = set(existing)
        duplicates = sum(1 for i in valid_indices if i in existing_set)

        stmt = _upsert_ignore(session, GameEvent.__table__, valid_rows)
        await session.execute(stmt)
        await session.commit()

    return AppendResult(
        accepted=len(valid_rows) - duplicates,
        duplicates=duplicates,
        rejected=[],
    )


async def complete_game(
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
    # FOR UPDATE: on Postgres a concurrent sweep waits for this completion, then
    # finds the row no longer open (#2621).
    game = await _get_owned_game(session, game_id, session_id, for_update=True)
    if game.completed_at is not None and not is_swept(game.game_metadata):
        return game  # idempotent — do not overwrite

    if outcome is not None and outcome not in _VALID_OUTCOMES:
        raise GameServiceError(400, f"Invalid outcome: {outcome!r}")

    name = (
        await session.execute(select(GameType.name).where(GameType.id == game.game_type_id))
    ).scalar_one()
    mod = get_module(name)
    # The sweep flag is server-written only: a result must not set it (#2621).
    validated_result = without_swept(
        await _validate_result(session, game, result, name, mod, final_score)
    )
    # Optional per-game hook: a game whose score is part of its result block
    # fills in a missing ``final_score`` from it, or rejects one that doesn't
    # match it (Blackjack's closing chips, #2745).
    derive_final_score = getattr(mod, "derive_final_score", None)
    if derive_final_score is not None:
        try:
            final_score = derive_final_score(final_score, outcome, validated_result)
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
    are unaffected. Results over ``_MAX_RESULT_BYTES`` are
    rejected — unvalidated games have no other bound.
    """
    if not result:
        return {}
    if len(json.dumps(result, default=str)) > _MAX_RESULT_BYTES:
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
    reconcile = getattr(mod, "reconcile_result", None)
    if reconcile is not None:
        validated = await reconcile(session, game, validated)
    return validated


def _report_rejected_result(game_type: str, reason: str, extra: dict[str, Any]) -> None:
    """Send a rejected completion result to Sentry (#2449).

    A 400 on ``/complete`` is dead-lettered by the app's sync worker, so the
    game's score is lost — this must be visible server-side, not just in the
    client's own report. Field paths and error types only: no session id (the
    privacy policy says crash reports carry no identifier) and no result values.
    """
    with sentry_sdk.new_scope() as scope:
        scope.set_tag("game_type", game_type)
        scope.set_context("result_rejection", extra)
        scope.fingerprint = ["games-complete-result-rejected", game_type, reason]
        sentry_sdk.capture_message(
            f"PATCH /games/{{id}}/complete rejected: {reason} ({game_type})", level="error"
        )

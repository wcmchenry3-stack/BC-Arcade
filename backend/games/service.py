"""DB service layer for the games write API (#364).

Idempotency strategy:
- Games: client may supply `id`; re-creating with the same id returns existing.
- Events: `(game_id, event_index)` is the composite PK. We use dialect-aware
  `INSERT ... ON CONFLICT DO NOTHING` so repeat batches are safe.
- Complete: re-completing a finished game returns its existing state without
  overwriting.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.models import EventType, Game, GameEvent, GameType
from games.registry import get_module
from vocab import GameOutcome

_VALID_OUTCOMES = frozenset(v.value for v in GameOutcome)

_TS_WINDOW_LOW = timedelta(days=365)
_TS_WINDOW_HIGH = timedelta(hours=24)


def _validate_client_timestamp(ts: datetime, now: datetime) -> datetime | None:
    """Return ts if it falls within [now − 1 year, now + 24 h]; else None.

    Normalises naive datetimes to UTC. A skewed or bogus client clock falls
    back to server-side stamping rather than poisoning the history table.
    """
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
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


async def _resolve_game_type(session: AsyncSession, name: str) -> GameType:
    gt = (await session.execute(select(GameType).where(GameType.name == name))).scalar_one_or_none()
    if gt is None or not gt.is_active:
        raise GameServiceError(400, f"Unknown or inactive game_type: {name!r}")
    return gt


async def _load_event_type_map(session: AsyncSession, game_type_id: int) -> dict[str, EventType]:
    rows = (
        (
            await session.execute(
                select(EventType).where(
                    EventType.game_type_id == game_type_id,
                    EventType.deprecated_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    return {et.name: et for et in rows}


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

    now = datetime.now(timezone.utc)
    game = Game(
        id=client_id or uuid.uuid4(),
        session_id=session_id,
        game_type_id=gt.id,
        game_metadata=metadata or {},
        players=players,
    )
    valid_started_at = _validate_client_timestamp(started_at, now) if started_at else None
    if valid_started_at is not None:
        game.started_at = valid_started_at
    session.add(game)
    await session.commit()
    await session.refresh(game)
    return game


async def _get_owned_game(session: AsyncSession, game_id: uuid.UUID, session_id: str) -> Game:
    game = (await session.execute(select(Game).where(Game.id == game_id))).scalar_one_or_none()
    if game is None:
        raise GameServiceError(404, "Game not found.")
    if game.session_id != session_id:
        raise GameServiceError(403, "Game belongs to a different session.")
    return game


def _upsert_ignore(session: AsyncSession, table, rows: list[dict]):
    """Dialect-aware INSERT ... ON CONFLICT DO NOTHING.

    Postgres and SQLite both support on_conflict_do_nothing via their
    dialect-specific insert() constructors. We branch on bind.dialect.name
    so the API test suite can run against either backend.
    """
    dialect = session.bind.dialect.name if session.bind else "postgresql"
    if dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert as _insert
    else:
        from sqlalchemy.dialects.postgresql import insert as _insert
    return _insert(table).values(rows).on_conflict_do_nothing()


async def append_events(
    session: AsyncSession,
    *,
    game_id: uuid.UUID,
    session_id: str,
    events: list[dict[str, Any]],
) -> AppendResult:
    game = await _get_owned_game(session, game_id, session_id)
    if game.completed_at is not None:
        raise GameServiceError(409, "Game is already completed.")

    event_type_map = await _load_event_type_map(session, game.game_type_id)

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
                "event_type_id": event_type_map[name].id,
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


# ---------------------------------------------------------------------------
# Read-side queries (#365)
# ---------------------------------------------------------------------------


@dataclass
class GameTypeStats:
    played: int
    best: int | None
    avg: float | None
    last_played_at: datetime | None
    best_chips: int | None = None
    current_chips: int | None = None
    best_run_chips: int | None = None
    total_runs: int | None = None
    runs_completed: int | None = None
    current_table: str | None = None


@dataclass
class StatsSummary:
    total_games: int
    by_game: dict[str, GameTypeStats]
    favorite_game: str | None


async def get_stats_for_session(session: AsyncSession, *, session_id: str) -> StatsSummary:
    """Aggregate per-game-type stats for a single session.

    Only counts completed games — in-progress games are excluded from
    played/best/avg so the leaderboard stays stable until a game finishes.

    Per-game stat shaping is delegated to each module's ``stats_shape()``
    method via the registry (#541).  No game-name branches live here.
    """
    # --- aggregate query -------------------------------------------------
    rows = (
        await session.execute(
            select(
                GameType.name,
                func.count(Game.id).label("played"),
                func.max(Game.final_score).label("best"),
                func.avg(Game.final_score).label("avg"),
                func.max(Game.completed_at).label("last_played_at"),
            )
            .select_from(Game)
            .join(GameType, Game.game_type_id == GameType.id)
            .where(
                Game.session_id == session_id,
                Game.completed_at.is_not(None),
            )
            .group_by(GameType.name)
        )
    ).all()

    # --- pre-fetch latest final_score per game type in one query ---------
    # Used by modules (e.g. Blackjack) that need the most-recent score.
    # Subquery: per game_type_id, find the max(completed_at).
    latest_sq = (
        select(
            Game.game_type_id,
            func.max(Game.completed_at).label("max_completed_at"),
        )
        .where(
            Game.session_id == session_id,
            Game.completed_at.is_not(None),
        )
        .group_by(Game.game_type_id)
        .subquery()
    )
    latest_score_rows = (
        await session.execute(
            select(GameType.name, Game.final_score, Game.game_metadata)
            .join(GameType, Game.game_type_id == GameType.id)
            .join(
                latest_sq,
                (Game.game_type_id == latest_sq.c.game_type_id)
                & (Game.completed_at == latest_sq.c.max_completed_at),
            )
            .where(Game.session_id == session_id)
        )
    ).all()
    latest_score_by_name: dict[str, int | None] = {
        name: (int(score) if score is not None else None) for name, score, _ in latest_score_rows
    }
    latest_meta_by_name: dict[str, dict] = {
        name: (meta or {}) for name, _, meta in latest_score_rows
    }

    # --- build per-game stats via module dispatch -------------------------
    by_game: dict[str, GameTypeStats] = {}
    total = 0
    favorite: str | None = None
    favorite_count = -1

    for name, played, best, avg, last_played in rows:
        total += played

        raw: dict = {
            "played": played,
            "best": int(best) if best is not None else None,
            "avg": round(float(avg), 1) if avg is not None else None,
            "last_played_at": last_played,
            "latest_score": latest_score_by_name.get(name),
            "metadata": latest_meta_by_name.get(name, {}),
        }

        game_module = get_module(name)
        shaped = (
            game_module.stats_shape(raw)
            if game_module is not None
            else {k: v for k, v in raw.items() if k != "latest_score"}
        )

        by_game[name] = GameTypeStats(
            played=shaped.get("played", 0),
            best=shaped.get("best"),
            avg=shaped.get("avg"),
            last_played_at=shaped.get("last_played_at"),
            best_chips=shaped.get("best_chips"),
            current_chips=shaped.get("current_chips"),
            best_run_chips=shaped.get("best_run_chips"),
            total_runs=shaped.get("total_runs"),
            runs_completed=shaped.get("runs_completed"),
            current_table=shaped.get("current_table"),
        )

        if played > favorite_count:
            favorite = name
            favorite_count = played

    return StatsSummary(total_games=total, by_game=by_game, favorite_game=favorite)


@dataclass
class GameRow:
    id: uuid.UUID
    game_type: str
    started_at: datetime
    completed_at: datetime | None
    final_score: int | None
    outcome: str | None
    duration_ms: int | None
    metadata: dict[str, Any]
    players: list[dict[str, Any]]


@dataclass
class GamePage:
    items: list[GameRow]
    next_cursor: str | None


async def list_games_for_session(
    session: AsyncSession,
    *,
    session_id: str,
    limit: int,
    cursor: datetime | None,
) -> GamePage:
    stmt = (
        select(Game, GameType.name)
        .join(GameType, Game.game_type_id == GameType.id)
        .where(Game.session_id == session_id)
        .order_by(Game.started_at.desc(), Game.id.desc())
        .limit(limit + 1)
    )
    if cursor is not None:
        stmt = stmt.where(Game.started_at < cursor)

    rows = (await session.execute(stmt)).all()
    items = [
        GameRow(
            id=g.id,
            game_type=name,
            started_at=g.started_at,
            completed_at=g.completed_at,
            final_score=g.final_score,
            outcome=g.outcome,
            duration_ms=g.duration_ms,
            metadata=g.game_metadata,
            players=g.players or [],
        )
        for g, name in rows[:limit]
    ]
    next_cursor = rows[limit][0].started_at.isoformat() if len(rows) > limit else None
    return GamePage(items=items, next_cursor=next_cursor)


@dataclass
class GameDetail:
    row: GameRow
    events: list[dict[str, Any]] | None


async def get_game_detail(
    session: AsyncSession,
    *,
    game_id: uuid.UUID,
    session_id: str,
    include_events: bool,
) -> GameDetail:
    opts = [selectinload(Game.game_type)]
    if include_events:
        opts.append(selectinload(Game.events).selectinload(GameEvent.event_type))
    game = (
        await session.execute(select(Game).options(*opts).where(Game.id == game_id))
    ).scalar_one_or_none()
    if game is None:
        raise GameServiceError(404, "Game not found.")
    if game.session_id != session_id:
        raise GameServiceError(403, "Game belongs to a different session.")

    row = GameRow(
        id=game.id,
        game_type=game.game_type.name,
        started_at=game.started_at,
        completed_at=game.completed_at,
        final_score=game.final_score,
        outcome=game.outcome,
        duration_ms=game.duration_ms,
        metadata=game.game_metadata,
        players=game.players or [],
    )
    events: list[dict[str, Any]] | None = None
    if include_events:
        events = [
            {
                "event_index": e.event_index,
                "event_type": e.event_type.name,
                "occurred_at": e.occurred_at,
                "data": e.data,
            }
            for e in game.events
        ]
    return GameDetail(row=row, events=events)


async def complete_game(
    session: AsyncSession,
    *,
    game_id: uuid.UUID,
    session_id: str,
    final_score: int | None,
    outcome: str | None,
    duration_ms: int | None,
    completed_at: datetime | None = None,
) -> Game:
    game = await _get_owned_game(session, game_id, session_id)
    if game.completed_at is not None:
        return game  # idempotent — do not overwrite

    if outcome is not None and outcome not in _VALID_OUTCOMES:
        raise GameServiceError(400, f"Invalid outcome: {outcome!r}")

    now = datetime.now(timezone.utc)
    valid_completed_at = _validate_client_timestamp(completed_at, now) if completed_at else None
    game.completed_at = valid_completed_at if valid_completed_at is not None else now
    game.final_score = final_score
    game.outcome = outcome
    game.duration_ms = duration_ms
    await session.commit()
    await session.refresh(game)
    return game


# ---------------------------------------------------------------------------
# Catalog (#1049)
# ---------------------------------------------------------------------------


async def get_catalog(session: AsyncSession) -> list[GameType]:
    return list(
        (
            await session.execute(
                select(GameType).where(GameType.is_active.is_(True)).order_by(GameType.sort_order)
            )
        )
        .scalars()
        .all()
    )


async def patch_game_type(
    session: AsyncSession,
    *,
    game_type_id: int,
    is_premium: bool | None,
    category: str | None,
) -> GameType:
    gt = (
        await session.execute(select(GameType).where(GameType.id == game_type_id))
    ).scalar_one_or_none()
    if gt is None:
        raise GameServiceError(404, "Game type not found.")
    if is_premium is not None:
        gt.is_premium = is_premium
    if category is not None:
        gt.category = category
    await session.commit()
    await session.refresh(gt)
    return gt

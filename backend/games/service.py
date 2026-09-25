"""DB service layer for the games write API (#364).

Idempotency strategy:
- Games: client may supply `id`; re-creating with the same id returns existing.
- Events: `(game_id, event_index)` is the composite PK. We use dialect-aware
  `INSERT ... ON CONFLICT DO NOTHING` so repeat batches are safe.
- Complete: re-completing a finished game returns its existing state without
  overwriting.
"""

from __future__ import annotations

import functools
import json
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import sentry_sdk
from pydantic import ValidationError
from sqlalchemy import ColumnElement, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.models import EventType, Game, GameEvent, GameType
from games.board import SCORE_METRIC, BoardDefinition
from games.filters import not_abandoned
from games.leaderboard import check_completion_limits, merge_result_metadata
from games.protocol import GameModule
from games.registry import get_module
from vocab import GameOutcome
from vocab import GameType as VocabGameType

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
    # Completed-only count behind Arcade XP (#2472). Set straight from the
    # aggregate query, never through stats_shape(): a game module must not be
    # able to shape how much XP it grants.
    completed_played: int = 0
    # Comparable per-game fields (#2620). Like completed_played they come
    # straight from the queries, never through stats_shape(), so every game
    # reports them the same way. Meanings: GameTypeStatsResponse.
    sessions: int = 0
    won: int | None = None
    lost: int | None = None
    tied: int | None = None
    current_win_streak: int | None = None
    best_win_streak: int | None = None
    time_played_ms: int = 0
    best_value: int | float | None = None
    best_label_key: str | None = None
    # Game-specific figures from stats_shape()'s "extras" (Blackjack's chips).
    extras: dict[str, Any] = field(default_factory=dict)
    # Deprecated top-level aliases of Blackjack's extras, kept for app builds
    # that read them (Profile reads best_chips) until #2644 removes them.
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


# --- comparable per-game stats (#2620) -------------------------------------

# Upper bound on what one row may add to time_played_ms: a sanity bound on the
# reported duration_ms, not an estimate of play time.
MAX_TIME_PLAYED_PER_GAME_MS = 24 * 60 * 60 * 1000

# Only these three outcomes count. The legacy ``blackjack`` outcome is not a
# win here: #2619 (migration 0024_drop_blackjack_outcome) rewrites any stored
# ``blackjack`` row to ``win`` and drops the value from the CHECK constraint.
_WIN = GameOutcome.WIN.value
_LOSS = GameOutcome.LOSS.value
_PUSH = GameOutcome.PUSH.value


def _dialect_name(session: AsyncSession) -> str:
    return session.bind.dialect.name if session.bind else "postgresql"


def _registered_module(name: str) -> GameModule:
    """The ``GameModule`` for game type *name*.

    Every vocab ``GameType`` has one since #2623 (a test checks it). A game
    without one is a bug, so this fails loudly instead of guessing a board for
    it. Only code-defined types reach it; a ``game_types`` row with no module
    is left out of the stats instead (``get_stats_for_session``).
    """
    module = get_module(name)
    if module is None:
        raise LookupError(f"No GameModule registered for game type {name!r}")
    return module


def _metadata_number(key: str, dialect: str) -> ColumnElement:
    """``games.metadata[key]`` as a number, or NULL when it is not a JSON number.

    Guarded by the JSON type so a malformed value (a game with no
    ``result_model`` accepts any result block) yields NULL instead of a cast
    error that would fail the whole ``/stats/me`` response.
    """
    if dialect == "sqlite":
        path = f'$."{key}"'
        return case(
            (
                func.json_type(Game.game_metadata, path).in_(("integer", "real")),
                func.json_extract(Game.game_metadata, path),
            )
        )
    value = Game.game_metadata[key]
    return case((func.jsonb_typeof(value) == "number", value.as_float()))


@functools.cache
def _best_candidate(dialect: str) -> ColumnElement:
    """Each row's board metric when the row can be its game's best, else NULL.

    A row qualifies when it is not abandoned and, if its board sets
    ``qualifying_outcomes``, its outcome is one of them (Daily Word: wins
    only). The value is ``final_score`` or the metadata key the board names.

    Boards are static, so the expression is built once per dialect and
    reused by every request.
    """
    whens = []
    for game_type in VocabGameType:
        board = _registered_module(game_type.value).board
        if board.metric == SCORE_METRIC and board.qualifying_outcomes is None:
            continue  # the ELSE branch below
        value = (
            Game.final_score
            if board.metric == SCORE_METRIC
            else _metadata_number(board.metric, dialect)
        )
        if board.qualifying_outcomes is not None:
            value = case((Game.outcome.in_(board.qualifying_outcomes), value))
        whens.append((GameType.name == game_type.value, value))
    per_game = case(*whens, else_=Game.final_score) if whens else Game.final_score
    return case((not_abandoned(), per_game))


# Each row's reported play time: duration_ms when it is > 0, capped at 24 h.
# Rows with a null, 0 or negative duration_ms add nothing (SUM skips NULL).
# There is deliberately no completed_at − started_at fallback: wall-clock time
# counts idle and backgrounded hours, and rows swept to abandoned (#2621) would
# add up to a day each.
_REPORTED_TIME_MS = case(
    (Game.duration_ms > MAX_TIME_PLAYED_PER_GAME_MS, MAX_TIME_PLAYED_PER_GAME_MS),
    (Game.duration_ms > 0, Game.duration_ms),
)


def _comparable_columns(dialect: str) -> list[ColumnElement]:
    """Conditional aggregates for the comparable fields, added to the stats query."""
    candidate = _best_candidate(dialect)
    return [
        func.count(case((Game.outcome == _WIN, Game.id))).label("won"),
        func.count(case((Game.outcome == _LOSS, Game.id))).label("lost"),
        func.count(case((Game.outcome == _PUSH, Game.id))).label("tied"),
        func.sum(_REPORTED_TIME_MS).label("time_played_ms"),
        func.max(candidate).label("metric_max"),
        func.min(candidate).label("metric_min"),
    ]


def _as_number(value: Any) -> int | float | None:
    """DB numerics (Decimal, float) to int when integral, else float."""
    if value is None:
        return None
    number = float(value)
    return int(number) if number.is_integer() else number


def win_streaks(outcomes: Iterable[str]) -> tuple[int, int]:
    """``(current, best)`` runs of consecutive wins, oldest outcome first.

    A ``loss`` ends a run. Every other outcome — ``push``, ``abandoned``,
    ``completed``, ``kept_playing`` — neither extends nor breaks it.
    """
    current = best = 0
    for outcome in outcomes:
        if outcome == _WIN:
            current += 1
            best = max(best, current)
        elif outcome == _LOSS:
            current = 0
    return current, best


async def _win_streaks_by_game(
    session: AsyncSession, *, session_id: str
) -> dict[str, tuple[int, int]]:
    """One ordered scan of the session's ``win``/``loss`` rows, all games at once.

    Only those two outcomes can move a streak (see ``win_streaks``), so every
    other row is left out of the scan.
    """
    rows = (
        await session.execute(
            select(GameType.name, Game.outcome)
            .join(GameType, Game.game_type_id == GameType.id)
            .where(
                Game.session_id == session_id,
                Game.completed_at.is_not(None),
                Game.outcome.in_((_WIN, _LOSS)),
            )
            .order_by(GameType.name, Game.completed_at, Game.started_at, Game.id)
        )
    ).all()
    outcomes_by_game: dict[str, list[str]] = {}
    for name, outcome in rows:
        outcomes_by_game.setdefault(name, []).append(outcome)
    return {name: win_streaks(outcomes) for name, outcomes in outcomes_by_game.items()}


def _comparable_fields(
    row: Any, board: BoardDefinition, streak: tuple[int, int] | None
) -> dict[str, Any]:
    """The comparable GameTypeStats fields for one aggregate row."""
    has_result = (row.won + row.lost + row.tied) > 0
    current, best = streak or (0, 0)
    best_value = row.metric_max if board.direction == "desc" else row.metric_min
    return {
        "sessions": row.played,
        "won": row.won if has_result else None,
        "lost": row.lost if has_result else None,
        "tied": row.tied if has_result else None,
        "current_win_streak": current if has_result else None,
        "best_win_streak": best if has_result else None,
        "time_played_ms": round(float(row.time_played_ms or 0)),
        "best_value": _as_number(best_value),
        "best_label_key": board.label_key,
    }


async def get_stats_for_session(session: AsyncSession, *, session_id: str) -> StatsSummary:
    """Aggregate per-game-type stats for a single session.

    Only counts completed games — in-progress games are excluded from
    played/best/avg so the leaderboard stays stable until a game finishes.

    Abandoned games (#2468 / #2472) are counted but not scored. ``played`` and
    ``last_played_at`` are lifecycle facts and still include them; every score
    aggregate (``best`` / ``avg`` / ``latest_score``) and ``completed_played``
    — the count XP is derived from — excludes them, because the frontend
    abandon paths do send a ``final_score`` (Sudoku sends the full completion
    formula, so a 0-error abandon on Hard scores 300).

    Per-game stat shaping is delegated to each module's ``stats_shape()``
    method via the registry (#541).  No game-name branches live here.

    The comparable fields (#2620: ``sessions``, ``won``/``lost``/``tied``,
    win streaks, ``time_played_ms``, ``best_value``) are set from the queries
    and the game's ``BoardDefinition``, never through ``stats_shape()``. They
    add conditional aggregates to the one aggregate query plus, only when some
    game has a ``win`` or ``loss``, one ordered scan for the win streaks.
    """
    # --- aggregate query -------------------------------------------------
    # Conditional aggregates keep this one round-trip: `case` with no `else`
    # yields NULL, which count/max/avg all skip.
    scored = case((not_abandoned(), Game.final_score))
    rows = (
        await session.execute(
            select(
                GameType.name,
                func.count(Game.id).label("played"),
                func.count(case((not_abandoned(), Game.id))).label("completed_played"),
                func.max(scored).label("best"),
                func.avg(scored).label("avg"),
                func.max(Game.completed_at).label("last_played_at"),
                *_comparable_columns(_dialect_name(session)),
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
    streaks = (
        await _win_streaks_by_game(session, session_id=session_id)
        if any(row.won or row.lost for row in rows)
        else {}
    )

    # --- pre-fetch the latest row per game type --------------------------
    # Used by modules (e.g. Blackjack) that need the most-recent score or
    # metadata. Score and metadata come from *different* latest rows on
    # purpose:
    #
    #   score    — skips abandons (#2468). Blackjack reads current_chips
    #              through it, so an abandoned table must not become the
    #              player's live chip balance.
    #   metadata — takes the latest row whatever its outcome. Blackjack writes
    #              its cumulative run aggregates (best_run_chips, total_runs,
    #              runs_completed, current_table) at session *start*, so the
    #              newest row always holds the freshest figures even when that
    #              session was later abandoned — and "New Game" and unmount are
    #              both abandon paths, so filtering here would blank the run
    #              history for anyone who has not just cashed out or busted.
    def _latest_row_query(*extra_filters):
        latest_sq = (
            select(
                Game.game_type_id,
                func.max(Game.completed_at).label("max_completed_at"),
            )
            .where(
                Game.session_id == session_id,
                Game.completed_at.is_not(None),
                *extra_filters,
            )
            .group_by(Game.game_type_id)
            .subquery()
        )
        return (
            select(GameType.name, Game.final_score, Game.game_metadata)
            .join(GameType, Game.game_type_id == GameType.id)
            .join(
                latest_sq,
                (Game.game_type_id == latest_sq.c.game_type_id)
                & (Game.completed_at == latest_sq.c.max_completed_at),
            )
            .where(Game.session_id == session_id, *extra_filters)
        )

    latest_score_rows = (await session.execute(_latest_row_query(not_abandoned()))).all()
    latest_meta_rows = (await session.execute(_latest_row_query())).all()
    latest_score_by_name: dict[str, int | None] = {
        name: (int(score) if score is not None else None) for name, score, _ in latest_score_rows
    }
    latest_meta_by_name: dict[str, dict] = {
        name: (meta or {}) for name, _, meta in latest_meta_rows
    }

    # --- build per-game stats via module dispatch -------------------------
    by_game: dict[str, GameTypeStats] = {}
    total = 0
    favorite: str | None = None
    favorite_count = -1

    for row in rows:
        name, played, completed_played = row.name, row.played, row.completed_played
        game_module = get_module(name)
        if game_module is None:
            # A game type with rows but no module is a bug, but it must not
            # take /stats/me down for every player who played it: report it
            # and leave that game out (it has no board or stats shape).
            sentry_sdk.capture_message(
                f"/stats: no GameModule for game type {name!r}; left out", level="error"
            )
            continue
        best, avg, last_played = row.best, row.avg, row.last_played_at
        total += played

        raw: dict = {
            "played": played,
            "best": int(best) if best is not None else None,
            "avg": round(float(avg), 1) if avg is not None else None,
            "last_played_at": last_played,
            "latest_score": latest_score_by_name.get(name),
            "metadata": latest_meta_by_name.get(name, {}),
        }

        shaped = game_module.stats_shape(raw)

        extras: dict[str, Any] = dict(shaped.get("extras") or {})

        by_game[name] = GameTypeStats(
            played=shaped.get("played", 0),
            best=shaped.get("best"),
            avg=shaped.get("avg"),
            last_played_at=shaped.get("last_played_at"),
            extras=extras,
            best_chips=extras.get("best_chips"),
            current_chips=extras.get("current_chips"),
            best_run_chips=extras.get("best_run_chips"),
            total_runs=extras.get("total_runs"),
            runs_completed=extras.get("runs_completed"),
            current_table=extras.get("current_table"),
            completed_played=completed_played,
            **_comparable_fields(row, game_module.board, streaks.get(name)),
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
    result: dict[str, Any] | None = None,
) -> Game:
    game = await _get_owned_game(session, game_id, session_id)
    if game.completed_at is not None:
        return game  # idempotent — do not overwrite

    if outcome is not None and outcome not in _VALID_OUTCOMES:
        raise GameServiceError(400, f"Invalid outcome: {outcome!r}")

    name = (
        await session.execute(select(GameType.name).where(GameType.id == game.game_type_id))
    ).scalar_one()
    mod = get_module(name)
    validated_result = await _validate_result(session, game, result, name, mod)
    # The board's caps and value types (#2618, absorbs #2215).
    violation = check_completion_limits(name, mod, game, final_score, validated_result)
    if violation is not None:
        _report_rejected_result(
            violation.game_type, "over board limit", {"field": violation.metric}
        )
        raise GameServiceError(400, violation.detail)

    now = datetime.now(timezone.utc)
    valid_completed_at = _validate_client_timestamp(completed_at, now) if completed_at else None
    game.completed_at = valid_completed_at if valid_completed_at is not None else now
    game.final_score = final_score
    game.outcome = outcome
    game.duration_ms = duration_ms
    if validated_result:
        # Reassign (never mutate in place) — the JSONB column isn't a MutableDict.
        # Creation-time keys win unless they hold null (merge_result_metadata);
        # the limit check above merged the same way.
        game.game_metadata = merge_result_metadata(game.game_metadata, validated_result)
    await session.commit()
    await session.refresh(game)
    return game


async def _validate_result(
    session: AsyncSession,
    game: Game,
    result: dict[str, Any] | None,
    name: str,
    mod: GameModule | None,
) -> dict:
    """Validate *result* against the game module's ``result_model`` (#2449).

    ``name`` and ``mod`` are the game's type name and registered module, as
    ``complete_game`` resolved them. Games without a registered module or a
    ``result_model`` accept any dict unvalidated. Only fields the client
    actually sent are returned. Results over ``_MAX_RESULT_BYTES`` are
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
        validated = result_model.model_validate(result).model_dump(exclude_unset=True)
    except ValidationError as e:
        errors = e.errors()
        fields = ", ".join(".".join(str(p) for p in err["loc"]) for err in errors)
        _report_rejected_result(
            name,
            "invalid result",
            {"fields": fields, "error_types": sorted({err["type"] for err in errors})},
        )
        raise GameServiceError(400, f"Invalid result for {name}: {fields}")
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

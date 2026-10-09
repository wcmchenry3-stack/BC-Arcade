"""FastAPI router for /games/* (#364).

Every route takes its session as ``db: DbSession`` (``db.base.get_db``). A
``GameServiceError`` raised by the games modules is answered by the app-level
handler in ``main.py`` with the same ``{"detail": ...}`` body and status an
``HTTPException`` would give, so the routes don't translate it (#2993).
"""

from __future__ import annotations

import hmac
import uuid
from dataclasses import asdict

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import DbSession
from db.models import Game
from entitlements.dependencies import check_entitlement
from limiter import limiter, session_key
from rate_limits import (
    CATALOG_ADMIN_SESSION_RATE_LIMIT,
    CATALOG_RATE_LIMIT,
    GAMES_COMPLETE_SESSION_RATE_LIMIT,
    GAMES_CREATE_SESSION_RATE_LIMIT,
    GAMES_DETAIL_SESSION_RATE_LIMIT,
    GAMES_EVENTS_SESSION_RATE_LIMIT,
    GAMES_LIST_SESSION_RATE_LIMIT,
    LEADERBOARD_IP_RATE_LIMIT,
    LEADERBOARD_SESSION_RATE_LIMIT,
    RANK_IP_RATE_LIMIT,
    RANK_SESSION_RATE_LIMIT,
)
from session import get_session_id, optional_session_id

from . import catalog, history, sessions, sweep, sweep_gate
from .boards import partitions, queries
from .boards.types import BoardEntry
from .schemas import (
    AppendEventsRequest,
    AppendEventsResponse,
    CatalogResponse,
    CompleteGameRequest,
    CreateGameRequest,
    CreateGameResponse,
    GameDetailResponse,
    GameEventResponse,
    GameHistoryResponse,
    GameRankResponse,
    GameRowResponse,
    GameStateResponse,
    GameTypeOut,
    LeaderboardEntryOut,
    LeaderboardResponse,
    PatchGameTypeRequest,
)

router = APIRouter()


def _to_state(game) -> GameStateResponse:
    return GameStateResponse(
        id=game.id,
        game_type=game.game_type.name if game.game_type else "",
        session_id=game.session_id,
        started_at=game.started_at,
        completed_at=game.completed_at,
        final_score=game.final_score,
        outcome=game.outcome,
        duration_ms=game.duration_ms,
    )


# ---------------------------------------------------------------------------
# Catalog (#1049) — registered before /{game_id} so literal path wins
# ---------------------------------------------------------------------------


def _gt_to_out(gt) -> GameTypeOut:
    return GameTypeOut(
        id=gt.id,
        name=gt.name,
        display_name=gt.display_name,
        icon_emoji=gt.icon_emoji,
        sort_order=gt.sort_order,
        is_active=gt.is_active,
        is_premium=gt.is_premium,
        category=gt.category,
    )


@router.get("/catalog", response_model=CatalogResponse)
@limiter.limit(CATALOG_RATE_LIMIT)
async def get_catalog(
    request: Request, db: DbSession
) -> JSONResponse:  # noqa: ARG001 - slowapi resolves `request` by name
    game_types = await catalog.get_catalog(db)
    body = CatalogResponse(items=[_gt_to_out(gt) for gt in game_types])
    return JSONResponse(
        content=body.model_dump(),
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.patch("/catalog/{game_type_id}", response_model=GameTypeOut)
@limiter.limit(CATALOG_ADMIN_SESSION_RATE_LIMIT, key_func=session_key)
async def patch_game_type(
    request: Request,
    game_type_id: int,
    body: PatchGameTypeRequest,
    db: DbSession,
    x_admin_token: str = Header(default=""),
) -> GameTypeOut:
    # Read once at startup: create_app() puts the Settings on app.state.
    admin_token = request.app.state.settings.admin_api_token.get_secret_value()
    if not admin_token or not hmac.compare_digest(
        x_admin_token.encode("utf-8"), admin_token.encode("utf-8")
    ):
        raise HTTPException(status_code=403, detail="Forbidden.")
    gt = await catalog.patch_game_type(
        db,
        game_type_id=game_type_id,
        is_premium=body.is_premium,
        category=body.category,
    )
    return _gt_to_out(gt)


# ---------------------------------------------------------------------------
# Read routes (#365) — registered before /{game_id} so literal paths win
# ---------------------------------------------------------------------------


def _to_row(g) -> GameRowResponse:
    return GameRowResponse(
        id=g.id,
        game_type=g.game_type,
        started_at=g.started_at,
        completed_at=g.completed_at,
        final_score=g.final_score,
        outcome=g.outcome,
        duration_ms=g.duration_ms,
        metadata=g.metadata,
        players=g.players,
    )


@router.get("/me", response_model=GameHistoryResponse)
@limiter.limit(GAMES_LIST_SESSION_RATE_LIMIT, key_func=session_key)
async def list_my_games(
    request: Request,
    db: DbSession,
    limit: int = Query(20, ge=1, le=100),
    cursor: str | None = None,
) -> GameHistoryResponse:
    sid = get_session_id(request)
    parsed_cursor: history.Cursor | None = None
    if cursor:
        try:
            parsed_cursor = history.parse_cursor(cursor)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid cursor.") from exc
    # Close this player's games left open > 24 h before listing them (#2621).
    # First page only: later pages continue a listing that was just swept.
    if parsed_cursor is None:
        await sweep.sweep_stale_games_safely(db, session_id=sid)
    page = await history.list_games_for_session(
        db, session_id=sid, limit=limit, cursor=parsed_cursor
    )
    return GameHistoryResponse(items=[_to_row(r) for r in page.items], next_cursor=page.next_cursor)


@router.get("/leaderboard/{game_type}", response_model=LeaderboardResponse)
@limiter.limit(LEADERBOARD_IP_RATE_LIMIT)
@limiter.limit(LEADERBOARD_SESSION_RATE_LIMIT, key_func=session_key)
async def get_leaderboard(
    request: Request,
    game_type: str,
    db: DbSession,
    limit: int = Query(queries.DEFAULT_LIMIT, ge=1, le=queries.MAX_LIMIT),
) -> LeaderboardResponse:
    """Top players on one board: one entry each (their best row).

    Only players with a display name (``PUT /players/me``) are listed, under
    their current name (#2624).

    Partition values are query params named after ``board.partitions``, e.g.
    ``/games/leaderboard/sudoku?difficulty=hard&variant=mini``. 404 for an
    unknown game or one whose board is disabled.

    With a valid ``X-Session-ID`` the caller's own entry is flagged ``is_me``
    and returned as ``me`` with its exact rank, even outside the top
    ``limit`` (#2633). Read-only.
    """
    board = partitions.enabled_board(game_type)
    if board is None:
        raise HTTPException(status_code=404, detail="Leaderboard not found.")
    params = [(k, v) for k, v in request.query_params.multi_items() if k != "limit"]
    partition = partitions.resolve_partition(game_type, board, params)
    gt = await queries.load_game_type(db, game_type)
    if gt is None:
        raise HTTPException(status_code=404, detail="Leaderboard not found.")
    # Not redundant with check_entitlement's own premium check: a free
    # board is public, so X-Session-ID is only required (400) for premium.
    if gt.is_premium:
        await check_entitlement(db, get_session_id(request), game_type)
    # The caller, when known, to flag their own entry (#2633). Optional:
    # a free board stays public without X-Session-ID.
    viewer = optional_session_id(request)
    entries = await queries.top_entries(
        db,
        game_type=game_type,
        board=board,
        game_type_id=gt.id,
        partition=partition,
        limit=limit,
        viewer_session_id=viewer,
    )
    # The caller's row in the list is their best entry with its rank:
    # only a caller outside the top ``limit`` costs the extra queries.
    me = next((e for e in entries if e.is_me), None)
    if viewer is not None and me is None:
        me = await queries.viewer_entry(
            db,
            game_type=game_type,
            board=board,
            game_type_id=gt.id,
            partition=partition,
            session_id=viewer,
        )
    return LeaderboardResponse(
        game_type=game_type,
        partition=partition,
        label_key=board.label_key,
        entries=[_entry_out(e) for e in entries],
        me=_entry_out(me) if me is not None else None,
    )


def _entry_out(e: BoardEntry) -> LeaderboardEntryOut:
    return LeaderboardEntryOut(
        rank=e.rank,
        player_name=e.player_name,
        value=e.value,
        completed_at=e.completed_at,
        is_me=e.is_me,
    )


@router.get("/{game_id}/rank", response_model=GameRankResponse)
@limiter.limit(RANK_IP_RATE_LIMIT)
@limiter.limit(RANK_SESSION_RATE_LIMIT, key_func=session_key)
async def get_game_rank(request: Request, game_id: uuid.UUID, db: DbSession) -> GameRankResponse:
    """Where one of the caller's games puts them on its board (#2677). Read-only.

    The result card's call: the rank of the caller's best entry in the game's
    partition and whether this game is that entry, computed exactly as the
    board computes it. ``ranked: false``
    with ``reason`` ``board_disabled`` / ``not_finished`` / ``not_rankable`` /
    ``no_name`` (rank and is_best null) when there is no standing to report.
    403 if another session owns the game (or a premium game isn't entitled),
    404 if the game or its board definition doesn't exist.
    """
    sid = get_session_id(request)
    game = await _load_owned_game(db, game_id, sid)
    result = await queries.game_rank(db, game=game, session_id=sid)
    return GameRankResponse.model_validate(asdict(result))


async def _load_owned_game(db: AsyncSession, game_id: uuid.UUID, sid: str) -> Game:
    """The caller's game with its ``game_type``, for the name and rank routes.

    404 if it doesn't exist, 403 if another session owns it or it is a premium
    game the caller isn't entitled to (a no-op for free games).
    """
    game = await queries.load_game(db, game_id)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found.")
    if game.session_id != sid:
        raise HTTPException(status_code=403, detail="Game belongs to a different session.")
    await check_entitlement(db, sid, game.game_type.name)
    return game


@router.get("/{game_id}", response_model=GameDetailResponse)
@limiter.limit(GAMES_DETAIL_SESSION_RATE_LIMIT, key_func=session_key)
async def get_game_detail(
    request: Request,
    game_id: uuid.UUID,
    db: DbSession,
    include_events: int = Query(0, ge=0, le=1),
) -> GameDetailResponse:
    sid = get_session_id(request)
    detail = await history.get_game_detail(
        db,
        game_id=game_id,
        session_id=sid,
        include_events=bool(include_events),
    )
    row = detail.row
    events = None
    if detail.events is not None:
        events = [GameEventResponse(**e) for e in detail.events]
    return GameDetailResponse(
        id=row.id,
        game_type=row.game_type,
        started_at=row.started_at,
        completed_at=row.completed_at,
        final_score=row.final_score,
        outcome=row.outcome,
        duration_ms=row.duration_ms,
        metadata=row.metadata,
        players=row.players,
        events=events,
    )


# ---------------------------------------------------------------------------
# Write routes (#364)
# ---------------------------------------------------------------------------


@router.post("", response_model=CreateGameResponse)
@limiter.limit(GAMES_CREATE_SESSION_RATE_LIMIT, key_func=session_key)
async def create_game(
    request: Request, body: CreateGameRequest, db: DbSession
) -> CreateGameResponse:
    sid = get_session_id(request)
    # Default to the creating session when the client omits players (#543).
    players = [p.model_dump() for p in body.players] if body.players else [{"player_id": sid}]
    await check_entitlement(db, sid, body.game_type)
    game = await sessions.create_game(
        db,
        session_id=sid,
        client_id=body.id,
        game_type_name=body.game_type,
        metadata=body.metadata,
        players=players,
        started_at=body.started_at,
    )
    # A backdated start can make this game stale sooner than /stats/me expects.
    sweep_gate.note_open_game(sid, game.started_at)
    return CreateGameResponse(id=game.id, started_at=game.started_at)


@router.post("/{game_id}/events", response_model=AppendEventsResponse)
@limiter.limit(GAMES_EVENTS_SESSION_RATE_LIMIT, key_func=session_key)
async def append_events(
    request: Request, game_id: uuid.UUID, body: AppendEventsRequest, db: DbSession
) -> AppendEventsResponse:
    sid = get_session_id(request)
    result = await sessions.append_events(
        db,
        game_id=game_id,
        session_id=sid,
        events=[e.model_dump() for e in body.events],
    )
    return AppendEventsResponse(
        accepted=result.accepted,
        duplicates=result.duplicates,
        rejected=result.rejected,
    )


@router.patch("/{game_id}/complete", response_model=GameStateResponse)
@limiter.limit(GAMES_COMPLETE_SESSION_RATE_LIMIT, key_func=session_key)
async def complete_game(
    request: Request, game_id: uuid.UUID, body: CompleteGameRequest, db: DbSession
) -> GameStateResponse:
    sid = get_session_id(request)
    # Returned with ``game_type`` loaded, so the response needs no second query.
    game = await sessions.complete_game(
        db,
        game_id=game_id,
        session_id=sid,
        final_score=body.final_score,
        outcome=body.outcome,
        duration_ms=body.duration_ms,
        completed_at=body.completed_at,
        result=body.result,
    )
    return _to_state(game)

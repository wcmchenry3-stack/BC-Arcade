"""App-level error handlers, ``get_db`` and the ``complete_game`` response (#2993 part B).

``GameServiceError`` and ``PurchaseError`` used to be re-raised as
``HTTPException(status_code, detail)`` in a try/except around each call in the
routers; ``main.py`` now answers them with one app-level handler. These tests
pin that the response is byte-identical to the ``HTTPException`` one, both in
isolation and through the real routes (the expected bodies below were captured
from the routers before the change). They also pin that routes take their
session from ``db.base.get_db`` (one per request, closed before the response is
sent) and that ``PATCH /games/{id}/complete`` no longer re-selects the game.
"""

from __future__ import annotations

import base64
import json
import re
import uuid
from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession

import main
from db import base
from db.base import DbSession, get_db, get_engine, get_session_factory
from db.models import Game, GameEntitlement
from entitlements import dependencies as ent_deps
from games import sessions
from games.sessions import GameServiceError
from purchases.verifiers import PurchaseError
from tests._helpers import session_headers

# ---------------------------------------------------------------------------
# The handler answers exactly as HTTPException(status_code, detail) did
# ---------------------------------------------------------------------------

_CASES = [
    (400, "Unknown or inactive game_type: 'nope'"),
    (403, "Game belongs to a different session."),
    (404, "Game not found."),
    (409, "is_premium_migration_only"),
    # append_events' structured detail.
    (400, {"error": "unknown_event_type", "rejected": ["a", "b"]}),
    (401, "unauthorized"),
    (422, "verification_failed"),
    (503, "store_unavailable"),
    (400, "Invalid result for hearts: é.ü"),
]


def _mini_app(raise_: type[Exception]) -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(GameServiceError, main._domain_error_handler)
    app.add_exception_handler(PurchaseError, main._domain_error_handler)

    @app.get("/boom/{i}")
    async def boom(i: int) -> None:
        status, detail = _CASES[i]
        if raise_ is HTTPException:
            raise HTTPException(status_code=status, detail=detail)
        raise raise_(status, detail)

    return app


@pytest.mark.parametrize(
    ("domain_error", "i"),
    [(GameServiceError, i) for i in range(len(_CASES))]
    # A PurchaseError detail is always a code (str).
    + [(PurchaseError, i) for i, (_, detail) in enumerate(_CASES) if isinstance(detail, str)],
)
def test_handler_response_is_byte_identical_to_http_exception(
    domain_error: type[Exception], i: int
) -> None:
    expected = TestClient(_mini_app(HTTPException)).get(f"/boom/{i}")
    got = TestClient(_mini_app(domain_error)).get(f"/boom/{i}")
    assert got.status_code == expected.status_code == _CASES[i][0]
    assert got.content == expected.content
    assert got.headers.items() == expected.headers.items()


def test_create_app_registers_both_handlers() -> None:
    app = main.create_app()
    assert app.exception_handlers[GameServiceError] is main._domain_error_handler
    assert app.exception_handlers[PurchaseError] is main._domain_error_handler


# ---------------------------------------------------------------------------
# Through the real routes: the six former try/except blocks, byte for byte
# ---------------------------------------------------------------------------

_JSON = "application/json"
_ADMIN = "test-admin-token-2993"


def _assert_body(r, status: int, body: bytes) -> None:
    assert r.status_code == status, r.text
    assert r.content == body
    assert r.headers["content-type"] == _JSON
    assert r.headers["content-length"] == str(len(body))


async def _grant(sid: str, slug: str) -> None:
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=sid, game_slug=slug))
        await db.commit()


def _new_game(client: TestClient, sid: str) -> str:
    r = client.post("/games", headers=session_headers(sid), json={"game_type": "yacht"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_patch_catalog_errors(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ADMIN_API_TOKEN", _ADMIN)
    headers = {"X-Admin-Token": _ADMIN, "Content-Type": _JSON}
    r = client.patch("/games/catalog/999999", headers=headers, json={"category": "x"})
    _assert_body(r, 404, b'{"detail":"Game type not found."}')


def test_get_game_detail_errors(client: TestClient, session_id: str) -> None:
    r = client.get(f"/games/{uuid.uuid4()}", headers=session_headers(session_id))
    _assert_body(r, 404, b'{"detail":"Game not found."}')
    game_id = _new_game(client, session_id)
    r = client.get(f"/games/{game_id}", headers=session_headers(str(uuid.uuid4())))
    _assert_body(r, 403, b'{"detail":"Game belongs to a different session."}')


def test_create_game_errors(client: TestClient, session_id: str) -> None:
    r = client.post("/games", headers=session_headers(session_id), json={"game_type": "nope"})
    _assert_body(r, 400, b'{"detail":"Unknown or inactive game_type: \'nope\'"}')
    game_id = _new_game(client, session_id)
    r = client.post(
        "/games",
        headers=session_headers(str(uuid.uuid4())),
        json={"game_type": "yacht", "id": game_id},
    )
    _assert_body(r, 403, b'{"detail":"Game belongs to a different session."}')


def test_append_events_errors(client: TestClient, session_id: str) -> None:
    events = {"events": [{"event_index": 0, "event_type": "bogus", "data": {}}]}
    r = client.post(
        f"/games/{uuid.uuid4()}/events", headers=session_headers(session_id), json=events
    )
    _assert_body(r, 404, b'{"detail":"Game not found."}')
    game_id = _new_game(client, session_id)
    r = client.post(f"/games/{game_id}/events", headers=session_headers(session_id), json=events)
    _assert_body(r, 400, b'{"detail":{"error":"unknown_event_type","rejected":["bogus"]}}')
    assert client.patch(
        f"/games/{game_id}/complete", headers=session_headers(session_id), json={}
    ).is_success
    r = client.post(f"/games/{game_id}/events", headers=session_headers(session_id), json=events)
    _assert_body(r, 409, b'{"detail":"Game is already completed."}')


def test_complete_game_errors(client: TestClient, session_id: str) -> None:
    r = client.patch(
        f"/games/{uuid.uuid4()}/complete", headers=session_headers(session_id), json={}
    )
    _assert_body(r, 404, b'{"detail":"Game not found."}')
    game_id = _new_game(client, session_id)
    r = client.patch(
        f"/games/{game_id}/complete",
        headers=session_headers(session_id),
        json={"outcome": "nope"},
    )
    _assert_body(r, 400, b'{"detail":"Invalid outcome: \'nope\'"}')


def test_purchase_errors(client: TestClient, session_id: str) -> None:
    # The shipped not-configured verifiers raise PurchaseError(503) from the store call.
    def seg(obj: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    jws = f"{seg({'alg': 'ES256'})}.{seg({'originalTransactionId': '1000'})}.sig"
    r = client.post(
        "/purchases/apple",
        json={"signed_transaction": jws, "source": "sync"},
        headers=session_headers(session_id),
    )
    _assert_body(r, 503, b'{"detail":"store_unavailable"}')
    # Raised by the route itself, before any store call.
    r = client.post(
        "/purchases/google",
        json={"product_id": "com.example.x", "purchase_token": "t", "source": "sync"},
        headers=session_headers(session_id),
    )
    _assert_body(r, 422, b'{"detail":"unknown_product"}')
    # Raised while parsing the evidence.
    r = client.post(
        "/purchases/apple",
        json={"signed_transaction": "not-a-jws", "source": "sync"},
        headers=session_headers(session_id),
    )
    _assert_body(r, 400, b'{"detail":"invalid_request"}')


# ---------------------------------------------------------------------------
# get_db
# ---------------------------------------------------------------------------


@pytest.fixture()
def counting_get_db(client: TestClient) -> Iterator[list[AsyncSession]]:
    """Override ``get_db`` on the app; collects every session it hands out."""
    from main import app

    handed_out: list[AsyncSession] = []

    async def _counting() -> AsyncIterator[AsyncSession]:
        async with get_session_factory()() as session:
            handed_out.append(session)
            yield session

    app.dependency_overrides[get_db] = _counting
    try:
        yield handed_out
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/games/catalog"),
        ("GET", "/games/me"),
        ("GET", "/games/leaderboard/yacht"),
        ("GET", "/stats/me"),
        ("GET", "/players/me"),
        ("GET", "/daily-challenge/today"),
        ("GET", "/daily-challenge/status"),
        ("DELETE", "/me"),
    ],
)
def test_routes_take_one_session_from_get_db(
    client: TestClient, counting_get_db: list[AsyncSession], session_id: str, method, path
) -> None:
    r = client.request(method, path, headers=session_headers(session_id))
    assert r.is_success, r.text
    assert len(counting_get_db) == 1


def test_require_entitlement_shares_the_route_session(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, AsyncSession] = {}

    async def fake_check(db: AsyncSession, session_id: str, game_slug: str) -> None:
        seen["dependency"] = db

    monkeypatch.setattr(ent_deps, "check_entitlement", fake_check)
    router = APIRouter(dependencies=[Depends(ent_deps.require_entitlement("hearts"))])

    @router.get("/x")
    async def route(request: Request, db: DbSession) -> dict:
        seen["route"] = db
        return {}

    app = FastAPI()
    app.include_router(router)
    r = TestClient(app).get("/x", headers={"X-Session-ID": str(uuid.uuid4())})
    assert r.status_code == 200
    assert seen["dependency"] is seen["route"]


def test_require_entitlement_releases_its_connection_before_the_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The read-only check must not keep a pooled connection checked out
    (idle in transaction) for the whole of a slow route."""
    seen: dict[str, bool] = {}

    async def reading_check(db: AsyncSession, session_id: str, game_slug: str) -> None:
        await db.execute(text("SELECT 1"))  # opens a transaction, as the real check does
        seen["checked_in_transaction"] = db.in_transaction()

    monkeypatch.setattr(ent_deps, "check_entitlement", reading_check)
    router = APIRouter(dependencies=[Depends(ent_deps.require_entitlement("hearts"))])

    @router.get("/x")
    async def route(request: Request, db: DbSession) -> dict:
        seen["in_transaction"] = db.in_transaction()
        return {}

    app = FastAPI()
    app.include_router(router)
    r = TestClient(app).get("/x", headers={"X-Session-ID": str(uuid.uuid4())})
    assert r.status_code == 200
    assert seen["checked_in_transaction"] is True
    assert seen["in_transaction"] is False


def test_get_db_session_is_closed_before_the_response_is_sent() -> None:
    """``scope="function"``: like the old ``async with factory() as db:`` blocks,
    the session (and its connection) is released before the body goes out."""
    app = FastAPI()

    @app.get("/x")
    async def route(db: DbSession) -> StreamingResponse:
        await db.execute(text("SELECT 1"))
        assert db.in_transaction()

        async def body() -> AsyncIterator[bytes]:
            yield b"open" if db.in_transaction() else b"closed"

        return StreamingResponse(body())

    assert TestClient(app).get("/x").content == b"closed"


def test_get_db_is_the_renamed_dependency() -> None:
    assert not hasattr(base, "get_session")


# ---------------------------------------------------------------------------
# complete_game: game_type comes back loaded, no re-select in the router
# ---------------------------------------------------------------------------


@pytest.fixture()
def games_selects() -> Iterator[list[str]]:
    """Every ``SELECT ... FROM games`` the engine runs while the fixture is active."""
    seen: list[str] = []
    engine = get_engine().sync_engine

    def _record(conn, cursor, statement, params, context, executemany) -> None:
        if statement.lstrip().upper().startswith("SELECT") and re.search(
            r"\bFROM games\b", statement
        ):
            seen.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", _record)


def test_complete_route_reads_the_game_twice_and_repeat_once(
    client: TestClient, session_id: str, games_selects: list[str]
) -> None:
    game_id = _new_game(client, session_id)
    games_selects.clear()
    url = f"/games/{game_id}/complete"
    body = {"final_score": 120, "outcome": "completed"}
    r = client.patch(url, headers=session_headers(session_id), json=body)
    assert r.status_code == 200, r.text
    assert r.json()["game_type"] == "yacht"
    # The locked read and the refresh after commit; the router's re-select is gone.
    assert len(games_selects) == 2, games_selects
    games_selects.clear()
    r = client.patch(url, headers=session_headers(session_id), json=body)
    assert r.status_code == 200 and r.json()["game_type"] == "yacht"
    assert r.json()["final_score"] == 120
    assert len(games_selects) == 1, games_selects


async def test_complete_game_returns_game_type_loaded(session_id: str) -> None:
    async with get_session_factory()() as db:
        game = await sessions.create_game(
            db,
            session_id=session_id,
            client_id=None,
            game_type_name="yacht",
            metadata={},
            players=[{"player_id": session_id}],
        )
        game_id = game.id
    for _ in range(2):  # the first completion, then the idempotent repeat
        async with get_session_factory()() as db:
            done = await sessions.complete_game(
                db,
                game_id=game_id,
                session_id=session_id,
                final_score=10,
                outcome="completed",
                duration_ms=None,
            )
            assert isinstance(done, Game)
            assert "game_type" in done.__dict__, "game_type must be loaded, not lazy"
        assert done.game_type.name == "yacht"

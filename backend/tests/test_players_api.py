"""One display name per player (#2624, #2519 decisions 17-18).

``PUT/GET/DELETE /players/me`` keep the caller's one display name. Every board
ranks only players who have one, counts all of their finished games, and shows
the current name, so a rename applies to all history. ``PATCH /games/{id}/name``
stays for installed builds and sets the same name.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError, OperationalError

from db.base import get_engine, get_session_factory, is_configured
from db.models import Game, GameEntitlement, GameType, Player
from games import leaderboard
from games.board import SCORE_METRIC
from limiter import limiter, session_key
from vocab import GameType as GameTypeEnum

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)

ENABLED_BOARDS = sorted(
    gt.value for gt in GameTypeEnum if leaderboard.enabled_board(gt.value) is not None
)
CREATE_METADATA: dict[str, dict[str, Any]] = {
    "sudoku": {"difficulty": "easy"},
    "starswarm": {"difficulty_tier": "Captain"},
}
PARTITION_QUERY: dict[str, str] = {
    "sudoku": "?difficulty=easy",
    "starswarm": "?difficulty_tier=Captain",
}


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


def _sid() -> str:
    return str(uuid.uuid4())


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


async def _grant_all(sid: str) -> None:
    """Entitle ``sid`` to every game, so premium tiers never get in the way."""
    factory = get_session_factory()
    async with factory() as db:
        names = (await db.execute(select(GameType.name))).scalars().all()
        for name in names:
            db.add(GameEntitlement(session_id=sid, game_slug=name))
        await db.commit()


async def _player(sid: str) -> Player | None:
    factory = get_session_factory()
    async with factory() as db:
        return await db.get(Player, sid)


def _put(client: TestClient, sid: str, name: Any):
    return client.put("/players/me", headers=_headers(sid), json={"display_name": name})


def _get(client: TestClient, sid: str) -> Any:
    r = client.get("/players/me", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return r.json()


def _play(client: TestClient, sid: str, game_type: str, value: int, **create_meta: Any) -> str:
    """Create and complete one game through the real session pipeline."""
    metadata = {**CREATE_METADATA.get(game_type, {}), **create_meta}
    r = client.post(
        "/games", headers=_headers(sid), json={"game_type": game_type, "metadata": metadata}
    )
    assert r.status_code == 200, r.text
    game_id = r.json()["id"]
    board = leaderboard.enabled_board(game_type)
    body: dict[str, Any] = {"outcome": "completed"}
    if board is not None and board.metric != SCORE_METRIC:
        body["result"] = {board.metric: value}
    else:
        body["final_score"] = value
    r = client.patch(f"/games/{game_id}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    return game_id


def _entries(client: TestClient, path: str, sid: str) -> list[tuple[str, int]]:
    r = client.get(f"/games/leaderboard/{path}", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return [(e["player_name"], e["value"]) for e in r.json()["entries"]]


# ---------------------------------------------------------------------------
# PUT / GET / DELETE /players/me
# ---------------------------------------------------------------------------


def test_get_without_a_name_is_null(client: TestClient) -> None:
    assert _get(client, _sid()) == {"display_name": None}


def test_put_stores_the_trimmed_name_and_get_returns_it(client: TestClient) -> None:
    sid = _sid()
    r = _put(client, sid, "  Ada  ")
    assert r.status_code == 200, r.text
    assert r.json() == {"display_name": "Ada"}
    assert _get(client, sid) == {"display_name": "Ada"}


async def test_put_replaces_the_name(client: TestClient) -> None:
    sid = _sid()
    assert _put(client, sid, "William").status_code == 200
    assert _put(client, sid, "Bill").json() == {"display_name": "Bill"}
    assert _get(client, sid) == {"display_name": "Bill"}
    player = await _player(sid)
    assert player is not None and player.display_name == "Bill"


async def test_put_of_the_same_name_writes_nothing(client: TestClient) -> None:
    """A repeated name still issues one upsert (#2675 drops the pre-read that
    used to short-circuit it), but its ``WHERE display_name != :name`` keeps
    the conflict branch from matching, so the statement provably changes
    nothing — checked here via the cursor's own rowcount, not its absence."""
    sid = _sid()
    first = _put(client, sid, "Ada")
    before = await _player(sid)
    assert before is not None

    rowcounts: list[int] = []

    def record(_conn, cursor, statement, *_args) -> None:  # type: ignore[no-untyped-def]
        if statement.lstrip().upper().startswith(("INSERT", "UPDATE")):
            rowcounts.append(cursor.rowcount)

    engine = get_engine().sync_engine
    event.listen(engine, "after_cursor_execute", record)
    try:
        # Surrounding whitespace is trimmed first, so this is the same name too.
        replays = [_put(client, sid, "Ada"), _put(client, sid, " Ada ")]
    finally:
        event.remove(engine, "after_cursor_execute", record)

    assert all(r.status_code == 200 and r.json() == first.json() for r in replays)
    assert rowcounts and all(count == 0 for count in rowcounts)
    after = await _player(sid)
    assert after is not None and after.updated_at == before.updated_at


@pytest.mark.parametrize(
    "name",
    ["", "   ", "x" * 33, None, 42, "\u001f", "\u001c\u001d", "\u0085", "a\u0000b", "tab\there"],
)
def test_put_validates_like_player_name(client: TestClient, name: Any) -> None:
    sid = _sid()
    r = _put(client, sid, name)
    assert r.status_code == 422, r.text
    assert _get(client, sid) == {"display_name": None}


def test_put_accepts_exactly_32_characters(client: TestClient) -> None:
    sid = _sid()
    assert _put(client, sid, "x" * 32).json() == {"display_name": "x" * 32}


def test_put_without_a_body_field_is_422(client: TestClient) -> None:
    r = client.put("/players/me", headers=_headers(_sid()), json={})
    assert r.status_code == 422


@pytest.mark.parametrize("method", ["get", "put", "delete"])
@pytest.mark.parametrize("headers", [{}, {"X-Session-ID": "not-a-uuid"}])
def test_routes_require_a_valid_session(
    client: TestClient, method: str, headers: dict[str, str]
) -> None:
    kwargs: dict[str, Any] = {"headers": headers}
    if method == "put":
        kwargs["json"] = {"display_name": "Ada"}
    r = getattr(client, method)("/players/me", **kwargs)
    assert r.status_code == 400, r.text


def test_names_are_per_player(client: TestClient) -> None:
    a, b = _sid(), _sid()
    _put(client, a, "Ada")
    assert _get(client, b) == {"display_name": None}


def test_delete_clears_the_name_and_is_idempotent(client: TestClient) -> None:
    sid = _sid()
    _put(client, sid, "Ada")
    for _ in range(2):
        r = client.delete("/players/me", headers=_headers(sid))
        assert r.status_code == 204, r.text
        assert r.content == b""
        assert _get(client, sid) == {"display_name": None}


def test_delete_without_a_name_is_204(client: TestClient) -> None:
    assert client.delete("/players/me", headers=_headers(_sid())).status_code == 204


async def test_players_table_enforces_the_length(client: TestClient) -> None:
    for bad in ("", "x" * 33):
        factory = get_session_factory()
        async with factory() as db:
            db.add(Player(session_id=_sid(), display_name=bad))
            with pytest.raises(IntegrityError):
                await db.commit()


async def test_erasure_deletes_the_display_name(client: TestClient) -> None:
    sid = _sid()
    _put(client, sid, "Ada")
    assert client.delete("/me", headers=_headers(sid)).status_code == 204
    assert await _player(sid) is None


# ---------------------------------------------------------------------------
# Boards read the player's name
# ---------------------------------------------------------------------------


def test_every_enabled_board_is_covered() -> None:
    assert len(ENABLED_BOARDS) >= 8, ENABLED_BOARDS


@pytest.mark.parametrize("game_type", ENABLED_BOARDS)
async def test_an_unnamed_player_is_absent_until_they_set_a_name(
    client: TestClient, game_type: str
) -> None:
    """A game finished before the player had a name ranks once they set one."""
    sid = _sid()
    await _grant_all(sid)
    path = f"{game_type}{PARTITION_QUERY.get(game_type, '')}"
    _play(client, sid, game_type, 5)
    assert _entries(client, path, sid) == []

    assert _put(client, sid, "Solo").status_code == 200
    assert _entries(client, path, sid) == [("Solo", 5)]

    assert client.delete("/players/me", headers=_headers(sid)).status_code == 204
    assert _entries(client, path, sid) == []


async def test_a_rename_shows_on_every_board_for_all_history(client: TestClient) -> None:
    sid = _sid()
    await _grant_all(sid)
    # Finished before the player had any name.
    _play(client, sid, "solitaire", 300)
    _play(client, sid, "sudoku", 80, difficulty="easy")
    assert _put(client, sid, "William").status_code == 200
    # Finished under the first name.
    _play(client, sid, "sort", 7)
    _play(client, sid, "sudoku", 250, difficulty="hard")

    boards = ["solitaire", "sudoku?difficulty=easy", "sudoku?difficulty=hard", "sort"]
    assert [_entries(client, b, sid) for b in boards] == [
        [("William", 300)],
        [("William", 80)],
        [("William", 250)],
        [("William", 7)],
    ]

    assert _put(client, sid, "Bill").status_code == 200
    assert [_entries(client, b, sid) for b in boards] == [
        [("Bill", 300)],
        [("Bill", 80)],
        [("Bill", 250)],
        [("Bill", 7)],
    ]


async def test_a_rename_does_not_touch_other_players(client: TestClient) -> None:
    me, other = _sid(), _sid()
    _play(client, me, "solitaire", 300)
    _play(client, other, "solitaire", 200)
    _put(client, me, "Me")
    _put(client, other, "Other")
    _put(client, me, "Renamed")
    assert _entries(client, "solitaire", me) == [("Renamed", 300), ("Other", 200)]


# ---------------------------------------------------------------------------
# PATCH /games/{id}/name — the compat route for installed builds
# ---------------------------------------------------------------------------


async def test_compat_name_route_sets_the_display_name_and_ranks(client: TestClient) -> None:
    better, worse, me = _sid(), _sid(), _sid()
    _play(client, better, "solitaire", 900)
    _put(client, better, "Better")
    _play(client, worse, "solitaire", 100)
    _put(client, worse, "Worse")
    game_id = _play(client, me, "solitaire", 500)

    r = client.patch(
        f"/games/{game_id}/name", headers=_headers(me), json={"player_name": "  Ada  "}
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"rank": 2, "is_best": True}
    assert _get(client, me) == {"display_name": "Ada"}
    assert _entries(client, "solitaire", me) == [("Better", 900), ("Ada", 500), ("Worse", 100)]


async def test_compat_name_route_ranks_the_players_best_entry(client: TestClient) -> None:
    me = _sid()
    _play(client, me, "solitaire", 800)
    worse = _play(client, me, "solitaire", 200)
    r = client.patch(f"/games/{worse}/name", headers=_headers(me), json={"player_name": "Me"})
    assert r.json() == {"rank": 1, "is_best": False}
    assert _entries(client, "solitaire", me) == [("Me", 800)]


async def test_compat_name_route_renames_everywhere(client: TestClient) -> None:
    me = _sid()
    await _grant_all(me)
    solitaire = _play(client, me, "solitaire", 300)
    _play(client, me, "sort", 4)
    client.patch(f"/games/{solitaire}/name", headers=_headers(me), json={"player_name": "Old"})
    sort_game = _play(client, me, "sort", 9)
    r = client.patch(f"/games/{sort_game}/name", headers=_headers(me), json={"player_name": "New"})
    assert r.status_code == 200, r.text
    assert _entries(client, "solitaire", me) == [("New", 300)]
    assert _entries(client, "sort", me) == [("New", 9)]


async def test_compat_name_route_still_writes_the_row(client: TestClient) -> None:
    """The route still records the name on the game row, as it always did."""
    me = _sid()
    await _grant_all(me)
    game_id = _play(client, me, "cascade", 1234)
    r = client.patch(f"/games/{game_id}/name", headers=_headers(me), json={"player_name": "Ada"})
    assert r.status_code == 200, r.text
    detail = client.get(f"/games/{game_id}", headers=_headers(me)).json()
    assert detail["metadata"]["player_name"] == "Ada"


async def test_compat_name_route_400s_write_no_name(client: TestClient) -> None:
    me = _sid()
    await _grant_all(me)
    # A tier the board doesn't allow (#2665).
    r = client.post(
        "/games",
        headers=_headers(me),
        json={"game_type": "starswarm", "metadata": {"difficulty_tier": "Cadet"}},
    )
    gid = r.json()["id"]
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(me),
        json={"final_score": 900, "outcome": "completed", "result": {"wave_reached": 2}},
    )
    assert r.status_code == 200, r.text
    r = client.patch(f"/games/{gid}/name", headers=_headers(me), json={"player_name": "Ace"})
    assert r.status_code == 400
    assert r.json()["detail"] == "This game's board does not exist."

    # An unfinished game.
    r = client.post("/games", headers=_headers(me), json={"game_type": "solitaire"})
    open_id = r.json()["id"]
    r = client.patch(f"/games/{open_id}/name", headers=_headers(me), json={"player_name": "Ace"})
    assert r.status_code == 400

    assert _get(client, me) == {"display_name": None}


# ---------------------------------------------------------------------------
# Safe replays
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# A name in POST /games metadata still names the player (#2624 review): builds
# from before #2624 never call PUT /players/me. (The per-game name routes that
# did the same were removed in #2644.)
# ---------------------------------------------------------------------------


async def test_a_name_in_creation_metadata_sets_the_display_name(client: TestClient) -> None:
    me, viewer = _sid(), _sid()
    await _grant_all(me)
    await _grant_all(viewer)
    _play(client, me, "cascade", 700, player_name="Maker")
    assert _get(client, me) == {"display_name": "Maker"}
    assert _entries(client, "cascade", viewer) == [("Maker", 700)]


async def test_a_legacy_name_that_is_not_a_valid_display_name_is_ignored(
    client: TestClient,
) -> None:
    me = _sid()
    await _grant_all(me)
    _play(client, me, "cascade", 700, player_name="   ")
    assert _get(client, me) == {"display_name": None}


async def test_replaying_complete_on_a_finished_row_changes_nothing(client: TestClient) -> None:
    """Regression guard: with the name on the player, a replayed completion has
    nothing left to duplicate or rewrite (#2624)."""
    sid = _sid()
    game_id = _play(client, sid, "solitaire", 400)
    _put(client, sid, "Ada")
    before_detail = client.get(f"/games/{game_id}", headers=_headers(sid)).json()
    before_board = _entries(client, "solitaire", sid)

    for body in (
        {"final_score": 400, "outcome": "completed"},
        {"final_score": 999, "outcome": "kept_playing", "duration_ms": 5, "result": {"x": 1}},
    ):
        r = client.patch(f"/games/{game_id}/complete", headers=_headers(sid), json=body)
        assert r.status_code == 200, r.text
        assert r.json()["final_score"] == 400
        assert r.json()["outcome"] == "completed"

    assert client.get(f"/games/{game_id}", headers=_headers(sid)).json() == before_detail
    assert _entries(client, "solitaire", sid) == before_board == [("Ada", 400)]
    factory = get_session_factory()
    async with factory() as db:
        rows = (await db.execute(select(Game.id).where(Game.session_id == sid))).all()
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# Rate limits and errors
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("handler", ["get_my_player", "put_my_player", "delete_my_player"])
def test_player_routes_are_rate_limited_by_session(handler: str) -> None:
    limits = limiter._route_limits[f"players.router.{handler}"]
    assert limits and all(lim.key_func is session_key for lim in limits)


def test_put_rate_limit_is_enforced(client: TestClient) -> None:
    from players.router import PLAYER_WRITE_RATE_LIMIT

    allowed = int(PLAYER_WRITE_RATE_LIMIT.split("/")[0])
    sid = _sid()
    statuses = [_put(client, sid, f"Name{i}").status_code for i in range(allowed + 1)]
    assert statuses == [200] * allowed + [429]
    assert _put(client, _sid(), "Other").status_code == 200


SECRET_SID = "0f0f0f0f-dead-4bee-8f00-000000000000"


@pytest.mark.parametrize(
    ("method", "target", "detail"),
    [
        ("put", "set_display_name", "Failed to save display name."),
        ("get", "get_display_name", "Failed to load display name."),
        ("delete", "clear_display_name", "Failed to clear display name."),
    ],
)
def test_db_errors_are_500_and_logged_without_the_session_id(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    method: str,
    target: str,
    detail: str,
) -> None:
    from players import service

    async def fail(*_: Any, **__: Any) -> Any:
        raise OperationalError("SELECT ... WHERE session_id = ?", {"sid": SECRET_SID}, None)

    monkeypatch.setattr(service, target, fail)
    kwargs: dict[str, Any] = {"headers": _headers(SECRET_SID)}
    if method == "put":
        kwargs["json"] = {"display_name": "Ada"}
    with caplog.at_level("ERROR"):
        r = getattr(client, method)("/players/me", **kwargs)
    assert r.status_code == 500
    assert r.json()["detail"] == detail
    errors = [rec for rec in caplog.records if rec.levelname == "ERROR"]
    assert errors and "OperationalError" in errors[0].getMessage()
    assert all(SECRET_SID not in rec.getMessage() for rec in errors)

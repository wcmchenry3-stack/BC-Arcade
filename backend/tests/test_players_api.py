"""Leaderboard participation under a generated name (#2624, #2778).

``PUT /players/me`` joins the boards under a server-generated name (no client
text is ever stored), ``POST /players/me/reroll`` swaps it for another, and
``DELETE /players/me`` leaves. Every board ranks only players who have joined,
counts all of their finished games, and shows the current name, so a reroll
applies to all history.
"""

from __future__ import annotations

import os
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError

from db.base import get_session_factory
from db.models import Game, GameEntitlement, GameType, Player
from games import leaderboard
from limiter import limiter, session_key
from players.generated import is_generated_display_name
from tests._helpers import session_headers as _headers
from tests.test_generic_leaderboard import (
    CREATE_METADATA,
    PARTITION_QUERY,
    completion_body,
    metric_value,
)
from vocab import GameType as GameTypeEnum

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)

ENABLED_BOARDS = sorted(
    gt.value for gt in GameTypeEnum if leaderboard.enabled_board(gt.value) is not None
)


def _sid() -> str:
    return str(uuid.uuid4())


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


def _join(client: TestClient, sid: str, body: Any = None):
    kwargs: dict[str, Any] = {"headers": _headers(sid)}
    if body is not None:
        kwargs["json"] = body
    return client.put("/players/me", **kwargs)


def _join_name(client: TestClient, sid: str) -> str:
    r = _join(client, sid)
    assert r.status_code == 200, r.text
    name = r.json()["display_name"]
    assert is_generated_display_name(name), name
    return name


def _reroll(client: TestClient, sid: str):
    return client.post("/players/me/reroll", headers=_headers(sid))


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
    assert board is not None, game_type
    body = completion_body(board, value)
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


def test_get_without_joining_is_null(client: TestClient) -> None:
    assert _get(client, _sid()) == {"display_name": None}


def test_put_joins_with_a_generated_name_and_get_returns_it(client: TestClient) -> None:
    sid = _sid()
    name = _join_name(client, sid)
    assert _get(client, sid) == {"display_name": name}


@pytest.mark.parametrize(
    "body",
    [
        {"display_name": "Ada"},
        {"display_name": "Brave Otter 4821"},
        {"display_name": "x" * 500},
        {"display_name": "\u0000"},
        {"name": "Ada", "extra": 1},
        {},
    ],
)
async def test_put_never_stores_client_text(client: TestClient, body: Any) -> None:
    """Arbitrary text is ignored (#2778): an older build that still sends a
    name joins, as sending one meant, under a generated name."""
    sid = _sid()
    r = _join(client, sid, body)
    assert r.status_code == 200, r.text
    name = r.json()["display_name"]
    assert is_generated_display_name(name)
    if "display_name" in body:
        assert name != body["display_name"]
    player = await _player(sid)
    assert player is not None and player.display_name == name


async def test_joining_again_keeps_the_name_and_writes_nothing(client: TestClient) -> None:
    sid = _sid()
    first = _join_name(client, sid)
    before = await _player(sid)
    assert before is not None
    assert [_join_name(client, sid) for _ in range(3)] == [first] * 3
    after = await _player(sid)
    assert after is not None and after.updated_at == before.updated_at


async def test_reroll_picks_a_different_generated_name(client: TestClient) -> None:
    sid = _sid()
    first = _join_name(client, sid)
    r = _reroll(client, sid)
    assert r.status_code == 200, r.text
    second = r.json()["display_name"]
    assert second != first and is_generated_display_name(second)
    assert _get(client, sid) == {"display_name": second}
    player = await _player(sid)
    assert player is not None and player.display_name == second


def test_reroll_without_joining_is_404_and_does_not_opt_in(client: TestClient) -> None:
    sid = _sid()
    r = _reroll(client, sid)
    assert r.status_code == 404, r.text
    assert _get(client, sid) == {"display_name": None}


def test_reroll_ignores_a_body(client: TestClient) -> None:
    sid = _sid()
    _join_name(client, sid)
    r = client.post("/players/me/reroll", headers=_headers(sid), json={"display_name": "Ada"})
    assert r.status_code == 200
    assert is_generated_display_name(r.json()["display_name"])


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/players/me"),
        ("put", "/players/me"),
        ("delete", "/players/me"),
        ("post", "/players/me/reroll"),
    ],
)
@pytest.mark.parametrize("headers", [{}, {"X-Session-ID": "not-a-uuid"}])
def test_routes_require_a_valid_session(
    client: TestClient, method: str, path: str, headers: dict[str, str]
) -> None:
    r = getattr(client, method)(path, headers=headers)
    assert r.status_code == 400, r.text


def test_names_are_per_player(client: TestClient) -> None:
    a, b = _sid(), _sid()
    _join_name(client, a)
    assert _get(client, b) == {"display_name": None}


def test_delete_leaves_the_boards_and_is_idempotent(client: TestClient) -> None:
    sid = _sid()
    _join_name(client, sid)
    for _ in range(2):
        r = client.delete("/players/me", headers=_headers(sid))
        assert r.status_code == 204, r.text
        assert r.content == b""
        assert _get(client, sid) == {"display_name": None}


def test_rejoining_after_leaving_gets_a_generated_name(client: TestClient) -> None:
    sid = _sid()
    _join_name(client, sid)
    assert client.delete("/players/me", headers=_headers(sid)).status_code == 204
    _join_name(client, sid)


def test_delete_without_joining_is_204(client: TestClient) -> None:
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
    _join_name(client, sid)
    assert client.delete("/me", headers=_headers(sid)).status_code == 204
    assert await _player(sid) is None


# ---------------------------------------------------------------------------
# Boards read the player's name
# ---------------------------------------------------------------------------


def test_every_enabled_board_is_covered() -> None:
    assert len(ENABLED_BOARDS) >= 8, ENABLED_BOARDS


@pytest.mark.parametrize("game_type", ENABLED_BOARDS)
async def test_a_player_is_absent_until_they_join(client: TestClient, game_type: str) -> None:
    """A game finished before the player joined ranks once they join."""
    sid = _sid()
    await _grant_all(sid)
    path = f"{game_type}{PARTITION_QUERY.get(game_type, '')}"
    board = leaderboard.enabled_board(game_type)
    assert board is not None, game_type
    value = metric_value(board, 5)
    _play(client, sid, game_type, value)
    assert _entries(client, path, sid) == []

    name = _join_name(client, sid)
    assert _entries(client, path, sid) == [(name, value)]

    assert client.delete("/players/me", headers=_headers(sid)).status_code == 204
    assert _entries(client, path, sid) == []


async def test_a_reroll_shows_on_every_board_for_all_history(client: TestClient) -> None:
    sid = _sid()
    await _grant_all(sid)
    # Finished before the player joined.
    _play(client, sid, "solitaire", 300)
    _play(client, sid, "sudoku", 80, difficulty="easy")
    first = _join_name(client, sid)
    # Finished under the first name.
    _play(client, sid, "sort", 7)
    _play(client, sid, "sudoku", 250, difficulty="hard")

    boards = ["solitaire", "sudoku?difficulty=easy", "sudoku?difficulty=hard", "sort"]
    assert [_entries(client, b, sid) for b in boards] == [
        [(first, 300)],
        [(first, 80)],
        [(first, 250)],
        [(first, 7)],
    ]

    second = _reroll(client, sid).json()["display_name"]
    assert [_entries(client, b, sid) for b in boards] == [
        [(second, 300)],
        [(second, 80)],
        [(second, 250)],
        [(second, 7)],
    ]


async def test_a_reroll_does_not_touch_other_players(client: TestClient) -> None:
    me, other = _sid(), _sid()
    _play(client, me, "solitaire", 300)
    _play(client, other, "solitaire", 200)
    _join_name(client, me)
    other_name = _join_name(client, other)
    mine = _reroll(client, me).json()["display_name"]
    assert _entries(client, "solitaire", me) == [(mine, 300), (other_name, 200)]


# ---------------------------------------------------------------------------
# A name in POST /games metadata (builds from before #2624, which never call
# PUT /players/me) was the player's opt-in under the old model: it still joins
# them, but only ever under a generated name (#2778).
# ---------------------------------------------------------------------------


async def test_a_name_in_creation_metadata_joins_under_a_generated_name(
    client: TestClient,
) -> None:
    me, viewer = _sid(), _sid()
    await _grant_all(me)
    await _grant_all(viewer)
    _play(client, me, "cascade", 700, player_name="Maker")
    name = _get(client, me)["display_name"]
    assert name != "Maker" and is_generated_display_name(name)
    assert _entries(client, "cascade", viewer) == [(name, 700)]
    # Later legacy games keep the name the player already has.
    _play(client, me, "cascade", 10, player_name="Other")
    assert _get(client, me) == {"display_name": name}


async def test_a_legacy_name_that_is_not_a_valid_display_name_is_ignored(
    client: TestClient,
) -> None:
    me = _sid()
    await _grant_all(me)
    _play(client, me, "cascade", 700, player_name="   ")
    assert _get(client, me) == {"display_name": None}


@pytest.mark.parametrize(
    "default", ["You", "you", " Player ", "PLAYER 1", "player1", "Guest", "Anonymous", "anon", "Me"]
)
async def test_a_legacy_default_name_does_not_opt_in(client: TestClient, default: str) -> None:
    """A name the old build filled in was never the player's choice to go public."""
    me = _sid()
    await _grant_all(me)
    _play(client, me, "cascade", 700, player_name=default)
    assert _get(client, me) == {"display_name": None}


async def test_replaying_complete_on_a_finished_row_changes_nothing(client: TestClient) -> None:
    """Regression guard: with the name on the player, a replayed completion has
    nothing left to duplicate or rewrite (#2624)."""
    sid = _sid()
    game_id = _play(client, sid, "solitaire", 400)
    name = _join_name(client, sid)
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
    assert _entries(client, "solitaire", sid) == before_board == [(name, 400)]
    factory = get_session_factory()
    async with factory() as db:
        rows = (await db.execute(select(Game.id).where(Game.session_id == sid))).all()
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# Rate limits and errors
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "handler", ["get_my_player", "put_my_player", "reroll_my_player", "delete_my_player"]
)
def test_player_routes_are_rate_limited_by_session(handler: str) -> None:
    limits = limiter._route_limits[f"players.router.{handler}"]
    assert limits and all(lim.key_func is session_key for lim in limits)


def test_put_rate_limit_is_enforced(client: TestClient) -> None:
    from players.router import PLAYER_WRITE_RATE_LIMIT

    allowed = int(PLAYER_WRITE_RATE_LIMIT.split("/")[0])
    sid = _sid()
    statuses = [_join(client, sid).status_code for _ in range(allowed + 1)]
    assert statuses == [200] * allowed + [429]
    assert _join(client, _sid()).status_code == 200


def test_reroll_has_its_own_tighter_rate_limit(client: TestClient) -> None:
    from players.router import PLAYER_REROLL_RATE_LIMIT, PLAYER_WRITE_RATE_LIMIT

    allowed = int(PLAYER_REROLL_RATE_LIMIT.split("/")[0])
    assert PLAYER_REROLL_RATE_LIMIT.endswith("/hour")
    assert allowed < int(PLAYER_WRITE_RATE_LIMIT.split("/")[0])
    limits = [str(lim.limit) for lim in limiter._route_limits["players.router.reroll_my_player"]]
    assert len(limits) == 2
    sid = _sid()
    _join_name(client, sid)
    statuses = [_reroll(client, sid).status_code for _ in range(allowed + 1)]
    assert statuses == [200] * allowed + [429]
    # Per session: another player can still reroll, and joining isn't affected.
    other = _sid()
    _join_name(client, other)
    assert _reroll(client, other).status_code == 200
    assert _join(client, sid).status_code == 200


SECRET_SID = "0f0f0f0f-dead-4bee-8f00-000000000000"


@pytest.mark.parametrize(
    ("method", "path", "target", "detail"),
    [
        ("put", "/players/me", "join_leaderboards", "Failed to join leaderboards."),
        ("post", "/players/me/reroll", "reroll_display_name", "Failed to change display name."),
        ("get", "/players/me", "get_display_name", "Failed to load display name."),
        ("delete", "/players/me", "clear_display_name", "Failed to clear display name."),
    ],
)
def test_db_errors_are_500_and_logged_without_the_session_id(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    method: str,
    path: str,
    target: str,
    detail: str,
) -> None:
    from players import service

    async def fail(*_: Any, **__: Any) -> Any:
        raise OperationalError("SELECT ... WHERE session_id = ?", {"sid": SECRET_SID}, None)

    monkeypatch.setattr(service, target, fail)
    with caplog.at_level("ERROR"):
        r = getattr(client, method)(path, headers=_headers(SECRET_SID))
    assert r.status_code == 500
    assert r.json()["detail"] == detail
    errors = [rec for rec in caplog.records if rec.levelname == "ERROR"]
    assert errors and "OperationalError" in errors[0].getMessage()
    assert all(SECRET_SID not in rec.getMessage() for rec in errors)

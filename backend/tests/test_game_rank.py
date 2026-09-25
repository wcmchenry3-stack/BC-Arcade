"""``GET /games/{id}/rank``: the result card's read-only rank call (#2677).

It reports the caller's standing on the game's board without setting
anything: the rank of their best entry in that game's partition and whether
this game is that entry, or ``ranked: false`` with a reason. The standing
is the one ``PATCH /games/{id}/name`` and the board itself report.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select

from db.base import get_engine, get_session_factory, is_configured
from db.models import Game, Player
from games import leaderboard
from limiter import _real_ip, limiter, session_key
from starswarm.models import DEFAULT_DIFFICULTY_TIER
from tests.test_generic_leaderboard import (
    SECRET_SID,
    _assert_logged_safely,
    _FailingDB,
    _finished_game,
    _grant_all,
    _headers,
    _patched_board,
    _seed,
    _set_name,
    _sid,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)

UNRANKED = {"ranked": False, "rank": None, "is_best": None}


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


def _rank(client: TestClient, game_id: Any, sid: str) -> dict:
    r = client.get(f"/games/{game_id}/rank", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return r.json()


def _ranked(rank: int, is_best: bool) -> dict:
    return {"ranked": True, "rank": rank, "is_best": is_best, "reason": None}


def _unranked(reason: str) -> dict:
    return {**UNRANKED, "reason": reason}


# ---------------------------------------------------------------------------
# Ranked
# ---------------------------------------------------------------------------


async def test_rank_is_the_named_players_best_entry(client: TestClient) -> None:
    await _seed("solitaire", _sid(), score=900, name="Top")
    await _seed("solitaire", _sid(), score=100, name="Bottom")
    sid = _sid()
    best = await _seed("solitaire", sid, score=500, name="Me", minutes=1)
    worse = await _seed("solitaire", sid, score=300, name="Me", minutes=2)

    assert _rank(client, best, sid) == _ranked(2, True)
    # A game that isn't the player's best still reports the best's rank.
    assert _rank(client, worse, sid) == _ranked(2, False)


async def test_rank_agrees_with_the_name_route_and_the_board(client: TestClient) -> None:
    for i, score in enumerate((950, 700, 400, 150)):
        await _seed("freecell", _sid(), score=score, name=f"P{i}", minutes=i)
    sid = _sid()
    ids = [
        await _seed("freecell", sid, score=s, name="Me", minutes=10 + i)
        for i, s in enumerate((500, 300, 800))
    ]
    board = client.get("/games/leaderboard/freecell?limit=20").json()["entries"]
    board_rank = next(e["rank"] for e in board if e["player_name"] == "Me")

    for game_id in ids:
        got = _rank(client, game_id, sid)
        r = client.patch(
            f"/games/{game_id}/name", headers=_headers(sid), json={"player_name": "Me"}
        )
        assert r.status_code == 200, r.text
        named = r.json()
        assert got == _ranked(named["rank"], named["is_best"])
        assert got["rank"] == board_rank == 2  # FreeCell: fewer moves; only 150 beats 300
    assert [_rank(client, g, sid)["is_best"] for g in ids] == [False, True, False]


async def test_rank_is_exact_outside_the_top_ten(client: TestClient) -> None:
    for i in range(12):
        await _seed("solitaire", _sid(), score=1000 - i * 10, name=f"P{i}", minutes=i)
    sid = _sid()
    game_id = await _seed("solitaire", sid, score=5, name="Me", minutes=50)
    assert _rank(client, game_id, sid) == _ranked(13, True)


async def test_rank_uses_the_tiebreak(client: TestClient) -> None:
    await _seed("sort", _sid(), name="Fewer", meta={"level_reached": 5, "total_moves": 10})
    await _seed("sort", _sid(), name="NoMoves", meta={"level_reached": 5})
    sid = _sid()
    game_id = await _seed(
        "sort", sid, name="Me", minutes=1, meta={"level_reached": 5, "total_moves": 20}
    )
    assert _rank(client, game_id, sid) == _ranked(2, True)


# ---------------------------------------------------------------------------
# Partitioned boards
# ---------------------------------------------------------------------------


async def test_sudoku_ranks_within_the_games_difficulty_and_variant(client: TestClient) -> None:
    await _seed("sudoku", _sid(), score=290, name="HardPro", meta={"difficulty": "hard"})
    await _seed("sudoku", _sid(), score=95, name="EasyPro", meta={"difficulty": "easy"})
    await _seed(
        "sudoku", _sid(), score=99, name="MiniPro", meta={"difficulty": "easy", "variant": "mini"}
    )
    sid = _sid()
    easy = await _seed("sudoku", sid, score=90, name="Me", minutes=1, meta={"difficulty": "easy"})
    # An explicit "classic" is the same board as a row without a variant.
    classic = await _seed(
        "sudoku",
        sid,
        score=80,
        name="Me",
        minutes=2,
        meta={"difficulty": "easy", "variant": "classic"},
    )
    hard = await _seed("sudoku", sid, score=100, name="Me", minutes=3, meta={"difficulty": "hard"})
    mini = await _seed(
        "sudoku",
        sid,
        score=10,
        name="Me",
        minutes=4,
        meta={"difficulty": "easy", "variant": "mini"},
    )

    assert _rank(client, easy, sid) == _ranked(2, True)
    assert _rank(client, classic, sid) == _ranked(2, False)
    assert _rank(client, hard, sid) == _ranked(2, True)
    assert _rank(client, mini, sid) == _ranked(2, True)


async def test_star_swarm_ranks_within_the_games_tier(client: TestClient) -> None:
    await _seed("starswarm", _sid(), score=9000, name="Ace", meta={"difficulty_tier": "Captain"})
    await _seed("starswarm", _sid(), score=100, name="Low", meta={"difficulty_tier": "Captain"})
    # A row without a tier is on the default tier's board.
    await _seed("starswarm", _sid(), score=8000, name="Legacy", meta={})
    sid = _sid()
    await _grant_all(sid)
    captain = await _seed(
        "starswarm", sid, score=500, name="Me", minutes=1, meta={"difficulty_tier": "Captain"}
    )
    default = await _seed(
        "starswarm",
        sid,
        score=500,
        name="Me",
        minutes=2,
        meta={"difficulty_tier": DEFAULT_DIFFICULTY_TIER},
    )
    assert _rank(client, captain, sid) == _ranked(2, True)
    assert _rank(client, default, sid) == _ranked(2, True)


# ---------------------------------------------------------------------------
# Not ranked
# ---------------------------------------------------------------------------


async def test_no_display_name_is_no_name(client: TestClient) -> None:
    await _seed("solitaire", _sid(), score=100, name="Other")
    sid = _sid()
    game_id = await _seed("solitaire", sid, score=900, name=None)
    assert _rank(client, game_id, sid) == _unranked("no_name")

    await _set_name(sid, "Me")
    assert _rank(client, game_id, sid) == _ranked(1, True)


NOT_RANKABLE: dict[str, tuple[str, dict[str, Any]]] = {
    "no final score": ("solitaire", {"score": None}),
    "abandoned": ("solitaire", {"score": 100, "outcome": "abandoned"}),
    "no metric": ("sort", {"meta": {"total_moves": 3}}),
    "non-integer metric": ("sort", {"meta": {"level_reached": "5"}}),
    "negative score": ("solitaire", {"score": -5}),
    "over the partition cap": ("sudoku", {"score": 101, "meta": {"difficulty": "easy"}}),
    "disallowed partition value": (
        "starswarm",
        {"score": 100, "meta": {"difficulty_tier": "NoSuchTier"}},
    ),
}


@pytest.mark.parametrize("named", [True, False], ids=["named", "unnamed"])
@pytest.mark.parametrize("case", sorted(NOT_RANKABLE))
async def test_a_game_that_cannot_rank_is_not_rankable(
    client: TestClient, case: str, named: bool
) -> None:
    game_type, row = NOT_RANKABLE[case]
    sid = _sid()
    await _grant_all(sid)
    game_id = await _seed(game_type, sid, name="Me" if named else None, **row)
    # Checked before the name: a card never asks for a name the game can't use.
    assert _rank(client, game_id, sid) == _unranked("not_rankable")


async def test_an_unfinished_game_is_not_rankable(client: TestClient) -> None:
    sid = _sid()
    await _set_name(sid, "Me")
    r = client.post("/games", headers=_headers(sid), json={"game_type": "solitaire"})
    assert r.status_code == 200, r.text
    assert _rank(client, r.json()["id"], sid) == _unranked("not_rankable")


async def test_a_non_qualifying_outcome_is_not_rankable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patched_board(monkeypatch, "solitaire", qualifying_outcomes=("completed",))
    sid = _sid()
    kept = await _seed("solitaire", sid, score=50, name="Me", outcome="kept_playing")
    done = await _seed("solitaire", sid, score=40, name="Me", minutes=1, outcome="completed")
    assert _rank(client, kept, sid) == _unranked("not_rankable")
    assert _rank(client, done, sid) == _ranked(1, True)


async def test_a_named_row_the_board_still_excludes_is_not_rankable(client: TestClient) -> None:
    # A sentinel ``*-anon`` session passes the row check and has a name, but
    # the board never shows it. (Not reachable over HTTP: the header must be
    # a UUID.) The rank follows the board, not the row check.
    sid = "solitaire-anon"
    game_id = await _seed("solitaire", sid, score=100, name="Anon")
    factory = get_session_factory()
    async with factory() as db:
        game = await leaderboard.load_game(db, game_id)
        assert game is not None
        result = await leaderboard.game_rank(db, game=game, session_id=sid)
    assert result == leaderboard.GameRank(ranked=False, reason="not_rankable")


@pytest.mark.parametrize("game_type", ["blackjack", "daily_word"])
async def test_a_disabled_board_is_board_disabled(client: TestClient, game_type: str) -> None:
    sid = _sid()
    await _grant_all(sid)
    game_id = await _seed(game_type, sid, score=1500, name="Me", outcome="win")
    assert _rank(client, game_id, sid) == _unranked("board_disabled")


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


async def test_another_players_game_is_403(client: TestClient) -> None:
    game_id = await _seed("solitaire", _sid(), score=100, name="Owner")
    r = client.get(f"/games/{game_id}/rank", headers=_headers(_sid()))
    assert r.status_code == 403


def test_an_unknown_game_is_404(client: TestClient) -> None:
    r = client.get(f"/games/{uuid.uuid4()}/rank", headers=_headers(_sid()))
    assert r.status_code == 404


async def test_a_game_without_a_board_definition_is_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = _sid()
    game_id = await _seed("solitaire", sid, score=100, name="Me")
    monkeypatch.setattr(leaderboard, "get_module", lambda _name: None)
    r = client.get(f"/games/{game_id}/rank", headers=_headers(sid))
    assert r.status_code == 404


def test_a_malformed_id_is_422(client: TestClient) -> None:
    r = client.get("/games/not-a-uuid/rank", headers=_headers(_sid()))
    assert r.status_code == 422


def test_the_session_header_is_required(client: TestClient) -> None:
    assert client.get(f"/games/{uuid.uuid4()}/rank").status_code == 400


async def test_a_premium_game_needs_the_entitlement(client: TestClient) -> None:
    sid = _sid()
    game_id = await _seed(
        "starswarm", sid, score=100, name="Me", meta={"difficulty_tier": "Captain"}
    )
    assert client.get(f"/games/{game_id}/rank", headers=_headers(sid)).status_code == 403
    await _grant_all(sid)
    assert _rank(client, game_id, sid) == _ranked(1, True)


async def test_the_name_lookup_db_error_is_logged_and_chained(
    caplog: pytest.LogCaptureFixture,
) -> None:
    from sqlalchemy.exc import OperationalError

    with caplog.at_level("ERROR"), pytest.raises(leaderboard.LeaderboardError) as info:
        await leaderboard.game_rank(
            _FailingDB(fail_execute=True),  # type: ignore[arg-type]
            game=_finished_game("solitaire"),
            session_id=SECRET_SID,
        )
    assert info.value.status_code == 500
    assert isinstance(info.value.__cause__, OperationalError)
    _assert_logged_safely(caplog, "solitaire")


# ---------------------------------------------------------------------------
# Read-only
# ---------------------------------------------------------------------------


async def _snapshot(sid: str) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]]]:
    factory = get_session_factory()
    async with factory() as db:
        games = (
            await db.execute(
                select(Game.id, Game.game_metadata, Game.final_score, Game.completed_at)
                .where(Game.session_id == sid)
                .order_by(Game.id)
            )
        ).all()
        players = (
            await db.execute(
                select(Player.session_id, Player.display_name, Player.updated_at).where(
                    Player.session_id == sid
                )
            )
        ).all()
    return [tuple(g) for g in games], [tuple(p) for p in players]


async def test_the_rank_route_never_writes(client: TestClient) -> None:
    named, unnamed = _sid(), _sid()
    await _seed("solitaire", _sid(), score=900, name="Other")
    ranked = await _seed("solitaire", named, score=500, name="Me")
    abandoned = await _seed("solitaire", named, score=5, name="Me", outcome="abandoned")
    no_name = await _seed("solitaire", unnamed, score=700, name=None)
    before = [await _snapshot(named), await _snapshot(unnamed)]

    statements: list[str] = []

    def record(_conn, _cursor, statement, *_args) -> None:  # type: ignore[no-untyped-def]
        statements.append(statement)

    engine = get_engine().sync_engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        results = [
            _rank(client, ranked, named),
            _rank(client, abandoned, named),
            _rank(client, no_name, unnamed),
        ]
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert results == [_ranked(2, True), _unranked("not_rankable"), _unranked("no_name")]
    assert statements, "the statement listener saw nothing"
    writes = [
        s
        for s in statements
        if s.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE", "UPSERT", "REPLACE"))
    ]
    assert writes == []
    assert [await _snapshot(named), await _snapshot(unnamed)] == before
    factory = get_session_factory()
    async with factory() as db:
        count = await db.scalar(
            select(func.count()).select_from(Player).where(Player.session_id == unnamed)
        )
    assert count == 0


# ---------------------------------------------------------------------------
# Routing and rate limits
# ---------------------------------------------------------------------------


async def test_the_detail_route_still_resolves(client: TestClient) -> None:
    sid = _sid()
    game_id = await _seed("solitaire", sid, score=100, name="Me")
    detail = client.get(f"/games/{game_id}", headers=_headers(sid))
    assert detail.status_code == 200 and detail.json()["id"] == str(game_id)
    assert _rank(client, game_id, sid) == _ranked(1, True)


def test_rank_rate_limit_keyed_by_session_with_ip_backstop() -> None:
    key_funcs = {lim.key_func for lim in limiter._route_limits["games.router.get_game_rank"]}
    assert key_funcs == {session_key, _real_ip}


async def test_rank_session_limit_is_enforced(client: TestClient) -> None:
    from games.router import RANK_SESSION_RATE_LIMIT

    allowed = int(RANK_SESSION_RATE_LIMIT.split("/")[0])
    sid = _sid()
    game_id = await _seed("solitaire", sid, score=100, name="Me")
    statuses = [
        client.get(f"/games/{game_id}/rank", headers=_headers(sid)).status_code
        for _ in range(allowed + 1)
    ]
    assert statuses == [200] * allowed + [429]
    # Another session from the same IP is still served (its own game: 404 here).
    assert client.get(f"/games/{uuid.uuid4()}/rank", headers=_headers(_sid())).status_code == 404

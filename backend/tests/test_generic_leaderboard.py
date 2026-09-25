"""Generic leaderboard, rank and name routes (#2618).

``GET /games/leaderboard/{game_type}`` and ``PATCH /games/{id}/name`` serve
every game from its ``BoardDefinition``. One entry per player (#2519 decision
12): each named player's best row only, under their current display name
(#2624); abandoned rows and sentinel ``*-anon`` sessions never rank; ranks are
exact and count players, not rows.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from db.base import get_session_factory, is_configured
from db.models import Game, GameEntitlement, GameType, Player
from games import leaderboard
from games.board import SCORE_METRIC
from games.registry import get_module
from limiter import _real_ip, limiter, session_key
from vocab import GameType as GameTypeEnum

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)

ENABLED_BOARDS = sorted(
    gt.value for gt in GameTypeEnum if leaderboard.enabled_board(gt.value) is not None
)
DISABLED_BOARDS = sorted(
    gt.value
    for gt in GameTypeEnum
    if get_module(gt.value) is not None and leaderboard.enabled_board(gt.value) is None
)

# Creation metadata each game's metadata_model requires, and the partition
# query that board needs.
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


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


async def _game_type_id(name: str) -> int:
    factory = get_session_factory()
    async with factory() as db:
        return (await db.execute(select(GameType.id).where(GameType.name == name))).scalar_one()


async def _is_premium(name: str) -> bool:
    factory = get_session_factory()
    async with factory() as db:
        return bool(
            (
                await db.execute(select(GameType.is_premium).where(GameType.name == name))
            ).scalar_one()
        )


async def _grant_all(sid: str) -> None:
    """Entitle ``sid`` to every game, so tier changes never break these tests."""
    factory = get_session_factory()
    async with factory() as db:
        names = (await db.execute(select(GameType.name))).scalars().all()
        for name in names:
            db.add(GameEntitlement(session_id=sid, game_slug=name))
        await db.commit()


async def _seed(
    game_type: str,
    session_id: str,
    *,
    score: int | None = None,
    name: str | None = "Player",
    minutes: int = 0,
    outcome: str | None = "completed",
    meta: dict[str, Any] | None = None,
) -> uuid.UUID:
    """Insert one finished row directly.

    A non-blank ``name`` becomes the player's display name (the latest call
    wins, as a rename would). The row itself carries no name: boards read the
    player's (#2624).
    """
    if name is not None and name.strip():
        await _set_name(session_id, name)
    gt_id = await _game_type_id(game_type)
    metadata = dict(meta or {})
    game_id = uuid.uuid4()
    factory = get_session_factory()
    async with factory() as db:
        db.add(
            Game(
                id=game_id,
                session_id=session_id,
                game_type_id=gt_id,
                game_metadata=metadata,
                players=[],
                final_score=score,
                outcome=outcome,
                started_at=T0 + timedelta(minutes=minutes) - timedelta(seconds=30),
                completed_at=T0 + timedelta(minutes=minutes),
            )
        )
        await db.commit()
    return game_id


async def _set_name(session_id: str, name: str) -> None:
    """Store ``name`` as the player's display name, bypassing the validator."""
    factory = get_session_factory()
    async with factory() as db:
        player = await db.get(Player, session_id)
        if player is None:
            db.add(Player(session_id=session_id, display_name=name))
        else:
            player.display_name = name
        await db.commit()


def _sid() -> str:
    return str(uuid.uuid4())


def _board(client: TestClient, path: str, sid: str | None = None) -> dict:
    headers = _headers(sid) if sid else {}
    r = client.get(f"/games/leaderboard/{path}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _pairs(body: dict) -> list[tuple[str, int]]:
    return [(e["player_name"], e["value"]) for e in body["entries"]]


# ---------------------------------------------------------------------------
# Ordering
# ---------------------------------------------------------------------------


async def test_desc_board_orders_highest_first(client: TestClient) -> None:
    for name, score in (("Low", 100), ("High", 900), ("Mid", 500)):
        await _seed("solitaire", _sid(), score=score, name=name)
    body = _board(client, "solitaire")
    assert body["game_type"] == "solitaire"
    assert body["label_key"] == "score"
    assert body["partition"] == {}
    assert _pairs(body) == [("High", 900), ("Mid", 500), ("Low", 100)]
    assert [e["rank"] for e in body["entries"]] == [1, 2, 3]


async def test_asc_board_orders_lowest_first(client: TestClient) -> None:
    for name, moves in (("Slow", 140), ("Fast", 80), ("Mid", 100)):
        await _seed("freecell", _sid(), score=moves, name=name)
    body = _board(client, "freecell")
    assert body["label_key"] == "moves"
    assert _pairs(body) == [("Fast", 80), ("Mid", 100), ("Slow", 140)]


async def test_equal_scores_rank_earlier_completion_first(client: TestClient) -> None:
    await _seed("solitaire", _sid(), score=700, name="Later", minutes=5)
    await _seed("solitaire", _sid(), score=700, name="Earlier", minutes=1)
    assert _pairs(_board(client, "solitaire")) == [("Earlier", 700), ("Later", 700)]


async def test_metadata_metric_with_tiebreak_then_completed_at(client: TestClient) -> None:
    # Sort: level_reached desc, then total_moves asc, then completed_at asc.
    await _seed("sort", _sid(), name="ManyMoves", meta={"level_reached": 10, "total_moves": 90})
    await _seed(
        "sort",
        _sid(),
        name="FewMovesLate",
        minutes=9,
        meta={"level_reached": 10, "total_moves": 40},
    )
    await _seed(
        "sort",
        _sid(),
        name="FewMovesEarly",
        minutes=1,
        meta={"level_reached": 10, "total_moves": 40},
    )
    await _seed("sort", _sid(), name="NoMoves", meta={"level_reached": 10})
    await _seed("sort", _sid(), name="Top", meta={"level_reached": 12, "total_moves": 500})
    # No metric at all: not on the board.
    await _seed("sort", _sid(), name="Unscored", meta={"total_moves": 1})

    body = _board(client, "sort")
    assert body["label_key"] == "level"
    assert [e["player_name"] for e in body["entries"]] == [
        "Top",
        "FewMovesEarly",
        "FewMovesLate",
        "ManyMoves",
        "NoMoves",
    ]
    assert [e["value"] for e in body["entries"]] == [12, 10, 10, 10, 10]


# ---------------------------------------------------------------------------
# Partitions
# ---------------------------------------------------------------------------


async def test_sudoku_partition_filter_and_missing_variant_is_classic(client: TestClient) -> None:
    await _seed(
        "sudoku",
        _sid(),
        score=250,
        name="Classic",
        meta={"difficulty": "hard", "variant": "classic"},
    )
    await _seed("sudoku", _sid(), score=240, name="Legacy", meta={"difficulty": "hard"})
    await _seed(
        "sudoku", _sid(), score=260, name="Mini", meta={"difficulty": "hard", "variant": "mini"}
    )
    await _seed(
        "sudoku", _sid(), score=90, name="Easy", meta={"difficulty": "easy", "variant": "classic"}
    )

    classic = _board(client, "sudoku?difficulty=hard")
    assert classic["partition"] == {"difficulty": "hard", "variant": "classic"}
    assert _pairs(classic) == [("Classic", 250), ("Legacy", 240)]

    explicit = _board(client, "sudoku?difficulty=hard&variant=classic")
    assert _pairs(explicit) == _pairs(classic)

    mini = _board(client, "sudoku?difficulty=hard&variant=mini")
    assert _pairs(mini) == [("Mini", 260)]

    easy = _board(client, "sudoku?difficulty=easy")
    assert _pairs(easy) == [("Easy", 90)]


@pytest.mark.parametrize(
    "path",
    [
        "sudoku",  # difficulty is required
        "sudoku?difficulty=hard&colour=red",  # not a partition
        "sudoku?difficulty=hard&difficulty=easy",  # repeated
        "sudoku?difficulty=",  # empty
        "solitaire?difficulty=hard",  # solitaire has no partitions
    ],
)
def test_invalid_partition_query_is_400(client: TestClient, path: str) -> None:
    r = client.get(f"/games/leaderboard/{path}")
    assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# Exclusions
# ---------------------------------------------------------------------------


async def test_abandoned_rows_excluded(client: TestClient) -> None:
    await _seed("solitaire", _sid(), score=100, name="Kept")
    await _seed("solitaire", _sid(), score=999, name="Quit", outcome="abandoned")
    assert _pairs(_board(client, "solitaire")) == [("Kept", 100)]


async def test_abandoned_row_does_not_shadow_a_players_real_best(client: TestClient) -> None:
    sid = _sid()
    await _seed("solitaire", sid, score=999, name="Me", outcome="abandoned")
    await _seed("solitaire", sid, score=300, name="Me", minutes=1)
    assert _pairs(_board(client, "solitaire")) == [("Me", 300)]


async def test_null_outcome_rows_still_rank(client: TestClient) -> None:
    await _seed("solitaire", _sid(), score=100, name="Legacy", outcome=None)
    assert _pairs(_board(client, "solitaire")) == [("Legacy", 100)]


async def test_sentinel_sessions_excluded(client: TestClient) -> None:
    await _seed("solitaire", "solitaire-anon", score=1000, name="OldClient")
    await _seed("sort", "sort-anon", score=23, name="OldClient", meta={"level_reached": 23})
    await _seed("solitaire", _sid(), score=100, name="Real")
    assert _pairs(_board(client, "solitaire")) == [("Real", 100)]
    assert _board(client, "sort")["entries"] == []


async def test_legacy_post_score_rows_never_appear(client: TestClient) -> None:
    """A v1.0 client's ``POST /solitaire/score`` row stays off the generic board."""
    r = client.post("/solitaire/score", json={"player_name": "Old", "score": 400})
    assert r.status_code == 201, r.text
    assert _board(client, "solitaire")["entries"] == []


async def test_players_without_a_display_name_are_excluded(client: TestClient) -> None:
    await _seed("solitaire", _sid(), score=900, name=None)
    await _seed("solitaire", _sid(), score=100, name="Named")
    body = _board(client, "solitaire")
    assert _pairs(body) == [("Named", 100)]
    assert all(e["player_name"] != "anon" for e in body["entries"])


async def test_a_name_on_the_row_alone_does_not_rank(client: TestClient) -> None:
    """``metadata.player_name`` (old rows, legacy routes) no longer gates ranking (#2624)."""
    await _seed("solitaire", _sid(), score=900, name=None, meta={"player_name": "RowOnly"})
    assert _board(client, "solitaire")["entries"] == []


async def test_every_finished_game_of_a_named_player_counts(client: TestClient) -> None:
    """Decision 18: the unnamed 900 used to be ignored; now it is the player's entry."""
    sid = _sid()
    await _seed("solitaire", sid, score=900, name=None)
    await _seed("solitaire", sid, score=200, name="Me", minutes=1)
    assert _pairs(_board(client, "solitaire")) == [("Me", 900)]


# ---------------------------------------------------------------------------
# Unknown / disabled boards
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("game_type", [*DISABLED_BOARDS, "bogus"])
def test_disabled_or_unknown_board_is_404(client: TestClient, game_type: str) -> None:
    r = client.get(f"/games/leaderboard/{game_type}")
    assert r.status_code == 404, r.text


def test_disabled_boards_exist() -> None:
    # Guards the parametrisation above from going vacuous.
    assert {"blackjack", "daily_word"} <= set(DISABLED_BOARDS)


# ---------------------------------------------------------------------------
# One entry per player
# ---------------------------------------------------------------------------


async def test_one_session_appears_once_with_its_best(client: TestClient) -> None:
    sid = _sid()
    await _seed("solitaire", sid, score=300, name="Me", minutes=1)
    await _seed("solitaire", sid, score=500, name="Me", minutes=2)
    await _seed("solitaire", sid, score=400, name="Me", minutes=3)
    assert _pairs(_board(client, "solitaire")) == [("Me", 500)]

    # A worse replay changes nothing.
    await _seed("solitaire", sid, score=450, name="Me", minutes=4)
    body = _board(client, "solitaire")
    assert _pairs(body) == [("Me", 500)]
    assert body["entries"][0]["completed_at"].startswith("2026-01-01T00:02")

    # A better replay replaces the entry.
    await _seed("solitaire", sid, score=600, name="Me", minutes=5)
    assert _pairs(_board(client, "solitaire")) == [("Me", 600)]


async def test_name_shown_is_the_players_current_name(client: TestClient) -> None:
    sid = _sid()
    await _seed("solitaire", sid, score=500, name="OldName", minutes=1)
    await _seed("solitaire", sid, score=100, name="NewName", minutes=2)
    assert _pairs(_board(client, "solitaire")) == [("NewName", 500)]


async def test_equal_bests_keep_the_earliest(client: TestClient) -> None:
    sid = _sid()
    await _seed("solitaire", sid, score=500, name="Me", minutes=1)
    await _seed("solitaire", sid, score=500, name="Me", minutes=2)
    body = _board(client, "solitaire")
    assert _pairs(body) == [("Me", 500)]
    assert body["entries"][0]["completed_at"].startswith("2026-01-01T00:01")


async def test_rank_counts_sessions_not_rows(client: TestClient) -> None:
    a, b = _sid(), _sid()
    a_ids = [
        await _seed("solitaire", a, score=s, name="A", minutes=i)
        for i, s in enumerate((900, 800, 700))
    ]
    b_ids = [
        await _seed("solitaire", b, score=s, name="B", minutes=10 + i)
        for i, s in enumerate((600, 500, 400))
    ]
    body = _board(client, "solitaire")
    assert [(e["player_name"], e["rank"]) for e in body["entries"]] == [("A", 1), ("B", 2)]

    # Naming B's worst row still reports B's best rank: 2, not 6.
    r = client.patch(f"/games/{b_ids[2]}/name", headers=_headers(b), json={"player_name": "B"})
    assert r.status_code == 200, r.text
    assert r.json() == {"rank": 2, "is_best": False}
    r = client.patch(f"/games/{a_ids[1]}/name", headers=_headers(a), json={"player_name": "A"})
    assert r.json() == {"rank": 1, "is_best": False}


async def test_exact_rank_outside_the_top_ten(client: TestClient) -> None:
    for i in range(12):
        await _seed("solitaire", _sid(), score=1000 - i * 10, name=f"P{i}", minutes=i)
    sid = _sid()
    game_id = await _seed("solitaire", sid, score=5, name=None, minutes=50)

    r = client.patch(f"/games/{game_id}/name", headers=_headers(sid), json={"player_name": "Me"})
    assert r.status_code == 200, r.text
    assert r.json() == {"rank": 13, "is_best": True}

    assert len(_board(client, "solitaire")["entries"]) == 10
    full = _board(client, "solitaire?limit=20")["entries"]
    assert len(full) == 13
    assert (full[-1]["player_name"], full[-1]["rank"]) == ("Me", 13)


async def test_rank_honours_asc_direction_and_tiebreak(client: TestClient) -> None:
    # FreeCell: fewer moves is better.
    await _seed("freecell", _sid(), score=80, name="Better")
    await _seed("freecell", _sid(), score=120, name="Worse")
    sid = _sid()
    game_id = await _seed("freecell", sid, score=100, name=None, minutes=1)
    r = client.patch(f"/games/{game_id}/name", headers=_headers(sid), json={"player_name": "Me"})
    assert r.json() == {"rank": 2, "is_best": True}

    # Sort: same level, fewer total moves ahead; missing total_moves behind.
    await _seed("sort", _sid(), name="Fewer", meta={"level_reached": 5, "total_moves": 10})
    await _seed("sort", _sid(), name="NoMoves", meta={"level_reached": 5})
    sid = _sid()
    game_id = await _seed(
        "sort", sid, name=None, minutes=1, meta={"level_reached": 5, "total_moves": 20}
    )
    r = client.patch(f"/games/{game_id}/name", headers=_headers(sid), json={"player_name": "Me"})
    assert r.json() == {"rank": 2, "is_best": True}


# ---------------------------------------------------------------------------
# PATCH /games/{id}/name
# ---------------------------------------------------------------------------


async def test_name_route_sets_name_and_puts_game_on_board(client: TestClient) -> None:
    sid = _sid()
    game_id = await _seed("solitaire", sid, score=321, name=None)
    assert _board(client, "solitaire")["entries"] == []

    r = client.patch(
        f"/games/{game_id}/name", headers=_headers(sid), json={"player_name": "  Ada  "}
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"rank": 1, "is_best": True}
    assert _pairs(_board(client, "solitaire")) == [("Ada", 321)]

    detail = client.get(f"/games/{game_id}", headers=_headers(sid)).json()
    assert detail["metadata"]["player_name"] == "Ada"


async def test_name_route_is_owner_only(client: TestClient) -> None:
    game_id = await _seed("solitaire", _sid(), score=100, name=None)
    r = client.patch(f"/games/{game_id}/name", headers=_headers(_sid()), json={"player_name": "X"})
    assert r.status_code == 403


def test_name_route_unknown_game_is_404(client: TestClient) -> None:
    r = client.patch(
        f"/games/{uuid.uuid4()}/name", headers=_headers(_sid()), json={"player_name": "X"}
    )
    assert r.status_code == 404


def test_name_route_requires_session(client: TestClient) -> None:
    r = client.patch(f"/games/{uuid.uuid4()}/name", json={"player_name": "X"})
    assert r.status_code == 400


async def test_name_route_unscored_is_400(client: TestClient) -> None:
    sid = _sid()
    unscored = await _seed("solitaire", sid, score=None, name=None)
    r = client.patch(f"/games/{unscored}/name", headers=_headers(sid), json={"player_name": "X"})
    assert r.status_code == 400

    # An open (never completed) session row.
    r = client.post("/games", headers=_headers(sid), json={"game_type": "solitaire"})
    open_id = r.json()["id"]
    r = client.patch(f"/games/{open_id}/name", headers=_headers(sid), json={"player_name": "X"})
    assert r.status_code == 400

    # Sort without its metric is unscored too.
    no_level = await _seed("sort", sid, name=None, meta={"total_moves": 3})
    r = client.patch(f"/games/{no_level}/name", headers=_headers(sid), json={"player_name": "X"})
    assert r.status_code == 400


async def test_name_route_abandoned_is_400(client: TestClient) -> None:
    sid = _sid()
    game_id = await _seed("solitaire", sid, score=100, name=None, outcome="abandoned")
    r = client.patch(f"/games/{game_id}/name", headers=_headers(sid), json={"player_name": "X"})
    assert r.status_code == 400


async def test_name_route_disabled_board_is_404(client: TestClient) -> None:
    sid = _sid()
    await _grant_all(sid)
    game_id = await _seed("blackjack", sid, score=1500, name=None)
    r = client.patch(f"/games/{game_id}/name", headers=_headers(sid), json={"player_name": "X"})
    assert r.status_code == 404


@pytest.mark.parametrize("name", ["", "   ", "x" * 33])
async def test_name_route_validates_length(client: TestClient, name: str) -> None:
    sid = _sid()
    game_id = await _seed("solitaire", sid, score=100, name=None)
    r = client.patch(f"/games/{game_id}/name", headers=_headers(sid), json={"player_name": name})
    assert r.status_code == 422


async def test_name_route_uses_the_rows_partition(client: TestClient) -> None:
    await _seed("sudoku", _sid(), score=290, name="HardPro", meta={"difficulty": "hard"})
    sid = _sid()
    game_id = await _seed("sudoku", sid, score=100, name=None, meta={"difficulty": "easy"})
    r = client.patch(f"/games/{game_id}/name", headers=_headers(sid), json={"player_name": "Me"})
    assert r.json() == {"rank": 1, "is_best": True}


# ---------------------------------------------------------------------------
# Rate limits
# ---------------------------------------------------------------------------


def _limits(handler: str) -> list:
    return limiter._route_limits[f"games.router.{handler}"]


def test_name_route_rate_limit_keyed_by_session() -> None:
    limits = _limits("set_player_name")
    assert limits and all(lim.key_func is session_key for lim in limits)


def test_leaderboard_rate_limit_keyed_by_session_with_ip_backstop() -> None:
    key_funcs = {lim.key_func for lim in _limits("get_leaderboard")}
    assert key_funcs == {session_key, _real_ip}


def test_leaderboard_session_limit_is_enforced(client: TestClient) -> None:
    from games.router import LEADERBOARD_SESSION_RATE_LIMIT

    allowed = int(LEADERBOARD_SESSION_RATE_LIMIT.split("/")[0])
    sid = _sid()
    statuses = [
        client.get("/games/leaderboard/solitaire", headers=_headers(sid)).status_code
        for _ in range(allowed + 1)
    ]
    assert statuses == [200] * allowed + [429]
    # A different session from the same IP is still served.
    assert client.get("/games/leaderboard/solitaire", headers=_headers(_sid())).status_code == 200


# ---------------------------------------------------------------------------
# Entitlement (tiers read from the catalog, never hardcoded)
# ---------------------------------------------------------------------------


async def _board_with_tier(premium: bool) -> str:
    for game_type in ENABLED_BOARDS:
        if (
            not leaderboard.enabled_board(game_type).partitions
            and await _is_premium(game_type) is premium
        ):
            return game_type
    pytest.skip(f"no enabled, unpartitioned board with is_premium={premium}")


async def test_premium_board_requires_entitlement(client: TestClient) -> None:
    game_type = await _board_with_tier(True)
    sid = _sid()
    assert client.get(f"/games/leaderboard/{game_type}").status_code == 400
    assert client.get(f"/games/leaderboard/{game_type}", headers=_headers(sid)).status_code == 403

    score_game = await _seed(game_type, sid, score=1, name=None, meta={"level_reached": 1})
    r = client.patch(f"/games/{score_game}/name", headers=_headers(sid), json={"player_name": "X"})
    assert r.status_code == 403

    await _grant_all(sid)
    assert client.get(f"/games/leaderboard/{game_type}", headers=_headers(sid)).status_code == 200
    r = client.patch(f"/games/{score_game}/name", headers=_headers(sid), json={"player_name": "X"})
    assert r.status_code == 200, r.text


async def test_free_board_needs_no_session(client: TestClient) -> None:
    game_type = await _board_with_tier(False)
    assert client.get(f"/games/leaderboard/{game_type}").status_code == 200


# ---------------------------------------------------------------------------
# max_value on PATCH /games/{id}/complete
# ---------------------------------------------------------------------------


def _create(client: TestClient, sid: str, game_type: str) -> str:
    r = client.post(
        "/games",
        headers=_headers(sid),
        json={"game_type": game_type, "metadata": CREATE_METADATA.get(game_type, {})},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _complete(client: TestClient, sid: str, game_id: str, **body: Any):
    return client.patch(
        f"/games/{game_id}/complete",
        headers=_headers(sid),
        json={"outcome": "completed", **body},
    )


async def test_complete_rejects_score_above_max_value(client: TestClient) -> None:
    sid = _sid()
    await _grant_all(sid)
    cap = leaderboard.enabled_board("solitaire").max_value
    assert cap is not None

    over = _create(client, sid, "solitaire")
    r = _complete(client, sid, over, final_score=cap + 1)
    assert r.status_code == 400, r.text
    # Nothing was written: the row is still open and can complete legitimately.
    r = _complete(client, sid, over, final_score=cap)
    assert r.status_code == 200, r.text
    assert r.json()["final_score"] == cap


@pytest.mark.parametrize("level", [24, -1, "12", 3.5, True])
async def test_complete_rejects_bad_metadata_metric(client: TestClient, level: Any) -> None:
    sid = _sid()
    await _grant_all(sid)
    game_id = _create(client, sid, "sort")
    r = _complete(client, sid, game_id, result={"level_reached": level})
    assert r.status_code == 400, r.text


async def test_complete_rejects_bad_tiebreak_value(client: TestClient) -> None:
    sid = _sid()
    await _grant_all(sid)
    game_id = _create(client, sid, "sort")
    r = _complete(client, sid, game_id, result={"level_reached": 3, "total_moves": "many"})
    assert r.status_code == 400, r.text


async def test_complete_allows_uncapped_board(client: TestClient) -> None:
    sid = _sid()
    await _grant_all(sid)
    assert leaderboard.enabled_board("cascade").max_value is None
    game_id = _create(client, sid, "cascade")
    assert _complete(client, sid, game_id, final_score=10**7).status_code == 200


# ---------------------------------------------------------------------------
# Merging the result into the creation-time metadata
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "created,result,merged",
    [
        # A creation-time value wins over the result's.
        ({"difficulty": "easy"}, {"difficulty": "hard"}, {"difficulty": "easy"}),
        # A key only one side has is kept.
        ({"difficulty": "easy"}, {"errors": 2}, {"difficulty": "easy", "errors": 2}),
        ({}, {"errors": 2}, {"errors": 2}),
        (None, {"errors": 2}, {"errors": 2}),
        # A creation-time null is no value: the result's value fills it (#2623).
        ({"difficulty_tier": None}, {"difficulty_tier": "Captain"}, {"difficulty_tier": "Captain"}),
        # A null in the result never clears a creation-time value.
        ({"difficulty_tier": "Ensign"}, {"difficulty_tier": None}, {"difficulty_tier": "Ensign"}),
        (
            {"best_run_chips": None},
            {"hands_played": 4},
            {"best_run_chips": None, "hands_played": 4},
        ),
    ],
    ids=[
        "creation-wins",
        "result-only-key",
        "empty-creation",
        "no-creation",
        "null-creation-is-filled",
        "null-result-does-not-clear",
        "untouched-null-stays",
    ],
)
def test_merge_result_metadata(created, result, merged) -> None:
    assert leaderboard.merge_result_metadata(created, result) == merged


def test_merge_result_metadata_does_not_mutate_its_inputs() -> None:
    created = {"difficulty_tier": None}
    result = {"difficulty_tier": "Captain"}
    leaderboard.merge_result_metadata(created, result)
    assert created == {"difficulty_tier": None}
    assert result == {"difficulty_tier": "Captain"}


def test_completion_limits_see_the_tier_a_null_creation_value_would_hide() -> None:
    """The cap check merges exactly as the stored row does."""
    game = Game(game_metadata={"difficulty": None})
    mod = get_module("sudoku")
    board = mod.board
    # A "hard" result under a null creation difficulty is checked against hard's cap.
    assert (
        leaderboard.check_completion_limits("sudoku", mod, game, 300, {"difficulty": "hard"})
        is None
    )
    violation = leaderboard.check_completion_limits(
        "sudoku", mod, game, 150, {"difficulty": "easy"}
    )
    assert violation is not None
    assert board.max_value_for({"difficulty": "easy"}) == 100


# ---------------------------------------------------------------------------
# No duplicates, per enabled game (end to end through the session pipeline)
# ---------------------------------------------------------------------------


def test_every_enabled_game_is_covered() -> None:
    assert len(ENABLED_BOARDS) >= 8, ENABLED_BOARDS


@pytest.mark.parametrize("game_type", ENABLED_BOARDS)
async def test_named_session_row_appears_exactly_once(client: TestClient, game_type: str) -> None:
    board = leaderboard.enabled_board(game_type)
    sid = _sid()
    await _grant_all(sid)
    path = f"{game_type}{PARTITION_QUERY.get(game_type, '')}"

    def play(value: int) -> dict:
        game_id = _create(client, sid, game_type)
        if board.metric == SCORE_METRIC:
            r = _complete(client, sid, game_id, final_score=value)
        else:
            r = _complete(client, sid, game_id, result={board.metric: value})
        assert r.status_code == 200, r.text
        r = client.patch(
            f"/games/{game_id}/name", headers=_headers(sid), json={"player_name": "Solo"}
        )
        assert r.status_code == 200, r.text
        return r.json()

    assert play(5) == {"rank": 1, "is_best": True}
    entries = _board(client, path, sid)["entries"]
    assert [(e["player_name"], e["value"]) for e in entries] == [("Solo", 5)]

    # A second named game from the same player still leaves one entry.
    worse = 3 if board.direction == "desc" else 7
    assert play(worse) == {"rank": 1, "is_best": False}
    entries = _board(client, path, sid)["entries"]
    assert [(e["player_name"], e["value"]) for e in entries] == [("Solo", 5)]


# ---------------------------------------------------------------------------
# Review fixes: bad stored rows never break or top a board
# ---------------------------------------------------------------------------

HUGE = 10**400


@pytest.mark.parametrize(
    ("field", "value"),
    [("level_reached", 2**31), ("total_moves", 2**31), ("total_moves", HUGE)],
)
async def test_complete_rejects_out_of_range_metadata_values(
    client: TestClient, field: str, value: int
) -> None:
    sid = _sid()
    await _grant_all(sid)
    game_id = _create(client, sid, "sort")
    result = {"level_reached": 3, field: value}
    r = _complete(client, sid, game_id, result=result)
    assert r.status_code == 400, r.text


async def test_complete_rejects_final_score_above_int32_on_uncapped_board(
    client: TestClient,
) -> None:
    sid = _sid()
    await _grant_all(sid)
    game_id = _create(client, sid, "cascade")
    assert _complete(client, sid, game_id, final_score=2**31).status_code == 400
    assert _complete(client, sid, game_id, final_score=2**31 - 1).status_code == 200


async def test_stored_huge_metric_or_tiebreak_does_not_break_the_board(
    client: TestClient,
) -> None:
    # Rows written before the write-side bound: the board must still load.
    await _seed("sort", _sid(), name="HugeLevel", meta={"level_reached": HUGE})
    await _seed(
        "sort", _sid(), name="HugeMoves", minutes=1, meta={"level_reached": 5, "total_moves": HUGE}
    )
    await _seed("sort", _sid(), name="NoMoves", minutes=2, meta={"level_reached": 5})
    body = _board(client, "sort")
    # A huge tie-break counts as missing: HugeMoves ties NoMoves and finished first.
    assert _pairs(body) == [("HugeMoves", 5), ("NoMoves", 5)]


async def test_stored_non_integer_metric_never_ranks(client: TestClient) -> None:
    for i, level in enumerate(("12", "abc", 3.5, True, None, [1], {"x": 1})):
        await _seed("sort", _sid(), name=f"Bad{i}", meta={"level_reached": level})
    await _seed("sort", _sid(), name="Good", meta={"level_reached": 2})
    assert _pairs(_board(client, "sort")) == [("Good", 2)]


async def test_stored_non_integer_tiebreak_counts_as_missing(client: TestClient) -> None:
    await _seed(
        "sort", _sid(), name="StrMoves", minutes=1, meta={"level_reached": 5, "total_moves": "1"}
    )
    await _seed(
        "sort", _sid(), name="NegMoves", minutes=2, meta={"level_reached": 5, "total_moves": -5}
    )
    await _seed(
        "sort", _sid(), name="RealMoves", minutes=3, meta={"level_reached": 5, "total_moves": 90}
    )
    assert [n for n, _ in _pairs(_board(client, "sort"))] == ["RealMoves", "StrMoves", "NegMoves"]


def test_board_sql_never_casts_json_to_float() -> None:
    """Postgres ``CAST(... AS FLOAT)`` overflows on a huge JSON number (500)."""
    from sqlalchemy.dialects import postgresql

    board = leaderboard.enabled_board("sort")
    stmt = leaderboard.top_statement(board, 1, {})
    sql = str(stmt.compile(dialect=postgresql.dialect())).upper()
    assert "FLOAT" not in sql
    assert "JSONB_TYPEOF" in sql


async def test_negative_score_never_ranks_on_asc_board(client: TestClient) -> None:
    await _seed("freecell", _sid(), score=-1_000_000, name="Cheat")
    await _seed("freecell", _sid(), score=90, name="Honest")
    assert _pairs(_board(client, "freecell")) == [("Honest", 90)]

    sid = _sid()
    game_id = await _seed("freecell", sid, score=80, name=None, minutes=1)
    r = client.patch(f"/games/{game_id}/name", headers=_headers(sid), json={"player_name": "Me"})
    assert r.json() == {"rank": 1, "is_best": True}


async def test_negative_final_score_completes_but_cannot_be_named(client: TestClient) -> None:
    """Rejecting the completion would dead-letter the game and lose its stats."""
    sid = _sid()
    await _grant_all(sid)
    game_id = _create(client, sid, "freecell")
    r = _complete(client, sid, game_id, final_score=-5)
    assert r.status_code == 200, r.text
    r = client.patch(f"/games/{game_id}/name", headers=_headers(sid), json={"player_name": "X"})
    assert r.status_code == 400, r.text


@pytest.mark.parametrize("level", ["12", 3.5, -1])
async def test_name_route_rejects_non_integer_or_negative_metric(
    client: TestClient, level: Any
) -> None:
    sid = _sid()
    game_id = await _seed("sort", sid, name=None, meta={"level_reached": level})
    r = client.patch(f"/games/{game_id}/name", headers=_headers(sid), json={"player_name": "X"})
    assert r.status_code == 400, r.text


async def test_stored_rows_above_the_cap_never_rank(client: TestClient) -> None:
    cap = leaderboard.enabled_board("solitaire").max_value
    await _seed("solitaire", _sid(), score=cap + 1, name="Over")
    await _seed("solitaire", _sid(), score=cap, name="AtCap")
    assert _pairs(_board(client, "solitaire")) == [("AtCap", cap)]

    await _seed("sort", _sid(), name="Level30", meta={"level_reached": 30})
    await _seed("sort", _sid(), name="Level23", meta={"level_reached": 23})
    assert _pairs(_board(client, "sort")) == [("Level23", 23)]


async def test_sudoku_per_difficulty_caps_apply_to_stored_rows(client: TestClient) -> None:
    await _seed("sudoku", _sid(), score=150, name="EasyOver", meta={"difficulty": "easy"})
    await _seed("sudoku", _sid(), score=100, name="EasyMax", meta={"difficulty": "easy"})
    await _seed("sudoku", _sid(), score=250, name="MediumOver", meta={"difficulty": "medium"})
    await _seed("sudoku", _sid(), score=290, name="Hard", meta={"difficulty": "hard"})
    assert _pairs(_board(client, "sudoku?difficulty=easy")) == [("EasyMax", 100)]
    assert _board(client, "sudoku?difficulty=medium")["entries"] == []
    assert _pairs(_board(client, "sudoku?difficulty=hard")) == [("Hard", 290)]

    sid = _sid()
    over = await _seed("sudoku", sid, score=150, name=None, meta={"difficulty": "easy"})
    r = client.patch(f"/games/{over}/name", headers=_headers(sid), json={"player_name": "X"})
    assert r.status_code == 400, r.text


async def test_complete_uses_the_rows_partition_cap(client: TestClient) -> None:
    sid = _sid()
    await _grant_all(sid)

    def create(difficulty: str) -> str:
        r = client.post(
            "/games",
            headers=_headers(sid),
            json={"game_type": "sudoku", "metadata": {"difficulty": difficulty}},
        )
        assert r.status_code == 200, r.text
        return r.json()["id"]

    easy = create("easy")
    assert _complete(client, sid, easy, final_score=150).status_code == 400
    assert _complete(client, sid, easy, final_score=100).status_code == 200
    hard = create("hard")
    assert _complete(client, sid, hard, final_score=250).status_code == 200


def _patched_board(monkeypatch: pytest.MonkeyPatch, game_type: str, **changes: Any) -> None:
    mod = get_module(game_type)
    monkeypatch.setattr(mod, "board", mod.board.model_copy(update=changes))


async def test_partition_default_comes_from_the_board(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patched_board(monkeypatch, "sudoku", partition_defaults=(("variant", "mini"),))
    await _seed("sudoku", _sid(), score=90, name="NoVariant", meta={"difficulty": "easy"})
    await _seed(
        "sudoku",
        _sid(),
        score=80,
        name="Classic",
        meta={"difficulty": "easy", "variant": "classic"},
    )
    body = _board(client, "sudoku?difficulty=easy")
    assert body["partition"] == {"difficulty": "easy", "variant": "mini"}
    assert _pairs(body) == [("NoVariant", 90)]


async def test_no_partition_default_means_the_key_is_required(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patched_board(monkeypatch, "sudoku", partition_defaults=())
    r = client.get("/games/leaderboard/sudoku?difficulty=easy")
    assert r.status_code == 400, r.text


async def test_qualifying_outcomes_are_honoured(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patched_board(monkeypatch, "solitaire", qualifying_outcomes=("completed",))
    await _seed("solitaire", _sid(), score=100, name="Completed", outcome="completed")
    await _seed("solitaire", _sid(), score=900, name="KeptPlaying", outcome="kept_playing")
    await _seed("solitaire", _sid(), score=800, name="NoOutcome", outcome=None)
    assert _pairs(_board(client, "solitaire")) == [("Completed", 100)]

    sid = _sid()
    other = await _seed("solitaire", sid, score=50, name=None, outcome="kept_playing")
    r = client.patch(f"/games/{other}/name", headers=_headers(sid), json={"player_name": "X"})
    assert r.status_code == 400, r.text


async def test_stored_names_are_shown_trimmed(client: TestClient) -> None:
    """Every write path trims; a name stored untrimmed (by hand) still shows trimmed."""
    await _seed("sudoku", _sid(), score=90, name="\t Padded \u3000", meta={"difficulty": "easy"})
    names = [e["player_name"] for e in _board(client, "sudoku?difficulty=easy")["entries"]]
    assert names == ["Padded"]


# ---------------------------------------------------------------------------
# Review fixes: DB errors are logged, rolled back and chained
# ---------------------------------------------------------------------------

SECRET_SID = "0f0f0f0f-dead-4bee-8f00-000000000000"


def _db_error() -> Exception:
    from sqlalchemy.exc import OperationalError

    return OperationalError("SELECT ... WHERE session_id = ?", {"sid": SECRET_SID}, Exception("x"))


class _NoRow:
    def scalar_one_or_none(self) -> None:
        return None


class _FailingDB:
    bind = None

    def __init__(
        self,
        *,
        fail_commit: bool = False,
        fail_execute: bool = False,
        fail_execute_after_commit: bool = False,
    ) -> None:
        self.fail_commit = fail_commit
        self.fail_execute = fail_execute
        self.fail_execute_after_commit = fail_execute_after_commit
        self.committed = False
        self.rolled_back = False

    async def execute(self, *_: Any, **__: Any) -> Any:
        if self.fail_execute or (self.fail_execute_after_commit and self.committed):
            raise _db_error()
        # The display-name upsert (#2624), before the commit.
        return _NoRow()

    async def commit(self) -> None:
        if self.fail_commit:
            raise _db_error()
        self.committed = True

    async def rollback(self) -> None:
        self.rolled_back = True


def _assert_logged_safely(caplog: pytest.LogCaptureFixture, game_type: str) -> None:
    errors = [r for r in caplog.records if r.levelname == "ERROR"]
    assert errors, "the DB error was not logged"
    text = " ".join(r.getMessage() for r in errors)
    assert "OperationalError" in text and game_type in text
    assert SECRET_SID not in text
    assert all(SECRET_SID not in repr(r.args) for r in errors)


async def test_top_entries_db_error_is_logged_and_chained(
    caplog: pytest.LogCaptureFixture,
) -> None:
    from sqlalchemy.exc import OperationalError

    board = leaderboard.enabled_board("solitaire")
    with caplog.at_level("ERROR"), pytest.raises(leaderboard.LeaderboardError) as info:
        await leaderboard.top_entries(
            _FailingDB(fail_execute=True),  # type: ignore[arg-type]
            game_type="solitaire",
            board=board,
            game_type_id=1,
            partition={},
        )
    assert info.value.status_code == 500
    assert isinstance(info.value.__cause__, OperationalError)
    _assert_logged_safely(caplog, "solitaire")


def _finished_game(game_type: str) -> Game:
    return Game(
        id=uuid.uuid4(),
        session_id=SECRET_SID,
        game_type=GameType(name=game_type),
        game_type_id=1,
        game_metadata={},
        final_score=100,
        outcome="completed",
        completed_at=T0,
    )


async def test_set_player_name_commit_error_rolls_back_and_logs(
    caplog: pytest.LogCaptureFixture,
) -> None:
    from sqlalchemy.exc import OperationalError

    db = _FailingDB(fail_commit=True)
    with caplog.at_level("ERROR"), pytest.raises(leaderboard.LeaderboardError) as info:
        await leaderboard.set_player_name(
            db,  # type: ignore[arg-type]
            game=_finished_game("solitaire"),
            session_id=SECRET_SID,
            player_name="Me",
        )
    assert info.value.status_code == 500
    assert isinstance(info.value.__cause__, OperationalError)
    assert db.rolled_back
    _assert_logged_safely(caplog, "solitaire")


async def test_set_player_name_rank_error_is_logged_and_chained(
    caplog: pytest.LogCaptureFixture,
) -> None:
    from sqlalchemy.exc import OperationalError

    with caplog.at_level("ERROR"), pytest.raises(leaderboard.LeaderboardError) as info:
        await leaderboard.set_player_name(
            _FailingDB(fail_execute_after_commit=True),  # type: ignore[arg-type]
            game=_finished_game("solitaire"),
            session_id=SECRET_SID,
            player_name="Me",
        )
    assert info.value.status_code == 500
    assert isinstance(info.value.__cause__, OperationalError)
    _assert_logged_safely(caplog, "solitaire")


# ---------------------------------------------------------------------------
# Review fixes: one game-type lookup per completion
# ---------------------------------------------------------------------------


async def test_complete_game_looks_up_the_game_type_once() -> None:
    from sqlalchemy import event

    from db.base import get_engine
    from games import service

    sid = _sid()
    factory = get_session_factory()
    async with factory() as db:
        game = await service.create_game(
            db,
            session_id=sid,
            client_id=None,
            game_type_name="sort",
            metadata={},
            players=[],
        )
        statements: list[str] = []

        def record(_conn, _cursor, statement, *_args) -> None:  # type: ignore[no-untyped-def]
            statements.append(statement)

        engine = get_engine().sync_engine
        event.listen(engine, "before_cursor_execute", record)
        try:
            await service.complete_game(
                db,
                game_id=game.id,
                session_id=sid,
                final_score=None,
                outcome="completed",
                duration_ms=None,
                result={"level_reached": 3, "total_moves": 10},
            )
        finally:
            event.remove(engine, "before_cursor_execute", record)
    lookups = [s for s in statements if "FROM game_types" in s]
    assert len(lookups) == 1, lookups

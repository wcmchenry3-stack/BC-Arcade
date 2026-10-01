"""Mahjong reporting on the session board (#2627, #2747).

Since #2627 the app records a cleared board as ``win`` (a deadlock the player
leaves stays ``loss``, #2592), sends the layout played as creation metadata,
and stops calling the (since removed, #2644) ``POST /mahjong/score``. The
finished session row is the leaderboard entry: a named player's best win ranks
once, under their display name, however many games they win.

Since #2747 the best win is the fastest clear (``duration_ms``, lower is
better), on one board per layout; a clear under 36 s, with no duration or
with no layout ranks nowhere.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select

from db.base import get_session_factory, is_configured
from db.models import Game
from mahjong.models import MahjongMetadata
from mahjong.module import module as mahjong_module
from tests.test_generic_leaderboard import _grant_all, _headers, _set_name, _sid

# ---------------------------------------------------------------------------
# MahjongMetadata.layout
# ---------------------------------------------------------------------------


def test_metadata_accepts_a_layout_id() -> None:
    assert MahjongMetadata(layout="four_rivers").layout == "four_rivers"


def test_metadata_layout_is_optional_for_older_builds() -> None:
    assert MahjongMetadata().layout is None
    assert MahjongMetadata(player_name="Old").layout is None


@pytest.mark.parametrize("layout", ["", "Turtle", "four rivers", "x" * 33, 3])
def test_metadata_rejects_a_malformed_layout(layout: Any) -> None:
    with pytest.raises(ValidationError):
        MahjongMetadata(layout=layout)


def test_metadata_still_forbids_unknown_keys() -> None:
    with pytest.raises(ValidationError):
        MahjongMetadata(layout="turtle", level="turtle")


def test_mahjong_records_a_winner() -> None:
    assert mahjong_module.has_winner is True


# ---------------------------------------------------------------------------
# End to end: POST /games → PATCH /games/{id}/complete → board and rank
# ---------------------------------------------------------------------------

live = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


def _start(client: TestClient, sid: str, layout: str = "pyramid") -> str:
    r = client.post(
        "/games",
        headers=_headers(sid),
        json={"game_type": "mahjong", "metadata": {"layout": layout}},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _win(
    client: TestClient,
    sid: str,
    duration_ms: int | None = 90_000,
    layout: str = "pyramid",
    score: int = 1220,
) -> str:
    game_id = _start(client, sid, layout)
    body: dict[str, Any] = {
        "outcome": "win",
        "final_score": score,
        "result": {"won": True, "pairs": 72},
    }
    if duration_ms is not None:
        body["duration_ms"] = duration_ms
    r = client.patch(f"/games/{game_id}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    return game_id


def _lose(client: TestClient, sid: str, duration_ms: int = 60_000) -> str:
    game_id = _start(client, sid)
    r = client.patch(
        f"/games/{game_id}/complete",
        headers=_headers(sid),
        json={
            "outcome": "loss",
            "duration_ms": duration_ms,
            "result": {"won": False, "pairs": 40},
        },
    )
    assert r.status_code == 200, r.text
    return game_id


def _board(client: TestClient, sid: str, layout: str = "pyramid") -> list[tuple[str, int]]:
    r = client.get(f"/games/leaderboard/mahjong?layout={layout}", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return [(e["player_name"], e["value"]) for e in r.json()["entries"]]


def _rank(client: TestClient, game_id: str, sid: str) -> dict:
    r = client.get(f"/games/{game_id}/rank", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return r.json()


async def _row(game_id: str) -> Game:
    factory = get_session_factory()
    async with factory() as db:
        return (await db.execute(select(Game).where(Game.id == uuid.UUID(game_id)))).scalar_one()


async def _player(name: str) -> str:
    sid = _sid()
    await _grant_all(sid)
    await _set_name(sid, name)
    return sid


_RANKED_BEST = {"ranked": True, "rank": 1, "is_best": True, "reason": None}


@live
async def test_start_records_the_layout(client: TestClient) -> None:
    sid = _sid()
    await _grant_all(sid)
    game_id = _start(client, sid, "four_rivers")
    assert (await _row(game_id)).game_metadata["layout"] == "four_rivers"


@live
async def test_a_win_is_recorded_as_a_win_and_ranks_by_its_time(client: TestClient) -> None:
    sid = await _player("Riley")
    game_id = _win(client, sid, 95_000)

    row = await _row(game_id)
    assert row.outcome == "win"
    assert row.final_score == 1220
    assert row.duration_ms == 95_000
    assert row.game_metadata["layout"] == "pyramid"
    assert row.game_metadata["won"] is True
    assert _rank(client, game_id, sid) == _RANKED_BEST
    assert _board(client, sid) == [("Riley", 95_000)]


@live
async def test_the_faster_clear_ranks_first(client: TestClient) -> None:
    """Fastest clear wins (#2747): a lower ``duration_ms`` ranks higher, whatever the score."""
    slow = await _player("Slow")
    slow_game = _win(client, slow, 300_000, score=1220)
    fast = await _player("Fast")
    fast_game = _win(client, fast, 120_000, score=900)

    assert _board(client, fast) == [("Fast", 120_000), ("Slow", 300_000)]
    assert _rank(client, fast_game, fast)["rank"] == 1
    assert _rank(client, slow_game, slow)["rank"] == 2


@live
async def test_each_layout_has_its_own_board(client: TestClient) -> None:
    sid = await _player("Riley")
    turtle = _win(client, sid, 200_000, layout="turtle")
    spider = _win(client, sid, 100_000, layout="spider")

    assert _board(client, sid, "turtle") == [("Riley", 200_000)]
    assert _board(client, sid, "spider") == [("Riley", 100_000)]
    assert _board(client, sid, "pyramid") == []
    # Each clear is the best on its own layout's board.
    assert _rank(client, turtle, sid) == _RANKED_BEST
    assert _rank(client, spider, sid) == _RANKED_BEST


@live
@pytest.mark.parametrize("query", ["", "?layout=unknown", "?layout=Turtle"])
async def test_the_board_needs_a_known_layout(client: TestClient, query: str) -> None:
    sid = _sid()
    await _grant_all(sid)
    r = client.get(f"/games/leaderboard/mahjong{query}", headers=_headers(sid))
    assert r.status_code == 400, r.text


@live
async def test_one_player_appears_once_with_their_fastest_clear(client: TestClient) -> None:
    """Several wins and a (faster) loss leave one entry: the player's fastest win."""
    sid = await _player("Riley")
    best = _win(client, sid, 100_000)
    worse = _win(client, sid, 150_000)
    _lose(client, sid, duration_ms=40_000)

    assert _board(client, sid) == [("Riley", 100_000)]
    assert _rank(client, best, sid)["is_best"] is True
    assert _rank(client, worse, sid) == {**_RANKED_BEST, "is_best": False}


@live
async def test_a_deadlock_loss_never_ranks(client: TestClient) -> None:
    sid = await _player("Riley")
    game_id = _lose(client, sid)
    assert (await _row(game_id)).outcome == "loss"
    assert _board(client, sid) == []
    assert _rank(client, game_id, sid) == {
        "ranked": False,
        "rank": None,
        "is_best": None,
        "reason": "not_rankable",
    }


@live
@pytest.mark.parametrize("duration_ms", [None, 0, 1_000, 35_999])
async def test_an_implausible_clear_time_is_stored_but_never_ranks(
    client: TestClient, duration_ms: int | None
) -> None:
    """No duration, or one under the 36 s floor (#2747): the completion is
    accepted (a 4xx would dead-letter it in the app) but nothing ranks it."""
    sid = await _player("Riley")
    game_id = _win(client, sid, duration_ms)
    row = await _row(game_id)
    assert (row.outcome, row.duration_ms) == ("win", duration_ms)
    assert _board(client, sid) == []
    assert _rank(client, game_id, sid)["reason"] == "not_rankable"


@live
async def test_the_floor_itself_ranks(client: TestClient) -> None:
    sid = await _player("Riley")
    _win(client, sid, 36_000)
    assert _board(client, sid) == [("Riley", 36_000)]


@live
async def test_a_clear_with_no_layout_ranks_on_no_board(client: TestClient) -> None:
    """Builds before #2627 recorded no layout: the board can't tell which one
    was cleared, so the row is kept for stats but ranks nowhere (#2747)."""
    sid = await _player("Riley")
    r = client.post("/games", headers=_headers(sid), json={"game_type": "mahjong", "metadata": {}})
    assert r.status_code == 200, r.text
    game_id = r.json()["id"]
    r = client.patch(
        f"/games/{game_id}/complete",
        headers=_headers(sid),
        json={"outcome": "win", "duration_ms": 90_000, "result": {"won": True, "pairs": 72}},
    )
    assert r.status_code == 200, r.text

    for layout in ("turtle", "pyramid"):
        assert _board(client, sid, layout) == []
    assert _rank(client, game_id, sid)["reason"] == "not_rankable"


@live
async def test_stats_best_is_the_fastest_clear(client: TestClient) -> None:
    sid = await _player("Riley")
    _win(client, sid, 150_000, layout="turtle")
    _win(client, sid, 120_000, layout="spider")
    _win(client, sid, 1_000, layout="turtle")  # under the floor: not a best
    _lose(client, sid, duration_ms=40_000)  # a loss is never a best

    r = client.get("/stats/me", headers=_headers(sid))
    assert r.status_code == 200, r.text
    stats = r.json()["by_game"]["mahjong"]
    assert stats["best_value"] == 120_000
    assert stats["best_label_key"] == "time"

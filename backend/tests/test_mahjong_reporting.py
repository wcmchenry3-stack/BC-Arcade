"""Mahjong reporting on the session board (#2627).

Since #2627 the app records a cleared board as ``win`` (a deadlock the player
leaves stays ``loss``, #2592), sends the layout played as creation metadata,
and stops calling the (since removed, #2644) ``POST /mahjong/score``. The
finished session row is the leaderboard entry: a named player's best win ranks
once, under their display name, however many games they win.
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


def _win(client: TestClient, sid: str, score: int, layout: str = "pyramid") -> str:
    game_id = _start(client, sid, layout)
    r = client.patch(
        f"/games/{game_id}/complete",
        headers=_headers(sid),
        json={
            "outcome": "win",
            "final_score": score,
            "duration_ms": 90_000,
            "result": {"won": True, "pairs": 72},
        },
    )
    assert r.status_code == 200, r.text
    return game_id


def _lose(client: TestClient, sid: str) -> str:
    game_id = _start(client, sid)
    r = client.patch(
        f"/games/{game_id}/complete",
        headers=_headers(sid),
        json={"outcome": "loss", "duration_ms": 60_000, "result": {"won": False, "pairs": 40}},
    )
    assert r.status_code == 200, r.text
    return game_id


def _board(client: TestClient, sid: str) -> list[tuple[str, int]]:
    r = client.get("/games/leaderboard/mahjong", headers=_headers(sid))
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


@live
async def test_start_records_the_layout(client: TestClient) -> None:
    sid = _sid()
    await _grant_all(sid)
    game_id = _start(client, sid, "four_rivers")
    assert (await _row(game_id)).game_metadata["layout"] == "four_rivers"


@live
async def test_a_win_is_recorded_as_a_win_and_ranks(client: TestClient) -> None:
    sid = _sid()
    await _grant_all(sid)
    await _set_name(sid, "Riley")
    game_id = _win(client, sid, 1220)

    row = await _row(game_id)
    assert row.outcome == "win"
    assert row.final_score == 1220
    assert row.game_metadata["layout"] == "pyramid"
    assert row.game_metadata["won"] is True
    assert _rank(client, game_id, sid) == {
        "ranked": True,
        "rank": 1,
        "is_best": True,
        "reason": None,
    }
    assert _board(client, sid) == [("Riley", 1220)]


@live
async def test_one_player_appears_once(client: TestClient) -> None:
    """Several wins and a loss leave one entry: the player's best win."""
    sid = _sid()
    await _grant_all(sid)
    await _set_name(sid, "Riley")
    best = _win(client, sid, 1100, layout="turtle")
    worse = _win(client, sid, 900, layout="spider")
    _lose(client, sid)

    assert _board(client, sid) == [("Riley", 1100)]
    assert _rank(client, best, sid)["is_best"] is True
    assert _rank(client, worse, sid) == {
        "ranked": True,
        "rank": 1,
        "is_best": False,
        "reason": None,
    }


@live
async def test_a_deadlock_loss_never_ranks(client: TestClient) -> None:
    sid = _sid()
    await _grant_all(sid)
    await _set_name(sid, "Riley")
    game_id = _lose(client, sid)
    assert (await _row(game_id)).outcome == "loss"
    assert _board(client, sid) == []
    assert _rank(client, game_id, sid)["ranked"] is False

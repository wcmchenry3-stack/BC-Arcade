"""Solitaire, Sudoku, FreeCell and Cascade report through the session rows (#2632).

The app records each game with ``POST /games`` + ``PATCH /games/{id}/complete``
and its result card reads ``GET /games/{id}/rank`` (the per-game score routes
were removed in #2644). These tests drive exactly what the current app sends,
per game, and check that a named player appears once per board (and
partition) and that the abandon the ``useGameSync`` hook sends never ranks.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi.testclient import TestClient

from db.base import is_configured
from tests.test_generic_leaderboard import _grant_all, _headers

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


@dataclass(frozen=True)
class AppFlow:
    """What the current app build sends for one game."""

    game_type: str
    # POST /games metadata (useGameSync start()'s second argument).
    metadata: dict[str, Any]
    # The PATCH /complete result block for a win / for the hook's abandon.
    won_result: dict[str, Any]
    abandon_result: dict[str, Any]
    # final_score of a good game and of a worse one, in the board's direction.
    best: int
    worse: int
    board_query: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


FLOWS = (
    AppFlow(
        "solitaire",
        metadata={"draw_mode": 3},
        won_result={"won": True, "moves": 140},
        abandon_result={"won": False, "moves": 12},
        best=900,
        worse=500,
    ),
    AppFlow(
        "sudoku",
        metadata={"difficulty": "medium", "variant": "classic"},
        won_result={"won": True, "errors": 1},
        abandon_result={"won": False, "errors": 0},
        best=190,
        worse=150,
        board_query="?difficulty=medium&variant=classic",
    ),
    AppFlow(
        # Fewest moves ranks first: the win sends finalScore = moveCount.
        "freecell",
        metadata={},
        won_result={"won": True, "moves": 88},
        abandon_result={"won": False, "moves": 3},
        best=88,
        worse=120,
    ),
    AppFlow(
        "cascade",
        metadata={},
        won_result={"duration_ms": 60_000},
        abandon_result={"duration_ms": 30_000},
        best=4200,
        worse=1800,
    ),
)


def _set_display_name(client: TestClient, sid: str, name: str) -> None:
    r = client.put("/players/me", headers=_headers(sid), json={"display_name": name})
    assert r.status_code == 200, r.text


def _start(client: TestClient, sid: str, flow: AppFlow) -> str:
    r = client.post(
        "/games",
        headers=_headers(sid),
        json={"game_type": flow.game_type, "metadata": flow.metadata},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _win(client: TestClient, sid: str, flow: AppFlow, score: int) -> str:
    game_id = _start(client, sid, flow)
    r = client.patch(
        f"/games/{game_id}/complete",
        headers=_headers(sid),
        json={"outcome": "completed", "final_score": score, "result": flow.won_result},
    )
    assert r.status_code == 200, r.text
    return game_id


def _abandon(client: TestClient, sid: str, flow: AppFlow) -> str:
    """The hook's own abandon (unmount / restart): no score, the progress snapshot."""
    game_id = _start(client, sid, flow)
    r = client.patch(
        f"/games/{game_id}/complete",
        headers=_headers(sid),
        json={"outcome": "abandoned", "result": flow.abandon_result},
    )
    assert r.status_code == 200, r.text
    return game_id


def _rank(client: TestClient, sid: str, game_id: str) -> dict:
    r = client.get(f"/games/{game_id}/rank", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return r.json()


def _entries(client: TestClient, sid: str, flow: AppFlow) -> list[tuple[str, int]]:
    r = client.get(f"/games/leaderboard/{flow.game_type}{flow.board_query}", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return [(e["player_name"], e["value"]) for e in r.json()["entries"]]


@pytest.mark.parametrize("flow", FLOWS, ids=[f.game_type for f in FLOWS])
async def test_a_named_player_appears_once_per_board(client: TestClient, flow: AppFlow) -> None:
    sid = str(uuid.uuid4())
    await _grant_all(sid)  # Sudoku and Cascade are premium
    _set_display_name(client, sid, "Solo")

    first = _win(client, sid, flow, flow.best)
    assert _rank(client, sid, first) == {
        "ranked": True,
        "rank": 1,
        "is_best": True,
        "reason": None,
    }
    assert _entries(client, sid, flow) == [("Solo", flow.best)]

    # A worse game and an abandoned one leave the single best entry.
    second = _win(client, sid, flow, flow.worse)
    assert _rank(client, sid, second)["is_best"] is False
    abandoned = _abandon(client, sid, flow)
    assert _rank(client, sid, abandoned)["ranked"] is False
    assert _entries(client, sid, flow) == [("Solo", flow.best)]


async def test_solitaire_records_the_draw_mode_on_the_session_row(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    flow = FLOWS[0]
    game_id = _win(client, sid, flow, flow.best)
    detail = client.get(f"/games/{game_id}", headers=_headers(sid)).json()
    assert detail["metadata"]["draw_mode"] == 3


async def test_solitaire_draw_modes_share_one_board(client: TestClient) -> None:
    draw_1 = AppFlow(**{**FLOWS[0].__dict__, "metadata": {"draw_mode": 1}})
    one, three = str(uuid.uuid4()), str(uuid.uuid4())
    _set_display_name(client, one, "DrawOne")
    _set_display_name(client, three, "DrawThree")
    _win(client, one, draw_1, 700)
    _win(client, three, FLOWS[0], 800)
    assert _entries(client, one, FLOWS[0]) == [("DrawThree", 800), ("DrawOne", 700)]


async def test_freecell_best_value_is_the_fewest_moves(client: TestClient) -> None:
    """FreeCell's /stats/me best is its fewest moves once wins carry the score."""
    sid = str(uuid.uuid4())
    flow = FLOWS[2]
    _win(client, sid, flow, 120)
    _win(client, sid, flow, 88)
    _win(client, sid, flow, 140)
    _abandon(client, sid, flow)  # no score: it can't become a "best" of 0 or 3

    freecell = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["freecell"]
    assert freecell["best_value"] == 88
    assert freecell["best_label_key"] == "moves"
    assert freecell["completed"] == 3
    # The deprecated `best` (Profile's "Top score" in store builds) too, not 140.
    assert freecell["best"] == 88


async def test_a_descending_games_legacy_best_is_still_its_highest_score(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    await _grant_all(sid)
    flow = FLOWS[3]  # Cascade
    _win(client, sid, flow, 1800)
    _win(client, sid, flow, 4200)
    _win(client, sid, flow, 900)
    cascade = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["cascade"]
    assert cascade["best"] == 4200
    assert cascade["best_value"] == 4200

"""Sort's result model and its board, through the shared ``/games`` path (#2625).

Every solved level is a session row (``useGameSync("sort")``, #2512), scored
with the player's standing after it: ``final_score`` and ``level_reached`` are
the highest level solved, and ``total_moves`` is the sum of the player's best
moves up to it, recorded but not ranked (#2746): a tie on level goes to the
earliest completion. ``level``/``moves``/``undos`` are the level actually
played. The payloads below mirror ``SortScreen.tsx``; a rejection
would dead-letter the solve, so every current one must pass.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from daily_challenge.definitions import FREE_GOAL_POOL, game_facts
from db.base import get_session_factory
from db.models import GameEntitlement, Player
from games.registry import get_module
from main import app
from sort.generate_levels import LEVEL_SPECS
from sort.models import SortMetadata, SortResult
from sort.module import module as sort_module

client = TestClient(app)


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


def _sid() -> str:
    return str(uuid.uuid4())


def _scored(
    frontier: int,
    total_moves: int,
    *,
    played: int | None = None,
    moves: int = 12,
    undos: int = 0,
) -> dict:
    """A solved level: ``played`` (default: the frontier itself), scored with the
    standing after it, ``final_score``/``level_reached`` = frontier."""
    return {
        "final_score": frontier,
        "outcome": "completed",
        "duration_ms": None,
        "result": {
            "won": True,
            "level": frontier if played is None else played,
            "moves": moves,
            "undos": undos,
            "level_reached": frontier,
            "total_moves": total_moves,
        },
    }


# (PATCH /complete body, as SyncWorker serialises it) for every path the app has.
_CURRENT_COMPLETIONS: dict[str, dict[str, Any]] = {
    "frontier-first-solve": _scored(5, 60),
    # A lower level still missing a best (an older build's progress): no total.
    "frontier-first-solve-no-total": {
        "final_score": 5,
        "outcome": "completed",
        "duration_ms": None,
        "result": {"won": True, "level": 5, "moves": 12, "undos": 1, "level_reached": 5},
    },
    # Replaying level 3 with level 9 the highest solved.
    "replay": _scored(9, 140, played=3, moves=9, undos=2),
    "abandon": {
        "final_score": None,
        "outcome": "abandoned",
        "duration_ms": None,
        "result": {"won": False, "level": 4, "moves": 3},
    },
    "abandon-no-level": {
        "final_score": None,
        "outcome": "abandoned",
        "duration_ms": None,
        "result": {"won": False, "level": None, "moves": 0},
    },
    # The #2512 build: every solve, with outcome/won in the result, no score.
    "installed-2512-solve": {
        "final_score": None,
        "outcome": "completed",
        "duration_ms": None,
        "result": {"outcome": "completed", "won": True, "level": 2, "moves": 14, "undos": 0},
    },
    "no-result": {"final_score": None, "outcome": "abandoned", "duration_ms": None, "result": {}},
}


async def _grant(sid: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=sid, game_slug="sort"))
        await db.commit()


async def _name(sid: str, name: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(Player(session_id=sid, display_name=name))
        await db.commit()


async def _player(name: str | None = None) -> str:
    sid = _sid()
    await _grant(sid)
    if name is not None:
        await _name(sid, name)
    return sid


def _play(sid: str, body: dict) -> str:
    r = client.post("/games", headers=_headers(sid), json={"game_type": "sort", "metadata": {}})
    assert r.status_code == 200, r.text
    game_id = r.json()["id"]
    r = client.patch(f"/games/{game_id}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    return game_id


def _board(sid: str) -> list[tuple[str, int]]:
    # Other tests share this database: read past their Sort rows.
    r = client.get("/games/leaderboard/sort?limit=100", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return [(e["player_name"], e["value"]) for e in r.json()["entries"]]


# ---------------------------------------------------------------------------
# module + model
# ---------------------------------------------------------------------------


def test_result_model_is_registered() -> None:
    assert get_module("sort") is sort_module
    assert sort_module.result_model is SortResult
    assert sort_module.metadata_model is SortMetadata


def test_board_ranks_level_reached_then_earliest_completion() -> None:
    board = sort_module.board
    assert (board.metric, board.direction) == ("level_reached", "desc")
    # No moves tie-break (#2746): levels are random per request, so moves on
    # the same level number are moves on different puzzles.
    assert board.tiebreak is None
    # Levels are 1-23 (LEVEL_SPECS, built per request by build_levels): the
    # cap must let the last one rank.
    assert board.max_value == len(LEVEL_SPECS) == 23


def test_metadata_is_unchanged() -> None:
    assert set(SortMetadata.model_fields) == {"player_name"}
    with pytest.raises(ValidationError):
        SortMetadata.model_validate({"level": 3})


@pytest.mark.parametrize("name", list(_CURRENT_COMPLETIONS))
def test_current_results_validate_and_keep_every_key(name: str) -> None:
    result = _CURRENT_COMPLETIONS[name]["result"]
    assert SortResult.model_validate(result).model_dump(exclude_unset=True) == result


def test_result_ignores_unknown_keys() -> None:
    dumped = SortResult.model_validate(
        {"level": 2, "moves": 5, "hints_used": 3, "duration": 9}
    ).model_dump(exclude_unset=True)
    assert dumped == {"level": 2, "moves": 5}


@pytest.mark.parametrize(
    "bad",
    [
        {"level_reached": "12"},
        {"level_reached": True},
        {"total_moves": 1.5},
        {"total_moves": -1},
        {"moves": -3},
    ],
    ids=["level-string", "level-bool", "total-float", "total-negative", "moves-negative"],
)
def test_result_rejects_malformed_values(bad: dict) -> None:
    with pytest.raises(ValidationError):
        SortResult.model_validate(bad)


# ---------------------------------------------------------------------------
# over HTTP: every current payload completes, and lands in games.metadata
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", list(_CURRENT_COMPLETIONS))
async def test_every_current_completion_is_accepted(name: str) -> None:
    sid = await _player()
    _play(sid, _CURRENT_COMPLETIONS[name])


async def test_the_scored_result_is_stored_where_the_board_reads_it() -> None:
    sid = await _player()
    game_id = _play(sid, _scored(7, 81, moves=15, undos=2))
    r = client.get(f"/games/{game_id}", headers=_headers(sid))
    assert r.status_code == 200, r.text
    row = r.json()
    assert row["final_score"] == 7
    assert row["outcome"] == "completed"
    assert row["metadata"] == {
        "won": True,
        "level": 7,
        "moves": 15,
        "undos": 2,
        "level_reached": 7,
        "total_moves": 81,
    }


async def test_unknown_result_keys_are_not_stored() -> None:
    sid = await _player()
    body = _scored(3, 30)
    body["result"] = {**body["result"], "hints_used": 4}
    game_id = _play(sid, body)
    metadata = client.get(f"/games/{game_id}", headers=_headers(sid)).json()["metadata"]
    assert "hints_used" not in metadata
    assert metadata["total_moves"] == 30


async def test_level_above_the_cap_is_rejected() -> None:
    sid = await _player()
    r = client.post("/games", headers=_headers(sid), json={"game_type": "sort", "metadata": {}})
    game_id = r.json()["id"]
    r = client.patch(f"/games/{game_id}/complete", headers=_headers(sid), json=_scored(24, 100))
    assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# the board (one entry per player, #2618)
# ---------------------------------------------------------------------------


async def test_same_level_ranks_earliest_completion_not_fewer_total_moves() -> None:
    more = await _player("SortMore")
    fewer = await _player("SortFewer")
    # The one with more moves finishes first: the time decides, not total_moves
    # (#2746: their level 23s were different puzzles).
    _play(more, _scored(23, 900))
    _play(fewer, _scored(23, 400))
    top = [p for p in _board(fewer) if p[0] in {"SortMore", "SortFewer"}]
    assert top == [("SortMore", 23), ("SortFewer", 23)]

    game_rank: dict[str, int] = {}
    for sid in (more, fewer):
        games = client.get("/games/me", headers=_headers(sid)).json()["items"]
        r = client.get(f"/games/{games[0]['id']}/rank", headers=_headers(sid))
        assert r.status_code == 200, r.text
        game_rank[sid] = r.json()["rank"]
    assert game_rank[more] < game_rank[fewer]


async def test_one_player_appears_once_at_their_highest_level() -> None:
    sid = await _player("SortClimber")
    first = _play(sid, _scored(21, 300))
    _play(sid, _scored(22, 330))
    best = _play(sid, _scored(23, 360))
    # A replay at the same frontier, an abandon and an unscored (#2512 build)
    # solve: none of them displaces the best row, the first solve of 23.
    _play(sid, _scored(23, 360, played=4))
    _play(sid, _CURRENT_COMPLETIONS["abandon"])
    _play(sid, _CURRENT_COMPLETIONS["installed-2512-solve"])

    mine = [p for p in _board(sid) if p[0] == "SortClimber"]
    assert mine == [("SortClimber", 23)]

    r = client.get(f"/games/{best}/rank", headers=_headers(sid)).json()
    assert r["ranked"] is True and r["is_best"] is True
    older = client.get(f"/games/{first}/rank", headers=_headers(sid)).json()
    assert older["ranked"] is True and older["is_best"] is False
    assert older["rank"] == r["rank"]


async def test_a_replay_that_lowers_the_total_does_not_change_the_rank() -> None:
    steady = await _player("SortSteady")
    replayer = await _player("SortReplayer")
    _play(steady, _scored(23, 450))
    first = _play(replayer, _scored(23, 500))
    names = {"SortSteady", "SortReplayer"}
    assert [p for p in _board(steady) if p[0] in names] == [
        ("SortSteady", 23),
        ("SortReplayer", 23),
    ]

    # Level 5 replayed in far fewer moves: same frontier, total down to 400.
    # Moves don't rank (#2746), so the first solve of 23 stays the best row.
    replay = _play(replayer, _scored(23, 400, played=5, moves=8))
    assert [p for p in _board(steady) if p[0] in names] == [
        ("SortSteady", 23),
        ("SortReplayer", 23),
    ]
    r = client.get(f"/games/{first}/rank", headers=_headers(replayer)).json()
    assert r["ranked"] is True and r["is_best"] is True
    later = client.get(f"/games/{replay}/rank", headers=_headers(replayer)).json()
    assert later["is_best"] is False and later["rank"] == r["rank"]


async def test_an_unscored_solve_is_not_on_the_board() -> None:
    sid = await _player("SortReplayOnly")
    solve = _play(sid, _CURRENT_COMPLETIONS["installed-2512-solve"])
    assert "SortReplayOnly" not in [name for name, _ in _board(sid)]
    r = client.get(f"/games/{solve}/rank", headers=_headers(sid)).json()
    assert r["ranked"] is False


# ---------------------------------------------------------------------------
# daily challenge: every solve carries the score its goals read
# ---------------------------------------------------------------------------


def test_a_replay_meets_the_sort_goals_up_to_the_frontier() -> None:
    easy, medium, hard = FREE_GOAL_POOL["sort"]
    body = _scored(15, 300, played=2)
    metadata = SortResult.model_validate(body["result"]).model_dump(exclude_unset=True)
    facts = game_facts(metadata, body["final_score"], None)
    assert easy.evaluate(facts) and medium.evaluate(facts) and hard.evaluate(facts)
    early = _scored(5, 60, played=1)
    facts = game_facts(early["result"], early["final_score"], None)
    assert easy.evaluate(facts) and not medium.evaluate(facts)

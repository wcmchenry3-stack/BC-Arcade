"""Sort's result model and its board, through the shared ``/games`` path (#2625).

Every solved level is a session row (``useGameSync("sort")``, #2512). Only the
first solve of the player's frontier level is scored: ``final_score`` and
``level_reached`` are the level, and ``total_moves`` (the sum of the player's
best moves up to it) breaks a tie. The payloads below mirror ``SortScreen.tsx``;
a rejection would dead-letter the solve, so every current one must pass.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from db.base import get_session_factory
from db.models import GameEntitlement, Player
from games.registry import get_module
from main import app
from sort.models import SortMetadata, SortResult
from sort.module import module as sort_module

client = TestClient(app)


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


def _sid() -> str:
    return str(uuid.uuid4())


def _scored(level: int, total_moves: int, *, moves: int = 12, undos: int = 0) -> dict:
    """The frontier first solve: ``finalScore`` + ``level_reached`` + ``total_moves``."""
    return {
        "final_score": level,
        "outcome": "completed",
        "duration_ms": None,
        "result": {
            "level": level,
            "moves": moves,
            "undos": undos,
            "level_reached": level,
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
        "result": {"level": 5, "moves": 12, "undos": 1, "level_reached": 5},
    },
    "replay": {
        "final_score": None,
        "outcome": "completed",
        "duration_ms": None,
        "result": {"level": 3, "moves": 9, "undos": 2},
    },
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


def test_board_ranks_level_reached_then_fewest_total_moves() -> None:
    board = sort_module.board
    assert (board.metric, board.direction) == ("level_reached", "desc")
    assert board.tiebreak == ("total_moves", "asc")
    # Real levels are 1-23 (levels.json): the cap must let the last one rank.
    assert board.max_value == 23


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


async def test_same_level_ranks_fewer_total_moves_first() -> None:
    more = await _player("SortMore")
    fewer = await _player("SortFewer")
    # The one with more moves finishes first: total_moves decides, not the time.
    _play(more, _scored(23, 900))
    _play(fewer, _scored(23, 400))
    top = [p for p in _board(fewer) if p[0] in {"SortMore", "SortFewer"}]
    assert top == [("SortFewer", 23), ("SortMore", 23)]

    game_rank: dict[str, int] = {}
    for sid in (more, fewer):
        games = client.get("/games/me", headers=_headers(sid)).json()["items"]
        r = client.get(f"/games/{games[0]['id']}/rank", headers=_headers(sid))
        assert r.status_code == 200, r.text
        game_rank[sid] = r.json()["rank"]
    assert game_rank[fewer] < game_rank[more]


async def test_one_player_appears_once_at_their_highest_level() -> None:
    sid = await _player("SortClimber")
    first = _play(sid, _scored(21, 300))
    _play(sid, _scored(22, 330))
    best = _play(sid, _scored(23, 360))
    # Replays and abandons carry no level_reached, so they never rank.
    _play(sid, _CURRENT_COMPLETIONS["replay"])
    _play(sid, _CURRENT_COMPLETIONS["abandon"])

    mine = [p for p in _board(sid) if p[0] == "SortClimber"]
    assert mine == [("SortClimber", 23)]

    r = client.get(f"/games/{best}/rank", headers=_headers(sid)).json()
    assert r["ranked"] is True and r["is_best"] is True
    older = client.get(f"/games/{first}/rank", headers=_headers(sid)).json()
    assert older["ranked"] is True and older["is_best"] is False
    assert older["rank"] == r["rank"]


async def test_an_unscored_solve_is_not_on_the_board() -> None:
    sid = await _player("SortReplayOnly")
    replay = _play(sid, _CURRENT_COMPLETIONS["replay"])
    assert "SortReplayOnly" not in [name for name, _ in _board(sid)]
    r = client.get(f"/games/{replay}/rank", headers=_headers(sid)).json()
    assert r["ranked"] is False

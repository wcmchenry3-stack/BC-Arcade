"""Sort's result model and its board, through the shared ``/games`` path (#2625).

Every solved level is a session row (``useGameSync("sort")``, #2512), scored
with the player's standing after it: ``final_score`` and ``level_reached`` are
the highest level solved, and ``total_moves`` is the sum of the player's best
moves up to it: the tie-break, dropped in #2746 while levels were random and
back with the fixed level catalog (#2761). ``catalog_version`` names the
catalog; only rows of the current one rank, which reset the board when the
catalog shipped. ``level``/``moves``/``undos`` are the level actually played.
The payloads below mirror ``SortScreen.tsx``; a rejection would dead-letter
the solve, so every current one must pass.
"""

from __future__ import annotations

import itertools
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from daily_challenge.definitions import FREE_GOAL_POOL, game_facts
from db.base import get_session_factory
from db.models import GameEntitlement, Player
from games.registry import get_module
from main import app
from sort.catalog import CATALOG_VERSION, LEVEL_COUNT
from sort.models import SortMetadata, SortResult
from sort.module import module as sort_module
from tests._helpers import session_headers as _headers

client = TestClient(app)


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
            "catalog_version": CATALOG_VERSION,
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
        "result": {
            "won": True,
            "level": 5,
            "moves": 12,
            "undos": 1,
            "level_reached": 5,
            "catalog_version": CATALOG_VERSION,
        },
    },
    # The last level of the catalog.
    "last-level": _scored(LEVEL_COUNT, 4000),
    # A build from before the catalog (#2761): random levels 1-23, no version.
    "pre-catalog-solve": {
        "final_score": 23,
        "outcome": "completed",
        "duration_ms": None,
        "result": {
            "won": True,
            "level": 23,
            "moves": 40,
            "undos": 0,
            "level_reached": 23,
            "total_moves": 700,
        },
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


# Ties on level rank by completed_at (#2746). Back-to-back requests can get
# the same server now(), and a tie on that falls back to the random game id,
# so every play here sends its own completed_at, one second after the last.
_T0 = datetime.now(UTC) - timedelta(hours=1)
_tick = itertools.count()


def _play(sid: str, body: dict) -> str:
    r = client.post("/games", headers=_headers(sid), json={"game_type": "sort", "metadata": {}})
    assert r.status_code == 200, r.text
    game_id = r.json()["id"]
    completed_at = _T0 + timedelta(seconds=next(_tick))
    body = {**body, "completed_at": completed_at.isoformat()}
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


def test_board_ranks_level_reached_then_fewest_total_moves_in_the_current_catalog() -> None:
    board = sort_module.board
    assert (board.metric, board.direction) == ("level_reached", "desc")
    # Every player gets the same catalog levels (#2761), so moves compare.
    assert board.tiebreak == ("total_moves", "asc")
    # Levels are 1-120: the cap must let the last one rank.
    assert board.max_value == LEVEL_COUNT == 120
    # Only solves of the current catalog rank (the board reset, #2761).
    assert board.edition == ("catalog_version", CATALOG_VERSION)


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
        {"level_reached": LEVEL_COUNT + 1},
        {"level": LEVEL_COUNT + 1},
        {"catalog_version": "1"},
        {"catalog_version": True},
        {"catalog_version": 0},
    ],
    ids=[
        "level-string",
        "level-bool",
        "total-float",
        "total-negative",
        "moves-negative",
        "reached-above-catalog",
        "level-above-catalog",
        "version-string",
        "version-bool",
        "version-zero",
    ],
)
def test_result_rejects_malformed_values(bad: dict) -> None:
    with pytest.raises(ValidationError):
        SortResult.model_validate(bad)


@pytest.mark.parametrize("stars", [1, 2, 3])
def test_result_accepts_stars_one_to_three(stars: int) -> None:
    result = _scored(5, 60)["result"] | {"stars": stars}
    assert SortResult.model_validate(result).model_dump(exclude_unset=True) == result


@pytest.mark.parametrize("stars", [0, 4, -1, "2", True, 2.0])
def test_result_rejects_stars_outside_one_to_three_or_not_an_int(stars: object) -> None:
    with pytest.raises(ValidationError):
        SortResult.model_validate({"stars": stars})


def test_result_without_stars_still_validates() -> None:
    result = _scored(5, 60)["result"]
    parsed = SortResult.model_validate(result)
    assert parsed.stars is None
    assert "stars" not in parsed.model_dump(exclude_unset=True)


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
        "catalog_version": CATALOG_VERSION,
    }


async def test_stars_are_stored_and_do_not_change_the_board_score() -> None:
    sid = await _player()
    body = _scored(7, 81, moves=15)
    body["result"] = {**body["result"], "stars": 2}
    game_id = _play(sid, body)
    row = client.get(f"/games/{game_id}", headers=_headers(sid)).json()
    assert row["metadata"]["stars"] == 2
    assert row["final_score"] == 7


async def test_stars_out_of_range_are_rejected() -> None:
    sid = await _player()
    r = client.post("/games", headers=_headers(sid), json={"game_type": "sort", "metadata": {}})
    game_id = r.json()["id"]
    body = _scored(7, 81)
    body["result"] = {**body["result"], "stars": 4}
    r = client.patch(f"/games/{game_id}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 400, r.text


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
    r = client.patch(
        f"/games/{game_id}/complete", headers=_headers(sid), json=_scored(LEVEL_COUNT + 1, 100)
    )
    assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# the board (one entry per player, #2618)
# ---------------------------------------------------------------------------


async def test_same_level_ranks_fewer_total_moves_first() -> None:
    more = await _player("SortMore")
    fewer = await _player("SortFewer")
    # The one with more moves finishes first, but the catalog's levels are
    # the same for everyone (#2761): fewer total moves wins the tie.
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


async def test_a_replay_that_lowers_the_total_moves_the_player_up() -> None:
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
    # Moves rank again (#2761), so the replay becomes the best row.
    replay = _play(replayer, _scored(23, 400, played=5, moves=8))
    assert [p for p in _board(steady) if p[0] in names] == [
        ("SortReplayer", 23),
        ("SortSteady", 23),
    ]
    later = client.get(f"/games/{replay}/rank", headers=_headers(replayer)).json()
    assert later["ranked"] is True and later["is_best"] is True
    r = client.get(f"/games/{first}/rank", headers=_headers(replayer)).json()
    assert r["is_best"] is False and r["rank"] == later["rank"]


async def test_a_solve_from_before_the_catalog_is_stored_but_never_ranks(sort_edition) -> None:
    """The board reset (#2761), switched on: old builds still send level_reached on
    random levels, with no catalog_version. The solve completes (a rejection would
    dead-letter it) and keeps its row, but no board ranks it."""
    sort_edition(True)
    old = await _player("SortOldBuild")
    new = await _player("SortCatalog")
    solve = _play(old, _CURRENT_COMPLETIONS["pre-catalog-solve"])
    _play(new, _scored(2, 20))
    names = [name for name, _ in _board(new)]
    assert "SortCatalog" in names and "SortOldBuild" not in names
    r = client.get(f"/games/{solve}/rank", headers=_headers(old)).json()
    assert r["ranked"] is False and r["reason"] == "not_rankable"
    stored = client.get(f"/games/{solve}", headers=_headers(old)).json()
    assert stored["final_score"] == 23 and "catalog_version" not in stored["metadata"]


async def test_a_solve_of_another_catalog_never_ranks(sort_edition) -> None:
    sort_edition(True)
    sid = await _player("SortOtherCatalog")
    body = _scored(40, 300)
    body["result"] = {**body["result"], "catalog_version": CATALOG_VERSION + 1}
    solve = _play(sid, body)
    assert "SortOtherCatalog" not in [name for name, _ in _board(sid)]
    r = client.get(f"/games/{solve}/rank", headers=_headers(sid)).json()
    assert r["ranked"] is False


async def test_an_unscored_solve_is_not_on_the_board() -> None:
    sid = await _player("SortReplayOnly")
    solve = _play(sid, _CURRENT_COMPLETIONS["installed-2512-solve"])
    assert "SortReplayOnly" not in [name for name, _ in _board(sid)]
    r = client.get(f"/games/{solve}/rank", headers=_headers(sid)).json()
    assert r["ranked"] is False


async def test_a_solve_from_before_the_catalog_ranks_until_the_reset_is_switched_on(
    sort_edition,
) -> None:
    """SORT_CATALOG_EDITION_ENFORCED is off by default: the backend deploys before
    the app builds that send catalog_version are live, so until the owner turns
    the reset on the board ranks every row, as before it (#2761)."""
    sort_edition(False)
    old = await _player("SortOldBuildOff")
    solve = _play(old, _CURRENT_COMPLETIONS["pre-catalog-solve"])
    assert ("SortOldBuildOff", 23) in _board(old)
    r = client.get(f"/games/{solve}/rank", headers=_headers(old)).json()
    assert r["ranked"] is True
    sort_edition(True)
    assert "SortOldBuildOff" not in [name for name, _ in _board(old)]


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

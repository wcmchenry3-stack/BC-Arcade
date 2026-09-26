"""FreeCell records a per-session game via the shared path (#2452).

The legacy leaderboard routes are covered by ``test_freecell.py``; these tests
cover the GameModule, its result model, and — the load-bearing part — how the
session rows rank. Since #2632 a win sends its move count as ``final_score``
and ranks on the generic board (fewest moves first, once per player); an
abandon never carries a score.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from daily_challenge.definitions import FREE_GOAL_POOL, game_facts
from freecell.models import FreeCellMetadata, FreeCellResult
from freecell.module import module as freecell_module
from games.protocol import GameModule
from games.registry import get_module
from main import app
from vocab import GameType

client = TestClient(app)


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# module + registry
# ---------------------------------------------------------------------------


def test_module_satisfies_the_protocol_and_is_registered() -> None:
    assert isinstance(freecell_module, GameModule)
    assert freecell_module.game_type == GameType.FREECELL
    assert get_module("freecell") is freecell_module


def test_result_model_is_separate_from_the_metadata_model() -> None:
    assert freecell_module.result_model is FreeCellResult
    assert freecell_module.result_model is not freecell_module.metadata_model


def test_stats_shape_strips_latest_score() -> None:
    raw = {"best": None, "last_played_at": None, "latest_score": None}
    assert freecell_module.stats_shape(raw) == {"last_played_at": None}


# ---------------------------------------------------------------------------
# models
# ---------------------------------------------------------------------------


def test_metadata_is_empty_and_forbids_everything_else() -> None:
    assert FreeCellMetadata.model_validate({}).model_dump() == {}
    # player_name belongs to the leaderboard row, not the session row.
    for extra in ({"player_name": "alice"}, {"moves": 3}):
        with pytest.raises(ValidationError):
            FreeCellMetadata.model_validate(extra)


def test_result_accepts_a_win_and_an_abandon() -> None:
    assert FreeCellResult.model_validate({"won": True, "moves": 92}).model_dump() == {
        "won": True,
        "moves": 92,
    }
    assert FreeCellResult.model_validate({"won": False, "moves": 0}).won is False


def test_result_ignores_unknown_keys_so_a_newer_build_still_completes() -> None:
    dumped = FreeCellResult.model_validate(
        {"won": True, "moves": 80, "outcome": "completed", "hint_used": True}
    ).model_dump(exclude_unset=True)
    assert dumped == {"won": True, "moves": 80}


@pytest.mark.parametrize(
    "bad",
    [{"moves": 5}, {"won": True}, {"won": True, "moves": -1}, {"won": "maybe", "moves": 5}, {}],
    ids=["no-won", "no-moves", "negative-moves", "not-a-bool", "empty"],
)
def test_result_rejects_missing_or_invalid_fields(bad: dict) -> None:
    with pytest.raises(ValidationError):
        FreeCellResult.model_validate(bad)


# ---------------------------------------------------------------------------
# daily challenge — the result must satisfy the goals #2453 wrote for FreeCell
# ---------------------------------------------------------------------------


def _facts(result: dict) -> dict:
    validated = FreeCellResult.model_validate(result).model_dump(exclude_unset=True)
    # The goals read only the result block; a win's final_score (#2632) is its moves.
    return game_facts(validated, validated["moves"] if validated["won"] else None, None)


def test_validated_results_satisfy_the_freecell_goals() -> None:
    easy, medium, hard = FREE_GOAL_POOL["freecell"]
    abandoned = _facts({"won": False, "moves": 5})
    assert easy.evaluate(abandoned) and not medium.evaluate(abandoned)
    win = _facts({"won": True, "moves": 100})
    assert medium.evaluate(win) and hard.evaluate(win)
    slow_win = _facts({"won": True, "moves": 101})
    assert medium.evaluate(slow_win) and not hard.evaluate(slow_win)
    assert not easy.evaluate(_facts({"won": False, "moves": 4}))


# ---------------------------------------------------------------------------
# the shared path over HTTP — and the boards (#2632)
# ---------------------------------------------------------------------------


def _play(
    sid: str, *, won: bool, moves: int, outcome: str = "completed", scored: bool = True
) -> str:
    """One session game as the app records it.

    Since #2632 a win sends ``final_score = moves`` (the board ranks it asc); an
    abandon (the hook's, on unmount or New Game) never carries a score.
    ``scored=False`` is an installed build's win, which sent no score.
    """
    r = client.post("/games", headers=_headers(sid), json={"game_type": "freecell"})
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    body: dict = {"outcome": outcome, "result": {"won": won, "moves": moves}}
    if scored and outcome != "abandoned":
        body["final_score"] = moves
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    return gid


def _generic_board(sid: str) -> list[tuple[str, int]]:
    r = client.get("/games/leaderboard/freecell", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return [(e["player_name"], e["value"]) for e in r.json()["entries"]]


def test_a_won_session_game_records_the_result_and_its_moves_as_the_score() -> None:
    sid = str(uuid.uuid4())
    gid = _play(sid, won=True, moves=91)
    detail = client.get(f"/games/{gid}", headers=_headers(sid)).json()
    assert detail["metadata"] == {"won": True, "moves": 91}
    assert detail["final_score"] == 91
    assert detail["outcome"] == "completed"


def test_an_installed_builds_unscored_win_still_completes() -> None:
    sid = str(uuid.uuid4())
    gid = _play(sid, won=True, moves=91, scored=False)
    detail = client.get(f"/games/{gid}", headers=_headers(sid)).json()
    assert detail["final_score"] is None
    assert detail["outcome"] == "completed"


def test_an_invalid_result_is_a_400_and_does_not_complete_the_game() -> None:
    sid = str(uuid.uuid4())
    gid = client.post("/games", headers=_headers(sid), json={"game_type": "freecell"}).json()["id"]
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={"outcome": "completed", "result": {"won": True}},  # moves missing
    )
    assert r.status_code == 400
    assert client.get(f"/games/{gid}", headers=_headers(sid)).json()["completed_at"] is None


def test_a_named_players_win_ranks_once_and_an_abandon_never() -> None:
    # Fewer moves is better, so an abandoned game with a handful of moves must
    # never rank, and each player is listed once (their fewest moves).
    sid = str(uuid.uuid4())
    r = client.put("/players/me", headers=_headers(sid), json={"display_name": "Alice"})
    assert r.status_code == 200, r.text
    _play(sid, won=False, moves=3, outcome="abandoned")
    _play(sid, won=True, moves=88)
    _play(sid, won=True, moves=104)
    assert _generic_board(sid) == [("Alice", 88)]


def test_a_session_game_earns_xp_and_counts_as_played() -> None:
    sid = str(uuid.uuid4())
    _play(sid, won=True, moves=88)
    stats = client.get("/stats/me", headers=_headers(sid)).json()
    assert stats["by_game"]["freecell"]["sessions"] == 1
    assert stats["arcade_xp"] > 0

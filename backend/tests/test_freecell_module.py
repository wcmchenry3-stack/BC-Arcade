"""FreeCell records a per-session game via the shared path (#2452).

The leaderboard routes are covered by ``test_freecell.py`` and stay unchanged;
these tests cover the GameModule, its result model, and — the load-bearing part —
that the new per-session rows do not touch the leaderboard.
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
    raw = {"played": 2, "best": None, "avg": None, "last_played_at": None, "latest_score": None}
    assert "latest_score" not in freecell_module.stats_shape(raw)
    assert freecell_module.stats_shape(raw)["played"] == 2


# ---------------------------------------------------------------------------
# models
# ---------------------------------------------------------------------------


def test_metadata_requires_nothing_and_forbids_unknown_keys() -> None:
    assert FreeCellMetadata.model_validate({}).player_name == ""
    assert FreeCellMetadata.model_validate({"player_name": "alice"}).player_name == "alice"
    with pytest.raises(ValidationError):
        FreeCellMetadata.model_validate({"moves": 3})


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
    return game_facts(validated, None, None)  # final_score stays null for FreeCell


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
# the shared path over HTTP — and the leaderboard stays exactly as it was
# ---------------------------------------------------------------------------


def _play(sid: str, *, won: bool, moves: int, outcome: str = "completed") -> str:
    r = client.post("/games", headers=_headers(sid), json={"game_type": "freecell"})
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={"outcome": outcome, "result": {"won": won, "moves": moves}},
    )
    assert r.status_code == 200, r.text
    return gid


def test_a_session_game_records_the_result_and_no_score() -> None:
    sid = str(uuid.uuid4())
    gid = _play(sid, won=True, moves=91)
    detail = client.get(f"/games/{gid}", headers=_headers(sid)).json()
    assert detail["metadata"] == {"won": True, "moves": 91}
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


def test_session_games_never_reach_the_leaderboard() -> None:
    # An abandoned game with few moves would rank first (fewer moves is better),
    # and a win would appear as an "anon" duplicate — so neither may be ranked.
    sid = str(uuid.uuid4())
    _play(sid, won=False, moves=3, outcome="abandoned")
    _play(sid, won=True, moves=88)
    assert client.get("/freecell/leaderboard").json() == {"scores": []}


def test_the_named_submission_flow_is_unchanged_alongside_a_session_game() -> None:
    sid = str(uuid.uuid4())
    _play(sid, won=True, moves=88)
    r = client.post("/freecell/score", json={"player_id": "alice", "move_count": 88})
    assert r.status_code == 201
    assert r.json()["rank"] == 1
    # Exactly one entry: the named one. The session row did not duplicate it.
    assert client.get("/freecell/leaderboard").json()["scores"] == [
        {"player_id": "alice", "move_count": 88, "rank": 1}
    ]


def test_a_session_game_earns_xp_and_counts_as_played() -> None:
    sid = str(uuid.uuid4())
    _play(sid, won=True, moves=88)
    stats = client.get("/stats/me", headers=_headers(sid)).json()
    assert stats["by_game"]["freecell"]["played"] == 1
    assert stats["arcade_xp"] > 0

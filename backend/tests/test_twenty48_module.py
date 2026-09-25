"""Twenty48 GameModule, its models and the payloads the app sends (#2623).

Registering the module turns on metadata and result validation for Twenty48,
a free game whose current store builds already send session rows. The payload
replays below mirror ``Twenty48Screen.tsx`` and ``useGameSync`` on ``dev``; a
rejection there would dead-letter the player's game, so every one must pass.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from daily_challenge.definitions import FREE_GOAL_POOL, game_facts
from games.board import SCORE_METRIC
from games.protocol import GameModule
from games.registry import get_module
from main import app
from twenty48.models import Twenty48Metadata, Twenty48Result
from twenty48.module import module as twenty48_module
from vocab import GameType

client = TestClient(app)


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


def _ended(outcome: str, *, score: int = 2400, tile: int = 256) -> dict:
    """``endedPayload(s, outcome)`` — game over, new game, keep playing."""
    return {
        "final_score": score,
        "highest_tile": tile,
        "move_count": 180,
        "duration_ms": 95_000,
        "outcome": outcome,
    }


# The progress snapshot the hook attaches when it abandons the session itself
# (unmount): the same keys without ``outcome``.
_ABANDON_SNAPSHOT = {
    "final_score": 312,
    "highest_tile": 64,
    "move_count": 41,
    "duration_ms": 20_000,
}

# (PATCH /complete body, as SyncWorker serialises it) for every path the app has.
_CURRENT_COMPLETIONS = {
    "game-over": {
        "final_score": 2400,
        "outcome": "completed",
        "duration_ms": 95_000,
        "result": _ended("completed"),
    },
    "new-game-abandon": {
        "final_score": 800,
        "outcome": "abandoned",
        "duration_ms": 40_000,
        "result": _ended("abandoned", score=800, tile=64),
    },
    "keep-playing": {
        "final_score": 20_480,
        "outcome": "kept_playing",
        "duration_ms": 600_000,
        "result": _ended("kept_playing", score=20_480, tile=2048),
    },
    "unmount-abandon": {
        "final_score": None,
        "outcome": "abandoned",
        "duration_ms": None,
        "result": _ABANDON_SNAPSHOT,
    },
    "no-result": {"final_score": None, "outcome": "abandoned", "duration_ms": None, "result": {}},
    "null-result": {
        "final_score": None,
        "outcome": "abandoned",
        "duration_ms": None,
        "result": None,
    },
}


# ---------------------------------------------------------------------------
# module + registry
# ---------------------------------------------------------------------------


def test_module_satisfies_the_protocol_and_is_registered() -> None:
    assert isinstance(twenty48_module, GameModule)
    assert twenty48_module.game_type == GameType.TWENTY48
    assert get_module("twenty48") is twenty48_module


def test_models_are_declared_and_separate() -> None:
    assert twenty48_module.metadata_model is Twenty48Metadata
    assert twenty48_module.result_model is Twenty48Result


def test_board_is_one_global_score_board() -> None:
    board = twenty48_module.board
    assert board.metric == SCORE_METRIC
    assert board.direction == "desc"
    assert board.partitions == []
    assert board.max_value is None
    assert board.enabled is True


def test_reaching_2048_is_a_win() -> None:
    assert twenty48_module.has_winner is True


def test_stats_shape_is_pass_through_without_latest_score() -> None:
    raw = {"played": 3, "best": 2048, "avg": 900.0, "last_played_at": None, "latest_score": 400}
    shaped = twenty48_module.stats_shape(raw)
    assert "latest_score" not in shaped
    assert shaped == {"played": 3, "best": 2048, "avg": 900.0, "last_played_at": None}


# ---------------------------------------------------------------------------
# models
# ---------------------------------------------------------------------------


def test_metadata_is_empty_and_forbids_extra_keys() -> None:
    assert Twenty48Metadata.model_validate({}).model_dump() == {}
    with pytest.raises(ValidationError):
        Twenty48Metadata.model_validate({"initial_board": [0] * 16})


@pytest.mark.parametrize("name", list(_CURRENT_COMPLETIONS))
def test_current_results_validate_and_keep_every_key(name: str) -> None:
    result = _CURRENT_COMPLETIONS[name]["result"] or {}
    dumped = Twenty48Result.model_validate(result).model_dump(exclude_unset=True)
    assert dumped == result


def test_result_ignores_unknown_keys_so_a_newer_build_still_completes() -> None:
    dumped = Twenty48Result.model_validate(
        {**_ended("completed"), "undo_count": 2, "has_won": True}
    ).model_dump(exclude_unset=True)
    assert dumped == _ended("completed")


def test_result_accepts_a_future_win_outcome() -> None:
    assert Twenty48Result.model_validate(_ended("win")).outcome == "win"


@pytest.mark.parametrize(
    "bad",
    [{"final_score": -1}, {"highest_tile": "big"}, {"move_count": 1.5}],
    ids=["negative-score", "tile-not-int", "moves-not-int"],
)
def test_result_rejects_malformed_values(bad: dict) -> None:
    with pytest.raises(ValidationError):
        Twenty48Result.model_validate(bad)


# ---------------------------------------------------------------------------
# daily challenge — reads final_score and highest_tile from the merged result
# ---------------------------------------------------------------------------


def test_validated_results_still_feed_the_twenty48_goals() -> None:
    easy, medium, hard = FREE_GOAL_POOL["twenty48"]
    # An unmount abandon has no final_score column: the result is its only score.
    facts = game_facts(
        Twenty48Result.model_validate({**_ABANDON_SNAPSHOT, "final_score": 600}).model_dump(
            exclude_unset=True
        ),
        None,
        None,
    )
    assert easy.evaluate(facts) and not hard.evaluate(facts)
    facts = game_facts(
        Twenty48Result.model_validate(_ended("completed", score=3000, tile=512)).model_dump(
            exclude_unset=True
        ),
        3000,
        95_000,
    )
    assert medium.evaluate(facts) and hard.evaluate(facts)


# ---------------------------------------------------------------------------
# the shared path over HTTP — every current payload is accepted
# ---------------------------------------------------------------------------


def _start(sid: str) -> str:
    # useGameSync("twenty48").start sends no metadata: the board is event data.
    r = client.post("/games", headers=_headers(sid), json={"game_type": "twenty48", "metadata": {}})
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.mark.parametrize("name", list(_CURRENT_COMPLETIONS))
def test_current_completions_are_accepted(name: str) -> None:
    sid = str(uuid.uuid4())
    gid = _start(sid)
    body = _CURRENT_COMPLETIONS[name]
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    detail = client.get(f"/games/{gid}", headers=_headers(sid)).json()
    assert detail["completed_at"] is not None
    assert detail["metadata"] == (body["result"] or {})


def test_an_unknown_result_key_is_dropped_not_rejected() -> None:
    sid = str(uuid.uuid4())
    gid = _start(sid)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={
            "final_score": 2400,
            "outcome": "completed",
            "result": {**_ended("completed"), "x": 1},
        },
    )
    assert r.status_code == 200, r.text
    metadata = client.get(f"/games/{gid}", headers=_headers(sid)).json()["metadata"]
    assert metadata == _ended("completed")


def test_a_malformed_result_is_a_400_and_does_not_complete_the_game() -> None:
    sid = str(uuid.uuid4())
    gid = _start(sid)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={"outcome": "completed", "result": {"highest_tile": "big"}},
    )
    assert r.status_code == 400
    assert client.get(f"/games/{gid}", headers=_headers(sid)).json()["completed_at"] is None


def test_creation_with_unknown_metadata_is_rejected() -> None:
    r = client.post(
        "/games",
        headers=_headers(str(uuid.uuid4())),
        json={"game_type": "twenty48", "metadata": {"initial_board": [0] * 16}},
    )
    assert r.status_code == 422


def test_a_kept_playing_completion_from_an_older_build_still_counts() -> None:
    """``kept_playing`` is not an abandon: it ranks as best and is not filtered out."""
    sid = str(uuid.uuid4())
    gid = _start(sid)
    r = client.patch(
        f"/games/{gid}/complete", headers=_headers(sid), json=_CURRENT_COMPLETIONS["keep-playing"]
    )
    assert r.status_code == 200, r.text
    stats = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["twenty48"]
    assert stats["played"] == 1
    assert stats["best"] == 20_480

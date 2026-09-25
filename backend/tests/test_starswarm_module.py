"""Star Swarm GameModule, its models and the payloads the app sends (#2623).

Registering the module turns on metadata and result validation for the
session rows ``useGameSync("starswarm")`` has written since #2516. The payload
replays below mirror ``StarSwarmScreen.tsx`` on ``dev``; a rejection there
would dead-letter the run. The named leaderboard (``POST /starswarm/score``)
is covered by ``test_starswarm_api.py`` and does not use these models.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from db.base import get_session_factory
from db.models import GameEntitlement
from games.board import SCORE_METRIC
from games.protocol import GameModule
from games.registry import get_module
from main import app
from starswarm.models import StarSwarmMetadata, StarSwarmResult
from starswarm.module import module as starswarm_module
from vocab import GameType

client = TestClient(app)

_TIERS = [
    "Ensign",
    "LieutenantJG",
    "Lieutenant",
    "LieutenantCommander",
    "Commander",
    "Captain",
    "RearAdmiral",
    "ViceAdmiral",
    "Admiral",
    "FleetAdmiral",
]


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


# Star Swarm is premium: POST /games needs the entitlement. conftest cleans the
# tables between tests, so the grant is repeated for each one.
_SID = str(uuid.uuid4())


@pytest.fixture(autouse=True)
async def _starswarm_entitlement():
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=_SID, game_slug="starswarm"))
        await db.commit()


# ---------------------------------------------------------------------------
# module + registry
# ---------------------------------------------------------------------------


def test_module_satisfies_the_protocol_and_is_registered() -> None:
    assert isinstance(starswarm_module, GameModule)
    assert starswarm_module.game_type == GameType.STARSWARM
    assert get_module("starswarm") is starswarm_module


def test_models_are_declared_and_separate() -> None:
    assert starswarm_module.metadata_model is StarSwarmMetadata
    assert starswarm_module.result_model is StarSwarmResult


def test_board_is_partitioned_by_difficulty_tier() -> None:
    board = starswarm_module.board
    assert board.metric == SCORE_METRIC
    assert board.direction == "desc"
    assert board.partitions == ("difficulty_tier",)
    assert board.partition_defaults == ()
    assert board.max_value is None
    assert board.qualifying_outcomes is None
    assert board.enabled is True


def test_the_partition_key_survives_result_validation() -> None:
    # complete_game stores model_dump(exclude_unset=True): an undeclared key is lost.
    assert "difficulty_tier" in StarSwarmResult.model_fields


def test_there_is_no_winner() -> None:
    assert starswarm_module.has_winner is False


def test_stats_shape_is_pass_through_without_latest_score() -> None:
    raw = {"played": 2, "best": None, "avg": None, "last_played_at": None, "latest_score": None}
    shaped = starswarm_module.stats_shape(raw)
    assert "latest_score" not in shaped
    assert shaped["played"] == 2


# ---------------------------------------------------------------------------
# models
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("tier", _TIERS)
def test_metadata_accepts_every_tier(tier: str) -> None:
    assert StarSwarmMetadata.model_validate({"difficulty_tier": tier}).difficulty_tier == tier


def test_metadata_forbids_extra_keys() -> None:
    assert StarSwarmMetadata.model_validate({}).model_dump(exclude_unset=True) == {}
    with pytest.raises(ValidationError):
        StarSwarmMetadata.model_validate({"difficulty_tier": "Captain", "wave": 3})


@pytest.mark.parametrize("tier", _TIERS)
def test_current_result_validates_and_keeps_every_key(tier: str) -> None:
    result = {"outcome": "completed", "wave_reached": 7, "difficulty_tier": tier}
    assert StarSwarmResult.model_validate(result).model_dump(exclude_unset=True) == result


def test_result_ignores_unknown_keys_so_a_newer_build_still_completes() -> None:
    dumped = StarSwarmResult.model_validate(
        {"outcome": "completed", "wave_reached": 4, "difficulty_tier": "Ensign", "kills": 90}
    ).model_dump(exclude_unset=True)
    assert dumped == {"outcome": "completed", "wave_reached": 4, "difficulty_tier": "Ensign"}


@pytest.mark.parametrize(
    "bad",
    [{"wave_reached": -1}, {"wave_reached": "ten"}, {"difficulty_tier": "x" * 33}],
    ids=["negative-wave", "wave-not-int", "tier-too-long"],
)
def test_result_rejects_malformed_values(bad: dict) -> None:
    with pytest.raises(ValidationError):
        StarSwarmResult.model_validate(bad)


# ---------------------------------------------------------------------------
# the shared path over HTTP — every current payload is accepted
# ---------------------------------------------------------------------------


def _start(sid: str, tier: str = "LieutenantJG") -> str:
    # beginRun: syncRestart({ difficulty_tier: tier }, { difficulty_tier: tier })
    r = client.post(
        "/games",
        headers=_headers(sid),
        json={"game_type": "starswarm", "metadata": {"difficulty_tier": tier}},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_a_game_over_is_accepted_and_carries_the_partition_key() -> None:
    sid = _SID
    gid = _start(sid, "Captain")
    # handleGameOver: syncComplete({ outcome }, { outcome, wave_reached, difficulty_tier })
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={
            "final_score": None,
            "outcome": "completed",
            "duration_ms": None,
            "result": {"outcome": "completed", "wave_reached": 9, "difficulty_tier": "Captain"},
        },
    )
    assert r.status_code == 200, r.text
    detail = client.get(f"/games/{gid}", headers=_headers(sid)).json()
    assert detail["metadata"] == {
        "outcome": "completed",
        "wave_reached": 9,
        "difficulty_tier": "Captain",
    }
    assert detail["final_score"] is None


def test_the_tier_the_run_was_created_with_wins_over_the_result() -> None:
    sid = _SID
    gid = _start(sid, "Ensign")
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={"outcome": "completed", "result": {"wave_reached": 2, "difficulty_tier": "Admiral"}},
    )
    assert r.status_code == 200, r.text
    metadata = client.get(f"/games/{gid}", headers=_headers(sid)).json()["metadata"]
    assert metadata["difficulty_tier"] == "Ensign"


@pytest.mark.parametrize("result", [{}, None], ids=["empty", "null"])
def test_a_restart_abandon_without_a_result_is_accepted(result) -> None:
    # Star Swarm registers no progress snapshot: the hook's abandon sends no result.
    sid = _SID
    gid = _start(sid)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={"final_score": None, "outcome": "abandoned", "duration_ms": None, "result": result},
    )
    assert r.status_code == 200, r.text


def test_creation_without_metadata_is_accepted() -> None:
    r = client.post("/games", headers=_headers(_SID), json={"game_type": "starswarm"})
    assert r.status_code == 200, r.text


def test_creation_with_unknown_metadata_is_rejected() -> None:
    r = client.post(
        "/games",
        headers=_headers(_SID),
        json={"game_type": "starswarm", "metadata": {"difficulty_tier": "Captain", "wave": 1}},
    )
    assert r.status_code == 422


def test_session_runs_do_not_reach_the_named_leaderboard() -> None:
    sid = _SID
    gid = _start(sid, "Captain")
    client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={"outcome": "completed", "result": {"wave_reached": 9, "difficulty_tier": "Captain"}},
    )
    r = client.get("/starswarm/leaderboard", headers=_headers(sid))
    assert r.status_code == 200, r.text
    assert r.json()["scores"] == []

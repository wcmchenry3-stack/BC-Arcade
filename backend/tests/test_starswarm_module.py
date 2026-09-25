"""Star Swarm GameModule, its models and the payloads the app sends (#2623).

Registering the module turns on metadata and result validation for the
session rows ``useGameSync("starswarm")`` has written since #2516. The payload
replays below mirror ``StarSwarmScreen.tsx`` on ``dev``; a rejection there
would dead-letter the run. The named leaderboard (``POST /starswarm/score``)
is covered by ``test_starswarm_api.py`` and does not use these models.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select

from db.base import get_session_factory
from db.models import Game, GameEntitlement
from db.models import GameType as GameTypeRow
from games.board import SCORE_METRIC
from games.protocol import GameModule
from games.registry import get_module
from main import app
from starswarm.models import (
    DEFAULT_DIFFICULTY_TIER,
    DIFFICULTY_TIERS,
    StarSwarmMetadata,
    StarSwarmResult,
)
from starswarm.module import module as starswarm_module
from starswarm.router import ScoreRequest
from vocab import GameType

client = TestClient(app)

_CLIENT_DIR = Path(__file__).parents[2] / "frontend" / "src" / "game" / "starswarm"


def _engine_tiers() -> list[str]:
    """``DIFFICULTY_TIERS`` in ``engine.ts``: the tiers the picker offers, in order."""
    source = (_CLIENT_DIR / "engine.ts").read_text(encoding="utf-8")
    match = re.search(r"export const DIFFICULTY_TIERS\b[^=]*=\s*\[(.*?)\];", source, re.DOTALL)
    assert match, "DIFFICULTY_TIERS not found in frontend/src/game/starswarm/engine.ts"
    return re.findall(r'"([^"]+)"', match.group(1))


def _type_tiers() -> list[str]:
    """The ``DifficultyTier`` union in ``types.ts``."""
    source = (_CLIENT_DIR / "types.ts").read_text(encoding="utf-8")
    match = re.search(r"export type DifficultyTier\s*=(.*?);", source, re.DOTALL)
    assert match, "DifficultyTier not found in frontend/src/game/starswarm/types.ts"
    return re.findall(r'"([^"]+)"', match.group(1))


# Every tier the current client can send, read from the client itself.
_TIERS = _engine_tiers()


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
    assert board.partition_defaults == (("difficulty_tier", "LieutenantJG"),)
    assert board.partition_values == (("difficulty_tier", DIFFICULTY_TIERS),)
    assert board.max_value is None
    assert board.qualifying_outcomes is None
    assert board.enabled is True


# ---------------------------------------------------------------------------
# the tier allow-list matches the client
# ---------------------------------------------------------------------------


def test_the_allow_list_is_exactly_the_clients_tiers() -> None:
    # engine.ts DIFFICULTY_TIERS is what the picker, the dev panel and the
    # saved-difficulty restore all check against, so it is every value sent.
    assert list(DIFFICULTY_TIERS) == _engine_tiers()
    assert sorted(DIFFICULTY_TIERS) == sorted(_type_tiers())


def test_a_row_without_a_tier_counts_as_the_legacy_default() -> None:
    # POST /starswarm/score defaults a missing tier to LieutenantJG, and so does
    # its leaderboard when it reads a row.
    assert DEFAULT_DIFFICULTY_TIER == "LieutenantJG"
    assert ScoreRequest.model_fields["difficulty_tier"].default == DEFAULT_DIFFICULTY_TIER
    assert ScoreRequest(player_id="A", score=1, wave_reached=1).difficulty_tier == "LieutenantJG"
    assert starswarm_module.board.partition_default("difficulty_tier") == DEFAULT_DIFFICULTY_TIER


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


_FORGED = ["captain", "CAPTAIN", "Cadet", "Captain ", "x" * 33, ""]


@pytest.mark.parametrize("tier", _FORGED)
def test_metadata_rejects_a_tier_the_client_cannot_send(tier: str) -> None:
    with pytest.raises(ValidationError):
        StarSwarmMetadata.model_validate({"difficulty_tier": tier})


@pytest.mark.parametrize("tier", _FORGED)
def test_result_rejects_a_tier_the_client_cannot_send(tier: str) -> None:
    with pytest.raises(ValidationError):
        StarSwarmResult.model_validate({"wave_reached": 3, "difficulty_tier": tier})


def test_a_missing_or_null_tier_is_still_accepted() -> None:
    assert StarSwarmMetadata.model_validate({"difficulty_tier": None}).difficulty_tier is None
    assert StarSwarmResult.model_validate({"wave_reached": 1}).difficulty_tier is None


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


# ---------------------------------------------------------------------------
# every tier the client sends is accepted over HTTP; nothing else is
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("tier", _TIERS)
def test_every_client_tier_is_accepted_at_creation_and_completion(tier: str) -> None:
    gid = _start(_SID, tier)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(_SID),
        json={
            "final_score": None,
            "outcome": "completed",
            "duration_ms": None,
            "result": {"outcome": "completed", "wave_reached": 3, "difficulty_tier": tier},
        },
    )
    assert r.status_code == 200, r.text
    metadata = client.get(f"/games/{gid}", headers=_headers(_SID)).json()["metadata"]
    assert metadata["difficulty_tier"] == tier


def test_creation_with_a_forged_tier_is_rejected() -> None:
    r = client.post(
        "/games",
        headers=_headers(_SID),
        json={"game_type": "starswarm", "metadata": {"difficulty_tier": "captain"}},
    )
    assert r.status_code == 422


def test_completion_with_a_forged_tier_is_rejected() -> None:
    gid = _start(_SID, "Captain")
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(_SID),
        json={"outcome": "completed", "result": {"wave_reached": 2, "difficulty_tier": "Cadet"}},
    )
    assert r.status_code == 400
    assert client.get(f"/games/{gid}", headers=_headers(_SID)).json()["completed_at"] is None


# ---------------------------------------------------------------------------
# an explicit null tier at creation does not override the result's tier
# ---------------------------------------------------------------------------


def test_a_null_creation_tier_takes_the_tier_from_the_result() -> None:
    r = client.post(
        "/games",
        headers=_headers(_SID),
        json={"game_type": "starswarm", "metadata": {"difficulty_tier": None}},
    )
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(_SID),
        json={
            "final_score": 5000,
            "outcome": "completed",
            "result": {"outcome": "completed", "wave_reached": 6, "difficulty_tier": "Captain"},
        },
    )
    assert r.status_code == 200, r.text
    metadata = client.get(f"/games/{gid}", headers=_headers(_SID)).json()["metadata"]
    assert metadata["difficulty_tier"] == "Captain"

    r = client.patch(f"/games/{gid}/name", headers=_headers(_SID), json={"player_name": "Ace"})
    assert r.status_code == 200, r.text
    assert _names(_board("?difficulty_tier=Captain")) == [("Ace", 5000)]
    assert _board("?difficulty_tier=LieutenantJG")["entries"] == []


# ---------------------------------------------------------------------------
# the generic board: default tier and the allow-list
# ---------------------------------------------------------------------------


async def _seed(score: int, name: str, meta: dict) -> None:
    factory = get_session_factory()
    async with factory() as db:
        gt_id = (
            await db.execute(select(GameTypeRow.id).where(GameTypeRow.name == "starswarm"))
        ).scalar_one()
        db.add(
            Game(
                id=uuid.uuid4(),
                session_id=str(uuid.uuid4()),
                game_type_id=gt_id,
                game_metadata={**meta, "player_name": name},
                players=[],
                final_score=score,
                outcome="completed",
                completed_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            )
        )
        await db.commit()


def _board(query: str) -> dict:
    r = client.get(f"/games/leaderboard/starswarm{query}", headers=_headers(_SID))
    assert r.status_code == 200, r.text
    return r.json()


def _names(body: dict) -> list[tuple[str, int]]:
    return [(e["player_name"], e["value"]) for e in body["entries"]]


async def test_a_row_without_a_tier_ranks_on_the_lieutenant_jg_board() -> None:
    await _seed(900, "NoTier", {})
    await _seed(800, "NullTier", {"difficulty_tier": None})
    await _seed(700, "JG", {"difficulty_tier": "LieutenantJG"})
    await _seed(600, "Captain", {"difficulty_tier": "Captain"})

    jg = _board("?difficulty_tier=LieutenantJG")
    assert jg["partition"] == {"difficulty_tier": "LieutenantJG"}
    assert _names(jg) == [("NoTier", 900), ("NullTier", 800), ("JG", 700)]
    # A request without a tier is the default board, as for Sudoku's variant.
    assert _names(_board("")) == _names(jg)
    assert _names(_board("?difficulty_tier=Captain")) == [("Captain", 600)]


@pytest.mark.parametrize("tier", _TIERS)
def test_every_client_tier_has_a_board(tier: str) -> None:
    assert _board(f"?difficulty_tier={tier}")["partition"] == {"difficulty_tier": tier}


@pytest.mark.parametrize("tier", ["captain", "CAPTAIN", "Cadet", "Captain%20", "x" * 33])
def test_a_board_for_a_tier_the_client_cannot_send_is_400(tier: str) -> None:
    r = client.get(f"/games/leaderboard/starswarm?difficulty_tier={tier}", headers=_headers(_SID))
    assert r.status_code == 400, r.text

"""Star Swarm GameModule, its models and the payloads the app sends (#2623).

Registering the module turns on metadata and result validation for the
session rows ``useGameSync("starswarm")`` has written since #2516. The payload
replays below mirror ``StarSwarmScreen.tsx`` on ``dev``; a rejection there
would dead-letter the run.
"""

from __future__ import annotations

import copy
import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select

from db.base import get_session_factory
from db.models import Game, GameEntitlement, Player
from db.models import GameType as GameTypeRow
from games.board import SCORE_METRIC
from games.protocol import GameModule
from games.registry import get_module
from games.sessions import _max_result_bytes
from main import app
from observability import report
from starswarm.models import (
    DEFAULT_DIFFICULTY_TIER,
    DIFFICULTY_TIERS,
    StarSwarmMetadata,
    StarSwarmResult,
)
from starswarm.module import module as starswarm_module
from tests._helpers import session_headers as _headers
from vocab import GameType

client = TestClient(app)

_CLIENT_DIR = Path(__file__).parents[2] / "frontend" / "src" / "game" / "starswarm"


def _engine_tiers() -> list[str]:
    """``DIFFICULTY_TIERS`` in ``engine/tuning.ts``: the tiers the picker offers, in order."""
    source = (_CLIENT_DIR / "engine" / "tuning.ts").read_text(encoding="utf-8")
    match = re.search(r"export const DIFFICULTY_TIERS\b[^=]*=\s*\[(.*?)\];", source, re.DOTALL)
    assert match, "DIFFICULTY_TIERS not found in frontend/src/game/starswarm/engine/tuning.ts"
    return re.findall(r'"([^"]+)"', match.group(1))


def _type_tiers() -> list[str]:
    """The ``DifficultyTier`` union in ``types.ts``."""
    source = (_CLIENT_DIR / "types.ts").read_text(encoding="utf-8")
    match = re.search(r"export type DifficultyTier\s*=(.*?);", source, re.DOTALL)
    assert match, "DifficultyTier not found in frontend/src/game/starswarm/types.ts"
    return re.findall(r'"([^"]+)"', match.group(1))


# Every tier the current client can send, read from the client itself.
_TIERS = _engine_tiers()


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
    # engine/tuning.ts DIFFICULTY_TIERS is what the picker, the dev panel and the
    # saved-difficulty restore all check against, so it is every value sent.
    assert list(DIFFICULTY_TIERS) == _engine_tiers()
    assert sorted(DIFFICULTY_TIERS) == sorted(_type_tiers())


def test_a_row_without_a_tier_counts_as_the_default() -> None:
    # The engine's default tier, which the board uses for a row with none.
    assert DEFAULT_DIFFICULTY_TIER == "LieutenantJG"
    assert starswarm_module.board.partition_default("difficulty_tier") == DEFAULT_DIFFICULTY_TIER


def test_the_partition_key_survives_result_validation() -> None:
    # complete_game stores model_dump(exclude_unset=True): an undeclared key is lost.
    assert "difficulty_tier" in StarSwarmResult.model_fields


def test_there_is_no_winner() -> None:
    assert starswarm_module.has_winner is False


def test_stats_shape_is_pass_through_without_latest_score() -> None:
    raw = {"best": None, "last_played_at": None, "latest_score": None}
    assert starswarm_module.stats_shape(raw) == {"last_played_at": None}


# ---------------------------------------------------------------------------
# models
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("tier", _TIERS)
def test_metadata_accepts_every_tier(tier: str) -> None:
    assert StarSwarmMetadata.model_validate({"difficulty_tier": tier}).difficulty_tier == tier


_FORGED = ["captain", "CAPTAIN", "Cadet", "Captain ", ""]


@pytest.mark.parametrize("tier", _FORGED)
def test_metadata_stores_a_tier_it_cannot_rank(tier: str) -> None:
    """Rejecting it would dead-letter the run; it is kept and never ranks."""
    assert StarSwarmMetadata.model_validate({"difficulty_tier": tier}).difficulty_tier == tier


@pytest.mark.parametrize("tier", _FORGED)
def test_result_stores_a_tier_it_cannot_rank(tier: str) -> None:
    result = StarSwarmResult.model_validate({"wave_reached": 3, "difficulty_tier": tier})
    assert result.difficulty_tier == tier


def test_models_reject_an_overlong_tier() -> None:
    with pytest.raises(ValidationError):
        StarSwarmMetadata.model_validate({"difficulty_tier": "x" * 33})
    with pytest.raises(ValidationError):
        StarSwarmResult.model_validate({"difficulty_tier": "x" * 33})


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


def test_a_run_on_an_unknown_tier_is_kept_but_never_ranks() -> None:
    """A tier the backend doesn't know (a forged value, or one a newer app
    added first) is stored, so the run isn't dead-lettered, but it has no
    board: it never ranks and its board can't be requested."""
    r = client.post(
        "/games",
        headers=_headers(_SID),
        json={"game_type": "starswarm", "metadata": {"difficulty_tier": "Cadet"}},
    )
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(_SID),
        json={
            "final_score": 900,
            "outcome": "completed",
            "result": {"wave_reached": 2, "difficulty_tier": "Cadet"},
        },
    )
    assert r.status_code == 200, r.text
    assert (
        client.get(f"/games/{gid}", headers=_headers(_SID)).json()["metadata"]["difficulty_tier"]
        == "Cadet"
    )

    r = client.get(f"/games/{gid}/rank", headers=_headers(_SID))
    assert r.status_code == 200, r.text
    assert r.json()["reason"] == "not_rankable"
    r = client.get("/games/leaderboard/starswarm?difficulty_tier=Cadet", headers=_headers(_SID))
    assert r.status_code == 400


def test_a_forged_result_tier_does_not_replace_the_creation_tier() -> None:
    gid = _start(_SID, "Captain")
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(_SID),
        json={
            "final_score": 700,
            "outcome": "completed",
            "result": {"wave_reached": 2, "difficulty_tier": "Cadet"},
        },
    )
    assert r.status_code == 200, r.text
    metadata = client.get(f"/games/{gid}", headers=_headers(_SID)).json()["metadata"]
    assert metadata["difficulty_tier"] == "Captain"


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

    r = client.put("/players/me", headers=_headers(_SID))
    assert r.status_code == 200, r.text
    ace = r.json()["display_name"]
    assert _names(_board("?difficulty_tier=Captain")) == [(ace, 5000)]
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
        session_id = str(uuid.uuid4())
        # Boards show the player's display name (#2624).
        db.add(Player(session_id=session_id, display_name=name))
        db.add(
            Game(
                id=uuid.uuid4(),
                session_id=session_id,
                game_type_id=gt_id,
                game_metadata=meta,
                players=[],
                final_score=score,
                outcome="completed",
                completed_at=datetime(2026, 1, 1, tzinfo=UTC),
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


# ---------------------------------------------------------------------------
# #2837: the per-wave score breakdown
# ---------------------------------------------------------------------------

_TIER_IDS = ("Grunt", "Elite", "Guardian", "Carrier")  # the tier ids since #2843 (was "Boss")
_MODS = ("", ":dive", ":rout", ":bomb", ":ram")


def _breakdown(waves: int = 3) -> dict:
    """What ``summarizeScoreLedger`` sends for a short run: ``end`` is the final score."""
    out, running = [], 0
    for w in range(1, waves + 1):
        pts = {"Grunt": 1000 * w, "Elite:dive": 400, "Carrier": 1000, "clear": 500 * w}
        total = sum(pts.values())
        out.append(
            {"wave": w, "start": running, "end": running + total, "total": total, "pts": pts}
        )
        running += total
    return {"v": 1, "waves": out}


_APP_BREAKDOWN_MAX_BYTES = 4096  # BREAKDOWN_MAX_BYTES in scoreLedger.ts


def _worst_case_breakdown(waves: int = 250) -> dict:
    """The app's worst case (mirrors scoreLedger.test.ts): every source on every wave, with
    big numbers (the run's total still fits ``final_score``'s int32 cap), folded oldest-first into ``earlier`` until the block's compact JSON fits the
    app's 4 KiB cap, as ``summarizeScoreLedger`` does. The server measures with
    ``json.dumps``' default separators, which are wider than the app's ``JSON.stringify``."""
    per_wave = [
        {f"{t}{m}": 99_999 + w for t in _TIER_IDS for m in _MODS} | {"clear": 999_999}
        for w in range(1, waves + 1)
    ]

    def build(folded: int) -> dict:
        out: dict = {"v": 1}
        running = 0
        if folded:
            pts: dict[str, int] = {}
            for p in per_wave[:folded]:
                for k, v in p.items():
                    pts[k] = pts.get(k, 0) + v
            running = sum(pts.values())
            out["earlier"] = {"first": 1, "last": folded, "total": running, "pts": pts}
        rows = []
        for i, p in enumerate(per_wave[folded:], start=folded + 1):
            total = sum(p.values())
            rows.append({"wave": i, "start": running, "end": running + total, "total": total})
            rows[-1]["pts"] = p
            running += total
        out["waves"] = rows
        return out

    folded = max(0, waves - 20)  # LEDGER_DETAIL_WAVES
    bd = build(folded)
    while len(json.dumps(bd, separators=(",", ":"))) > _APP_BREAKDOWN_MAX_BYTES:
        folded += 1
        bd = build(folded)
    return bd


def _final(breakdown: dict) -> int:
    return breakdown["waves"][-1]["end"] + breakdown.get("unattributed", 0)


def test_result_keeps_a_score_breakdown() -> None:
    bd = _breakdown()
    result = {"outcome": "completed", "wave_reached": 3, "difficulty_tier": "Ensign"}
    dumped = StarSwarmResult.model_validate({**result, "score_breakdown": bd}).model_dump(
        exclude_unset=True
    )
    assert dumped == {**result, "score_breakdown": bd}


def test_an_older_builds_result_has_no_breakdown() -> None:
    result = {"outcome": "completed", "wave_reached": 3, "difficulty_tier": "Ensign"}
    dumped = StarSwarmResult.model_validate(result).model_dump(exclude_unset=True)
    assert "score_breakdown" not in dumped


def test_breakdown_sources_are_an_open_set() -> None:
    # A renamed tier (Boss -> Guardian, #2843: older builds still send "Boss") or a new modifier
    # is kept, not rejected.
    wave = {"wave": 1, "start": 0, "end": 800, "total": 800}
    wave["pts"] = {"Guardian": 400, "Guardian:bomb": 400}
    bd = {"v": 1, "waves": [wave], "extra": 1}
    kept = StarSwarmResult.model_validate({"score_breakdown": bd}).score_breakdown
    assert kept is not None and kept.waves[0].pts == {"Guardian": 400, "Guardian:bomb": 400}


def _wave(wave: int = 1, pts: object = None) -> dict:
    return {"wave": wave, "start": 0, "end": 1, "total": 1, "pts": {} if pts is None else pts}


@pytest.mark.parametrize(
    "bad",
    [
        {"waves": "nope"},
        {"waves": [_wave(-1)]},
        {"waves": [_wave(pts={"Grunt": "many"})]},
        {"waves": [_wave(pts={"x" * 33: 1})]},
        {"waves": [_wave(pts={f"s{i}": 1 for i in range(49)})]},
        {"waves": [_wave(i) for i in range(65)]},
        "not-an-object",
    ],
    ids=[
        "waves-not-list",
        "negative-wave",
        "points-not-int",
        "long-source",
        "too-many-sources",
        "too-many-waves",
        "not-an-object",
    ],
)
def test_a_malformed_breakdown_is_dropped_and_the_run_still_validates(bad) -> None:
    result = StarSwarmResult.model_validate(
        {
            "outcome": "completed",
            "wave_reached": 4,
            "difficulty_tier": "Captain",
            "score_breakdown": bad,
        }
    )
    assert result.score_breakdown is None
    assert result.wave_reached == 4 and result.difficulty_tier == "Captain"


def test_the_apps_worst_case_breakdown_fits_the_result_limit() -> None:
    result = {
        "outcome": "completed",
        "wave_reached": 250,
        "difficulty_tier": "LieutenantCommander",
        "score_breakdown": _worst_case_breakdown(),
    }
    assert len(json.dumps(result)) < _max_result_bytes()
    assert StarSwarmResult.model_validate(result).score_breakdown is not None


def _complete(gid: str, final_score: int | None, result: dict | None, sid: str = _SID):
    return client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={
            "final_score": final_score,
            "outcome": "completed",
            "duration_ms": None,
            "result": result,
        },
    )


def test_a_completed_run_stores_its_breakdown_and_the_owner_reads_it_back() -> None:
    gid = _start(_SID, "Captain")
    bd = _breakdown(4)
    result = {
        "outcome": "completed",
        "wave_reached": 4,
        "difficulty_tier": "Captain",
        "score_breakdown": bd,
    }
    r = _complete(gid, _final(bd), result)
    assert r.status_code == 200, r.text
    detail = client.get(f"/games/{gid}", headers=_headers(_SID)).json()
    assert detail["final_score"] == _final(bd)
    stored = detail["metadata"]["score_breakdown"]
    assert stored == bd
    # It reconciles: every wave's points sum to its total, and the totals to the score.
    for w in stored["waves"]:
        assert sum(w["pts"].values()) == w["total"] == w["end"] - w["start"]
    assert sum(w["total"] for w in stored["waves"]) == detail["final_score"]
    # The run still ranks on its tier's board.
    r = client.put("/players/me", headers=_headers(_SID))
    assert r.status_code == 200, r.text
    name = r.json()["display_name"]
    assert _names(_board("?difficulty_tier=Captain")) == [(name, _final(bd))]


def test_the_worst_case_breakdown_is_accepted_over_http() -> None:
    gid = _start(_SID)
    bd = _worst_case_breakdown()
    result = {
        "outcome": "completed",
        "wave_reached": 250,
        "difficulty_tier": "LieutenantJG",
        "score_breakdown": bd,
    }
    r = _complete(gid, _final(bd), result)
    assert r.status_code == 200, r.text
    detail = client.get(f"/games/{gid}", headers=_headers(_SID)).json()
    assert detail["metadata"]["score_breakdown"] == bd


def test_a_result_over_the_limit_is_still_rejected() -> None:
    # The limit is not raised for the breakdown: an oversize block fails as before.
    gid = _start(_SID)
    big = {f"source{j}": 10**12 for j in range(20)}
    bd = {"v": 1, "waves": [_wave(i, big) for i in range(40)]}
    r = _complete(gid, 0, {"outcome": "completed", "wave_reached": 40, "score_breakdown": bd})
    assert r.status_code == 400
    assert "too large" in r.text


def test_a_malformed_breakdown_does_not_dead_letter_the_run() -> None:
    gid = _start(_SID, "Ensign")
    result = {
        "outcome": "completed",
        "wave_reached": 2,
        "difficulty_tier": "Ensign",
        "score_breakdown": {"waves": 7},
    }
    r = _complete(gid, 900, result)
    assert r.status_code == 200, r.text
    detail = client.get(f"/games/{gid}", headers=_headers(_SID)).json()
    assert detail["final_score"] == 900
    assert detail["metadata"]["score_breakdown"] is None


def test_a_retried_completion_does_not_double_count() -> None:
    # SyncWorker may PATCH the same queued completion again after a lost response:
    # the first completion wins and the stored breakdown is unchanged.
    gid = _start(_SID)
    bd = _breakdown(2)
    result = {"outcome": "completed", "wave_reached": 2, "score_breakdown": bd}
    assert _complete(gid, _final(bd), result).status_code == 200
    assert _complete(gid, _final(bd), result).status_code == 200
    doubled = {**result, "score_breakdown": _breakdown(4)}
    assert _complete(gid, _final(_breakdown(4)), doubled).status_code == 200
    detail = client.get(f"/games/{gid}", headers=_headers(_SID)).json()
    assert detail["final_score"] == _final(bd)
    assert detail["metadata"]["score_breakdown"] == bd


def test_only_the_owner_can_read_a_runs_breakdown() -> None:
    gid = _start(_SID)
    bd = _breakdown(1)
    r = _complete(gid, _final(bd), {"wave_reached": 1, "score_breakdown": bd})
    assert r.status_code == 200, r.text
    r = client.get(f"/games/{gid}", headers=_headers(str(uuid.uuid4())))
    assert r.status_code == 403
    assert "score_breakdown" not in r.text


# --- invariants, reconciliation and Sentry reporting (#2837 review) ----------


@pytest.fixture
def sentry_messages(monkeypatch) -> list[tuple[str, dict]]:
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        report.sentry_sdk,
        "capture_message",
        lambda message, **kw: calls.append((message, kw)),
    )
    return calls


def _validated(bd: object, context: dict | None = None):
    return StarSwarmResult.model_validate({"score_breakdown": bd}, context=context).score_breakdown


def _with(bd: dict, path: tuple, value: object) -> dict:
    out = copy.deepcopy(bd)
    target = out
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return out


def _folded() -> dict:
    """A breakdown with an ``earlier`` bucket: waves 1-2 folded, 3-4 detailed."""
    bd = _breakdown(4)
    folded = bd["waves"][:2]
    pts: dict[str, int] = {}
    for w in folded:
        for k, v in w["pts"].items():
            pts[k] = pts.get(k, 0) + v
    earlier = {"first": 1, "last": 2, "total": sum(pts.values()), "pts": pts}
    return {"v": 1, "earlier": earlier, "waves": bd["waves"][2:]}


@pytest.mark.parametrize(
    "context", [None, {}, {"final_score": None}], ids=["none", "empty", "null"]
)
def test_a_consistent_breakdown_is_kept_without_a_final_score(context, sentry_messages) -> None:
    assert _validated(_breakdown(3), context) is not None
    assert _validated(_folded(), context) is not None
    assert sentry_messages == []


def test_a_breakdown_that_reconciles_with_the_final_score_is_kept(sentry_messages) -> None:
    bd = _folded()
    assert _validated(bd, {"final_score": _final(bd)}) is not None
    with_gap = {**bd, "unattributed": 50}
    assert _validated(with_gap, {"final_score": _final(bd) + 50}) is not None


def test_a_breakdown_that_does_not_reconcile_is_dropped(sentry_messages) -> None:
    bd = _breakdown(2)
    assert _validated(bd, {"final_score": _final(bd) + 1}) is None
    assert _validated({**bd, "unattributed": 5}, {"final_score": _final(bd)}) is None
    reasons = [kw["fingerprint"][1] for _, kw in sentry_messages]
    assert reasons == ["breakdown_unreconciled", "breakdown_unreconciled"]


def _mutations() -> list[tuple[str, dict]]:
    bd = _breakdown(3)
    f = _folded()
    w0 = bd["waves"][0]
    return [
        ("end-start-not-total", _with(bd, ("waves", 0, "end"), w0["end"] + 1)),
        ("total-not-sum", _with(_with(bd, ("waves", 0, "total"), 1), ("waves", 0, "end"), 1)),
        ("start-not-previous-end", _with(bd, ("waves", 1, "start"), 0)),
        ("first-wave-not-at-zero", _with(bd, ("waves", 0, "start"), 7)),
        ("not-ascending", _with(bd, ("waves", 1, "wave"), 1)),
        ("earlier-first-after-last", _with(f, ("earlier", "first"), 9)),
        ("earlier-total-not-sum", _with(f, ("earlier", "total"), 1)),
        ("wave-not-after-earlier", _with(f, ("waves", 0, "start"), 0)),
        ("wave-inside-earlier", _with(f, ("waves", 0, "wave"), 2)),
    ]


@pytest.mark.parametrize("bd", [m[1] for m in _mutations()], ids=[m[0] for m in _mutations()])
def test_an_inconsistent_breakdown_is_dropped_and_reported(bd, sentry_messages) -> None:
    assert _validated(bd) is None
    assert len(sentry_messages) == 1
    _message, kw = sentry_messages[0]
    assert kw["level"] == "warning"
    assert kw["fingerprint"] == ["starswarm-result-breakdown-dropped", "breakdown_inconsistent"]
    assert kw["extras"]["fields"].startswith("score_breakdown")


@pytest.mark.parametrize(
    "path,value",
    [
        (("waves", 0, "pts", "Grunt"), -1000),
        (("waves", 0, "pts", "Grunt"), True),
        (("waves", 0, "pts", "Grunt"), 1000.0),
        (("waves", 0, "total"), "2900"),
        (("waves", 0, "wave"), 1.0),
        (("unattributed",), 1.5),
    ],
    ids=["negative-points", "bool", "float", "numeric-string", "float-wave", "float-gap"],
)
def test_breakdown_numbers_are_strict_non_negative_ints(path, value, sentry_messages) -> None:
    assert _validated(_with(_breakdown(1), path, value)) is None
    _message, kw = sentry_messages[0]
    assert kw["fingerprint"] == ["starswarm-result-breakdown-dropped", "invalid"]


def test_the_drop_report_carries_field_paths_and_types_but_no_values(
    sentry_messages, caplog
) -> None:
    secret = 987_654_321
    bd = _with(_breakdown(1), ("waves", 0, "pts", "Grunt"), -secret)
    assert _validated(bd) is None
    _message, kw = sentry_messages[0]
    assert kw["extras"]["fields"] == "score_breakdown.waves.0.pts.Grunt"
    assert kw["extras"]["error_types"] == ["greater_than_equal"]
    assert str(secret) not in repr(sentry_messages)
    assert "score_breakdown.waves.0.pts.Grunt [greater_than_equal]" in caplog.text


def test_a_top_level_type_error_names_the_field_in_the_log(sentry_messages, caplog) -> None:
    assert _validated("not-an-object") is None
    assert "score_breakdown [model_type]" in caplog.text


def test_a_kept_breakdown_with_unattributed_points_is_reported(sentry_messages) -> None:
    bd = {**_breakdown(2), "unattributed": 40}
    kept = _validated(bd, {"final_score": _final(bd)})
    assert kept is not None and kept.unattributed == 40
    assert [kw["fingerprint"] for _, kw in sentry_messages] == [
        ["starswarm-result-breakdown-dropped", "unattributed"]
    ]


def test_an_inconsistent_breakdown_does_not_fail_the_completion(sentry_messages) -> None:
    gid = _start(_SID)
    bd = _with(_breakdown(2), ("waves", 1, "start"), 0)
    r = _complete(gid, 1234, {"outcome": "completed", "wave_reached": 2, "score_breakdown": bd})
    assert r.status_code == 200, r.text
    detail = client.get(f"/games/{gid}", headers=_headers(_SID)).json()
    assert detail["final_score"] == 1234
    assert detail["metadata"]["score_breakdown"] is None


def test_a_breakdown_that_disagrees_with_the_body_score_is_dropped_over_http(
    sentry_messages,
) -> None:
    # _validate_result passes the PATCH body's final_score as validation context.
    gid = _start(_SID)
    bd = _breakdown(2)
    result = {"outcome": "completed", "wave_reached": 2, "score_breakdown": bd}
    r = _complete(gid, _final(bd) + 100, result)
    assert r.status_code == 200, r.text
    detail = client.get(f"/games/{gid}", headers=_headers(_SID)).json()
    assert detail["final_score"] == _final(bd) + 100
    assert detail["metadata"]["score_breakdown"] is None
    assert [kw["fingerprint"][1] for _, kw in sentry_messages] == ["breakdown_unreconciled"]

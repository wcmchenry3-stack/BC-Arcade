"""Cascade's time bonus and result contract (#3700).

- ``cascade.time_bonus``: the formula, against the fixture the app's display
  copy also reads (``tests/fixtures/cascade_time_bonus.json``).
- ``CascadeResult``: the server fields (``time_bonus``, ``bonus_rule``, ``won``,
  ``outcome``, ``final_score``) come from the completion's own outcome and
  duration, never the app's copies; unknown keys are ignored.
- ``CascadeModule.derive_final_score``: merge score + time bonus, overwriting
  the sent score; old builds (no ``merge_score``) and abandons keep theirs.
- End to end: ``PATCH /games/{id}/complete`` stores it, and the board ranks by
  the stored score, old rows included.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select

from cascade.models import MAX_TIER, CascadeResult
from cascade.module import module as cascade_module
from cascade.time_bonus import BONUS_MAX, BONUS_RULE, MIN_WIN_MS, PAR_TIME_MS, time_bonus
from db.base import get_session_factory
from db.models import Game, GameEntitlement, GameType, Player
from tests._helpers import session_headers as _headers

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "cascade_time_bonus.json").read_text(encoding="utf-8")
)

_live = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)

# A finished game's block as the app sends it (resultBlock.ts), with the app's
# own (display-only) bonus copy.
APP_BLOCK: dict[str, Any] = {
    "final_score": 20_417,
    "merge_score": 8_000,
    "time_bonus": 12_417,
    "bonus_rule": 2,
    "duration_ms": 211_000,
    "theme": "fruits",
    "total_drops": 188,
    "total_merges": 170,
    "max_tier": 11,
    "won": True,
    "outcome": "win",
}


def _validate(
    block: dict[str, Any], outcome: str | None, duration_ms: int | None
) -> dict[str, Any]:
    """The block as ``_validate_result`` stores it for this completion."""
    context = {
        "final_score": block.get("final_score"),
        "outcome": outcome,
        "duration_ms": duration_ms,
    }
    return CascadeResult.model_validate(block, context=context).model_dump(exclude_unset=True)


# ---------------------------------------------------------------------------
# The formula
# ---------------------------------------------------------------------------


def test_the_rule_matches_the_owner_decision_and_the_fixture() -> None:
    assert (BONUS_MAX, PAR_TIME_MS, MIN_WIN_MS, BONUS_RULE) == (30_000, 360_000, 20_000, 2)
    assert FIXTURE["rule"] == {
        "bonus_rule": BONUS_RULE,
        "bonus_max": BONUS_MAX,
        "par_time_ms": PAR_TIME_MS,
        "min_win_ms": MIN_WIN_MS,
    }


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["id"] for c in FIXTURE["cases"]])
def test_time_bonus_matches_the_shared_fixture(case: dict[str, Any]) -> None:
    assert time_bonus(case["outcome"], case["duration_ms"]) == case["bonus"]


@pytest.mark.parametrize(
    "outcome,duration_ms,expected",
    [
        ("win", 0, 0),  # t = 0: under the floor
        ("win", MIN_WIN_MS - 1, 0),  # just under the floor
        ("win", MIN_WIN_MS, 28_333),  # at the floor
        ("win", 211_000, 12_417),  # the 11-tier sim's median win
        ("win", PAR_TIME_MS, 0),  # t = T
        ("win", PAR_TIME_MS * 2, 0),  # t > T
        ("loss", 60_000, 0),
        ("win", None, 0),  # no duration
    ],
)
def test_time_bonus(outcome: str, duration_ms: int | None, expected: int) -> None:
    assert time_bonus(outcome, duration_ms) == expected


def test_time_bonus_rounds_half_up_like_the_app() -> None:
    # 30,000 × 6 / 360,000 = 0.5 exactly: Python's round() would give 0 (rule 2, #3967).
    assert time_bonus("win", PAR_TIME_MS - 6) == 1


def test_time_bonus_never_rises_as_the_win_slows() -> None:
    bonuses = [time_bonus("win", t) for t in range(MIN_WIN_MS, PAR_TIME_MS + 1, 997)]
    assert bonuses == sorted(bonuses, reverse=True)


# ---------------------------------------------------------------------------
# CascadeResult
# ---------------------------------------------------------------------------


def test_the_server_recomputes_the_bonus_and_ignores_the_apps() -> None:
    forged = {**APP_BLOCK, "time_bonus": 1_000_000, "bonus_rule": 99, "final_score": 999_999}
    stored = _validate(forged, "win", 211_000)
    assert stored["time_bonus"] == 12_417
    assert stored["bonus_rule"] == BONUS_RULE
    assert stored["final_score"] == 8_000 + 12_417


def test_the_bonus_reads_the_completions_duration_not_the_blocks() -> None:
    # The block claims a fast win; the completion's duration_ms (the column) says 5 minutes.
    stored = _validate({**APP_BLOCK, "duration_ms": 25_000}, "win", 300_000)
    assert stored["time_bonus"] == time_bonus("win", 300_000)


@pytest.mark.parametrize("duration_ms", [None, 0, 1_000, MIN_WIN_MS - 1])
def test_a_win_under_the_floor_or_with_no_time_is_stored_with_no_bonus(
    duration_ms: int | None,
) -> None:
    stored = _validate(APP_BLOCK, "win", duration_ms)
    assert stored["time_bonus"] == 0
    assert stored["won"] is True
    assert stored["final_score"] == 8_000


def test_a_loss_earns_no_bonus_whatever_the_app_claims() -> None:
    stored = _validate({**APP_BLOCK, "won": True, "outcome": "win"}, "loss", 60_000)
    assert stored["time_bonus"] == 0
    assert stored["won"] is False
    assert stored["outcome"] == "loss"
    assert stored["final_score"] == 8_000


def test_won_and_outcome_follow_the_completion() -> None:
    stored = _validate({**APP_BLOCK, "won": False, "outcome": "loss"}, "win", 211_000)
    assert (stored["won"], stored["outcome"]) == (True, "win")


def test_an_abandon_keeps_its_sent_score_and_no_outcome_key() -> None:
    block = {k: v for k, v in APP_BLOCK.items() if k not in ("outcome", "won")}
    block["final_score"] = 8_000
    stored = _validate(block, "abandoned", 211_000)
    assert stored["time_bonus"] == 0
    assert stored["won"] is False
    assert "outcome" not in stored
    assert stored["final_score"] == 8_000


def test_unknown_keys_are_ignored_not_rejected() -> None:
    stored = _validate({**APP_BLOCK, "combo_peak": 7, "capstone": "fruits"}, "win", 211_000)
    assert "combo_peak" not in stored
    assert "capstone" not in stored


def test_a_block_from_before_3700_gets_no_server_bonus_fields() -> None:
    old = {
        "final_score": 4_321,
        "duration_ms": 90_000,
        "theme": "cosmos",
        "total_drops": 80,
        "total_merges": 60,
        "outcome": "completed",
    }
    stored = _validate(old, "completed", 90_000)
    assert "time_bonus" not in stored
    assert "bonus_rule" not in stored
    assert stored["final_score"] == 4_321
    assert "outcome" not in stored  # the column holds it


@pytest.mark.parametrize(
    "field,value",
    [("max_tier", 12), ("max_tier", -1), ("merge_score", -5), ("merge_score", "lots")],
)
def test_a_malformed_app_field_is_rejected(field: str, value: Any) -> None:
    with pytest.raises(ValidationError):
        _validate({**APP_BLOCK, field: value}, "win", 211_000)


def test_the_capstone_tier_is_the_highest_max_tier() -> None:
    """#3975: the 12-tier ladder's capstone is tier 11; a tier-12 ``max_tier`` is rejected."""
    assert MAX_TIER == 11
    assert _validate({**APP_BLOCK, "max_tier": 11}, "win", 211_000)["max_tier"] == 11
    assert _validate({**APP_BLOCK, "max_tier": 10}, "loss", 211_000)["max_tier"] == 10
    with pytest.raises(ValidationError):
        _validate({**APP_BLOCK, "max_tier": MAX_TIER + 1}, "win", 211_000)


def test_a_malformed_server_field_from_the_app_is_dropped_not_rejected() -> None:
    stored = _validate({**APP_BLOCK, "time_bonus": "huge", "bonus_rule": None}, "win", 211_000)
    assert (stored["time_bonus"], stored["bonus_rule"]) == (12_417, BONUS_RULE)


@pytest.mark.parametrize("merge", ["5000", True], ids=["string", "bool"])
def test_a_coerced_merge_score_scores_the_block_and_the_column_alike(merge: Any) -> None:
    # Review on #3926: the bonus is worked out from the typed merge score, after validation.
    stored = _validate({**APP_BLOCK, "merge_score": merge}, "win", 211_000)
    column = cascade_module.derive_final_score(999, "win", stored)
    assert stored["merge_score"] == int(merge)
    assert stored["final_score"] == column == int(merge) + 12_417


def test_a_null_merge_score_writes_no_bonus_and_keeps_the_sent_score() -> None:
    big = 2_000_000_000
    stored = _validate({**APP_BLOCK, "merge_score": None, "final_score": big}, "win", 211_000)
    assert "time_bonus" not in stored
    assert "bonus_rule" not in stored
    assert stored["final_score"] == cascade_module.derive_final_score(big, "win", stored) == big


@pytest.mark.parametrize("duration_ms", [-5_000, 12.5, "soon", True, 2**31])
def test_a_bad_block_duration_is_dropped_not_rejected(duration_ms: Any) -> None:
    # Builds before #3738 could send a negative play time after the device clock was set back.
    old = {"final_score": 4_321, "duration_ms": duration_ms, "theme": "fruits"}
    stored = _validate(old, "completed", 90_000)
    assert "duration_ms" not in stored
    assert stored["final_score"] == 4_321
    assert cascade_module.derive_final_score(4_321, "completed", stored) == 4_321


def test_a_whole_float_block_duration_is_kept() -> None:
    stored = _validate({**APP_BLOCK, "duration_ms": 211_000.0}, "win", 211_000)
    assert stored["duration_ms"] == 211_000


def test_the_score_is_clamped_to_the_int32_column() -> None:
    top = 2**31 - 1
    stored = _validate({**APP_BLOCK, "merge_score": top - 5}, "win", 211_000)
    assert stored["final_score"] == top
    assert cascade_module.derive_final_score(None, "win", stored) == top


# ---------------------------------------------------------------------------
# derive_final_score
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "sent,outcome,result,expected",
    [
        # A finished game: merge score + the server's bonus, whatever was sent.
        (999_999, "win", {"merge_score": 8_000, "time_bonus": 12_417}, 20_417),
        (None, "win", {"merge_score": 8_000, "time_bonus": 12_417}, 20_417),
        (8_000, "loss", {"merge_score": 8_000, "time_bonus": 0}, 8_000),
        (123, "loss", {"merge_score": 8_000, "time_bonus": 0}, 8_000),
        # Old builds (no merge_score): the sent score, no bonus.
        (4_321, "completed", {"total_drops": 80}, 4_321),
        (4_321, "win", {}, 4_321),
        (None, "loss", {}, None),
        # An abandon is stored as sent.
        (2_500, "abandoned", {"merge_score": 8_000, "time_bonus": 0}, 2_500),
        # Never over the column's top (2³¹−1).
        (None, "win", {"merge_score": 2**31 - 1, "time_bonus": 20_000}, 2**31 - 1),
    ],
)
def test_derive_final_score(
    sent: int | None, outcome: str, result: dict[str, Any], expected: int | None
) -> None:
    assert cascade_module.derive_final_score(sent, outcome, result) == expected


# ---------------------------------------------------------------------------
# End to end: the stored row and the board
# ---------------------------------------------------------------------------

T0 = datetime(2026, 1, 1, tzinfo=UTC)


async def _grant(sid: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=sid, game_slug="cascade"))
        await db.commit()


def _create(client: TestClient, sid: str) -> str:
    r = client.post("/games", headers=_headers(sid), json={"game_type": "cascade", "metadata": {}})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _stored(game_id: str) -> Game:
    factory = get_session_factory()
    async with factory() as db:
        return (await db.execute(select(Game).where(Game.id == uuid.UUID(game_id)))).scalar_one()


async def _seed(name: str, score: int, meta: dict[str, Any], minutes: int) -> None:
    """One finished Cascade row from a named player, inserted directly."""
    factory = get_session_factory()
    async with factory() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == "cascade"))
        ).scalar_one()
        sid = str(uuid.uuid4())
        db.add(Player(session_id=sid, display_name=name))
        db.add(
            Game(
                id=uuid.uuid4(),
                session_id=sid,
                game_type_id=gt_id,
                game_metadata=meta,
                players=[],
                final_score=score,
                duration_ms=meta.get("duration_ms"),
                outcome=meta.get("outcome", "completed"),
                started_at=T0 + timedelta(minutes=minutes) - timedelta(seconds=30),
                completed_at=T0 + timedelta(minutes=minutes),
            )
        )
        await db.commit()


@_live
async def test_complete_stores_the_server_score_and_block(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid)
    gid = _create(client, sid)
    forged = {**APP_BLOCK, "time_bonus": 50_000, "final_score": 58_000}
    body = {"outcome": "win", "final_score": 58_000, "duration_ms": 211_000, "result": forged}
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    row = await _stored(gid)
    assert row.final_score == 8_000 + 12_417
    assert row.game_metadata["time_bonus"] == 12_417
    assert row.game_metadata["bonus_rule"] == BONUS_RULE
    assert row.game_metadata["final_score"] == 8_000 + 12_417
    assert row.game_metadata["won"] is True
    assert row.game_metadata["max_tier"] == 11


@_live
async def test_a_one_second_win_is_stored_not_rejected(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid)
    gid = _create(client, sid)
    body = {"outcome": "win", "final_score": 28_000, "duration_ms": 1_000, "result": APP_BLOCK}
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    row = await _stored(gid)
    assert (row.final_score, row.game_metadata["time_bonus"]) == (8_000, 0)


@_live
async def test_a_negative_block_duration_from_an_old_build_is_accepted(client: TestClient) -> None:
    """Builds before #3738 could send a negative play time (device clock set back): a 400
    would dead-letter the game, so the bad block value is dropped and the score kept."""
    sid = str(uuid.uuid4())
    await _grant(sid)
    gid = _create(client, sid)
    old = {"final_score": 4_321, "duration_ms": -12_000, "theme": "fruits", "outcome": "completed"}
    body = {"outcome": "completed", "final_score": 4_321, "result": old}
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    row = await _stored(gid)
    assert row.final_score == 4_321
    assert "duration_ms" not in row.game_metadata


@_live
async def test_a_null_merge_score_stores_the_sent_score_with_no_bonus(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid)
    gid = _create(client, sid)
    big = 2_000_000_000
    block = {**APP_BLOCK, "merge_score": None, "final_score": big}
    body = {"outcome": "win", "final_score": big, "duration_ms": 211_000, "result": block}
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    row = await _stored(gid)
    assert row.final_score == row.game_metadata["final_score"] == big
    assert "bonus_rule" not in row.game_metadata
    assert "time_bonus" not in row.game_metadata


@_live
async def test_an_old_build_completion_keeps_its_score(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid)
    gid = _create(client, sid)
    old = {"final_score": 4_321, "duration_ms": 90_000, "theme": "fruits", "outcome": "completed"}
    body = {"outcome": "completed", "final_score": 4_321, "duration_ms": 90_000, "result": old}
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    row = await _stored(gid)
    assert row.final_score == 4_321
    assert "time_bonus" not in row.game_metadata


@_live
async def test_the_board_ranks_by_score_with_old_rows_alongside(client: TestClient) -> None:
    tag = uuid.uuid4().hex[:6]
    fast_win = f"Fast{tag}"
    slow_win = f"Slow{tag}"
    old_row = f"Old{tag}"
    loss = f"Loss{tag}"
    await _seed(slow_win, 9_000, {"merge_score": 9_000, "time_bonus": 0}, minutes=1)
    await _seed(fast_win, 20_417, {"merge_score": 8_000, "time_bonus": 12_417}, minutes=2)
    await _seed(old_row, 12_000, {"duration_ms": 90_000}, minutes=3)  # before #3700
    await _seed(loss, 8_500, {"merge_score": 8_500, "outcome": "loss"}, minutes=4)
    viewer = str(uuid.uuid4())
    await _grant(viewer)  # Cascade is premium: its board needs an entitled session
    r = client.get("/games/leaderboard/cascade", headers=_headers(viewer))
    assert r.status_code == 200, r.text
    ours = [
        (e["player_name"], e["value"])
        for e in r.json()["entries"]
        if e["player_name"] in {fast_win, slow_win, old_row, loss}
    ]
    # Score desc: a fast win's bonus puts it over a slower win with more merges, and a row from
    # before #3700 ranks by its score among them.
    assert ours == [
        (fast_win, 20_417),
        (old_row, 12_000),
        (slow_win, 9_000),
        (loss, 8_500),
    ]

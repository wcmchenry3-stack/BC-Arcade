"""Hearts result block: per-hand scores persisted with the game (#2838)."""

from __future__ import annotations

import os
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory
from db.models import GameEntitlement
from hearts.models import HeartsResult
from hearts.module import module

# Hand 2 is a moon shot by seat 2 (0 for the shooter, 26 for each opponent).
HANDS = [[10, 5, 8, 3], [26, 26, 0, 26], [9, 4, 6, 7]]
TOTALS = [45, 35, 14, 36]
BASE = {"final_score": 55, "vs_result": "loss"}
GOOD = {**BASE, "hand_scores": HANDS, "final_scores": TOTALS, "human_seat": 0}
KEYS = ("hand_scores", "final_scores", "human_seat")


def _dump(result: dict[str, Any]) -> dict[str, Any]:
    return HeartsResult.model_validate(result).model_dump(exclude_unset=True)


def test_module_uses_the_result_model() -> None:
    assert module.result_model is HeartsResult


def test_a_reconciling_breakdown_is_kept_with_moon_rows() -> None:
    out = _dump(GOOD)
    assert out == GOOD
    assert out["hand_scores"][1] == [26, 26, 0, 26]


@pytest.mark.parametrize(
    "result",
    [
        {"final_score": 54, "vs_result": "win"},
        {"hands_played": 3},
        {},
    ],
    ids=["old build", "abandon", "empty"],
)
def test_old_payloads_validate_unchanged(result: dict[str, Any]) -> None:
    assert _dump(result) == result


def test_unknown_keys_pass_through() -> None:
    assert _dump({**GOOD, "future": 1})["future"] == 1


def _bad_cases() -> dict[str, dict[str, Any]]:
    return {
        "sum mismatch": {**GOOD, "final_scores": [45, 35, 14, 37]},
        "wrong seats": {**GOOD, "final_scores": [45, 35, 14]},
        "short row": {**GOOD, "hand_scores": [[10, 5, 8], *HANDS[1:]]},
        "delta over 26": {**GOOD, "hand_scores": [[27, 5, 8, 3], *HANDS[1:]]},
        "negative": {**GOOD, "hand_scores": [[-1, 5, 8, 3], *HANDS[1:]]},
        "not a list": {**GOOD, "hand_scores": "nope"},
        "bool": {**GOOD, "hand_scores": [[True, 5, 8, 3], *HANDS[1:]]},
        "no hands": {**GOOD, "hand_scores": [], "final_scores": [0, 0, 0, 0]},
        "too many hands": {**GOOD, "hand_scores": [[0, 0, 0, 0]] * 61},
        "bad seat": {**GOOD, "human_seat": 4},
        "missing seat": {k: v for k, v in GOOD.items() if k != "human_seat"},
        "score not 100-human": {**GOOD, "final_score": 54},
    }


@pytest.mark.parametrize("name", list(_bad_cases()))
def test_a_malformed_breakdown_is_dropped_never_rejected(name: str) -> None:
    out = _dump(_bad_cases()[name])
    assert not any(k in out for k in KEYS)
    # The rest of the result survives, so the completion still lands.
    assert out["vs_result"] == "loss"


def test_a_partial_breakdown_is_dropped_whole() -> None:
    assert not any(k in _dump({**BASE, "hand_scores": HANDS}) for k in KEYS)


# ---------------------------------------------------------------------------
# API (needs the database)
# ---------------------------------------------------------------------------

needs_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


@pytest.fixture()
def client():
    from main import app

    with TestClient(app) as c:
        yield c


async def _entitled_sid() -> str:
    sid = str(uuid.uuid4())
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=sid, game_slug="hearts"))
        await db.commit()
    return sid


def _finish(client: TestClient, sid: str, result: dict[str, Any], outcome: str = "loss") -> str:
    r = client.post(
        "/games",
        headers=_headers(sid),
        json={"game_type": "hearts", "metadata": {"ai_difficulty": "mixed"}},
    )
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    body = {"outcome": outcome, "final_score": result.get("final_score"), "result": result}
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    return gid


@needs_db
async def test_the_owner_reads_the_hand_history_back(client: TestClient) -> None:
    sid = await _entitled_sid()
    gid = _finish(client, sid, GOOD)
    detail = client.get(f"/games/{gid}", headers=_headers(sid))
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["final_score"] == 55
    meta = body["metadata"]
    assert meta["hand_scores"] == HANDS
    assert meta["final_scores"] == TOTALS
    assert meta["human_seat"] == 0
    assert meta["ai_difficulty"] == "mixed"


@needs_db
async def test_another_session_cannot_read_it(client: TestClient) -> None:
    sid = await _entitled_sid()
    gid = _finish(client, sid, GOOD)
    other = client.get(f"/games/{gid}", headers=_headers(str(uuid.uuid4())))
    assert other.status_code in (403, 404)


@needs_db
async def test_an_old_build_completion_still_lands(client: TestClient) -> None:
    sid = await _entitled_sid()
    gid = _finish(client, sid, {"final_score": 54, "vs_result": "win"}, "win")
    body = client.get(f"/games/{gid}", headers=_headers(sid)).json()
    assert body["final_score"] == 54
    assert "hand_scores" not in body["metadata"]


@needs_db
async def test_a_bad_breakdown_still_completes_the_game(client: TestClient) -> None:
    sid = await _entitled_sid()
    gid = _finish(client, sid, {**GOOD, "final_scores": [1, 2, 3, 4]})
    body = client.get(f"/games/{gid}", headers=_headers(sid)).json()
    assert body["final_score"] == 55
    assert body["completed_at"] is not None
    assert "hand_scores" not in body["metadata"]


@needs_db
async def test_an_abandon_keeps_only_hands_played(client: TestClient) -> None:
    sid = await _entitled_sid()
    gid = _finish(client, sid, {"hands_played": 2}, "abandoned")
    body = client.get(f"/games/{gid}", headers=_headers(sid)).json()
    assert body["metadata"]["hands_played"] == 2
    assert "hand_scores" not in body["metadata"]

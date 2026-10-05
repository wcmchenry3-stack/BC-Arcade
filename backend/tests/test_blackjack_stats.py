"""Blackjack runs record win / loss / abandoned, and /stats/me counts them (#2628).

A run that reached its goal records ``win``, a run whose chips ran out before
the goal ``loss``, and a run left before the goal ``abandoned``. The run
summary is in ``extras`` only (the deprecated top-level aliases went in #2644).
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from blackjack.module import module as blackjack_module
from db.base import get_session_factory
from db.models import Game, GameEntitlement, GameType
from games.board import MAX_BOARD_VALUE
from tests._helpers import session_headers as _headers

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)

# Every figure stats_shape() puts in extras. The deprecated top-level aliases
# of the same names were removed in #2644.
_EXTRAS_KEYS = {
    "best_chips",
    "current_chips",
    "best_run_chips",
    "total_runs",
    "runs_completed",
    "current_table",
}


async def _grant_blackjack(sid: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=sid, game_slug="blackjack"))
        await db.commit()


def _play_run(
    client: TestClient,
    sid: str,
    *,
    outcome: str,
    final_chips: int,
    metadata: dict,
    final_score: int | None = None,
    expect_status: int = 200,
) -> str:
    """One run as the app sends it: create with the run aggregates, then complete.

    Returns the game id.
    """
    r = client.post(
        "/games",
        headers=_headers(sid),
        json={"game_type": "blackjack", "metadata": metadata},
    )
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    body: dict = {
        "outcome": outcome,
        "duration_ms": 60_000,
        "result": {
            "hands_won": 3,
            "hands_played": 5,
            "starting_chips": 1000,
            "final_chips": final_chips,
        },
    }
    if final_score is not None:
        body["final_score"] = final_score
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == expect_status, r.text
    return gid


def test_blackjack_has_a_winner() -> None:
    assert blackjack_module.has_winner is True


async def test_stats_me_counts_blackjack_wins_and_losses(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant_blackjack(sid)
    meta = {"best_run_chips": None, "total_runs": 0, "runs_completed": 0}
    _play_run(client, sid, outcome="win", final_chips=2600, metadata=meta)
    _play_run(
        client,
        sid,
        outcome="win",
        final_chips=0,  # reached the goal, kept playing, then ran out
        metadata={**meta, "total_runs": 1, "runs_completed": 1, "best_run_chips": 2600},
    )
    _play_run(
        client,
        sid,
        outcome="loss",
        final_chips=0,
        metadata={**meta, "total_runs": 2, "runs_completed": 2, "best_run_chips": 2600},
    )
    _play_run(
        client,
        sid,
        outcome="abandoned",
        final_chips=800,
        metadata={
            "best_run_chips": 2600,
            "total_runs": 3,
            "runs_completed": 2,
            "current_table": "intermediate",
        },
    )

    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["sessions"] == 4
    assert bj["completed"] == 3
    assert (bj["won"], bj["lost"], bj["tied"]) == (2, 1, 0)
    # The loss ended the two-win streak; the abandon neither extends nor breaks it.
    assert (bj["current_win_streak"], bj["best_win_streak"]) == (0, 2)

    # The run summary lives in extras (from the newest run's metadata)...
    assert set(bj["extras"]) == _EXTRAS_KEYS
    assert bj["extras"]["best_run_chips"] == 2600
    assert bj["extras"]["total_runs"] == 3
    assert bj["extras"]["runs_completed"] == 2
    assert bj["extras"]["current_table"] == "intermediate"
    # ...and only there: the deprecated top-level aliases are gone (#2644).
    assert _EXTRAS_KEYS.isdisjoint(bj)
    assert {"played", "best", "avg"}.isdisjoint(bj)


async def test_stats_me_blackjack_extras_carry_chips_when_a_score_is_sent(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    await _grant_blackjack(sid)
    meta = {"best_run_chips": 2600, "total_runs": 4, "runs_completed": 2}
    _play_run(client, sid, outcome="win", final_chips=2700, metadata=meta, final_score=2700)
    _play_run(client, sid, outcome="loss", final_chips=0, metadata=meta, final_score=0)

    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["extras"]["best_chips"] == 2700
    assert bj["extras"]["current_chips"] == 0
    assert (bj["won"], bj["lost"]) == (1, 1)


async def test_pre_2628_completed_runs_are_not_wins(client: TestClient) -> None:
    """Installed builds before #2628 still send ``completed``: no winner."""
    sid = str(uuid.uuid4())
    await _grant_blackjack(sid)
    _play_run(client, sid, outcome="completed", final_chips=0, metadata={})

    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["sessions"] == 1
    assert bj["completed"] == 1
    assert bj["won"] is None
    assert bj["lost"] is None
    assert bj["current_win_streak"] is None


# ---------------------------------------------------------------------------
# #2745 — a finished run's score is its closing chips
# ---------------------------------------------------------------------------


async def _stored_final_score(gid: str) -> int | None:
    factory = get_session_factory()
    async with factory() as db:
        return (
            await db.execute(select(Game.final_score).where(Game.id == uuid.UUID(gid)))
        ).scalar_one()


async def test_finished_run_without_final_score_scores_its_closing_chips(
    client: TestClient,
) -> None:
    """Installed builds, offline-queued completions and the unmount/kill "win"
    path send only ``result.final_chips``; Best and the stored score use it."""
    sid = str(uuid.uuid4())
    await _grant_blackjack(sid)
    win = _play_run(client, sid, outcome="win", final_chips=2600, metadata={})
    loss = _play_run(client, sid, outcome="loss", final_chips=0, metadata={})

    assert await _stored_final_score(win) == 2600
    assert await _stored_final_score(loss) == 0
    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["best_value"] == 2600
    assert bj["best_label_key"] == "chips"
    assert bj["extras"]["best_chips"] == 2600
    assert bj["extras"]["current_chips"] == 0


async def test_finished_run_with_matching_final_score_is_stored_as_sent(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    await _grant_blackjack(sid)
    gid = _play_run(client, sid, outcome="win", final_chips=3100, metadata={}, final_score=3100)

    assert await _stored_final_score(gid) == 3100
    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["best_value"] == 3100
    assert bj["extras"]["best_chips"] == 3100


@pytest.mark.parametrize(
    "final_chips,final_score",
    [
        (2600, 2700),  # final_score must equal final_chips
        (-1, None),  # chips are never negative
        (MAX_BOARD_VALUE + 1, None),  # above the 32-bit games column
    ],
)
async def test_invalid_closing_chips_are_rejected(
    client: TestClient, final_chips: int, final_score: int | None
) -> None:
    sid = str(uuid.uuid4())
    await _grant_blackjack(sid)
    gid = _play_run(
        client,
        sid,
        outcome="win",
        final_chips=final_chips,
        metadata={},
        final_score=final_score,
        expect_status=400,
    )
    assert await _stored_final_score(gid) is None


async def test_abandoned_run_keeps_no_score_and_never_counts_toward_best(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    await _grant_blackjack(sid)
    _play_run(client, sid, outcome="loss", final_chips=0, metadata={})
    abandoned = _play_run(client, sid, outcome="abandoned", final_chips=5000, metadata={})

    assert await _stored_final_score(abandoned) is None
    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["best_value"] == 0
    assert bj["extras"]["best_chips"] == 0
    assert bj["extras"]["current_chips"] == 0


async def test_rows_stored_before_2745_count_toward_best(client: TestClient) -> None:
    """Rows already stored with only ``metadata.final_chips`` (no final_score)
    count toward Best at read time: no backfill migration."""
    sid = str(uuid.uuid4())
    factory = get_session_factory()
    async with factory() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == "blackjack"))
        ).scalar_one()
        for outcome, chips in (("win", 1800), ("completed", 900), ("abandoned", 9000)):
            db.add(
                Game(
                    session_id=sid,
                    game_type_id=gt_id,
                    completed_at=datetime.now(timezone.utc),
                    outcome=outcome,
                    final_score=None,
                    game_metadata={"hands_won": 2, "final_chips": chips},
                )
            )
        await db.commit()

    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["best_value"] == 1800


@pytest.mark.parametrize(
    "final_score,outcome,result,expected",
    [
        (None, "win", {"final_chips": 2600}, 2600),
        (None, "loss", {"final_chips": 0}, 0),
        (None, "completed", {"final_chips": 400}, 400),
        (None, None, {"final_chips": 400}, 400),
        (2600, "win", {"final_chips": 2600}, 2600),
        (None, "abandoned", {"final_chips": 800}, None),
        (7, "abandoned", {"final_chips": 800}, 7),
        (None, "win", {}, None),
        (None, "win", {"final_chips": True}, None),
    ],
)
def test_derive_final_score(
    final_score: int | None, outcome: str | None, result: dict, expected: int | None
) -> None:
    assert blackjack_module.derive_final_score(final_score, outcome, result) == expected


@pytest.mark.parametrize(
    "final_score,outcome,result",
    [
        (2500, "win", {"hands_won": 1}),  # a score with no board metric
        (2500, "loss", {}),
        (2500, None, {"final_chips": True}),
        (2500, "win", {"final_chips": 2400}),
    ],
)
def test_derive_final_score_rejects_a_score_without_matching_chips(
    final_score: int, outcome: str | None, result: dict
) -> None:
    with pytest.raises(ValueError):
        blackjack_module.derive_final_score(final_score, outcome, result)


def _create(client: TestClient, sid: str) -> str:
    r = client.post(
        "/games", headers=_headers(sid), json={"game_type": "blackjack", "metadata": {}}
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.mark.parametrize(
    "body",
    [
        {"outcome": "win", "final_score": 2500, "result": {"hands_won": 1}},
        {"outcome": "loss", "final_score": 2500},
        {"outcome": "win", "final_score": 2500, "result": {"hands_won": 1, "final_chips": None}},
    ],
)
async def test_finished_run_with_a_score_but_no_closing_chips_is_rejected(
    client: TestClient, body: dict
) -> None:
    sid = str(uuid.uuid4())
    await _grant_blackjack(sid)
    gid = _create(client, sid)
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 400, r.text
    assert await _stored_final_score(gid) is None


async def test_abandon_with_a_score_and_no_chips_is_still_accepted(client: TestClient) -> None:
    """Abandons keep their old semantics: stored as sent, never counted."""
    sid = str(uuid.uuid4())
    await _grant_blackjack(sid)
    gid = _create(client, sid)
    body = {"outcome": "abandoned", "final_score": 2500, "result": {"hands_won": 1}}
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    assert await _stored_final_score(gid) == 2500
    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["best_value"] is None
    assert bj["extras"]["best_chips"] is None


async def test_killed_process_win_sweep_counts_its_closing_chips(client: TestClient) -> None:
    """The app's orphan sweep closes a killed run that reached its goal as
    ``win`` with the persisted progress result and no ``final_score`` or
    duration (``gameEventClient.abandonOrphan``)."""
    sid = str(uuid.uuid4())
    await _grant_blackjack(sid)
    gid = _create(client, sid)
    body = {
        "outcome": "win",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "result": {
            "hands_won": 4,
            "hands_played": 7,
            "starting_chips": 100,
            "final_chips": 265,
        },
    }
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text

    assert await _stored_final_score(gid) == 265
    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["best_value"] == 265
    assert bj["extras"]["best_chips"] == 265
    assert bj["won"] == 1

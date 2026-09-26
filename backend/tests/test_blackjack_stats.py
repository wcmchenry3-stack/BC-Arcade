"""Blackjack runs record win / loss / abandoned, and /stats/me counts them (#2628).

A run that reached its goal records ``win``, a run whose chips ran out before
the goal ``loss``, and a run left before the goal ``abandoned``. The run
summary is in ``extras`` only (the deprecated top-level aliases went in #2644).
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from blackjack.module import module as blackjack_module
from db.base import get_session_factory, is_configured
from db.models import GameEntitlement

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


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


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
) -> None:
    """One run as the app sends it: create with the run aggregates, then complete."""
    r = client.post(
        "/games", headers=_headers(sid), json={"game_type": "blackjack", "metadata": metadata}
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
    assert r.status_code == 200, r.text


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

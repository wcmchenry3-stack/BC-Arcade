"""Read-side tests for #365 (stats, history, detail)."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory, is_configured
from db.models import GameEntitlement
from games.progression import (
    BASE_XP_PER_GAME,
    LEVEL_THRESHOLDS,
    VARIETY_BONUS_PER_GAME_TYPE,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


# Sudoku rows need creation metadata: SudokuMetadata forbids extras and
# requires a difficulty tier.
_HARD = {"difficulty": "hard"}


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


async def _grant(session_id: str, game_slug: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug=game_slug))
        await db.commit()


def _create_and_complete(
    client: TestClient,
    sid: str,
    *,
    game_type: str,
    final_score: int,
    outcome: str = "win",
    metadata: dict | None = None,
) -> str:
    body: dict = {"game_type": game_type}
    if metadata is not None:
        body["metadata"] = metadata
    r = client.post("/games", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={"final_score": final_score, "outcome": outcome, "duration_ms": 10_000},
    )
    assert r.status_code == 200, r.text
    return gid


# ---------------------------------------------------------------------------
# GET /stats/me
# ---------------------------------------------------------------------------


def test_stats_me_empty_session(client: TestClient) -> None:
    r = client.get("/stats/me", headers=_headers(str(uuid.uuid4())))
    assert r.status_code == 200
    body = r.json()
    assert body["total_games"] == 0
    assert body["by_game"] == {}
    assert body["favorite_game"] is None


async def test_stats_me_aggregates_per_game(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    _create_and_complete(client, sid, game_type="yacht", final_score=100)
    _create_and_complete(client, sid, game_type="yacht", final_score=300)
    _create_and_complete(client, sid, game_type="twenty48", final_score=15_000)

    r = client.get("/stats/me", headers=_headers(sid))
    assert r.status_code == 200
    body = r.json()
    assert body["total_games"] == 3
    assert body["by_game"]["yacht"]["played"] == 2
    assert body["by_game"]["yacht"]["best"] == 300
    assert body["by_game"]["yacht"]["avg"] == 200.0
    assert body["by_game"]["twenty48"]["played"] == 1
    assert body["favorite_game"] == "yacht"


@pytest.mark.asyncio
async def test_stats_me_blackjack_uses_chip_shape(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "blackjack")  # premium since 2026-09-23
    _create_and_complete(client, sid, game_type="blackjack", final_score=1500)
    _create_and_complete(client, sid, game_type="blackjack", final_score=2400)

    r = client.get("/stats/me", headers=_headers(sid))
    body = r.json()
    bj = body["by_game"]["blackjack"]
    assert bj["played"] == 2
    assert bj["best_chips"] == 2400
    assert bj["current_chips"] == 2400
    # non-blackjack fields should be absent or null on this entry
    assert bj.get("best") is None
    assert bj.get("avg") is None


def test_stats_me_empty_session_is_level_one(client: TestClient) -> None:
    """#2391: a brand-new session still gets a full progression block."""
    r = client.get("/stats/me", headers=_headers(str(uuid.uuid4())))
    assert r.status_code == 200
    body = r.json()
    assert body["arcade_xp"] == 0
    assert body["arcade_level"] == 1
    assert body["xp_into_level"] == 0
    assert body["xp_for_next_level"] == LEVEL_THRESHOLDS[1]


def test_stats_me_reports_arcade_xp_and_level(client: TestClient) -> None:
    """#2391: XP on the wire is derived from the same summary as the stats.

    The XP/level maths is unit-tested in test_progression.py; this only proves
    the endpoint exposes it and that the four fields agree with each other.
    """
    sid = str(uuid.uuid4())
    for _ in range(3):
        _create_and_complete(client, sid, game_type="twenty48", final_score=2048)
    _create_and_complete(client, sid, game_type="sort", final_score=1500)
    # Started but never completed — must not earn XP.
    r = client.post("/games", headers=_headers(sid), json={"game_type": "solitaire"})
    assert r.status_code == 200, r.text

    body = client.get("/stats/me", headers=_headers(sid)).json()
    xp = body["arcade_xp"]
    level = body["arcade_level"]
    assert xp == 4 * BASE_XP_PER_GAME + 2 * VARIETY_BONUS_PER_GAME_TYPE
    assert 1 < level < len(LEVEL_THRESHOLDS)
    assert LEVEL_THRESHOLDS[level - 1] + body["xp_into_level"] == xp
    assert xp + body["xp_for_next_level"] == LEVEL_THRESHOLDS[level]


# ---------------------------------------------------------------------------
# Abandoned games: counted, never scored (#2468 / #2472)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_abandoned_game_is_played_but_not_scored(client: TestClient) -> None:
    """The Sudoku case from #2468.

    The frontend abandon path sends the *completion* score formula, so a
    0-error abandon on Hard posts 300 — the same as a perfect solve. It must
    still count as played, but must not touch best/avg.
    """
    sid = str(uuid.uuid4())
    await _grant(sid, "sudoku")
    _create_and_complete(
        client, sid, game_type="sudoku", final_score=100, outcome="completed", metadata=_HARD
    )
    _create_and_complete(
        client, sid, game_type="sudoku", final_score=300, outcome="abandoned", metadata=_HARD
    )

    body = client.get("/stats/me", headers=_headers(sid)).json()
    sudoku = body["by_game"]["sudoku"]

    assert sudoku["played"] == 2, "abandons are a lifecycle fact and still count as played"
    assert sudoku["best"] == 100, "the abandoned 300 must not become the best score"
    assert sudoku["avg"] == 100.0, "the abandoned 300 must not drag the average"


@pytest.mark.asyncio
async def test_abandoned_game_earns_no_xp_over_the_wire(client: TestClient) -> None:
    """#2472: the farming exploit, end to end."""
    sid = str(uuid.uuid4())
    await _grant(sid, "sudoku")
    _create_and_complete(
        client, sid, game_type="sudoku", final_score=100, outcome="completed", metadata=_HARD
    )
    baseline = client.get("/stats/me", headers=_headers(sid)).json()["arcade_xp"]

    for _ in range(5):
        _create_and_complete(
            client, sid, game_type="sudoku", final_score=300, outcome="abandoned", metadata=_HARD
        )

    after = client.get("/stats/me", headers=_headers(sid)).json()
    assert after["arcade_xp"] == baseline, "quitting five games must earn nothing"
    assert after["by_game"]["sudoku"]["played"] == 6


@pytest.mark.asyncio
async def test_abandoning_a_new_game_type_earns_no_variety_bonus(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    _create_and_complete(client, sid, game_type="twenty48", final_score=2048, outcome="completed")
    before = client.get("/stats/me", headers=_headers(sid)).json()["arcade_xp"]

    await _grant(sid, "sudoku")
    _create_and_complete(
        client, sid, game_type="sudoku", final_score=300, outcome="abandoned", metadata=_HARD
    )

    after = client.get("/stats/me", headers=_headers(sid)).json()["arcade_xp"]
    assert after == before, "a game type only ever quit must not unlock its breadth bonus"


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["completed", "kept_playing", "win", "loss", "push"])
async def test_non_abandoned_outcomes_still_score(client: TestClient, outcome: str) -> None:
    """The predicate is NULL-safe and outcome-inclusive on purpose.

    `kept_playing` (Twenty48 past 2048) and the result vocabulary (`win` /
    `loss` / `push`) are real finishes — filtering on `outcome == "completed"`
    would have dropped them.
    """
    sid = str(uuid.uuid4())
    _create_and_complete(client, sid, game_type="twenty48", final_score=2048, outcome=outcome)

    body = client.get("/stats/me", headers=_headers(sid)).json()
    assert body["by_game"]["twenty48"]["best"] == 2048
    assert body["arcade_xp"] == BASE_XP_PER_GAME + VARIETY_BONUS_PER_GAME_TYPE


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("game_type", "outcome", "final_score"),
    [
        ("yacht", "win", 260),  # vs CPU
        ("yacht", "push", 240),  # vs CPU, a tie
        ("hearts", "loss", 38),
        ("daily_word", "win", None),  # no numeric score
        ("daily_word", "loss", None),
        ("mahjong", "loss", None),  # a deadlock, recorded without a score
    ],
)
async def test_games_with_a_winner_record_it_and_still_count(
    client: TestClient, game_type: str, outcome: str, final_score: int | None
) -> None:
    """#2517: Yacht vs CPU, Hearts, Daily Word and Mahjong now record who won.

    Each is a finished game, so it keeps its XP and its `played` count exactly
    as a `completed` row did — only `abandoned` drops out (games/filters.py).
    """
    sid = str(uuid.uuid4())
    await _grant(sid, game_type)
    start: dict = {"game_type": game_type}
    if game_type == "daily_word":
        start["metadata"] = {"puzzle_id": "2026-09-25"}
    r = client.post("/games", headers=_headers(sid), json=start)
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    body: dict = {"outcome": outcome, "duration_ms": 10_000}
    if final_score is not None:
        body["final_score"] = final_score
    r = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    assert r.json()["outcome"] == outcome

    stats = client.get("/stats/me", headers=_headers(sid)).json()
    assert stats["by_game"][game_type]["played"] == 1
    assert stats["arcade_xp"] == BASE_XP_PER_GAME + VARIETY_BONUS_PER_GAME_TYPE


@pytest.mark.asyncio
async def test_abandoned_session_does_not_blank_blackjack_current_chips(
    client: TestClient,
) -> None:
    """Blackjack reads current_chips through latest_score (#2468).

    If the abandon were the "latest" session it would become the player's live
    chip balance, so the latest-score subquery has to skip abandons too.
    """
    sid = str(uuid.uuid4())
    await _grant(sid, "blackjack")
    _create_and_complete(client, sid, game_type="blackjack", final_score=2400, outcome="completed")
    _create_and_complete(client, sid, game_type="blackjack", final_score=50, outcome="abandoned")

    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["current_chips"] == 2400
    assert bj["best_chips"] == 2400


@pytest.mark.asyncio
async def test_abandoned_session_still_supplies_blackjack_run_metadata(
    client: TestClient,
) -> None:
    """Metadata comes from the latest row of *any* outcome (#2468 review).

    Blackjack writes its cumulative run aggregates at session start, so the
    newest row always holds the freshest figures — even when that session was
    later abandoned. "New Game" and unmount are both abandon paths, so a player
    who has not just cashed out or busted would otherwise lose their whole run
    history from Profile.
    """
    sid = str(uuid.uuid4())
    await _grant(sid, "blackjack")
    # Cash-out: older row, stale aggregates.
    _create_and_complete(
        client,
        sid,
        game_type="blackjack",
        final_score=2400,
        outcome="completed",
        metadata={"total_runs": 1, "runs_completed": 1, "best_run_chips": 2400},
    )
    # Next table, played then navigated away: newest row, freshest aggregates.
    _create_and_complete(
        client,
        sid,
        game_type="blackjack",
        final_score=50,
        outcome="abandoned",
        metadata={"total_runs": 2, "runs_completed": 1, "best_run_chips": 2400},
    )

    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["total_runs"] == 2, "run history must come from the newest row, abandoned or not"
    assert bj["runs_completed"] == 1
    assert bj["best_run_chips"] == 2400
    # ...while the live chip balance still ignores the abandoned table.
    assert bj["current_chips"] == 2400


# ---------------------------------------------------------------------------
# GET /games/me (history with cursor pagination)
# ---------------------------------------------------------------------------


async def test_games_me_history_pagination(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    for s in (10, 20, 30, 40, 50):
        _create_and_complete(client, sid, game_type="yacht", final_score=s)

    r = client.get("/games/me?limit=2", headers=_headers(sid))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["items"]) == 2
    assert body["next_cursor"] is not None

    r2 = client.get(f"/games/me?limit=2&cursor={body['next_cursor']}", headers=_headers(sid))
    assert r2.status_code == 200
    assert len(r2.json()["items"]) == 2


async def test_games_me_filters_by_session(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    other = str(uuid.uuid4())
    await _grant(sid, "yacht")
    await _grant(other, "yacht")
    _create_and_complete(client, sid, game_type="yacht", final_score=100)
    _create_and_complete(client, other, game_type="yacht", final_score=200)

    r = client.get("/games/me", headers=_headers(sid))
    items = r.json()["items"]
    assert all(item["final_score"] == 100 for item in items)


# ---------------------------------------------------------------------------
# GET /games/{id}
# ---------------------------------------------------------------------------


async def test_game_detail_returns_row(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    gid = _create_and_complete(client, sid, game_type="yacht", final_score=250)
    r = client.get(f"/games/{gid}", headers=_headers(sid))
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == gid
    assert body["final_score"] == 250
    assert body.get("events") is None


async def test_game_detail_include_events(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    r = client.post("/games", headers=_headers(sid), json={"game_type": "yacht"})
    gid = r.json()["id"]
    client.post(
        f"/games/{gid}/events",
        headers=_headers(sid),
        json={
            "events": [
                {"event_index": 0, "event_type": "game_started", "data": {}},
                {"event_index": 1, "event_type": "roll", "data": {"dice": [1, 2, 3, 4, 5]}},
            ]
        },
    )

    r = client.get(f"/games/{gid}?include_events=1", headers=_headers(sid))
    assert r.status_code == 200
    body = r.json()
    assert len(body["events"]) == 2
    assert body["events"][0]["event_type"] == "game_started"


async def test_game_detail_cross_session_forbidden(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _grant(sid, "yacht")
    gid = _create_and_complete(client, sid, game_type="yacht", final_score=100)
    other = str(uuid.uuid4())
    r = client.get(f"/games/{gid}", headers=_headers(other))
    assert r.status_code == 403


def test_game_detail_not_found(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    r = client.get(f"/games/{uuid.uuid4()}", headers=_headers(sid))
    assert r.status_code == 404

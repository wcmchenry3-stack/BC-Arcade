"""Yacht reporting on the generic session board (#2630).

Yacht ranks on ``GET /games/leaderboard/yacht`` like every other game: each
finished session row of a named player counts, one entry per player (their
best), with solo and vs-the-computer games on the same board (#2519
decision 2). The session metadata records ``mode`` and ``difficulty`` without
partitioning by them.

The legacy ``POST /yacht/score`` / ``GET /yacht/scores`` routes (which stored
``400 - raw`` under ``yacht-anon`` and had no caller) are gone.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory, is_configured
from db.models import Game

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


def _sid() -> str:
    return str(uuid.uuid4())


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


def _name(client: TestClient, sid: str, name: str) -> None:
    r = client.put("/players/me", headers=_headers(sid), json={"display_name": name})
    assert r.status_code == 200, r.text


def _create(client: TestClient, sid: str, metadata: dict[str, Any]):
    return client.post(
        "/games", headers=_headers(sid), json={"game_type": "yacht", "metadata": metadata}
    )


def _play(
    client: TestClient,
    sid: str,
    score: int,
    *,
    metadata: dict[str, Any],
    outcome: str = "completed",
    duration_ms: int | None = 90_000,
) -> str:
    """Create and complete one Yacht game through the real session pipeline."""
    r = _create(client, sid, metadata)
    assert r.status_code == 200, r.text
    game_id = r.json()["id"]
    body: dict[str, Any] = {
        "final_score": score,
        "outcome": outcome,
        "duration_ms": duration_ms,
        "result": {"final_score": score, "upper_bonus": 0, "yacht_bonus_total": 0},
    }
    r = client.patch(f"/games/{game_id}/complete", headers=_headers(sid), json=body)
    assert r.status_code == 200, r.text
    return game_id


def _board(client: TestClient, sid: str) -> list[tuple[str, int]]:
    r = client.get("/games/leaderboard/yacht", headers=_headers(sid))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["partition"] == {}
    assert body["label_key"] == "score"
    return [(e["player_name"], e["value"]) for e in body["entries"]]


async def _row(game_id: str) -> Game:
    factory = get_session_factory()
    async with factory() as db:
        game = await db.get(Game, uuid.UUID(game_id))
        assert game is not None
        return game


SOLO = {"mode": "solo"}


def _vs(difficulty: str) -> dict[str, str]:
    return {"mode": "vs", "difficulty": difficulty}


# ---------------------------------------------------------------------------
# Legacy routes removed
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [("post", "/yacht/score"), ("get", "/yacht/scores")],
)
def test_legacy_score_routes_are_gone(client: TestClient, method: str, path: str) -> None:
    body = {"player_name": "Alice", "score": 200, "difficulty": "easy"}
    kwargs: dict[str, Any] = {"json": body} if method == "post" else {}
    r = getattr(client, method)(path, headers=_headers(_sid()), **kwargs)
    assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# Session metadata: mode and difficulty (the model's own rules, and that the
# legacy models are gone, are in test_yacht_models.py, which needs no DB)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "metadata",
    [
        SOLO,
        _vs("easy"),
        _vs("medium"),
        _vs("hard"),
        # Installed builds that predate #2630 send no mode.
        {},
        {"difficulty": "hard"},
    ],
)
async def test_metadata_accepted_and_stored(client: TestClient, metadata: dict) -> None:
    sid = _sid()
    game_id = _play(client, sid, 180, metadata=metadata)
    row = await _row(game_id)
    for key, value in metadata.items():
        assert row.game_metadata[key] == value


@pytest.mark.parametrize(
    "metadata",
    [
        {"mode": "duo"},
        {"mode": "vs", "difficulty": "legendary"},
        {"mode": "solo", "player_name": "Alice"},
        {"mode": "vs"},  # a vs game needs the computer's difficulty
        {"mode": "solo", "difficulty": "easy"},  # a solo game has none
    ],
)
def test_invalid_metadata_is_422(client: TestClient, metadata: dict) -> None:
    r = _create(client, _sid(), metadata)
    assert r.status_code == 422, r.text


async def test_duration_is_recorded(client: TestClient) -> None:
    game_id = _play(client, _sid(), 150, metadata=SOLO, duration_ms=123_456)
    assert (await _row(game_id)).duration_ms == 123_456


# ---------------------------------------------------------------------------
# One board: solo and vs mixed, one entry per player
# ---------------------------------------------------------------------------


async def test_solo_and_vs_games_share_one_board(client: TestClient) -> None:
    solo, vs_win, vs_push = _sid(), _sid(), _sid()
    _name(client, solo, "Solo")
    _name(client, vs_win, "VsWin")
    _name(client, vs_push, "VsPush")
    _play(client, solo, 180, metadata=SOLO)
    _play(client, vs_win, 250, metadata=_vs("hard"), outcome="win")
    _play(client, vs_push, 120, metadata=_vs("easy"), outcome="push")

    assert _board(client, solo) == [("VsWin", 250), ("Solo", 180), ("VsPush", 120)]


async def test_a_game_lost_to_the_computer_still_ranks(client: TestClient) -> None:
    sid = _sid()
    _name(client, sid, "Loser")
    _play(client, sid, 210, metadata=_vs("medium"), outcome="loss")
    assert _board(client, sid) == [("Loser", 210)]


async def test_one_entry_per_player_their_best_game(client: TestClient) -> None:
    other = _sid()
    _name(client, other, "Other")
    _play(client, other, 200, metadata=SOLO)

    sid = _sid()
    _name(client, sid, "Me")
    ids = [
        _play(client, sid, 150, metadata=SOLO),
        _play(client, sid, 240, metadata=_vs("hard"), outcome="loss"),
        _play(client, sid, 90, metadata=SOLO),
    ]

    assert _board(client, sid) == [("Me", 240), ("Other", 200)]

    ranks = [client.get(f"/games/{g}/rank", headers=_headers(sid)).json() for g in ids]
    assert [r["rank"] for r in ranks] == [1, 1, 1]
    assert [r["is_best"] for r in ranks] == [False, True, False]


async def test_unnamed_player_does_not_rank(client: TestClient) -> None:
    sid = _sid()
    game_id = _play(client, sid, 300, metadata=SOLO)
    assert _board(client, sid) == []
    r = client.get(f"/games/{game_id}/rank", headers=_headers(sid))
    assert r.status_code == 200, r.text
    assert r.json() == {"ranked": False, "rank": None, "is_best": None, "reason": "no_name"}


async def test_abandoned_game_does_not_rank(client: TestClient) -> None:
    sid = _sid()
    _name(client, sid, "Quitter")
    _play(client, sid, 300, metadata=SOLO, outcome="abandoned")
    _play(client, sid, 100, metadata=SOLO)
    assert _board(client, sid) == [("Quitter", 100)]


# ---------------------------------------------------------------------------
# Final scorecard in the result (#2839)
# ---------------------------------------------------------------------------

_CARD = {
    "categories": {
        "ones": 3,
        "twos": 6,
        "threes": 9,
        "fours": 12,
        "fives": 15,
        "sixes": 18,
        "three_of_a_kind": 20,
        "four_of_a_kind": 0,
        "full_house": 25,
        "small_straight": 30,
        "large_straight": 0,
        "yacht": 50,
        "chance": 22,
    },
    "upper_bonus": 35,
    "yacht_bonus_count": 1,
    "yacht_bonus_total": 100,
}
# Categories 63 + 147 = 210, the upper bonus 35, and one extra Yacht's 100.
_CARD_TOTAL = 210 + 35 + 100


def _complete(
    client: TestClient,
    sid: str,
    game_id: str,
    result: dict[str, Any],
    *,
    score: int,
    outcome: str = "completed",
):
    return client.patch(
        f"/games/{game_id}/complete",
        headers=_headers(sid),
        json={"final_score": score, "outcome": outcome, "duration_ms": 90_000, "result": result},
    )


async def test_scorecard_is_saved_and_returned_to_the_owner(client: TestClient) -> None:
    sid = _sid()
    game_id = _create(client, sid, SOLO).json()["id"]
    result = {
        "final_score": _CARD_TOTAL,
        "upper_bonus": 35,
        "yacht_bonus_total": 100,
        "outcome": "completed",
        "scorecard": _CARD,
    }
    r = _complete(client, sid, game_id, result, score=_CARD_TOTAL)
    assert r.status_code == 200, r.text

    r = client.get(f"/games/{game_id}", headers=_headers(sid))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["final_score"] == _CARD_TOTAL
    assert body["metadata"]["mode"] == "solo"
    assert body["metadata"]["scorecard"] == _CARD
    assert body["metadata"]["scorecard_reconciled"] is True
    assert body["metadata"]["yacht_bonus_total"] == 100
    # The saved card is the owner's alone.
    r = client.get(f"/games/{game_id}", headers=_headers(_sid()))
    assert r.status_code == 403


async def test_vs_result_saves_both_cards_and_the_board_uses_the_player_total(
    client: TestClient,
) -> None:
    sid = _sid()
    _name(client, sid, "Vs")
    game_id = _create(client, sid, _vs("hard")).json()["id"]
    opp = {"categories": {"ones": 2, "chance": 20}}
    result = {
        "final_score": _CARD_TOTAL,
        "upper_bonus": 35,
        "yacht_bonus_total": 100,
        "outcome": "win",
        "vs_result": "win",
        "opponent_score": 22,
        "scorecard": _CARD,
        "opponent_scorecard": opp,
    }
    assert (
        _complete(client, sid, game_id, result, score=_CARD_TOTAL, outcome="win").status_code == 200
    )
    meta = (await _row(game_id)).game_metadata
    assert meta["scorecard"] == _CARD
    assert meta["opponent_scorecard"] == opp
    assert meta["opponent_score"] == 22
    assert meta["scorecard_reconciled"] is True
    assert _board(client, sid) == [("Vs", _CARD_TOTAL)]


async def test_unreconciled_card_is_saved_and_flagged_not_rejected(client: TestClient) -> None:
    sid = _sid()
    game_id = _create(client, sid, SOLO).json()["id"]
    result = {"final_score": 999, "outcome": "completed", "scorecard": _CARD}
    assert _complete(client, sid, game_id, result, score=999).status_code == 200
    assert (await _row(game_id)).game_metadata["scorecard_reconciled"] is False


async def test_abandoned_partial_card_is_saved(client: TestClient) -> None:
    sid = _sid()
    game_id = _create(client, sid, SOLO).json()["id"]
    result = {
        "final_score": 6,
        "outcome": "abandoned",
        "scorecard": {"categories": {"twos": 6}, "upper_bonus": 0},
    }
    assert _complete(client, sid, game_id, result, score=6, outcome="abandoned").status_code == 200
    meta = (await _row(game_id)).game_metadata
    assert meta["scorecard"]["categories"] == {"twos": 6}
    assert meta["scorecard_reconciled"] is True


async def test_card_is_reconciled_against_the_stored_final_score(client: TestClient) -> None:
    sid = _sid()
    game_id = _create(client, sid, SOLO).json()["id"]
    # The card and the result's copy agree with each other, not with the row.
    result = {"final_score": _CARD_TOTAL, "outcome": "completed", "scorecard": _CARD}
    assert _complete(client, sid, game_id, result, score=999).status_code == 200
    row = await _row(game_id)
    assert row.final_score == 999
    assert row.game_metadata["scorecard"] == _CARD
    assert row.game_metadata["scorecard_reconciled"] is False


async def test_completion_retry_is_idempotent(client: TestClient) -> None:
    """An offline retry re-sends the same PATCH; the card is stored once, unchanged."""
    sid = _sid()
    game_id = _create(client, sid, SOLO).json()["id"]
    result = {"final_score": _CARD_TOTAL, "outcome": "completed", "scorecard": _CARD}
    for _ in range(2):
        r = _complete(client, sid, game_id, result, score=_CARD_TOTAL)
        assert r.status_code == 200, r.text
    assert (await _row(game_id)).game_metadata["scorecard"] == _CARD


async def test_pre_2839_result_still_completes(client: TestClient) -> None:
    sid = _sid()
    game_id = _play(client, sid, 180, metadata=_vs("easy"))
    meta = (await _row(game_id)).game_metadata
    assert "scorecard" not in meta
    assert "scorecard_reconciled" not in meta
    assert meta["yacht_bonus_total"] == 0


@pytest.mark.parametrize(
    "scorecard",
    [{"categories": {"bogus": 1}}, {"categories": {"ones": 99}}, {"categories": {"chance": -3}}],
)
async def test_out_of_shape_card_still_completes_with_the_card_dropped(
    client: TestClient, scorecard: dict
) -> None:
    """A 400 would dead-letter the game; the score and row are kept."""
    sid = _sid()
    game_id = _create(client, sid, SOLO).json()["id"]
    result = {"final_score": 10, "outcome": "completed", "scorecard": scorecard}
    assert _complete(client, sid, game_id, result, score=10).status_code == 200
    row = await _row(game_id)
    assert row.final_score == 10
    assert "scorecard" not in row.game_metadata
    assert row.game_metadata["scorecard_reconciled"] is False


def test_result_over_the_size_cap_is_400(client: TestClient) -> None:
    sid = _sid()
    game_id = _create(client, sid, SOLO).json()["id"]
    result = {"final_score": 10, "outcome": "completed", "scorecard": _CARD, "pad": "x" * 9000}
    assert _complete(client, sid, game_id, result, score=10).status_code == 400

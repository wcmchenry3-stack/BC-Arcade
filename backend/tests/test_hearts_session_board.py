"""Hearts on the session board (#2629).

The app records a Hearts game only as its own session row: ``POST /games``
with ``ai_difficulty`` in the metadata, then ``PATCH /games/{id}/complete``
with ``final_score = 100 − penalty`` and the ``win``/``loss``/``push``
outcome. The player's display name is theirs (``PUT /players/me``), so every
finished game ranks without a per-game submit, and the player appears once.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory, is_configured
from db.models import Game, GameEntitlement
from hearts.models import AI_DIFFICULTIES, HeartsMetadata

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


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


async def _entitled_sid() -> str:
    """A session entitled to Hearts, a premium game."""
    sid = str(uuid.uuid4())
    factory = get_session_factory()
    async with factory() as db:
        db.add(GameEntitlement(session_id=sid, game_slug="hearts"))
        await db.commit()
    return sid


def _create(client: TestClient, sid: str, metadata: dict[str, Any]) -> Any:
    return client.post(
        "/games", headers=_headers(sid), json={"game_type": "hearts", "metadata": metadata}
    )


def _play(client: TestClient, sid: str, penalty: int, outcome: str) -> str:
    """One finished game the way the app sends it (``HeartsScreen``)."""
    r = _create(client, sid, {"ai_difficulty": "daring"})
    assert r.status_code == 200, r.text
    game_id = r.json()["id"]
    final_score = max(0, 100 - penalty)
    r = client.patch(
        f"/games/{game_id}/complete",
        headers=_headers(sid),
        json={
            "outcome": outcome,
            "final_score": final_score,
            "result": {"final_score": final_score, "vs_result": outcome},
        },
    )
    assert r.status_code == 200, r.text
    return game_id


def _board(client: TestClient, sid: str) -> list[tuple[str, int]]:
    r = client.get("/games/leaderboard/hearts", headers=_headers(sid))
    assert r.status_code == 200, r.text
    return [(e["player_name"], e["value"]) for e in r.json()["entries"]]


# ---------------------------------------------------------------------------
# ai_difficulty in the creation metadata
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("difficulty", AI_DIFFICULTIES)
async def test_create_records_ai_difficulty(client: TestClient, difficulty: str) -> None:
    sid = await _entitled_sid()
    r = _create(client, sid, {"ai_difficulty": difficulty})
    assert r.status_code == 200, r.text
    factory = get_session_factory()
    async with factory() as db:
        game = await db.get(Game, uuid.UUID(r.json()["id"]))
        assert game is not None
        assert game.game_metadata == {"ai_difficulty": difficulty}


@pytest.mark.parametrize(
    "metadata",
    [{}, {"player_name": ""}, {"ai_difficulty": None}],
    ids=["pre-2629 build", "legacy player_name", "null"],
)
async def test_create_without_ai_difficulty_still_accepted(
    client: TestClient, metadata: dict[str, Any]
) -> None:
    """Installed builds send no ``ai_difficulty``: their games must still sync."""
    sid = await _entitled_sid()
    r = _create(client, sid, metadata)
    assert r.status_code == 200, r.text


def test_an_unknown_style_is_recorded_not_rejected() -> None:
    """Rejecting a label would lose the whole game in the app."""
    assert HeartsMetadata.model_validate({"ai_difficulty": "future"}).ai_difficulty == "future"


async def test_unknown_metadata_keys_are_still_rejected(client: TestClient) -> None:
    sid = await _entitled_sid()
    r = _create(client, sid, {"ai_difficulty": "schemer", "difficulty": "hard"})
    assert r.status_code == 422, r.text


async def test_overlong_ai_difficulty_is_rejected(client: TestClient) -> None:
    sid = await _entitled_sid()
    r = _create(client, sid, {"ai_difficulty": "x" * 33})
    assert r.status_code == 422, r.text


# ---------------------------------------------------------------------------
# One board entry per player
# ---------------------------------------------------------------------------


async def test_a_players_games_make_one_board_entry(client: TestClient) -> None:
    sid = await _entitled_sid()
    r = client.put("/players/me", headers=_headers(sid), json={"display_name": "Riley"})
    assert r.status_code == 200, r.text

    best = _play(client, sid, penalty=46, outcome="win")
    worse = _play(client, sid, penalty=70, outcome="loss")
    _play(client, sid, penalty=60, outcome="push")

    assert _board(client, sid) == [("Riley", 54)]

    # The card's rank lookup: the best game ranks, the worse one isn't the best.
    r = client.get(f"/games/{best}/rank", headers=_headers(sid))
    assert r.status_code == 200, r.text
    assert r.json() == {"rank": 1, "is_best": True, "ranked": True, "reason": None}
    r = client.get(f"/games/{worse}/rank", headers=_headers(sid))
    assert r.status_code == 200, r.text
    assert r.json()["is_best"] is False


async def test_a_legacy_score_post_adds_no_second_entry(client: TestClient) -> None:
    """An installed build still posts ``/hearts/score`` too: it never ranks twice."""
    sid = await _entitled_sid()
    r = client.put("/players/me", headers=_headers(sid), json={"display_name": "Riley"})
    assert r.status_code == 200, r.text
    _play(client, sid, penalty=46, outcome="win")

    r = client.post(
        "/hearts/score", headers=_headers(sid), json={"player_name": "Riley", "score": 54}
    )
    assert r.status_code == 201, r.text

    assert _board(client, sid) == [("Riley", 54)]

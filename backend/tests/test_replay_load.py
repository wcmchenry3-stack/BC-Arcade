"""The replay load test's payloads, rate limit and caps, driven through the TestClient (#3400).

``perf/scenarios/replay_payloads.py`` builds the games the Locust scenario sends. Here the
same games go through the real app, once each, so CI catches what a manual load run would:
a payload the server now refuses, a cap that no longer cuts, or a rate limit that no longer
answers 429. Only the pure payload module is imported; Locust itself is not (importing it
patches the standard library).
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory
from db.models import GameEntitlement
from games.replay_caps import DAILY_WORD_CAP, cap_for, event_bytes, is_replay_event
from main import app
from perf.scenarios.replay_payloads import (
    BATCH_SIZE,
    DAILY_WORD_CAP_EVENTS,
    MIX,
    build_game,
    over_cap_game,
    pick_game_type,
)
from rate_limits import GAMES_EVENTS_SESSION_RATE_LIMIT
from tests._helpers import session_headers as _headers

client = TestClient(app)


@pytest.fixture
async def sid() -> str:
    """A fresh session that owns every game in the mix."""
    session_id = str(uuid.uuid4())
    async with get_session_factory()() as db:
        for slug in MIX:
            db.add(GameEntitlement(session_id=session_id, game_slug=slug))
        await db.commit()
    return session_id


def _create(session_id: str, game_type: str, metadata: dict) -> str:
    r = client.post(
        "/games", headers=_headers(session_id), json={"game_type": game_type, "metadata": metadata}
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _post(session_id: str, gid: str, events: list[dict]):
    return client.post(
        f"/games/{gid}/events", headers=_headers(session_id), json={"events": events}
    )


def test_the_cap_constant_matches_the_server() -> None:
    assert DAILY_WORD_CAP.max_events == DAILY_WORD_CAP_EVENTS


def test_pick_game_type_stays_in_the_mix() -> None:
    assert {pick_game_type() for _ in range(200)} <= set(MIX)


@pytest.mark.parametrize("game_type", sorted(MIX))
def test_every_mix_game_is_accepted_whole_and_within_its_cap(sid: str, game_type: str) -> None:
    game = build_game(game_type)
    cap = cap_for(game_type)
    replay = [e for e in game.events if is_replay_event(e["event_type"])]
    assert len(replay) <= cap.max_events
    assert sum(event_bytes(e["data"]) for e in replay) <= cap.max_bytes

    gid = _create(sid, game_type, game.metadata)
    for batch in game.batches():
        assert len(batch) <= BATCH_SIZE
        r = _post(sid, gid, batch)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body == {
            "accepted": len(batch),
            "duplicates": 0,
            "rejected": [],
            "dropped": 0,
        }
    done = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json=game.complete,
    )
    assert done.status_code == 200, done.text


def test_events_over_the_cap_are_dropped_on_a_2xx(sid: str) -> None:
    extra = 4
    game = over_cap_game(extra)
    gid = _create(sid, game.game_type, game.metadata)
    accepted = dropped = 0
    for batch in game.batches():
        r = _post(sid, gid, batch)
        assert r.status_code == 200, r.text
        accepted += r.json()["accepted"]
        dropped += r.json()["dropped"]
    # game_started and game_ended are lifecycle rows, which the replay cap does not count.
    assert accepted == DAILY_WORD_CAP.max_events + 2
    assert dropped == extra
    assert accepted + dropped == len(game.events)
    done = client.patch(f"/games/{gid}/complete", headers=_headers(sid), json=game.complete)
    assert done.status_code == 200, done.text


def test_the_session_events_limit_holds_and_is_per_session(sid: str) -> None:
    per_minute = int(GAMES_EVENTS_SESSION_RATE_LIMIT.split("/")[0])
    game = build_game("daily_word")
    gid = _create(sid, game.game_type, game.metadata)
    # One lifecycle event per request, a new index each time: only the limit can refuse.
    codes = [
        _post(
            sid,
            gid,
            [{"event_index": i, "event_type": "game_ended", "data": {}}],
        ).status_code
        for i in range(per_minute + 5)
    ]
    assert codes[:per_minute] == [200] * per_minute
    assert codes[per_minute:] == [429] * 5

    refused = _post(sid, gid, [{"event_index": 999, "event_type": "game_ended", "data": {}}])
    assert refused.status_code == 429
    assert "retry-after" in refused.headers

    # Another session on the same IP is not held up by this one's budget.
    other = str(uuid.uuid4())
    other_gid = _create_for_other(other, game)
    assert _post(other, other_gid, game.batches()[0]).status_code == 200


def _create_for_other(session_id: str, game) -> str:
    # daily_word is a free game: no entitlement needed.
    return _create(session_id, game.game_type, game.metadata)

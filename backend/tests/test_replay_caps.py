"""Per-game replay caps on ``POST /games/{id}/events`` (#3292)."""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from db.base import get_session_factory
from db.models import EventType, GameEntitlement, GameEvent
from games import replay_caps
from games.replay_caps import (
    DEFAULT_CAP,
    LIFECYCLE_EVENT_NAMES,
    ReplayCap,
    apply_cap,
    cap_for,
    event_bytes,
    is_replay_event,
)
from observability import report
from tests._helpers import session_headers as _headers

# ---------------------------------------------------------------------------
# Unit: cap arithmetic
# ---------------------------------------------------------------------------


def test_lifecycle_events_are_not_replay_events() -> None:
    assert {"game_started", "game_ended", "hand_resolved"} == LIFECYCLE_EVENT_NAMES
    for name in LIFECYCLE_EVENT_NAMES:
        assert not is_replay_event(name)
    for name in ("roll", "move", "wave_completed", "guess_submitted"):
        assert is_replay_event(name)


def test_cap_for_uses_the_override_or_the_default() -> None:
    assert cap_for("starswarm") == replay_caps.CAPS_BY_GAME_TYPE["starswarm"]
    assert cap_for("yacht") == DEFAULT_CAP
    assert cap_for(None) == DEFAULT_CAP


def test_event_bytes_is_the_json_text_length() -> None:
    data = {"dice": [1, 2, 3], "name": "é"}
    assert event_bytes(data) == len(json.dumps(data).encode())
    assert event_bytes({}) == 2


def test_apply_cap_keeps_everything_under_the_cap() -> None:
    d = apply_cap(ReplayCap(max_events=5, max_bytes=100), 2, 10, [10, 10, 10])
    assert (d.kept, d.dropped, d.reason) == ([0, 1, 2], 0, None)


def test_apply_cap_fills_the_event_cap_exactly() -> None:
    d = apply_cap(ReplayCap(max_events=5, max_bytes=10_000), 3, 0, [1, 1, 1, 1])
    assert (d.kept, d.dropped, d.reason) == ([0, 1], 2, "events")


def test_apply_cap_fills_the_byte_cap_exactly() -> None:
    # 90 stored + 10 = 100 fits; the next would be 101.
    d = apply_cap(ReplayCap(max_events=100, max_bytes=100), 1, 90, [10, 1])
    assert (d.kept, d.dropped, d.reason) == ([0], 1, "bytes")


def test_apply_cap_stops_at_the_first_overflow_so_a_replay_has_no_gaps() -> None:
    # The 50-byte event does not fit; the 1-byte one after it would, but is dropped too.
    d = apply_cap(ReplayCap(max_events=100, max_bytes=60), 0, 0, [20, 50, 1])
    assert (d.kept, d.dropped, d.reason) == ([0], 2, "bytes")


def test_apply_cap_on_a_full_game_drops_the_whole_batch() -> None:
    d = apply_cap(ReplayCap(max_events=3, max_bytes=100), 3, 30, [1, 1])
    assert (d.kept, d.dropped, d.reason) == ([], 2, "events")


def test_report_cap_reached_is_throttled_per_game_type(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: sent.append((m, kw)))
    monkeypatch.setattr(replay_caps, "_throttles", {})
    d = apply_cap(ReplayCap(1, 100), 1, 0, [1])
    for _ in range(3):
        replay_caps.report_cap_reached("yacht", d, ReplayCap(1, 100))
    replay_caps.report_cap_reached("cascade", d, ReplayCap(1, 100))
    assert [m for m, _ in sent] == [
        "POST /games/{id}/events: replay cap reached (yacht)",
        "POST /games/{id}/events: replay cap reached (cascade)",
    ]
    kw = sent[0][1]
    assert kw["fingerprint"] == [replay_caps.CAP_FINGERPRINT, "yacht"]
    assert kw["level"] == "warning"
    assert kw["contexts"]["replay_cap"] == {
        "reason": "events",
        "dropped": 1,
        "max_events": 1,
        "max_bytes": 100,
    }


# ---------------------------------------------------------------------------
# Integration: the API
# ---------------------------------------------------------------------------


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    calls: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: calls.append((m, kw)))
    monkeypatch.setattr(replay_caps, "_throttles", {})
    return calls


def _cap_yacht(monkeypatch: pytest.MonkeyPatch, cap: ReplayCap) -> None:
    monkeypatch.setitem(replay_caps.CAPS_BY_GAME_TYPE, "yacht", cap)


@pytest.fixture(autouse=True)
async def _yacht_entitlement(session_id: str) -> None:
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug="yacht"))
        await db.commit()


def _new_game(client: TestClient, sid: str) -> str:
    r = client.post("/games", headers=_headers(sid), json={"game_type": "yacht"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _roll(i: int) -> dict[str, Any]:
    return {"event_index": i, "event_type": "roll", "data": {"dice": [1, 2, 3, 4, 5]}}


def _post(client: TestClient, sid: str, gid: str, events: list[dict]) -> dict:
    r = client.post(f"/games/{gid}/events", headers=_headers(sid), json={"events": events})
    assert r.status_code == 200, r.text
    return r.json()


async def _stored(gid: str) -> list[tuple[int, str]]:
    async with get_session_factory()() as db:
        rows = await db.execute(
            select(GameEvent.event_index, EventType.name)
            .join(EventType, EventType.id == GameEvent.event_type_id)
            .where(GameEvent.game_id == uuid.UUID(gid))
            .order_by(GameEvent.event_index)
        )
        return [tuple(r) for r in rows]


async def test_a_batch_past_the_event_cap_stores_up_to_the_cap_and_reports_once(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    _cap_yacht(monkeypatch, ReplayCap(max_events=3, max_bytes=1_000_000))
    gid = _new_game(client, session_id)
    events = [{"event_index": 0, "event_type": "game_started", "data": {}}]
    events += [_roll(i) for i in range(1, 6)]
    body = _post(client, session_id, gid, events)

    assert body == {"accepted": 4, "duplicates": 0, "rejected": []}
    assert await _stored(gid) == [(0, "game_started"), (1, "roll"), (2, "roll"), (3, "roll")]
    assert len(sent) == 1
    assert sent[0][1]["contexts"]["replay_cap"]["dropped"] == 2

    # A later batch on the full game: replay dropped, lifecycle kept, still 2xx,
    # and the report is throttled.
    body = _post(
        client,
        session_id,
        gid,
        [_roll(6), {"event_index": 7, "event_type": "game_ended", "data": {}}],
    )
    assert body == {"accepted": 1, "duplicates": 0, "rejected": []}
    assert (await _stored(gid))[-1] == (7, "game_ended")
    assert len(await _stored(gid)) == 5
    assert len(sent) == 1


async def test_the_byte_cap_counts_stored_and_new_replay_json(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    size = event_bytes(_roll(0)["data"])
    _cap_yacht(monkeypatch, ReplayCap(max_events=1_000, max_bytes=size * 2))
    gid = _new_game(client, session_id)
    assert _post(client, session_id, gid, [_roll(1)])["accepted"] == 1
    # One more fits (the stored row's size is read back from the database).
    assert _post(client, session_id, gid, [_roll(2), _roll(3)])["accepted"] == 1
    assert [i for i, _ in await _stored(gid)] == [1, 2]
    assert sent[0][1]["contexts"]["replay_cap"]["reason"] == "bytes"


async def test_a_retried_batch_still_counts_its_duplicates_on_a_full_game(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    _cap_yacht(monkeypatch, ReplayCap(max_events=2, max_bytes=1_000_000))
    gid = _new_game(client, session_id)
    batch = [_roll(1), _roll(2), _roll(3)]
    assert _post(client, session_id, gid, batch) == {"accepted": 2, "duplicates": 0, "rejected": []}
    # The device retries the same batch: the stored two are duplicates, the
    # dropped one is dropped again, and nothing new is stored.
    assert _post(client, session_id, gid, batch) == {"accepted": 0, "duplicates": 2, "rejected": []}
    assert [i for i, _ in await _stored(gid)] == [1, 2]


def test_under_the_cap_nothing_changes_and_nothing_reports(
    client: TestClient, session_id: str, sent
) -> None:
    gid = _new_game(client, session_id)
    body = _post(client, session_id, gid, [_roll(i) for i in range(1, 11)])
    assert body == {"accepted": 10, "duplicates": 0, "rejected": []}
    assert sent == []


async def test_fail_safe_an_exhausted_cap_never_blocks_play_or_the_boards(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    """With no replay room at all, games still create, complete and rank."""
    _cap_yacht(monkeypatch, ReplayCap(max_events=0, max_bytes=0))
    assert client.put("/players/me", headers=_headers(session_id)).status_code == 200
    gid = _new_game(client, session_id)
    events = [{"event_index": 0, "event_type": "game_started", "data": {}}, _roll(1), _roll(2)]
    assert _post(client, session_id, gid, events)["accepted"] == 1
    assert await _stored(gid) == [(0, "game_started")]

    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(session_id),
        json={"final_score": 1_234, "outcome": "completed", "duration_ms": 60_000},
    )
    assert r.status_code == 200, r.text
    assert r.json()["final_score"] == 1_234

    r = client.get("/games/leaderboard/yacht?limit=100", headers=_headers(session_id))
    assert r.status_code == 200, r.text
    assert r.json()["me"]["value"] == 1_234

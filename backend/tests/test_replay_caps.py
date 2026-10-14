"""Per-game caps on ``POST /games/{id}/events`` (#3292)."""

from __future__ import annotations

import json
import pathlib
import re
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from db.base import get_session_factory
from db.locks import EVENTS_NAMESPACE
from db.models import EventType, Game, GameEntitlement, GameEvent
from games import replay_caps, sessions
from games.filters import (
    REPLAY_CAPPED_KEY,
    REPLAY_CUTOFF_KEY,
    REPLAY_PAUSED_KEY,
    SWEPT_KEY,
    replay_cutoff,
    without_server_flags,
)
from games.replay_caps import (
    BLACKJACK_CAP,
    CASCADE_CAP,
    DEFAULT_CAP,
    LIFECYCLE_CAP,
    LIFECYCLE_EVENT_NAMES,
    ROW_OVERHEAD_BYTES,
    STARSWARM_CAP,
    TWENTY48_CAP,
    LifecycleCap,
    ReplayCap,
    apply_cap,
    apply_lifecycle_cap,
    cap_for,
    event_bytes,
    is_replay_event,
    json_bytes,
)
from observability import report
from payload_size import json_bytes as payload_json_bytes
from settings import Settings
from tests._helpers import session_headers as _headers

_EVENT_QUEUE_CONFIG = (
    pathlib.Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "game"
    / "_shared"
    / "eventQueueConfig.ts"
)

# ---------------------------------------------------------------------------
# Unit: definitions and cap arithmetic
# ---------------------------------------------------------------------------


def test_lifecycle_names_match_the_apps_lifecycle_tier() -> None:
    """``LIFECYCLE_EVENTS`` in eventQueueConfig.ts is the app's P1 tier."""
    m = re.search(
        r"const LIFECYCLE_EVENTS = new Set\(\[([^\]]*)\]\)", _EVENT_QUEUE_CONFIG.read_text()
    )
    assert m, "LIFECYCLE_EVENTS not found — has eventQueueConfig.ts moved or changed shape?"
    app_names = set(re.findall(r"\"([a-z_]+)\"", m.group(1)))
    assert app_names
    assert app_names == LIFECYCLE_EVENT_NAMES


def test_lifecycle_events_are_not_replay_events() -> None:
    for name in LIFECYCLE_EVENT_NAMES:
        assert not is_replay_event(name)
    for name in ("roll", "move", "wave_completed", "guess_submitted"):
        assert is_replay_event(name)


def test_cap_for_uses_the_override_or_the_default() -> None:
    assert cap_for("starswarm") == STARSWARM_CAP
    assert cap_for("twenty48") == TWENTY48_CAP == ReplayCap(2_000, 690_000)
    assert cap_for("blackjack") == BLACKJACK_CAP == ReplayCap(2_000, 560_000)
    assert cap_for("cascade") == CASCADE_CAP == ReplayCap(3_000, 900_000)
    assert cap_for("yacht") == DEFAULT_CAP
    assert cap_for(None) == DEFAULT_CAP


def test_json_bytes_matches_the_jsonb_text_form() -> None:
    """Default separators and raw UTF-8, as Postgres' ``jsonb::text`` prints it."""
    data = {"dice": [1, 2, 3], "name": "é"}
    assert json_bytes(data) == len('{"dice": [1, 2, 3], "name": "é"}'.encode())
    assert json_bytes(data) == len(json.dumps(data, ensure_ascii=False).encode())
    assert json_bytes({}) == 2


@pytest.mark.parametrize(
    ("data", "jsonb_text"),
    [
        # What PG16 prints for each (``SELECT '...'::jsonb::text``).
        ({"a": 1e16}, '{"a": 10000000000000000}'),
        ({"a": 1e-05}, '{"a": 0.00001}'),
        ({"a": -1.2345e-07}, '{"a": -0.00000012345}'),
        ({"a": 1.5e300}, '{"a": 15' + "0" * 299 + "}"),
        ({"a": [1e20, {"b": 2.5}]}, '{"a": [100000000000000000000, {"b": 2.5}]}'),
        ({"a": 123.45678901234567}, '{"a": 123.45678901234567}'),
    ],
)
def test_exponent_floats_are_counted_as_jsonb_prints_them(data: dict, jsonb_text: str) -> None:
    """Python prints these in exponent form; counting that would undercount the stored row."""
    assert json_bytes(data) == len(jsonb_text.encode())


def test_event_bytes_adds_the_row_overhead() -> None:
    assert ROW_OVERHEAD_BYTES == 200
    assert event_bytes({}) == 2 + ROW_OVERHEAD_BYTES


def test_apply_cap_keeps_everything_under_the_cap() -> None:
    d = apply_cap(ReplayCap(max_events=5, max_bytes=100), 2, 10, [10, 10, 10])
    assert (d.kept, d.dropped, d.reason) == ([0, 1, 2], 0, None)


def test_apply_cap_fills_the_event_cap_exactly() -> None:
    d = apply_cap(ReplayCap(max_events=5, max_bytes=10_000), 3, 0, [1, 1, 1, 1])
    assert (d.kept, d.dropped, d.reason) == ([0, 1], 2, "events")


def test_apply_cap_fills_the_byte_cap_exactly() -> None:
    d = apply_cap(ReplayCap(max_events=100, max_bytes=100), 1, 90, [10, 1])
    assert (d.kept, d.dropped, d.reason) == ([0], 1, "bytes")


def test_apply_cap_stops_at_the_first_overflow_within_a_batch() -> None:
    d = apply_cap(ReplayCap(max_events=100, max_bytes=60), 0, 0, [20, 50, 1])
    assert (d.kept, d.dropped, d.reason) == ([0], 2, "bytes")


def test_apply_cap_on_a_full_game_drops_the_whole_batch() -> None:
    d = apply_cap(ReplayCap(max_events=3, max_bytes=100), 3, 30, [1, 1])
    assert (d.kept, d.dropped, d.reason) == ([], 2, "events")


def _wave(i: int) -> dict:
    """~325 B: 200 of them stay inside the device's 64 KB per run."""
    return {"wave": i, "stats": "x" * 300}


def test_the_star_swarm_sample_run_is_inside_the_device_cap() -> None:
    assert sum(json_bytes(_wave(i)) for i in range(200)) <= 64 * 1024


# 2048 (Twenty48Screen.tsx): one move per swipe.
_MOVE = {
    "direction": "right",
    "score_delta": 1024,
    "score_after": 123_456,
    "highest_tile_after": 2048,
    "is_game_over": False,
    "has_won": False,
}
# Blackjack (BlackjackGameContext.tsx), worst case per hand: bet, deal, three actions.
_CARD = {"suit": "♦", "rank": "10"}
_HAND = [
    {"amount": 1000, "chips_remaining": 123_456},
    {"player_hand": [_CARD, _CARD], "dealer_up_card": _CARD, "is_player_blackjack": False},
] + [{"action": "double", "hand_index": 0, "hand_value_after": 21}] * 3
# Yacht (GameScreen.tsx): up to 3 rolls and one score per round.
_ROUND = [
    {"held": [True, False, True, False, True], "dice": [6, 6, 6, 2, 1], "rolls_used_after": 3}
] * 3 + [
    {
        "category": "three_of_a_kind",
        "value": 21,
        "is_joker": False,
        "available_alternatives": {k: 10 for k in ("ones", "twos", "chance", "yacht")},
    }
]


@pytest.mark.parametrize(
    ("cap", "payloads"),
    [
        (DEFAULT_CAP, _ROUND * 13),
        (STARSWARM_CAP, [_wave(i) for i in range(200)]),
        (TWENTY48_CAP, [_MOVE] * 2_000),
        (BLACKJACK_CAP, _HAND * 400),
    ],
    ids=[
        "yacht-13-rounds",
        "starswarm-200-waves",
        "twenty48-2000-moves",
        "blackjack-400-hands",
    ],
)
def test_todays_normal_games_fit_their_caps(cap: ReplayCap, payloads: list[dict]) -> None:
    d = apply_cap(cap, 0, 0, [event_bytes(p) for p in payloads])
    assert d.dropped == 0, d


def test_the_twenty48_figure_has_margin_over_a_measured_move() -> None:
    assert json_bytes(_MOVE) + ROW_OVERHEAD_BYTES <= TWENTY48_CAP.max_bytes // 2_000 - 10


def test_lifecycle_cap_counts_per_name_and_keeps_later_rows() -> None:
    cap = LifecycleCap(max_counts={"game_started": 2, "game_ended": 2}, max_bytes=10_000)
    items = [("game_started", 10), ("game_started", 10), ("game_ended", 10)]
    d = apply_lifecycle_cap(cap, {"game_started": 1}, 0, items)
    # The second game_started is over its count; the game_ended after it still lands.
    assert (d.kept, d.dropped, d.reason) == ([0, 2], 1, "game_started")


def test_lifecycle_cap_bounds_the_bytes() -> None:
    cap = LifecycleCap(max_counts={}, max_bytes=100)
    d = apply_lifecycle_cap(
        cap, {}, 50, [("hand_resolved", 40), ("hand_resolved", 40), ("game_ended", 10)]
    )
    assert (d.kept, d.dropped, d.reason) == ([0, 2], 1, "bytes")


def test_lifecycle_cap_limits() -> None:
    assert LIFECYCLE_CAP.max_counts == {"game_started": 4, "game_ended": 4, "hand_resolved": 1_000}
    # 1,000 Blackjack hands fit, with full-size start and end rows.
    hand = {"hand_index": 0, "outcome": "win", "payout_delta": 100, "chips_after": 12_345}
    items = (
        [("game_started", 8 * 1024 + ROW_OVERHEAD_BYTES)]
        + [("hand_resolved", event_bytes(hand))] * 1_000
        + [("game_ended", 8 * 1024 + ROW_OVERHEAD_BYTES)]
    )
    assert apply_lifecycle_cap(LIFECYCLE_CAP, {}, 0, items).dropped == 0


def test_report_cap_reached_is_throttled_per_game_type_and_kind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: sent.append((m, kw)))
    monkeypatch.setattr(replay_caps, "_throttles", {})
    d = apply_cap(ReplayCap(1, 100), 1, 0, [1])
    for _ in range(3):
        replay_caps.report_cap_reached("yacht", d, ReplayCap(1, 100))
    replay_caps.report_cap_reached("cascade", d, ReplayCap(1, 100))
    replay_caps.report_lifecycle_cap_reached("yacht", d)
    replay_caps.report_lifecycle_cap_reached("yacht", d)
    assert [m for m, _ in sent] == [
        "POST /games/{id}/events: replay cap reached (yacht)",
        "POST /games/{id}/events: replay cap reached (cascade)",
        "POST /games/{id}/events: lifecycle cap reached (yacht)",
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
    assert sent[2][1]["fingerprint"] == [replay_caps.LIFECYCLE_CAP_FINGERPRINT, "yacht"]


def test_server_flags_are_stripped_from_client_input() -> None:
    sent = {
        SWEPT_KEY: True,
        REPLAY_CAPPED_KEY: True,
        REPLAY_PAUSED_KEY: True,
        REPLAY_CUTOFF_KEY: 0,
        "mode": "solo",
    }
    assert without_server_flags(sent) == {"mode": "solo"}


def test_replay_cutoff_reads_only_an_integer() -> None:
    assert replay_cutoff({REPLAY_CUTOFF_KEY: 7}) == 7
    assert replay_cutoff({REPLAY_CUTOFF_KEY: 0}) == 0
    for bad in (None, True, "7", 7.0):
        assert replay_cutoff({REPLAY_CUTOFF_KEY: bad}) is None
    assert replay_cutoff(None) is None


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


def _sized(i: int, json_size: int) -> dict[str, Any]:
    """A roll whose compact JSON is ``json_size`` bytes (``{"p":"..."}`` is 8 + n)."""
    return {"event_index": i, "event_type": "roll", "data": {"p": "x" * (json_size - 8)}}


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


async def _metadata(gid: str) -> dict:
    async with get_session_factory()() as db:
        game = await db.get(Game, uuid.UUID(gid))
        assert game is not None
        return game.game_metadata


async def test_a_batch_past_the_event_cap_stores_up_to_the_cap_and_reports_once(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    _cap_yacht(monkeypatch, ReplayCap(max_events=3, max_bytes=1_000_000))
    gid = _new_game(client, session_id)
    events = [{"event_index": 0, "event_type": "game_started", "data": {}}]
    events += [_roll(i) for i in range(1, 6)]
    body = _post(client, session_id, gid, events)

    assert body == {"accepted": 4, "duplicates": 0, "rejected": [], "dropped": 2}
    assert await _stored(gid) == [(0, "game_started"), (1, "roll"), (2, "roll"), (3, "roll")]
    assert len(sent) == 1
    assert sent[0][1]["contexts"]["replay_cap"]["dropped"] == 2
    assert (await _metadata(gid))[REPLAY_CAPPED_KEY] is True

    # A later batch on the full game: replay dropped, lifecycle kept, still 2xx,
    # and the report is throttled.
    body = _post(
        client,
        session_id,
        gid,
        [_roll(6), {"event_index": 7, "event_type": "game_ended", "data": {}}],
    )
    assert body == {"accepted": 1, "duplicates": 0, "rejected": [], "dropped": 1}
    assert (await _stored(gid))[-1] == (7, "game_ended")
    assert len(await _stored(gid)) == 5
    assert len(sent) == 1


async def test_the_byte_cap_counts_stored_and_new_replay_bytes_with_overhead(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    size = event_bytes(_roll(0)["data"])
    # Two rows fit (the stored row's size is read back from the database, which
    # writes JSON with spaces, so give it a few bytes of slack); a third does not.
    _cap_yacht(monkeypatch, ReplayCap(max_events=1_000, max_bytes=size * 2 + 10))
    gid = _new_game(client, session_id)
    assert _post(client, session_id, gid, [_roll(1)])["accepted"] == 1
    assert _post(client, session_id, gid, [_roll(2), _roll(3)])["accepted"] == 1
    assert [i for i, _ in await _stored(gid)] == [1, 2]
    assert sent[0][1]["contexts"]["replay_cap"]["reason"] == "bytes"


async def test_no_gaps_across_batches(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    """Cap 100 B, batch [60, 50], then batch [10, 10]: once the 50 is dropped,
    the later 10s would fit but are dropped too, so the replay has no gap."""
    monkeypatch.setattr(replay_caps, "ROW_OVERHEAD_BYTES", 0)
    _cap_yacht(monkeypatch, ReplayCap(max_events=1_000, max_bytes=100))
    gid = _new_game(client, session_id)
    assert _post(client, session_id, gid, [_sized(1, 60), _sized(2, 50)])["accepted"] == 1
    assert _post(client, session_id, gid, [_sized(3, 10), _sized(4, 10)])["accepted"] == 0
    assert [i for i, _ in await _stored(gid)] == [1]
    # Lifecycle rows still land on a truncated game.
    end = {"event_index": 5, "event_type": "game_ended", "data": {}}
    assert _post(client, session_id, gid, [end])["accepted"] == 1


async def test_the_capped_flag_survives_completion_and_cannot_be_sent(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    _cap_yacht(monkeypatch, ReplayCap(max_events=0, max_bytes=0))
    gid = _new_game(client, session_id)
    _post(client, session_id, gid, [_roll(1)])
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(session_id),
        json={"final_score": 100, "outcome": "completed", "duration_ms": 1_000},
    )
    assert r.status_code == 200, r.text
    assert (await _metadata(gid))[REPLAY_CAPPED_KEY] is True

    r = client.post(
        "/games",
        headers=_headers(session_id),
        json={"game_type": "yacht", "metadata": {REPLAY_CAPPED_KEY: True}},
    )
    assert r.status_code == 422  # yacht's metadata forbids extra keys (#3221)


async def test_a_retried_batch_still_counts_its_duplicates_on_a_full_game(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    _cap_yacht(monkeypatch, ReplayCap(max_events=2, max_bytes=1_000_000))
    gid = _new_game(client, session_id)
    batch = [_roll(1), _roll(2), _roll(3)]
    assert _post(client, session_id, gid, batch) == {
        "accepted": 2,
        "duplicates": 0,
        "rejected": [],
        "dropped": 1,
    }
    assert _post(client, session_id, gid, batch) == {
        "accepted": 0,
        "duplicates": 2,
        "rejected": [],
        "dropped": 1,
    }
    assert [i for i, _ in await _stored(gid)] == [1, 2]


def test_under_the_cap_nothing_changes_and_nothing_reports(
    client: TestClient, session_id: str, sent
) -> None:
    gid = _new_game(client, session_id)
    body = _post(client, session_id, gid, [_roll(i) for i in range(1, 11)])
    assert body == {"accepted": 10, "duplicates": 0, "rejected": [], "dropped": 0}
    assert sent == []


async def test_lifecycle_rows_are_capped_per_game(
    client: TestClient, session_id: str, sent
) -> None:
    gid = _new_game(client, session_id)
    starts = [{"event_index": i, "event_type": "game_started", "data": {}} for i in range(6)]
    assert _post(client, session_id, gid, starts) == {
        "accepted": 4,
        "duplicates": 0,
        "rejected": [],
        "dropped": 2,
    }
    assert [m for m, _ in sent] == ["POST /games/{id}/events: lifecycle cap reached (yacht)"]
    assert sent[0][1]["contexts"]["lifecycle_cap"]["reason"] == "game_started"
    # The game is not marked replay-capped, and replay and game_ended still land.
    assert REPLAY_CAPPED_KEY not in await _metadata(gid)
    end = {"event_index": 7, "event_type": "game_ended", "data": {}}
    assert _post(client, session_id, gid, [_roll(6), end])["accepted"] == 2


async def test_stored_totals_count_deprecated_replay_types(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    """Rows of a type no longer in the active catalog still count toward the cap."""
    _cap_yacht(monkeypatch, ReplayCap(max_events=3, max_bytes=1_000_000))
    gid = _new_game(client, session_id)
    name = f"old_move_{uuid.uuid4().hex[:8]}"
    async with get_session_factory()() as db:
        game = await db.get(Game, uuid.UUID(gid))
        assert game is not None
        et = EventType(
            game_type_id=game.game_type_id,
            name=name,
            display_name="Old move",
            deprecated_at=datetime.now(UTC),
        )
        db.add(et)
        await db.flush()
        et_id = et.id
        db.add_all(
            [
                GameEvent(game_id=game.id, event_index=i, event_type_id=et_id, data={})
                for i in (1, 2)
            ]
        )
        await db.commit()
    try:
        async with get_session_factory()() as db:
            totals = await sessions.stored_event_totals(db, uuid.UUID(gid))
        assert (totals.replay_events, totals.replay_bytes) == (2, 2 * (2 + ROW_OVERHEAD_BYTES))
        # Two stored, one more fits.
        assert _post(client, session_id, gid, [_roll(3), _roll(4)])["accepted"] == 1
    finally:
        async with get_session_factory()() as db:
            await db.execute(delete(GameEvent).where(GameEvent.event_type_id == et_id))
            await db.execute(delete(EventType).where(EventType.id == et_id))
            await db.commit()


def test_append_events_takes_the_session_lock_then_the_game_row(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One lock order: the #3298 session advisory lock, then the game row FOR
    UPDATE (#3292), so a request waiting on the session never holds the row."""
    order: list[str] = []
    real_get, real_lock = sessions._get_owned_game, sessions.lock_session

    async def get_spy(session, game_id, sid, **kw):
        order.append(f"row(for_update={kw.get('for_update', False)})")
        return await real_get(session, game_id, sid, **kw)

    async def lock_spy(session, sid, namespace):
        order.append(f"session_lock({namespace})")
        await real_lock(session, sid, namespace)

    monkeypatch.setattr(sessions, "_get_owned_game", get_spy)
    monkeypatch.setattr(sessions, "lock_session", lock_spy)
    gid = _new_game(client, session_id)
    _post(client, session_id, gid, [_roll(1)])
    assert order == [f"session_lock({EVENTS_NAMESPACE})", "row(for_update=True)"]


async def test_a_cut_keeps_the_game_counters_equal_to_its_stored_rows(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    """The #3298 counters on ``games`` go down by what a replay cut deletes."""
    _cap_yacht(monkeypatch, ReplayCap(max_events=3, max_bytes=1_000_000))
    gid = _new_game(client, session_id)
    start = {"event_index": 0, "event_type": "game_started", "data": {}}
    _post(client, session_id, gid, [start, _score(20)])
    _post(client, session_id, gid, [_roll(5), _roll(1), _roll(4), _roll(2), _roll(3)])
    async with get_session_factory()() as db:
        game = await db.get(Game, uuid.UUID(gid))
        assert game is not None
        rows = (
            await db.execute(select(GameEvent.data).where(GameEvent.game_id == game.id))
        ).scalars()
        data = list(rows)
        assert game.event_count == len(data) == 3
        assert game.event_bytes == sum(payload_json_bytes(d) for d in data)


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


async def test_a_2000_move_2048_game_fits_across_ten_batches(
    client: TestClient, session_id: str, sent
) -> None:
    """New events are sized as stored rows are measured, so batches add up exactly."""
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug="twenty48"))
        await db.commit()
    r = client.post("/games", headers=_headers(session_id), json={"game_type": "twenty48"})
    assert r.status_code == 200, r.text
    gid = r.json()["id"]
    for batch in range(10):
        events = [
            {"event_index": i, "event_type": "move", "data": _MOVE}
            for i in range(batch * 200 + 1, batch * 200 + 201)
        ]
        assert _post(client, session_id, gid, events)["accepted"] == 200, batch
    assert len(await _stored(gid)) == 2_000
    assert sent == []
    assert REPLAY_CAPPED_KEY not in await _metadata(gid)


def _count_totals(monkeypatch: pytest.MonkeyPatch) -> list[uuid.UUID]:
    calls: list[uuid.UUID] = []
    real = sessions.stored_event_totals

    async def spy(session, game_id):
        calls.append(game_id)
        return await real(session, game_id)

    monkeypatch.setattr(sessions, "stored_event_totals", spy)
    return calls


async def test_a_capped_game_skips_the_totals_query_for_replay_only_batches(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    _cap_yacht(monkeypatch, ReplayCap(max_events=1, max_bytes=1_000_000))
    gid = _new_game(client, session_id)
    _post(client, session_id, gid, [_roll(1), _roll(2)])  # flags the game
    calls = _count_totals(monkeypatch)
    assert _post(client, session_id, gid, [_roll(3)])["accepted"] == 0
    assert calls == []
    # A lifecycle row needs the totals for its own cap.
    end = {"event_index": 4, "event_type": "game_ended", "data": {}}
    assert _post(client, session_id, gid, [_roll(5), end])["accepted"] == 1
    assert len(calls) == 1


def _count_cuts(monkeypatch: pytest.MonkeyPatch) -> list[tuple[int, str | None]]:
    cuts: list[tuple[int, str | None]] = []
    real = sessions._cut_replay

    async def spy(session, game, cutoff, reason_key):
        cuts.append((cutoff, reason_key))
        await real(session, game, cutoff, reason_key)

    monkeypatch.setattr(sessions, "_cut_replay", spy)
    return cuts


def _switch(monkeypatch: pytest.MonkeyPatch, enabled: bool) -> None:
    monkeypatch.setattr(sessions, "_settings", Settings.isolated(REPLAY_RECORDING_ENABLED=enabled))


def _score(i: int) -> dict[str, Any]:
    return {"event_index": i, "event_type": "score", "data": {"category": "chance", "value": 20}}


async def test_the_cap_is_a_prefix_by_index_not_by_arrival(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    """The app sends MID rows (``score``) before GRANULAR ones (``roll``): a
    higher-index score stored first is deleted when lower-index rolls trip the
    cap, so the stored replay stays a prefix by event_index."""
    _cap_yacht(monkeypatch, ReplayCap(max_events=3, max_bytes=1_000_000))
    gid = _new_game(client, session_id)
    start = {"event_index": 0, "event_type": "game_started", "data": {}}
    assert _post(client, session_id, gid, [start, _score(20)])["accepted"] == 2
    # Arrival order differs from index order on purpose.
    body = _post(client, session_id, gid, [_roll(5), _roll(1), _roll(4), _roll(2), _roll(3)])
    assert body == {"accepted": 2, "duplicates": 0, "rejected": [], "dropped": 3}
    # Rolls 1 and 2 fit next to the stored score; roll 3 does not, so the cut is
    # at 3 and the early score at 20 goes.
    assert await _stored(gid) == [(0, "game_started"), (1, "roll"), (2, "roll")]
    metadata = await _metadata(gid)
    assert metadata[REPLAY_CUTOFF_KEY] == 3 and metadata[REPLAY_CAPPED_KEY] is True
    assert len(sent) == 1
    # A later row at or above the cutoff is dropped; lifecycle still lands.
    end = {"event_index": 30, "event_type": "game_ended", "data": {}}
    assert _post(client, session_id, gid, [_score(25), end])["accepted"] == 1


async def test_a_lower_index_row_is_stored_if_it_fits_or_lowers_the_cutoff(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    _cap_yacht(monkeypatch, ReplayCap(max_events=3, max_bytes=1_000_000))
    gid = _new_game(client, session_id)
    _post(client, session_id, gid, [_score(20)])
    cuts = _count_cuts(monkeypatch)
    _post(client, session_id, gid, [_roll(i) for i in range(3, 8)])
    assert cuts == [(5, REPLAY_CAPPED_KEY)]
    assert [i for i, _ in await _stored(gid)] == [3, 4]
    # Index 2 is below the cutoff and fits: stored, the cutoff unchanged.
    assert _post(client, session_id, gid, [_roll(2)])["accepted"] == 1
    assert [i for i, _ in await _stored(gid)] == [2, 3, 4]
    assert cuts == [(5, REPLAY_CAPPED_KEY)]
    # Index 1 does not fit: the cutoff drops to 1, and everything from 1 up goes.
    assert _post(client, session_id, gid, [_roll(1)])["accepted"] == 0
    assert cuts == [(5, REPLAY_CAPPED_KEY), (1, REPLAY_CAPPED_KEY)]
    assert await _stored(gid) == []
    assert (await _metadata(gid))[REPLAY_CUTOFF_KEY] == 1


async def test_the_kill_switch_drops_replay_and_keeps_lifecycle(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    _switch(monkeypatch, False)
    calls = _count_totals(monkeypatch)
    cuts = _count_cuts(monkeypatch)
    gid = _new_game(client, session_id)
    assert _post(client, session_id, gid, [_roll(2), _roll(1)]) == {
        "accepted": 0,
        "duplicates": 0,
        "rejected": [],
        "dropped": 2,
    }
    assert calls == []  # nothing in the batch needed the totals
    start = {"event_index": 0, "event_type": "game_started", "data": {}}
    assert _post(client, session_id, gid, [start, _roll(3)])["accepted"] == 1
    assert await _stored(gid) == [(0, "game_started")]
    # Not a cap: nothing reported. Cut once, at the lowest dropped index.
    assert sent == []
    metadata = await _metadata(gid)
    assert metadata[REPLAY_PAUSED_KEY] is True and metadata[REPLAY_CUTOFF_KEY] == 1
    assert REPLAY_CAPPED_KEY not in metadata
    assert cuts == [(1, REPLAY_PAUSED_KEY)]


async def test_the_kill_switch_cuts_by_index_and_never_leaves_a_hole(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    """Off mid-game, then on: a higher-index row stored before the pause goes,
    later rows at or above the cut are dropped, and a lower one is accepted."""
    gid = _new_game(client, session_id)
    assert _post(client, session_id, gid, [_roll(1), _score(9)])["accepted"] == 2
    _switch(monkeypatch, False)
    assert _post(client, session_id, gid, [_roll(4), _roll(3)])["accepted"] == 0
    assert [i for i, _ in await _stored(gid)] == [1]  # the score at 9 is gone
    _switch(monkeypatch, True)
    calls = _count_totals(monkeypatch)
    cuts = _count_cuts(monkeypatch)
    assert _post(client, session_id, gid, [_roll(5), _roll(6)])["accepted"] == 0
    assert calls == [] and cuts == [] and sent == []
    # Index 2 is below the cut (3) and fits.
    assert _post(client, session_id, gid, [_roll(2)])["accepted"] == 1
    assert [i for i, _ in await _stored(gid)] == [1, 2]
    # Lifecycle rows still land; a game started afterwards records normally.
    end = {"event_index": 10, "event_type": "game_ended", "data": {}}
    assert _post(client, session_id, gid, [end])["accepted"] == 1
    fresh = _new_game(client, session_id)
    assert _post(client, session_id, fresh, [_roll(1)])["accepted"] == 1


async def test_the_kill_switch_does_not_raise_a_capped_games_cutoff(
    client: TestClient, session_id: str, monkeypatch: pytest.MonkeyPatch, sent
) -> None:
    _cap_yacht(monkeypatch, ReplayCap(max_events=1, max_bytes=1_000_000))
    gid = _new_game(client, session_id)
    _post(client, session_id, gid, [_roll(1), _roll(2)])
    _switch(monkeypatch, False)
    cuts = _count_cuts(monkeypatch)
    assert _post(client, session_id, gid, [_roll(3)])["accepted"] == 0
    assert cuts == []
    metadata = await _metadata(gid)
    assert metadata[REPLAY_CUTOFF_KEY] == 2 and REPLAY_PAUSED_KEY not in metadata


def test_the_kill_switch_setting(monkeypatch: pytest.MonkeyPatch) -> None:
    assert Settings.isolated().replay_recording_enabled is True
    monkeypatch.setenv("REPLAY_RECORDING_ENABLED", "false")
    assert Settings().replay_recording_enabled is False
    monkeypatch.setattr(sessions, "_settings", None)
    assert sessions._replay_recording_enabled() is False

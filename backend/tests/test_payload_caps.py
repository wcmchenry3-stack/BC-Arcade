"""Payload byte caps, per-game / per-session ceilings and bug_logs retention (#3298)."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from db.base import get_session_factory
from db.models import BugLog, Game, GameEntitlement, GameEvent
from games import sessions as game_sessions
from jobs import lifespan as jobs_lifespan
from logs import retention as bug_retention
from logs import service as log_service
from logs.retention import prune_expired_bug_logs
from settings import Settings
from tests._helpers import session_headers as _headers

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)


def _blob(total_bytes: int) -> dict:
    """A dict whose compact JSON is exactly ``total_bytes`` long."""
    overhead = len('{"b":""}')
    return {"b": "x" * (total_bytes - overhead)}


def _log(context: dict | None = None) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "logged_at": datetime.now(UTC).isoformat(),
        "level": "warn",
        "source": "test",
        "message": "m",
        "context": context if context is not None else {"k": "v"},
    }


async def _count(model, *where) -> int:
    async with get_session_factory()() as db:
        return (
            await db.execute(select(func.count()).select_from(model).where(*where))
        ).scalar_one()


@pytest.fixture
async def game(client: TestClient, session_id: str) -> str:
    async with get_session_factory()() as db:
        db.add(GameEntitlement(session_id=session_id, game_slug="yacht"))
        await db.commit()
    r = client.post("/games", headers=_headers(session_id), json={"game_type": "yacht"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _events(start: int, n: int, data: dict | None = None) -> dict:
    return {
        "events": [
            {"event_index": start + i, "event_type": "roll", "data": data or {"d": 1}}
            for i in range(n)
        ]
    }


def _use(monkeypatch: pytest.MonkeyPatch, module, **env: int) -> None:
    monkeypatch.setattr(module, "_settings", Settings.isolated(**env))


# --- game event data cap ----------------------------------------------------


def test_event_data_at_cap_is_stored(
    client: TestClient, session_id: str, game: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, game_sessions, MAX_EVENT_DATA_BYTES=1024)
    r = client.post(
        f"/games/{game}/events", headers=_headers(session_id), json=_events(0, 1, _blob(1024))
    )
    assert r.status_code == 200
    assert (r.json()["accepted"], r.json()["dropped"]) == (1, 0)


def test_event_data_over_cap_is_dropped_not_the_batch(
    client: TestClient, session_id: str, game: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, game_sessions, MAX_EVENT_DATA_BYTES=1024)
    body = _events(0, 2)
    body["events"][1]["data"] = _blob(1025)
    r = client.post(f"/games/{game}/events", headers=_headers(session_id), json=body)
    assert r.status_code == 200
    assert (r.json()["accepted"], r.json()["dropped"]) == (1, 1)


# --- per-game ceilings ------------------------------------------------------


async def test_game_past_event_count_ceiling_stops_growing(
    client: TestClient, session_id: str, game: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, game_sessions, MAX_EVENTS_PER_GAME=3)
    r1 = client.post(f"/games/{game}/events", headers=_headers(session_id), json=_events(0, 3))
    assert r1.json()["accepted"] == 3
    r2 = client.post(f"/games/{game}/events", headers=_headers(session_id), json=_events(3, 5))
    assert r2.status_code == 200
    assert (r2.json()["accepted"], r2.json()["dropped"]) == (0, 5)
    assert await _count(GameEvent, GameEvent.game_id == uuid.UUID(game)) == 3


async def test_game_past_byte_ceiling_stops_growing(
    client: TestClient, session_id: str, game: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, game_sessions, MAX_EVENT_BYTES_PER_GAME=1024, MAX_EVENT_DATA_BYTES=2048)
    r1 = client.post(
        f"/games/{game}/events", headers=_headers(session_id), json=_events(0, 1, _blob(1500))
    )
    assert r1.json()["accepted"] == 1
    r2 = client.post(f"/games/{game}/events", headers=_headers(session_id), json=_events(1, 1))
    assert (r2.json()["accepted"], r2.json()["dropped"]) == (0, 1)
    assert await _count(GameEvent, GameEvent.game_id == uuid.UUID(game)) == 1


# --- bug log context cap and per-session ceiling ----------------------------


def test_bug_context_at_cap_stored_over_cap_dropped(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, log_service, MAX_BUG_LOG_CONTEXT_BYTES=1024)
    sid = str(uuid.uuid4())
    r = client.post(
        "/logs/bug",
        headers=_headers(sid),
        json={"logs": [_log(_blob(1024)), _log(_blob(1025)), _log()]},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 2, "duplicates": 0, "dropped": 1}


async def test_session_past_bug_log_ceiling_stops_growing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, log_service, MAX_BUG_LOGS_PER_SESSION=3)
    sid = str(uuid.uuid4())
    r1 = client.post("/logs/bug", headers=_headers(sid), json={"logs": [_log() for _ in range(2)]})
    assert r1.json()["accepted"] == 2
    r2 = client.post("/logs/bug", headers=_headers(sid), json={"logs": [_log() for _ in range(4)]})
    assert r2.status_code == 200
    assert (r2.json()["accepted"], r2.json()["dropped"]) == (1, 3)
    assert await _count(BugLog, BugLog.session_id == sid) == 3
    # another session is unaffected
    other = client.post("/logs/bug", headers=_headers(str(uuid.uuid4())), json={"logs": [_log()]})
    assert other.json()["accepted"] == 1


def test_bug_log_duplicate_at_ceiling_still_counts_as_duplicate(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, log_service, MAX_BUG_LOGS_PER_SESSION=1)
    sid = str(uuid.uuid4())
    log = _log()
    client.post("/logs/bug", headers=_headers(sid), json={"logs": [log]})
    r = client.post("/logs/bug", headers=_headers(sid), json={"logs": [log]})
    assert r.json() == {"accepted": 0, "duplicates": 1, "dropped": 0}


# --- bug_logs retention -----------------------------------------------------


async def _add_bug_log(sid: str, received_at: datetime) -> None:
    async with get_session_factory()() as db:
        db.add(
            BugLog(
                id=uuid.uuid4(),
                session_id=sid,
                logged_at=received_at,
                received_at=received_at,
                level="warn",
                source="t",
                message="m",
                context={},
            )
        )
        await db.commit()


async def test_prune_deletes_only_bug_logs_past_retention() -> None:
    sid = f"ret-{uuid.uuid4()}"
    retention = timedelta(days=90)
    await _add_bug_log(sid, NOW - retention - timedelta(minutes=1))
    await _add_bug_log(sid, NOW - retention - timedelta(days=30))
    await _add_bug_log(sid, NOW - retention + timedelta(minutes=1))
    await _add_bug_log(sid, NOW)
    async with get_session_factory()() as db:
        events_before = (await db.execute(select(func.count()).select_from(GameEvent))).scalar_one()
        pruned = await prune_expired_bug_logs(db, now=NOW, retention=retention, batch_size=1)
        events_after = (await db.execute(select(func.count()).select_from(GameEvent))).scalar_one()
    assert pruned >= 2  # other tests' rows may be old too; ours are all gone
    assert await _count(BugLog, BugLog.session_id == sid, BugLog.received_at < NOW - retention) == 0
    assert await _count(BugLog, BugLog.session_id == sid) == 2
    assert events_before == events_after


async def test_prune_uses_the_configured_retention_days(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bug_retention, "_settings", Settings.isolated(BUG_LOG_RETENTION_DAYS=7))
    sid = f"ret-{uuid.uuid4()}"
    await _add_bug_log(sid, NOW - timedelta(days=8))
    await _add_bug_log(sid, NOW - timedelta(days=6))
    async with get_session_factory()() as db:
        await prune_expired_bug_logs(db, now=NOW)
    assert await _count(BugLog, BugLog.session_id == sid) == 1


def test_bug_log_retention_job_is_registered(monkeypatch: pytest.MonkeyPatch) -> None:
    names = [j.name for j in jobs_lifespan.configured_jobs()]
    assert "bug_logs_retention" in names
    assert bug_retention.retention_job(lambda: None).reraise_on_crash is True  # type: ignore[arg-type,return-value]


# --- batches that cross a ceiling, re-sends, byte measurement ---------------


async def test_batch_crossing_the_count_ceiling_is_partly_accepted(
    client: TestClient, session_id: str, game: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, game_sessions, MAX_EVENTS_PER_GAME=5)
    r = client.post(f"/games/{game}/events", headers=_headers(session_id), json=_events(0, 8))
    assert (r.json()["accepted"], r.json()["dropped"]) == (5, 3)
    assert (await _game_row(game)).event_count == 5


async def test_resent_batch_near_the_ceiling_accepts_new_events_up_to_it(
    client: TestClient, session_id: str, game: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, game_sessions, MAX_EVENTS_PER_GAME=5)
    h = _headers(session_id)
    assert (
        client.post(f"/games/{game}/events", headers=h, json=_events(0, 4)).json()["accepted"] == 4
    )
    # events 0-3 are stored; 4-8 are new. Stored ones are duplicates, not charged or dropped.
    r = client.post(f"/games/{game}/events", headers=h, json=_events(0, 9))
    assert r.json() == {"accepted": 1, "duplicates": 4, "rejected": [], "dropped": 4}
    assert (await _game_row(game)).event_count == 5


async def test_event_exactly_filling_the_game_byte_ceiling_is_stored_then_growth_stops(
    client: TestClient, session_id: str, game: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, game_sessions, MAX_EVENT_BYTES_PER_GAME=1024, MAX_EVENT_DATA_BYTES=1024)
    h = _headers(session_id)
    r1 = client.post(f"/games/{game}/events", headers=h, json=_events(0, 1, _blob(1024)))
    assert r1.json()["accepted"] == 1
    assert (await _game_row(game)).event_bytes == 1024
    r2 = client.post(f"/games/{game}/events", headers=h, json=_events(1, 1))
    assert (r2.json()["accepted"], r2.json()["dropped"]) == (0, 1)


def test_json_bytes_counts_utf8_bytes_not_characters() -> None:
    from payload_size import json_bytes

    assert json_bytes({"a": "é"}) == len('{"a":"é"}'.encode())  # 2-byte char, unescaped
    assert json_bytes({"a": "é"}) == len('{"a":"é"}') + 1


def test_multibyte_event_data_is_measured_in_bytes(
    client: TestClient, session_id: str, game: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, game_sessions, MAX_EVENT_DATA_BYTES=1024)
    # 600 two-byte chars: 600 characters but over 1024 bytes
    r = client.post(
        f"/games/{game}/events",
        headers=_headers(session_id),
        json=_events(0, 1, {"b": "é" * 600}),
    )
    assert (r.json()["accepted"], r.json()["dropped"]) == (0, 1)


# --- running counters and the per-session rolling-24 h ceiling --------------


async def _game_row(game_id: str) -> Game:
    async with get_session_factory()() as db:
        return (await db.execute(select(Game).where(Game.id == uuid.UUID(game_id)))).scalar_one()


def _new_game(client: TestClient, sid: str) -> str:
    r = client.post("/games", headers=_headers(sid), json={"game_type": "yacht"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def test_counters_match_stored_events_and_skip_dropped_and_duplicates(
    client: TestClient, session_id: str, game: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use(monkeypatch, game_sessions, MAX_EVENT_DATA_BYTES=1024)
    body = _events(0, 3)
    body["events"][2]["data"] = _blob(1025)  # dropped
    client.post(f"/games/{game}/events", headers=_headers(session_id), json=body)
    client.post(f"/games/{game}/events", headers=_headers(session_id), json=body)  # resend
    row = await _game_row(game)
    async with get_session_factory()() as db:
        stored = (
            (await db.execute(select(GameEvent).where(GameEvent.game_id == row.id))).scalars().all()
        )
    assert row.event_count == len(stored) == 2
    assert row.event_bytes == sum(
        len(json.dumps(e.data, separators=(",", ":"), ensure_ascii=False).encode()) for e in stored
    )


async def test_session_past_daily_event_ceiling_stops_growing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = str(uuid.uuid4())
    other = str(uuid.uuid4())
    for s in (sid, other):
        async with get_session_factory()() as db:
            db.add(GameEntitlement(session_id=s, game_slug="yacht"))
            await db.commit()
    _use(
        monkeypatch,
        game_sessions,
        MAX_EVENT_BYTES_PER_SESSION_DAY=2048,
        MAX_EVENT_DATA_BYTES=1024,
    )
    g1, g2, g3 = (_new_game(client, sid) for _ in range(3))
    h = _headers(sid)
    r1 = client.post(f"/games/{g1}/events", headers=h, json=_events(0, 2, _blob(1024)))
    assert r1.json()["accepted"] == 2
    r2 = client.post(f"/games/{g2}/events", headers=h, json=_events(0, 1))
    assert (r2.json()["accepted"], r2.json()["dropped"]) == (0, 1)
    # another session is unaffected
    og = _new_game(client, other)
    ro = client.post(f"/games/{og}/events", headers=_headers(other), json=_events(0, 1))
    assert ro.json()["accepted"] == 1
    # games older than 24 h no longer count
    async with get_session_factory()() as db:
        await db.execute(
            update(Game)
            .where(Game.id == uuid.UUID(g1))
            .values(created_at=datetime.now(UTC) - timedelta(hours=25))
        )
        await db.commit()
    r3 = client.post(f"/games/{g3}/events", headers=h, json=_events(0, 1))
    assert r3.json()["accepted"] == 1

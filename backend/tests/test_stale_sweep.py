"""Stale-session sweep (#2621): games left open > 24 h are closed as abandoned.

The sweep runs on read, per player, at the start of ``/stats/me`` and
``/games/me``. A real completion that arrives later replaces the swept values.
"""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Text, cast, event, select, text
from sqlalchemy.dialects import postgresql

from db.base import get_engine, get_session_factory, is_configured
from db.models import Game, GameType
from games import service
from games.filters import not_swept
from games.service import STALE_GAME_AFTER, sweep_stale_games

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping stale-sweep tests",
)

_NOW = datetime.now(timezone.utc)


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


def _headers(sid: str) -> dict[str, str]:
    return {"X-Session-ID": sid, "Content-Type": "application/json"}


def _utc(ts: datetime | None) -> datetime | None:
    """SQLite hands timestamps back naive; they are UTC."""
    if ts is None or ts.tzinfo is not None:
        return ts
    return ts.replace(tzinfo=timezone.utc)


async def _add(
    sid: str,
    *,
    started_ago: timedelta,
    game_type: str = "yacht",
    completed_ago: timedelta | None = None,
    **fields,
) -> uuid.UUID:
    factory = get_session_factory()
    async with factory() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == game_type))
        ).scalar_one()
        game = Game(
            session_id=sid,
            game_type_id=gt_id,
            started_at=_NOW - started_ago,
            completed_at=_NOW - completed_ago if completed_ago is not None else None,
            outcome=fields.get("outcome"),
            final_score=fields.get("final_score"),
            duration_ms=fields.get("duration_ms"),
            game_metadata=fields.get("metadata", {}),
        )
        db.add(game)
        await db.commit()
        return game.id


async def _get(game_id: uuid.UUID) -> Game:
    factory = get_session_factory()
    async with factory() as db:
        return (await db.execute(select(Game).where(Game.id == game_id))).scalar_one()


async def _sweep(sid: str, now: datetime = _NOW) -> int:
    factory = get_session_factory()
    async with factory() as db:
        return await sweep_stale_games(db, session_id=sid, now=now)


# ---------------------------------------------------------------------------
# The sweep itself
# ---------------------------------------------------------------------------


async def test_a_23_hour_open_row_is_untouched() -> None:
    sid = str(uuid.uuid4())
    gid = await _add(sid, started_ago=timedelta(hours=23))
    assert await _sweep(sid) == 0
    g = await _get(gid)
    assert g.completed_at is None
    assert g.outcome is None
    assert "swept" not in g.game_metadata


async def test_a_25_hour_open_row_is_swept_as_abandoned() -> None:
    sid = str(uuid.uuid4())
    gid = await _add(sid, started_ago=timedelta(hours=25), metadata={"player_name": "Ann"})
    assert await _sweep(sid) == 1
    g = await _get(gid)
    assert g.outcome == "abandoned"
    assert _utc(g.completed_at) == _utc(g.started_at) + STALE_GAME_AFTER
    assert g.game_metadata == {"player_name": "Ann", "swept": True}
    assert g.duration_ms is None
    assert g.final_score is None


async def test_a_completed_row_is_untouched() -> None:
    sid = str(uuid.uuid4())
    gid = await _add(
        sid,
        started_ago=timedelta(hours=30),
        completed_ago=timedelta(hours=29),
        outcome="completed",
        final_score=200,
        duration_ms=60_000,
    )
    before = await _get(gid)
    assert await _sweep(sid) == 0
    after = await _get(gid)
    assert (after.outcome, after.final_score, after.duration_ms) == ("completed", 200, 60_000)
    assert after.completed_at == before.completed_at
    assert after.game_metadata == {}


async def test_the_sweep_is_idempotent() -> None:
    sid = str(uuid.uuid4())
    gid = await _add(sid, started_ago=timedelta(hours=25))
    assert await _sweep(sid) == 1
    first = await _get(gid)
    # A later run — even much later — matches nothing: the row is no longer open.
    assert await _sweep(sid, now=_NOW + timedelta(days=3)) == 0
    second = await _get(gid)
    assert second.completed_at == first.completed_at
    assert second.game_metadata == first.game_metadata == {"swept": True}


async def test_the_sweep_is_scoped_to_the_callers_session() -> None:
    mine, theirs = str(uuid.uuid4()), str(uuid.uuid4())
    their_gid = await _add(theirs, started_ago=timedelta(hours=25))
    assert await _sweep(mine) == 0
    assert (await _get(their_gid)).completed_at is None


# ---------------------------------------------------------------------------
# Late completions
# ---------------------------------------------------------------------------


async def test_a_late_real_completion_replaces_a_swept_row(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    gid = await _add(sid, started_ago=timedelta(hours=30), metadata={"player_name": "Ann"})
    assert await _sweep(sid) == 1

    # A long-offline device flushes its queue: events, then the completion.
    r = client.post(
        f"/games/{gid}/events",
        headers=_headers(sid),
        json={"events": [{"event_index": 0, "event_type": "game_started", "data": {}}]},
    )
    assert r.status_code == 200, r.text
    finished_at = _NOW - timedelta(hours=29)
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={
            "final_score": 240,
            "outcome": "completed",
            "duration_ms": 3_600_000,
            "completed_at": finished_at.isoformat(),
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["outcome"], body["final_score"], body["duration_ms"]) == (
        "completed",
        240,
        3_600_000,
    )

    g = await _get(gid)
    assert abs(_utc(g.completed_at) - finished_at) < timedelta(milliseconds=1)
    # The flag is gone: the row is back under "first completion wins".
    assert g.game_metadata == {"player_name": "Ann"}

    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={"final_score": 1, "outcome": "abandoned", "duration_ms": 1},
    )
    assert r.status_code == 200
    assert r.json()["final_score"] == 240


async def test_a_late_completion_on_a_normally_completed_row_is_ignored(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    gid = await _add(
        sid,
        started_ago=timedelta(hours=30),
        completed_ago=timedelta(hours=29),
        outcome="completed",
        final_score=200,
        duration_ms=60_000,
    )
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={"final_score": 999, "outcome": "completed", "duration_ms": 1},
    )
    assert r.status_code == 200
    assert (r.json()["final_score"], r.json()["duration_ms"]) == (200, 60_000)
    r = client.post(
        f"/games/{gid}/events",
        headers=_headers(sid),
        json={"events": [{"event_index": 0, "event_type": "game_started", "data": {}}]},
    )
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# On read: /stats/me and /games/me
# ---------------------------------------------------------------------------


async def test_stats_me_counts_a_swept_game_as_played_but_it_earns_no_xp(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    await _add(
        sid,
        started_ago=timedelta(hours=2),
        completed_ago=timedelta(hours=1),
        outcome="completed",
        final_score=150,
    )
    baseline = client.get("/stats/me", headers=_headers(sid)).json()
    assert baseline["by_game"]["yacht"]["played"] == 1

    await _add(sid, started_ago=timedelta(hours=25))
    body = client.get("/stats/me", headers=_headers(sid)).json()
    assert body["total_games"] == 2
    assert body["by_game"]["yacht"]["played"] == 2
    assert body["by_game"]["yacht"]["best"] == 150
    assert body["arcade_xp"] == baseline["arcade_xp"]


async def test_games_me_lists_a_swept_game_as_abandoned(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    gid = await _add(sid, started_ago=timedelta(hours=25))
    items = client.get("/games/me", headers=_headers(sid)).json()["items"]
    assert [(i["id"], i["outcome"], i["metadata"]) for i in items] == [
        (str(gid), "abandoned", {"swept": True})
    ]
    assert items[0]["completed_at"] is not None
    assert items[0]["duration_ms"] is None


async def test_a_swept_older_session_never_supplies_the_latest_metadata(
    client: TestClient,
) -> None:
    # Blackjack reads its run aggregates from the latest row's metadata. A swept
    # row's completed_at (started_at + 24 h) can postdate newer games; since the
    # latest row is picked by started_at, its older aggregates do not win.
    sid = str(uuid.uuid4())
    await _add(
        sid,
        game_type="blackjack",
        started_ago=timedelta(hours=3),
        completed_ago=timedelta(hours=2),
        outcome="win",
        final_score=1200,
        metadata={"total_runs": 5, "current_table": "high"},
    )
    await _add(
        sid,
        game_type="blackjack",
        started_ago=timedelta(hours=25),  # swept to completed_at = now − 1 h
        metadata={"total_runs": 4, "current_table": "low"},
    )
    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["played"] == 2
    assert (bj["total_runs"], bj["current_table"]) == (5, "high")


async def test_a_swept_newest_session_still_supplies_the_latest_metadata(
    client: TestClient,
) -> None:
    # Blackjack writes its run aggregates when a session *starts*. When the swept
    # session is the newest one it holds the freshest figures, so excluding it
    # would roll the Profile back to an older run.
    sid = str(uuid.uuid4())
    await _add(
        sid,
        game_type="blackjack",
        started_ago=timedelta(hours=50),
        completed_ago=timedelta(hours=49),
        outcome="completed",
        final_score=1200,
        metadata={"total_runs": 3, "current_table": "low"},
    )
    await _add(
        sid,
        game_type="blackjack",
        started_ago=timedelta(hours=25),
        metadata={"total_runs": 4, "current_table": "high"},
    )
    bj = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["blackjack"]
    assert bj["played"] == 2
    assert (bj["total_runs"], bj["current_table"]) == (4, "high")
    # ...while the live chip balance still skips the swept (abandoned) table.
    assert bj["current_chips"] == 1200


async def test_last_played_at_ignores_a_swept_rows_synthetic_completed_at(
    client: TestClient,
) -> None:
    sid = str(uuid.uuid4())
    played_at = _NOW - timedelta(hours=3)
    await _add(
        sid,
        started_ago=timedelta(hours=4),
        completed_ago=timedelta(hours=3),
        outcome="completed",
        final_score=150,
    )
    # Swept to completed_at = now − 1 h: later than the real play, but not one.
    await _add(sid, started_ago=timedelta(hours=25))
    yacht = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["yacht"]
    assert yacht["played"] == 2
    last = _utc(datetime.fromisoformat(yacht["last_played_at"]))
    assert abs(last - played_at) < timedelta(milliseconds=1)


async def test_last_played_at_is_null_when_every_row_was_swept(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    await _add(sid, started_ago=timedelta(hours=25))
    yacht = client.get("/stats/me", headers=_headers(sid)).json()["by_game"]["yacht"]
    assert (yacht["played"], yacht["last_played_at"]) == (1, None)


async def test_games_me_sweeps_on_the_first_page_only(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    gid = await _add(sid, started_ago=timedelta(hours=25))
    later_page = client.get(
        "/games/me",
        headers=_headers(sid),
        params={"cursor": (_NOW + timedelta(hours=1)).isoformat()},
    )
    assert later_page.status_code == 200, later_page.text
    assert [(i["id"], i["outcome"]) for i in later_page.json()["items"]] == [(str(gid), None)]
    assert (await _get(gid)).completed_at is None

    first_page = client.get("/games/me", headers=_headers(sid)).json()["items"]
    assert [(i["id"], i["outcome"]) for i in first_page] == [(str(gid), "abandoned")]


def _count_statements(client: TestClient, sid: str) -> list[str]:
    statements: list[str] = []

    def record(_conn, _cursor, statement, *_rest) -> None:
        statements.append(statement)

    engine = get_engine().sync_engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        assert client.get("/stats/me", headers=_headers(sid)).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return statements


async def test_the_sweep_adds_one_query_to_stats_me(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = str(uuid.uuid4())
    await _add(sid, started_ago=timedelta(hours=2), completed_ago=timedelta(hours=1))
    # Warm-up: the first streak read freezes the window's daily templates (an INSERT).
    _count_statements(client, sid)
    with_sweep = _count_statements(client, sid)

    async def no_sweep(*_args, **_kwargs) -> int:
        return 0

    monkeypatch.setattr(service, "sweep_stale_games", no_sweep)
    without_sweep = _count_statements(client, sid)

    assert len(with_sweep) - len(without_sweep) == 1, with_sweep
    assert [s for s in with_sweep if s.lstrip().upper().startswith("UPDATE GAMES")]


@pytest.mark.parametrize("path", ["/stats/me", "/games/me"])
async def test_a_failing_sweep_never_breaks_the_read(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    path: str,
) -> None:
    sid = str(uuid.uuid4())
    await _add(
        sid,
        started_ago=timedelta(hours=2),
        completed_ago=timedelta(hours=1),
        outcome="completed",
        final_score=150,
    )

    raised: list[str] = []

    async def broken_sweep(session, *, session_id: str, **_kwargs) -> int:
        # A real DB error inside the session's transaction, so the rollback
        # path is exercised too (Postgres aborts the transaction on error). The
        # session id is a bound parameter, as in the real sweep, so it is in
        # the exception's text.
        try:
            await session.execute(
                text("UPDATE no_such_table SET x = 1 WHERE session_id = :sid"),
                {"sid": session_id},
            )
        except Exception as exc:
            raised.append(str(exc))
            raise
        return 0

    monkeypatch.setattr(service, "sweep_stale_games", broken_sweep)
    # INFO and up: what Sentry's default logging integration records (DEBUG
    # driver chatter, e.g. aiosqlite echoing statements, never reaches it).
    with caplog.at_level(logging.INFO):
        r = client.get(path, headers=_headers(sid))
    assert r.status_code == 200, r.text
    if path == "/stats/me":
        assert r.json()["by_game"]["yacht"]["played"] == 1
    else:
        assert len(r.json()["items"]) == 1

    assert raised and sid in raised[0], "the test must put the session id in the error"
    errors = [rec for rec in caplog.records if "stale-session sweep failed" in rec.getMessage()]
    assert len(errors) == 1
    (rec,) = errors
    assert rec.levelno == logging.ERROR
    # Class name only: no traceback or exception text for Sentry to pick up.
    assert rec.exc_info is None
    assert rec.exc_text is None
    assert "OperationalError" in rec.getMessage()
    # No session id anywhere in what was logged.
    for record in caplog.records:
        assert sid not in record.getMessage()
        assert sid not in repr(record.args)
        assert not record.exc_info or sid not in repr(record.exc_info[1])
        assert sid not in (record.exc_text or "")
    assert sid not in caplog.text


# ---------------------------------------------------------------------------
# The swept flag is server-written only (#2621 review)
# ---------------------------------------------------------------------------


def test_not_swept_never_casts_the_flag_on_postgres() -> None:
    # CAST(metadata->>'swept' AS BOOLEAN) raises on {"swept": "maybe"}, failing
    # /stats/me with a 500. The predicate compares JSON values instead.
    sql = str(select(Game.id).where(not_swept()).compile(dialect=postgresql.dialect()))
    assert "CAST" not in sql.upper()
    assert "IS DISTINCT FROM 'true'::jsonb" in sql


async def test_only_json_true_marks_a_row_swept(client: TestClient) -> None:
    sid = str(uuid.uuid4())
    values = {
        "absent": None,
        "yes": "yes",
        "string": "true",
        "maybe": "maybe",
        "one": 1,
        "false": False,
    }
    ids = {}
    for label, value in values.items():
        metadata = {} if value is None else {"swept": value}
        ids[label] = await _add(
            sid,
            started_ago=timedelta(hours=3),
            completed_ago=timedelta(hours=2),
            outcome="completed",
            final_score=10,
            metadata=metadata,
        )
    ids["true"] = await _add(sid, started_ago=timedelta(hours=25))
    assert await _sweep(sid) == 1

    factory = get_session_factory()
    async with factory() as db:
        kept = set(
            (await db.execute(select(Game.id).where(Game.session_id == sid, not_swept())))
            .scalars()
            .all()
        )
    assert kept == {ids[label] for label in values}

    r = client.get("/stats/me", headers=_headers(sid))
    assert r.status_code == 200, r.text
    assert r.json()["by_game"]["yacht"]["played"] == len(values) + 1
    # A spoofed non-boolean flag does not make a finished row overwritable.
    r = client.patch(
        f"/games/{ids['yes']}/complete",
        headers=_headers(sid),
        json={"final_score": 999, "outcome": "completed", "duration_ms": 1},
    )
    assert r.json()["final_score"] == 10


def _create(client: TestClient, sid: str, game_type: str, metadata: dict) -> str:
    r = client.post(
        "/games", headers=_headers(sid), json={"game_type": game_type, "metadata": metadata}
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _complete(client: TestClient, sid: str, gid: str, score: int, **extra) -> dict:
    r = client.patch(
        f"/games/{gid}/complete",
        headers=_headers(sid),
        json={"final_score": score, "outcome": "completed", "duration_ms": 1_000, **extra},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_a_client_sending_the_swept_flag_at_create_is_rejected(client: TestClient) -> None:
    # Every game's metadata model forbids unknown keys (#2623), so the flag
    # never reaches create_game over HTTP.
    r = client.post(
        "/games",
        headers=_headers(str(uuid.uuid4())),
        json={"game_type": "twenty48", "metadata": {"swept": True}},
    )
    assert r.status_code == 422


async def test_create_game_drops_the_swept_flag() -> None:
    # Defence in depth below the models: create_game never stores the flag.
    sid = str(uuid.uuid4())
    async with get_session_factory()() as db:
        game = await service.create_game(
            db,
            session_id=sid,
            client_id=None,
            game_type_name="cascade",
            metadata={"swept": True, "player_name": "Ann"},
            players=[],
        )
        gid = game.id
    assert (await _get(gid)).game_metadata == {"player_name": "Ann"}


async def test_a_result_cannot_set_the_swept_flag(client: TestClient) -> None:
    # Yacht has no result model, so its result is merged as sent — except the flag.
    sid = str(uuid.uuid4())
    gid = _create(client, sid, "yacht", {})
    assert (
        _complete(client, sid, gid, 100, result={"swept": True, "rolls": 3})["final_score"] == 100
    )
    metadata = (await _get(uuid.UUID(gid))).game_metadata
    assert "swept" not in metadata and metadata["rolls"] == 3
    # First completion wins: the finished row is not overwritable.
    assert _complete(client, sid, gid, 999)["final_score"] == 100


# ---------------------------------------------------------------------------
# A sweep racing a completion (#2621 review)
# ---------------------------------------------------------------------------


async def test_a_sweep_committing_mid_completion_leaves_the_row_unflagged(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # complete_game reads the row while it is still open; a /stats/me sweep then
    # commits; then the completion commits. The row must end finished and
    # unflagged, or a later completion could overwrite it.
    sid = str(uuid.uuid4())
    gid = await _add(sid, started_ago=timedelta(hours=25), metadata={"player_name": "Ann"})
    real_get = service._get_owned_game
    swept_mid_completion: list[int] = []

    async def get_then_sweep(*args, **kwargs):
        game = await real_get(*args, **kwargs)
        if not swept_mid_completion:
            assert game.completed_at is None, "the completion must read the row open"
            swept_mid_completion.append(await _sweep(sid))
        return game

    monkeypatch.setattr(service, "_get_owned_game", get_then_sweep)
    body = _complete(client, sid, str(gid), 240)
    monkeypatch.setattr(service, "_get_owned_game", real_get)

    assert swept_mid_completion == [1]
    assert (body["outcome"], body["final_score"]) == ("completed", 240)
    g = await _get(gid)
    assert (g.outcome, g.final_score, g.duration_ms) == ("completed", 240, 1_000)
    assert g.game_metadata == {"player_name": "Ann"}
    assert _complete(client, sid, str(gid), 999)["final_score"] == 240


# ---------------------------------------------------------------------------
# SQLite timestamp format (#2621 review)
# ---------------------------------------------------------------------------


async def _raw_completed_at(game_id: uuid.UUID) -> str:
    factory = get_session_factory()
    async with factory() as db:
        return (
            await db.execute(select(cast(Game.completed_at, Text)).where(Game.id == game_id))
        ).scalar_one()


@pytest.mark.skipif(
    not os.environ.get("DATABASE_URL", "").startswith("sqlite"),
    reason="SQLite stores timestamps as text; Postgres compares real timestamps",
)
async def test_a_swept_completed_at_is_stored_in_the_orms_sqlite_format() -> None:
    sid = str(uuid.uuid4())
    started = (_NOW - timedelta(hours=25)).replace(microsecond=123456)
    stale = await _add(sid, started_ago=_NOW - started)
    # A normal row that finished 56 µs *before* the swept row's completed_at.
    # With millisecond text ('…:SS.123') the swept row sorted first.
    normal = await _add(
        sid,
        started_ago=timedelta(hours=2),
        completed_ago=_NOW - (started + STALE_GAME_AFTER - timedelta(microseconds=56)),
        outcome="completed",
    )
    # A started_at stored without a fraction (SQLite's CURRENT_TIMESTAMP default).
    whole = await _add(sid, started_ago=timedelta(hours=26))
    factory = get_session_factory()
    async with factory() as db:
        await db.execute(
            text("UPDATE games SET started_at = :ts WHERE id = :id"),
            {"ts": "2026-01-02 03:04:05", "id": whole.hex},
        )
        await db.commit()

    assert await _sweep(sid) == 2

    expected = (started + STALE_GAME_AFTER).strftime("%Y-%m-%d %H:%M:%S.%f")
    assert await _raw_completed_at(stale) == expected
    assert await _raw_completed_at(whole) == "2026-01-03 03:04:05.000000"
    async with factory() as db:
        ordered = (
            (
                await db.execute(
                    select(Game.id)
                    .where(Game.session_id == sid, Game.id.in_([stale, normal]))
                    .order_by(Game.completed_at)
                )
            )
            .scalars()
            .all()
        )
    assert ordered == [normal, stale]

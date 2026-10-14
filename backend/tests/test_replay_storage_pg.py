"""The replay-storage SQL on real Postgres (#3292).

The suite runs on SQLite, where ``octet_length(data::text)``, the batched
tuple-``IN`` delete, ``pg_total_relation_size`` and the advisory lock are
either different or absent. CI's test-postgres job runs this file against a
migrated Postgres (``DATABASE_URL``); elsewhere it is skipped.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, func, select, text

from db.base import get_session_factory
from db.models import EventType, Game, GameEvent, GameType
from games import replay_caps, replay_storage, sessions
from games.filters import REPLAY_CAPPED_KEY
from games.replay_caps import ROW_OVERHEAD_BYTES
from observability import report

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL", "").startswith("postgres"),
    reason="DATABASE_URL is not Postgres — the replay-storage SQL is checked on Postgres only",
)

OLD = datetime.now(UTC) - timedelta(days=4000)


@pytest.fixture
async def games() -> AsyncIterator[list[uuid.UUID]]:
    created: list[uuid.UUID] = []
    yield created
    async with get_session_factory()() as db:
        await db.execute(delete(Game).where(Game.id.in_(created)))
        await db.commit()


async def _game(
    created: list[uuid.UUID], game_type: str, rows: list[tuple[str, dict]]
) -> uuid.UUID:
    async with get_session_factory()() as db:
        type_id = (
            await db.execute(select(GameType.id).where(GameType.name == game_type))
        ).scalar_one()
        ids = dict(
            (
                await db.execute(
                    select(EventType.name, EventType.id).where(EventType.game_type_id == type_id)
                )
            ).all()
        )
        game = Game(
            session_id=str(uuid.uuid4()), game_type_id=type_id, game_metadata={}, players=[]
        )
        db.add(game)
        await db.flush()
        db.add_all(
            [
                GameEvent(
                    game_id=game.id, event_index=i, event_type_id=ids[n], data=d, occurred_at=OLD
                )
                for i, (n, d) in enumerate(rows)
            ]
        )
        await db.commit()
        created.append(game.id)
        return game.id


async def _names(game_id: uuid.UUID) -> list[str]:
    async with get_session_factory()() as db:
        rows = await db.execute(
            select(EventType.name)
            .join(GameEvent, EventType.id == GameEvent.event_type_id)
            .where(GameEvent.game_id == game_id)
            .order_by(GameEvent.event_index)
        )
        return list(rows.scalars())


async def test_stored_totals_use_octet_length_of_the_jsonb_text(games) -> None:
    rows = [
        ("game_started", {}),
        ("roll", {"dice": [1, 2, 3, 4, 5]}),
        ("roll", {"name": "é"}),  # two bytes in UTF-8
        ("game_ended", {"score": 10}),
    ]
    gid = await _game(games, "yacht", rows)
    async with get_session_factory()() as db:
        totals = await sessions.stored_event_totals(db, gid)
        expected = (
            await db.execute(
                select(func.sum(func.octet_length(text("data::text")))).where(
                    GameEvent.game_id == gid, GameEvent.event_index.in_([1, 2])
                )
            )
        ).scalar_one()
    # jsonb::text: '{"dice": [1, 2, 3, 4, 5]}' (25) and '{"name": "é"}' (14).
    assert expected == 25 + 14
    assert totals.replay_events == 2
    assert totals.replay_bytes == expected + 2 * ROW_OVERHEAD_BYTES
    assert totals.lifecycle_counts == {"game_started": 1, "game_ended": 1}


async def test_batched_delete_keeps_lifecycle_and_keep_list_rows(games) -> None:
    yacht = await _game(
        games,
        "yacht",
        [("game_started", {})] + [("roll", {"i": i}) for i in range(5)] + [("game_ended", {})],
    )
    swarm = await _game(
        games, "starswarm", [("game_started", {}), ("wave_completed", {"w": 1}), ("game_ended", {})]
    )
    word = await _game(games, "daily_word", [("game_started", {}), ("guess_submitted", {"g": "x"})])
    keep = timedelta(days=3999)
    async with get_session_factory()() as db:
        assert (
            await replay_storage.prune_replay_events(db, keep=keep, batch_size=2, max_batches=2)
            == 4
        )
        assert await replay_storage.prune_replay_events(db, keep=keep, batch_size=2) == 1
    assert await _names(yacht) == ["game_started", "game_ended"]
    assert await _names(swarm) == ["game_started", "wave_completed", "game_ended"]
    assert await _names(word) == ["game_started", "guess_submitted"]
    async with get_session_factory()() as db:
        assert await db.get(Game, yacht) is not None


async def test_measure_storage_reads_the_relation_and_database_sizes() -> None:
    async with get_session_factory()() as db:
        size = await replay_storage.measure_storage(db)
    assert size is not None
    assert 0 < size.events_bytes < size.database_bytes


async def test_the_advisory_lock_lets_one_instance_run() -> None:
    factory = get_session_factory()
    async with factory() as first:
        assert await replay_storage.try_run_lock(first) is True
        async with factory() as second:
            assert await replay_storage.try_run_lock(second) is False
            await second.rollback()
        # Closing the holder's transaction releases it.
        await first.rollback()
        async with factory() as third:
            assert await replay_storage.try_run_lock(third) is True
            await third.rollback()


async def test_append_events_caps_and_flags_on_postgres(
    games, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The write path end to end on Postgres: FOR UPDATE, the totals query, the flag."""
    monkeypatch.setitem(replay_caps.CAPS_BY_GAME_TYPE, "yacht", replay_caps.ReplayCap(2, 10**6))
    monkeypatch.setattr(replay_caps, "_throttles", {})
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda *a, **kw: None)
    gid = await _game(games, "yacht", [("game_started", {})])
    async with get_session_factory()() as db:
        game = await db.get(Game, gid)
        assert game is not None
        sid = game.session_id

    def rolls(*idx: int) -> list[dict]:
        return [{"event_index": i, "event_type": "roll", "data": {"i": i}} for i in idx]

    async with get_session_factory()() as db:
        r = await sessions.append_events(db, game_id=gid, session_id=sid, events=rolls(1, 2, 3))
    assert (r.accepted, r.duplicates) == (2, 0)
    async with get_session_factory()() as db:
        r = await sessions.append_events(db, game_id=gid, session_id=sid, events=rolls(1, 4))
    assert (r.accepted, r.duplicates) == (0, 1)
    async with get_session_factory()() as db:
        game = await db.get(Game, gid)
        assert game is not None
        assert game.game_metadata == {REPLAY_CAPPED_KEY: True}
    assert await _names(gid) == ["game_started", "roll", "roll"]

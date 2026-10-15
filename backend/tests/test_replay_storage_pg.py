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
from games.filters import REPLAY_CAPPED_KEY, REPLAY_CUTOFF_KEY
from games.replay_caps import ROW_OVERHEAD_BYTES
from observability import report
from payload_size import jsonb_bytes
from settings import Settings

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
        assert game.game_metadata == {REPLAY_CAPPED_KEY: True, REPLAY_CUTOFF_KEY: 3}
    assert await _names(gid) == ["game_started", "roll", "roll"]


async def test_the_cap_cuts_by_index_on_postgres(games, monkeypatch: pytest.MonkeyPatch) -> None:
    """Tier order end to end: a high-index ``score`` stored first is deleted when
    lower-index rolls trip the cap, and the replay is a prefix by index."""
    monkeypatch.setitem(replay_caps.CAPS_BY_GAME_TYPE, "yacht", replay_caps.ReplayCap(3, 10**6))
    monkeypatch.setattr(replay_caps, "_throttles", {})
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda *a, **kw: None)
    gid = await _game(games, "yacht", [("game_started", {})])
    async with get_session_factory()() as db:
        game = await db.get(Game, gid)
        assert game is not None
        sid = game.session_id

    async def post(events: list[dict]) -> int:
        async with get_session_factory()() as db:
            r = await sessions.append_events(db, game_id=gid, session_id=sid, events=events)
        return r.accepted

    score = {"event_index": 20, "event_type": "score", "data": {"category": "chance", "value": 9}}
    assert await post([score]) == 1
    rolls = [{"event_index": i, "event_type": "roll", "data": {"i": i}} for i in (5, 1, 4, 2, 3)]
    # Rolls 1-3 fill the cap in index order (the score is not charged to them).
    assert await post(rolls) == 3
    assert await _names(gid) == ["game_started", "roll", "roll", "roll"]
    async with get_session_factory()() as db:
        indices = (
            await db.execute(
                select(GameEvent.event_index)
                .where(GameEvent.game_id == gid)
                .order_by(GameEvent.event_index)
            )
        ).scalars()
        assert list(indices) == [0, 1, 2, 3]
        game = await db.get(Game, gid)
        assert game is not None
        assert game.game_metadata == {REPLAY_CAPPED_KEY: True, REPLAY_CUTOFF_KEY: 4}


async def test_a_ceiling_cuts_by_index_on_postgres(games, monkeypatch: pytest.MonkeyPatch) -> None:
    """#3298's per-game ceiling drops a replay row: the replay is cut there, the
    early higher-index row is deleted, and the counters follow (advisory lock,
    FOR UPDATE and RETURNING on Postgres)."""
    monkeypatch.setattr(sessions, "_settings", Settings.isolated(MAX_EVENTS_PER_GAME=4))
    monkeypatch.setattr(replay_caps, "_throttles", {})
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda *a, **kw: None)
    gid = await _game(games, "yacht", [])
    async with get_session_factory()() as db:
        game = await db.get(Game, gid)
        assert game is not None
        sid = game.session_id

    async def post(events: list[dict]) -> tuple[int, int]:
        async with get_session_factory()() as db:
            r = await sessions.append_events(db, game_id=gid, session_id=sid, events=events)
        return r.accepted, r.dropped

    score = {"event_index": 20, "event_type": "score", "data": {"category": "chance", "value": 9}}
    assert await post([score]) == (1, 0)
    rolls = [{"event_index": i, "event_type": "roll", "data": {"i": i}} for i in (5, 1, 4, 2, 3)]
    assert await post(rolls) == (1, 4)
    assert await _names(gid) == ["roll"]
    async with get_session_factory()() as db:
        game = await db.get(Game, gid)
        assert game is not None
        assert game.game_metadata == {REPLAY_CAPPED_KEY: True, REPLAY_CUTOFF_KEY: 2}
        assert game.event_count == 1


_MOVE = {
    "direction": "right",
    "score_delta": 1024,
    "score_after": 123_456,
    "highest_tile_after": 2048,
    "is_game_over": False,
    "has_won": False,
}


async def test_the_estimate_matches_the_jsonb_text_length(games) -> None:
    data = [
        _MOVE,
        {"name": "é", "n": [1, 2.5, None, True]},
        {"big": 1.5e300, "small": -1.2345e-07, "n": [1e16, 1e-05]},
    ]
    gid = await _game(games, "twenty48", [("move", d) for d in data])
    async with get_session_factory()() as db:
        stored = (
            await db.execute(
                select(func.octet_length(text("data::text")))
                .where(GameEvent.game_id == gid)
                .order_by(GameEvent.event_index)
            )
        ).scalars()
        assert list(stored) == [replay_caps.json_bytes(d) for d in data]


async def test_a_2000_move_2048_game_fits_across_ten_batches_on_postgres(games) -> None:
    gid = await _game(games, "twenty48", [])
    async with get_session_factory()() as db:
        game = await db.get(Game, gid)
        assert game is not None
        sid = game.session_id
    for batch in range(10):
        events = [
            {"event_index": i, "event_type": "move", "data": _MOVE}
            for i in range(batch * 200, batch * 200 + 200)
        ]
        async with get_session_factory()() as db:
            r = await sessions.append_events(db, game_id=gid, session_id=sid, events=events)
        assert r.accepted == 200, batch
    async with get_session_factory()() as db:
        totals = await sessions.stored_event_totals(db, gid)
    assert totals.replay_events == 2_000
    assert totals.replay_bytes <= replay_caps.TWENTY48_CAP.max_bytes


# ---------------------------------------------------------------------------
# Review round 4 (#3318): counters equal the stored rows after a cut or a prune
# ---------------------------------------------------------------------------

# jsonb prints each 1e300 as 301 digits: ~6 KB stored for ~130 B as sent.
_EXP = {"x": [1e300] * 20, "name": "é", "neg": -0.0, "small": 1e-05}


async def _stored_sizes(gid: uuid.UUID) -> tuple[int, int, list[int]]:
    """The game's counters and ``octet_length(data::text)`` of each stored row."""
    async with get_session_factory()() as db:
        game = await db.get(Game, gid)
        assert game is not None
        sizes = (
            await db.execute(
                select(func.octet_length(text("data::text")))
                .where(GameEvent.game_id == gid)
                .order_by(GameEvent.event_index)
            )
        ).scalars()
        return game.event_count, game.event_bytes, [int(n) for n in sizes]


async def _post(gid: uuid.UUID, events: list[dict]) -> tuple[int, int]:
    async with get_session_factory()() as db:
        game = await db.get(Game, gid)
        assert game is not None
        sid = game.session_id
    async with get_session_factory()() as db:
        r = await sessions.append_events(db, game_id=gid, session_id=sid, events=events)
    return r.accepted, r.dropped


def _exp_rolls(*idx: int) -> list[dict]:
    return [{"event_index": i, "event_type": "roll", "data": {**_EXP, "i": i}} for i in idx]


@pytest.fixture
def _quiet(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(replay_caps, "_throttles", {})
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda *a, **kw: None)


async def test_jsonb_bytes_is_the_stored_rows_octet_length(games) -> None:
    data = [_EXP, {"a": "日本", "b": [1.5e-300, -0.0, 0.0, 1.0]}]
    gid = await _game(games, "yacht", [("roll", d) for d in data])
    _count, _bytes, sizes = await _stored_sizes(gid)
    assert sizes == [jsonb_bytes(d) for d in data]


async def test_a_cut_leaves_the_counters_equal_to_the_stored_rows(
    games, monkeypatch: pytest.MonkeyPatch, _quiet
) -> None:
    """S1 (#3318): exponent floats and non-ASCII data, charged and cut by the same
    measure, so ``event_bytes`` is the stored rows' sum and never negative."""
    monkeypatch.setitem(replay_caps.CAPS_BY_GAME_TYPE, "yacht", replay_caps.ReplayCap(3, 10**6))
    gid = await _game(games, "yacht", [])
    assert await _post(gid, _exp_rolls(10, 11)) == (2, 0)
    count, size, sizes = await _stored_sizes(gid)
    assert count == len(sizes) == 2 and size == sum(sizes) > 12_000
    # Rolls 1-3 fill the cap; the cut at 10 deletes the two early rows.
    assert await _post(gid, _exp_rolls(3, 1, 2)) == (3, 0)
    count, size, sizes = await _stored_sizes(gid)
    assert count == len(sizes) == 3
    assert size == sum(sizes)
    async with get_session_factory()() as db:
        game = await db.get(Game, gid)
        assert game is not None
        assert game.game_metadata[REPLAY_CUTOFF_KEY] == 10


async def test_cutting_a_pre_0035_game_never_goes_negative_on_postgres(
    games, monkeypatch: pytest.MonkeyPatch, _quiet
) -> None:
    monkeypatch.setitem(replay_caps.CAPS_BY_GAME_TYPE, "yacht", replay_caps.ReplayCap(2, 10**6))
    # Inserted directly: the counters stay 0, as on a game from before 0035.
    gid = await _game(games, "yacht", [("roll", {**_EXP, "i": i}) for i in range(10)])
    assert (await _stored_sizes(gid))[:2] == (0, 0)
    async with get_session_factory()() as db:
        game = await db.get(Game, gid)
        assert game is not None
        game.game_metadata = {}
        await db.commit()
    # Index 0 and 1 are stored: the misfit is the stored row at 2, so 2-9 go.
    assert await _post(gid, _exp_rolls(20)) == (0, 1)
    count, size, sizes = await _stored_sizes(gid)
    assert len(sizes) == 2
    assert (count, size) == (0, 0)  # clamped, not -8 and -48,000


async def test_a_cut_keeps_low_rows_that_fit_on_postgres(
    games, monkeypatch: pytest.MonkeyPatch, _quiet
) -> None:
    """S2 (#3318): cap 2, rows 5 and 6 stored, batch 1-3: cut at 3, keep 1 and 2."""
    monkeypatch.setitem(replay_caps.CAPS_BY_GAME_TYPE, "yacht", replay_caps.ReplayCap(2, 10**6))
    gid = await _game(games, "yacht", [])
    assert await _post(gid, _exp_rolls(5, 6)) == (2, 0)
    assert await _post(gid, _exp_rolls(1, 2, 3)) == (2, 1)
    async with get_session_factory()() as db:
        indices = (
            await db.execute(
                select(GameEvent.event_index)
                .where(GameEvent.game_id == gid)
                .order_by(GameEvent.event_index)
            )
        ).scalars()
        assert list(indices) == [1, 2]
    count, size, sizes = await _stored_sizes(gid)
    assert count == len(sizes) == 2 and size == sum(sizes)


async def test_retention_lowers_the_counters_by_what_it_deletes_on_postgres(games) -> None:
    """Codex (#3318): each prune batch lowers the counters of the games it touched."""
    rows = [("game_started", {})] + [("roll", {**_EXP, "i": i}) for i in range(5)]
    rows.append(("game_ended", {"name": "é"}))
    counted = await _game(games, "yacht", rows)
    pre_0035 = await _game(games, "yacht", rows)
    async with get_session_factory()() as db:
        # Charge ``counted`` as append_events would have.
        await db.execute(
            text(
                "UPDATE games SET event_count = s.n, event_bytes = s.b FROM ("
                "SELECT count(*) AS n, sum(octet_length(data::text)) AS b "
                "FROM game_events WHERE game_id = :gid) s WHERE games.id = :gid"
            ),
            {"gid": counted},
        )
        await db.commit()
    keep = timedelta(days=3999)
    async with get_session_factory()() as db:
        assert await replay_storage.prune_replay_events(db, keep=keep, batch_size=3) >= 10
    count, size, sizes = await _stored_sizes(counted)
    assert count == len(sizes) == 2 and size == sum(sizes)
    assert (await _stored_sizes(pre_0035))[:2] == (0, 0)

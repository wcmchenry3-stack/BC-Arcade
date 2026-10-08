"""The dialect-compiled elements in ``db.jsonx`` (#2996).

Each element is compiled for both dialects, and then executed against the
suite's database (SQLite on CI, a Postgres when ``DATABASE_URL`` names one),
so the SQL each body renders is proven to run and to agree with the Python
value it stands for. The sweep parity test pins the cut-off the sweep writes
to ``started_at + 24 h`` on whichever dialect the suite runs on.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import DateTime, Select, literal, select, text, update
from sqlalchemy.dialects import postgresql, sqlite

from db.base import get_session_factory
from db.jsonx import json_is_true, json_number, json_set_true, plus_hours
from db.models import Game, GameType
from games.filters import SWEPT_KEY, not_swept
from games.sweep import STALE_GAME_AFTER, STALE_GAME_HOURS, sweep_stale_games

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping jsonx tests",
)

_PG = postgresql.dialect()
_SQLITE = sqlite.dialect()


def _sql(statement: Any, dialect: Any) -> str:
    return str(statement.compile(dialect=dialect, compile_kwargs={"literal_binds": True}))


def _cache_key(statement: Select) -> Any:
    return statement._generate_cache_key()[0]


# ---------------------------------------------------------------------------
# Compilation, both dialects
# ---------------------------------------------------------------------------


def test_json_number_compiles_per_dialect() -> None:
    stmt = select(json_number(Game.game_metadata, "level"))
    pg = _sql(stmt, _PG)
    assert "jsonb_typeof(games.metadata -> 'level') = 'number'" in pg
    assert "CAST((games.metadata ->> 'level') AS FLOAT)" in pg
    lite = _sql(stmt, _SQLITE)
    assert "json_type(games.metadata, '$.level') IN ('integer', 'real')" in lite
    assert "json_extract(games.metadata, '$.level')" in lite


def test_the_default_compilation_is_the_postgresql_form() -> None:
    # A bare ``str(expr)`` (debugging, offline Alembic) renders the production SQL.
    assert "jsonb_typeof(games.metadata -> 'level')" in str(
        json_number(Game.game_metadata, "level")
    )
    assert "IS NOT DISTINCT FROM 'true'::jsonb" in str(json_is_true(Game.game_metadata, "swept"))
    assert "|| CAST(" in str(json_set_true(Game.game_metadata, "swept"))
    assert "INTERVAL '24 hours'" in str(plus_hours(Game.started_at, 24))


def test_json_is_true_compiles_per_dialect_and_negates_null_safely() -> None:
    flag = json_is_true(Game.game_metadata, SWEPT_KEY)
    assert "(games.metadata -> 'swept') IS NOT DISTINCT FROM 'true'::jsonb" in _sql(
        select(flag), _PG
    )
    assert "json_type(games.metadata, '$.swept') IS 'true'" in _sql(select(flag), _SQLITE)
    # ``~`` / ``not_()`` give the dialect's NULL-safe inequality, not ``NOT (...)``.
    negated = _sql(select(Game.id).where(~flag), _PG)
    assert "(games.metadata -> 'swept') IS DISTINCT FROM 'true'::jsonb" in negated
    assert "NOT" not in negated
    assert "json_type(games.metadata, '$.swept') IS NOT 'true'" in _sql(
        select(Game.id).where(~flag), _SQLITE
    )
    assert _sql(select(~~flag), _PG) == _sql(select(flag), _PG)


def test_not_swept_is_the_negated_flag() -> None:
    assert _sql(select(not_swept()), _PG) == _sql(
        select(~json_is_true(Game.game_metadata, SWEPT_KEY)), _PG
    )


def test_json_set_true_compiles_per_dialect() -> None:
    stmt = update(Game).values(game_metadata=json_set_true(Game.game_metadata, SWEPT_KEY))
    assert "metadata=(games.metadata || CAST('{\"swept\": true}' AS JSONB))" in _sql(stmt, _PG)
    assert "metadata=json_set(games.metadata, '$.swept', json('true'))" in _sql(stmt, _SQLITE)


def test_plus_hours_compiles_per_dialect() -> None:
    stmt = update(Game).values(completed_at=plus_hours(Game.started_at, 24))
    assert "completed_at=(games.started_at + INTERVAL '24 hours')" in _sql(stmt, _PG)
    lite = _sql(stmt, _SQLITE)
    # Whole seconds through strftime, then the ORM's six-digit fraction.
    assert "strftime('%Y-%m-%d %H:%M:%S', games.started_at, '+24 hours')" in lite
    assert "substr(substr(games.started_at, 21) || '000000', 1, 6)" in lite


@pytest.mark.parametrize("key", ["", "a-b", "a.b", "it's", "x y", "1x"])
def test_a_json_key_must_be_an_identifier(key: str) -> None:
    for element in (json_number, json_is_true, json_set_true):
        with pytest.raises(ValueError, match="identifier"):
            element(Game.game_metadata, key)


@pytest.mark.parametrize("hours", [-1, 1.5, True, "24"])
def test_plus_hours_takes_a_whole_number_of_hours(hours: Any) -> None:
    with pytest.raises(ValueError, match="hours"):
        plus_hours(Game.started_at, hours)


def test_baked_values_are_part_of_the_statement_cache_key() -> None:
    # The key, the negation and the hour count are SQL text, not bound
    # parameters, so statements that differ in them must not share a cache entry.
    assert _cache_key(select(json_number(Game.game_metadata, "a"))) != _cache_key(
        select(json_number(Game.game_metadata, "b"))
    )
    assert _cache_key(select(json_number(Game.game_metadata, "a"))) == _cache_key(
        select(json_number(Game.game_metadata, "a"))
    )
    assert _cache_key(select(json_is_true(Game.game_metadata, "a"))) != _cache_key(
        select(~json_is_true(Game.game_metadata, "a"))
    )
    assert _cache_key(select(json_set_true(Game.game_metadata, "a"))) != _cache_key(
        select(json_set_true(Game.game_metadata, "b"))
    )
    assert _cache_key(select(plus_hours(Game.started_at, 1))) != _cache_key(
        select(plus_hours(Game.started_at, 2))
    )


# ---------------------------------------------------------------------------
# Execution on the suite's dialect
# ---------------------------------------------------------------------------

_STARTED = datetime(2026, 3, 28, 22, 30, 15, 123456, tzinfo=UTC)


def _utc(ts: datetime | None) -> datetime | None:
    """SQLite hands timestamps back naive; they are UTC."""
    if ts is None or ts.tzinfo is not None:
        return ts
    return ts.replace(tzinfo=UTC)


async def _add(sid: str, metadata: dict[str, Any], *, started_at: datetime = _STARTED) -> uuid.UUID:
    factory = get_session_factory()
    async with factory() as db:
        gt_id = (await db.execute(select(GameType.id).where(GameType.name == "yacht"))).scalar_one()
        game = Game(
            session_id=sid, game_type_id=gt_id, started_at=started_at, game_metadata=metadata
        )
        db.add(game)
        await db.commit()
        return game.id


async def _values(sid: str, *columns: Any) -> dict[uuid.UUID, tuple]:
    factory = get_session_factory()
    async with factory() as db:
        rows = (await db.execute(select(Game.id, *columns).where(Game.session_id == sid))).all()
    return {row[0]: tuple(row[1:]) for row in rows}


async def test_json_number_reads_only_json_numbers() -> None:
    sid = str(uuid.uuid4())
    cases = {
        "int": ({"level": 7}, 7.0),
        "real": ({"level": 2.5}, 2.5),
        "zero": ({"level": 0}, 0.0),
        "negative": ({"level": -3}, -3.0),
        "string": ({"level": "7"}, None),
        "bool": ({"level": True}, None),
        "null": ({"level": None}, None),
        "list": ({"level": [7]}, None),
        "absent": ({"other": 7}, None),
        "empty": ({}, None),
    }
    ids = {name: await _add(sid, metadata) for name, (metadata, _) in cases.items()}
    got = await _values(sid, json_number(Game.game_metadata, "level"))
    for name, (_, expected) in cases.items():
        (value,) = got[ids[name]]
        assert value == expected, name


async def test_json_is_true_matches_only_json_true() -> None:
    sid = str(uuid.uuid4())
    cases = {
        "true": ({"swept": True}, True),
        "false": ({"swept": False}, False),
        "one": ({"swept": 1}, False),
        "string": ({"swept": "true"}, False),
        "null": ({"swept": None}, False),
        "absent": ({"other": True}, False),
        "empty": ({}, False),
    }
    ids = {name: await _add(sid, metadata) for name, (metadata, _) in cases.items()}
    flag = json_is_true(Game.game_metadata, "swept")
    got = await _values(sid, flag, ~flag)
    for name, (_, expected) in cases.items():
        # Both read as a boolean on every row: neither is ever NULL.
        assert got[ids[name]] == (expected, not expected), name


async def test_json_set_true_adds_or_replaces_the_key_and_keeps_the_rest() -> None:
    sid = str(uuid.uuid4())
    absent = await _add(sid, {"player_name": "Ann", "level": 3})
    other = await _add(sid, {"swept": "maybe", "n": [1, 2]})
    empty = await _add(sid, {})
    factory = get_session_factory()
    async with factory() as db:
        await db.execute(
            update(Game)
            .where(Game.session_id == sid)
            .values(game_metadata=json_set_true(Game.game_metadata, "swept"))
            .execution_options(synchronize_session=False)
        )
        await db.commit()
    got = await _values(sid, Game.game_metadata)
    assert got[absent] == ({"player_name": "Ann", "level": 3, "swept": True},)
    assert got[other] == ({"swept": True, "n": [1, 2]},)
    assert got[empty] == ({"swept": True},)


async def test_plus_hours_moves_a_timestamp_with_its_microseconds() -> None:
    sid = str(uuid.uuid4())
    # Crosses a month end (2026-03-28 22:30 + 50 h). The suite runs in UTC; the
    # time-zone case is pinned by the Postgres-only test below.
    gid = await _add(sid, {}, started_at=_STARTED)
    whole = await _add(sid, {}, started_at=_STARTED.replace(microsecond=0))
    factory = get_session_factory()
    async with factory() as db:
        await db.execute(
            update(Game)
            .where(Game.session_id == sid)
            .values(completed_at=plus_hours(Game.started_at, 50))
            .execution_options(synchronize_session=False)
        )
        await db.commit()
    got = await _values(sid, Game.completed_at)
    assert _utc(got[gid][0]) == _STARTED + timedelta(hours=50)
    assert _utc(got[whole][0]) == _STARTED.replace(microsecond=0) + timedelta(hours=50)


async def test_the_sweep_cut_off_is_started_at_plus_24_hours_on_this_dialect() -> None:
    # Parity pin (#2996): the same known started_at must give the same
    # completed_at whether the sweep's arithmetic ran on Postgres or SQLite.
    sid = str(uuid.uuid4())
    gid = await _add(sid, {"player_name": "Ann"}, started_at=_STARTED)
    factory = get_session_factory()
    async with factory() as db:
        closed = await sweep_stale_games(
            db, session_id=sid, now=_STARTED + STALE_GAME_AFTER + timedelta(seconds=1)
        )
    assert closed == 1
    got = await _values(sid, Game.completed_at, Game.game_metadata, Game.outcome)
    completed_at, metadata, outcome = got[gid]
    assert _utc(completed_at) == datetime(2026, 3, 29, 22, 30, 15, 123456, tzinfo=UTC)
    assert _utc(completed_at) == _STARTED + timedelta(hours=STALE_GAME_HOURS)
    assert metadata == {"player_name": "Ann", SWEPT_KEY: True}
    assert outcome == "abandoned"
    # Swept rows read as swept through the same element the sweep wrote with.
    assert await _values(sid, json_is_true(Game.game_metadata, SWEPT_KEY)) == {gid: (True,)}


async def test_the_24_hour_cut_off_is_absolute_in_a_session_time_zone_with_a_dst_change() -> None:
    # Postgres only. ``INTERVAL '24 hours'`` is an exact 24 h on a timestamptz, whatever the
    # session TimeZone; a '1 day' interval would be 23 h across Europe/London's 2026-03-29
    # change (01:00 UTC), and drift from the Python STALE_GAME_AFTER cut-off (#2996).
    factory = get_session_factory()
    async with factory() as db:
        if db.get_bind().dialect.name != "postgresql":
            pytest.skip("needs Postgres: SQLite has no session time zone")
        await db.execute(text("SET TIME ZONE 'Europe/London'"))
        started = datetime(2026, 3, 28, 12, 0, tzinfo=UTC)  # before the change
        cut_off = (
            await db.execute(select(plus_hours(literal(started, DateTime(timezone=True)), 24)))
        ).scalar_one()
        await db.execute(text("RESET TIME ZONE"))
    assert cut_off.astimezone(UTC) == started + timedelta(hours=24)
    assert cut_off.astimezone(UTC) == datetime(2026, 3, 29, 12, 0, tzinfo=UTC)

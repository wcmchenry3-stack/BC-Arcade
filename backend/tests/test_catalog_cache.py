"""Process-level catalog cache (#2966): games/catalog_cache.py."""

from __future__ import annotations

import dataclasses

import pytest
from sqlalchemy import delete, select, update

from db.base import get_session_factory
from db.models import EventType, GameType
from games import catalog_cache


async def test_game_types_are_detached_frozen_rows() -> None:
    factory = get_session_factory()
    async with factory() as db:
        row = await catalog_cache.get_game_type(db, "yacht")
        orm = (await db.execute(select(GameType).where(GameType.name == "yacht"))).scalar_one()
    assert isinstance(row, catalog_cache.GameTypeRow)
    assert (row.id, row.name, row.is_active, row.is_premium, row.category) == (
        orm.id,
        orm.name,
        orm.is_active,
        orm.is_premium,
        orm.category,
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        row.is_premium = True  # type: ignore[misc]


async def test_unknown_game_type_and_event_map() -> None:
    factory = get_session_factory()
    async with factory() as db:
        assert await catalog_cache.get_game_type(db, "zz_missing") is None
        assert await catalog_cache.event_type_ids(db, 32000) == {}


async def test_event_type_map_skips_deprecated_types() -> None:
    factory = get_session_factory()
    async with factory() as db:
        yacht = await catalog_cache.get_game_type(db, "yacht")
        assert yacht is not None
        rows = (
            await db.execute(
                select(EventType.name, EventType.id, EventType.deprecated_at).where(
                    EventType.game_type_id == yacht.id
                )
            )
        ).all()
        cached = await catalog_cache.event_type_ids(db, yacht.id)
    assert rows, "yacht has seeded event types"
    assert dict(cached) == {name: id_ for name, id_, gone in rows if gone is None}


async def test_snapshot_is_reused_within_the_ttl_and_reloaded_after(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = [1000.0]
    monkeypatch.setattr(catalog_cache.time, "monotonic", lambda: clock[0])
    factory = get_session_factory()
    async with factory() as db:
        before = await catalog_cache.get_game_type(db, "yacht")
        assert before is not None and before.category != "zz"
        # Changed behind the cache's back (another worker's PATCH).
        yacht = update(GameType).where(GameType.name == "yacht")
        await db.execute(yacht.values(category="zz"))
        await db.commit()
        try:
            clock[0] += catalog_cache.TTL_SECONDS - 1
            assert await catalog_cache.get_game_type(db, "yacht") == before
            clock[0] += 1
            after = await catalog_cache.get_game_type(db, "yacht")
            assert after is not None and after.category == "zz"
        finally:
            await db.execute(yacht.values(category=before.category))
            await db.commit()


async def test_a_load_racing_an_invalidation_is_not_stored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_load = catalog_cache._load

    async def load_then_invalidate(db):
        snap = await real_load(db)
        catalog_cache.invalidate()  # a PATCH committed while this load ran
        return snap

    monkeypatch.setattr(catalog_cache, "_load", load_then_invalidate)
    factory = get_session_factory()
    async with factory() as db:
        assert await catalog_cache.get_game_type(db, "yacht") is not None
    assert catalog_cache._snapshot is None


async def test_patch_game_type_service_invalidates() -> None:
    from games.service import patch_game_type

    factory = get_session_factory()
    async with factory() as db:
        gt = await catalog_cache.get_game_type(db, "blackjack")
        assert gt is not None
        assert catalog_cache._snapshot is not None
        original = gt.category
        try:
            await patch_game_type(db, game_type_id=gt.id, is_premium=None, category="zz")
            assert catalog_cache._snapshot is None
            assert (await catalog_cache.get_game_type(db, "blackjack")).category == "zz"  # type: ignore[union-attr]
        finally:
            await patch_game_type(db, game_type_id=gt.id, is_premium=None, category=original)


async def test_a_new_game_type_is_seen_after_invalidation() -> None:
    factory = get_session_factory()
    async with factory() as db:
        assert await catalog_cache.get_game_type(db, "zz_new") is None
        db.add(GameType(id=9101, name="zz_new", display_name="New", is_active=True))
        await db.commit()
        try:
            assert await catalog_cache.get_game_type(db, "zz_new") is None  # cached
            catalog_cache.invalidate()
            assert (await catalog_cache.get_game_type(db, "zz_new")) is not None
        finally:
            await db.execute(delete(GameType).where(GameType.name == "zz_new"))
            await db.commit()

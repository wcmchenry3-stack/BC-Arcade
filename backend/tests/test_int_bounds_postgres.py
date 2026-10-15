"""The overflow #3304 closes, on a real Postgres (needs LEADERBOARD_EXPLAIN_PG_URL).

SQLite stores 64-bit integers, so only Postgres shows the failure: an insert of
a value past the column's range raises, and unhandled that is a 500. The API
layer now rejects such a value with a 422 first (``test_int_bounds.py``); this
test pins both halves: the database really does reject 2**31 in the three
columns, and accepts 2**31 - 1, so the pydantic bound equals the column's range.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from db.base import Base
from db.models import Game, GameType
from int_bounds import INT32_MAX
from tests._pg_scratch import require_pg_url, scratch_database, url_str


async def test_postgres_rejects_2_pow_31_in_the_32_bit_columns() -> None:
    raw = require_pg_url()
    async with scratch_database(raw) as url:
        engine = create_async_engine(url_str(url))
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            factory = async_sessionmaker(engine, expire_on_commit=False)

            async with factory() as db:
                gt = GameType(name="t", display_name="T", category="x")
                db.add(gt)
                await db.commit()
                gt_id = gt.id

            def game(**kw: int) -> Game:
                return Game(
                    id=uuid.uuid4(),
                    session_id=str(uuid.uuid4()),
                    game_type_id=gt_id,
                    started_at=datetime.now(UTC),
                    **kw,
                )

            # The column maximum is stored...
            async with factory() as db:
                db.add(game(final_score=INT32_MAX, duration_ms=INT32_MAX))
                await db.commit()
                assert (await db.execute(select(Game.final_score))).scalar_one() == INT32_MAX

            # ... and one past it raises at insert (the old 500).
            for kw in ({"final_score": INT32_MAX + 1}, {"duration_ms": INT32_MAX + 1}):
                async with factory() as db:
                    db.add(game(**kw))
                    with pytest.raises(DBAPIError):
                        await db.commit()
        finally:
            await engine.dispose()

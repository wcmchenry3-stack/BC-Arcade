"""Smoke tests for #122 DB wiring.

These tests are skipped when DATABASE_URL is unset so local dev / CI without a
Postgres instance stays green. When DATABASE_URL is set (Render, or a local
dev DB), they verify:

  1. The async engine connects and round-trips a trivial query.
  2. The applied alembic revision is the head in versions/, derived rather
     than pinned (#2585). The single-head invariant itself needs no database
     and lives in test_migration_invariants.py.
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import text

from db.base import get_engine
from tests._alembic_heads import script_heads

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live DB smoke tests",
)


@pytest.mark.asyncio
async def test_engine_select_one() -> None:
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT 1"))
        assert result.scalar() == 1


@pytest.mark.asyncio
async def test_alembic_head_applied() -> None:
    """The DB is migrated to the head in versions/ — derived, never pinned.

    Every row is compared, not just the first: a database stamped on two
    branches has two rows and must not pass (#2616 review)."""
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT version_num FROM alembic_version"))
        applied = sorted(result.scalars().all())
    assert applied == list(script_heads())

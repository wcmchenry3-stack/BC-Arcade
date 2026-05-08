"""Smoke tests for #122 DB wiring.

These tests are skipped when DATABASE_URL is unset so local dev / CI without a
Postgres instance stays green. When DATABASE_URL is set (Render, or a local
dev DB), they verify:

  1. The async engine connects and round-trips a trivial query.
  2. The alembic head matches what's recorded in the versions/ directory.
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import text

from db.base import get_engine

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
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT version_num FROM alembic_version"))
        version = result.scalar()
        # Latest head — bump when a new migration lands.
        assert version == "0018_rename_merge_display_name"

"""Smoke tests for #122 DB wiring.

These tests are skipped when DATABASE_URL is unset so local dev / CI without a
Postgres instance stays green. When DATABASE_URL is set (Render, or a local
dev DB), they verify:

  1. The async engine connects and round-trips a trivial query.
  2. The applied alembic revision is the single head in versions/.

The single-head check itself needs no database and always runs (#2585).
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import text

from db.base import get_engine
from tests._alembic_heads import multiple_heads_message, script_heads

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live DB smoke tests",
)


def test_migrations_have_a_single_head() -> None:
    """Two migrations on the same parent make `alembic upgrade head` refuse to
    run, which fails the deploy (#2585; first seen with #2535). When the suite
    provisions its own DB, conftest stops the run on this before any test; this
    test covers runs against an externally provided DATABASE_URL, where conftest
    does not migrate."""
    heads = script_heads()
    assert len(heads) == 1, multiple_heads_message(heads)


@requires_db
@pytest.mark.asyncio
async def test_engine_select_one() -> None:
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT 1"))
        assert result.scalar() == 1


@requires_db
@pytest.mark.asyncio
async def test_alembic_head_applied() -> None:
    """The DB is migrated to the head in versions/ — derived, never pinned."""
    heads = script_heads()
    assert len(heads) == 1, multiple_heads_message(heads)
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT version_num FROM alembic_version"))
        assert result.scalar() == heads[0]

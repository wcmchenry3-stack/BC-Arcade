"""Shared pytest fixtures.

Sets up a session-scoped SQLite database for tests that hit the DB layer
(cascade leaderboard, games/logs/stats APIs). The hook fires in
pytest_configure — before any test module is imported — so pytestmark
skipifs that gate on DATABASE_URL evaluate to False and the tests run.

Tests that were skipped before #366 (games/logs/stats API tests guarded on
DATABASE_URL) now run on CI too, because this fixture guarantees one.

Real Postgres is still used when DATABASE_URL is provided externally
(e.g. running against the live Render DB locally for a smoke check).
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

_TEST_DB_FILE: Path | None = None


def pytest_configure(config: pytest.Config) -> None:
    """Provision a SQLite test DB before any test module is imported.

    We must set DATABASE_URL before collection so module-level
    `pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), ...)`
    resolves correctly.
    """
    global _TEST_DB_FILE
    if os.environ.get("DATABASE_URL"):
        # Caller provided a DB (e.g. Render Postgres for smoke tests).
        return

    tmp_dir = Path(tempfile.mkdtemp(prefix="gaming_app_test_"))
    db_path = tmp_dir / "test.db"
    _TEST_DB_FILE = db_path
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_path}"

    # Run alembic upgrade head using the sync sqlite URL (env.py strips the
    # +aiosqlite driver). We invoke the CLI so the stock alembic.ini loads.
    backend = Path(__file__).resolve().parent.parent
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend,
        env=env,
        check=True,
        capture_output=True,
    )


def pytest_unconfigure(config: pytest.Config) -> None:
    global _TEST_DB_FILE
    if _TEST_DB_FILE and _TEST_DB_FILE.exists():
        try:
            _TEST_DB_FILE.unlink()
        except OSError:
            pass
    _TEST_DB_FILE = None


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Reset the in-memory rate limit store before each test.

    slowapi uses an in-memory storage backend by default. Without resetting
    between tests, rate-limit counters carry over and cause spurious 429s.
    """
    from limiter import limiter

    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture(autouse=True)
async def _clean_db_tables():
    """Truncate DB state between tests so ordering doesn't matter.

    Lightweight — only touches tables the new API suite writes to. Existing
    in-memory game state (blackjack, cascade in-memory) is reset by
    their own router-level reset helpers.
    """
    from db.base import get_engine, is_configured

    if not is_configured():
        yield
        return

    from sqlalchemy import text

    engine = get_engine()
    async with engine.begin() as conn:
        for table in ("game_events", "games", "game_entitlements", "bug_logs"):
            await conn.execute(text(f"DELETE FROM {table}"))
    yield

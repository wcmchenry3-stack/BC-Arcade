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

import functools
import os
import tempfile
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

    from tests._migration_helpers import Alembic

_TEST_DB_FILE: Path | None = None


def pytest_configure(config: pytest.Config) -> None:
    """Provision a SQLite test DB before any test module is imported.

    We must set DATABASE_URL before collection so module-level
    `pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), ...)`
    resolves correctly.

    Also neutralise ENTITLEMENT_DEV_OVERRIDE so that .env's dev shortcut
    doesn't bypass entitlement checks in the test suite. dotenv's
    load_dotenv() (called in main.py at import time) only sets variables
    that are *absent* from os.environ, so setting the key here — before
    any test module is imported — prevents the .env value from taking effect.
    """
    os.environ.setdefault("ENTITLEMENT_DEV_OVERRIDE", "")

    global _TEST_DB_FILE
    if os.environ.get("DATABASE_URL"):
        # Caller provided a DB (e.g. Render Postgres for smoke tests).
        return

    # Before anything is provisioned, so stopping here leaves no temp dir and
    # no DATABASE_URL behind (#2616 review).
    _stop_unless_single_alembic_head()

    tmp_dir = Path(tempfile.mkdtemp(prefix="gaming_app_test_"))
    db_path = tmp_dir / "test.db"
    _TEST_DB_FILE = db_path
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_path}"

    # Run alembic upgrade head using the sync sqlite URL (env.py strips the
    # +aiosqlite driver). We invoke the CLI so the stock alembic.ini loads.
    from tests._migration_helpers import run_alembic

    result = run_alembic(db_path, "upgrade", "head", check=False)
    if result.returncode != 0:
        # The output is captured, so without this a failing migration shows
        # only an exit status. Stop the run with Alembic's own error.
        # The CLI prints its `FAILED: ...` reason to stdout and logging to
        # stderr, so show both (#2616 review).
        pytest.exit(
            f"`alembic upgrade head` failed (exit {result.returncode}):\n"
            f"{result.stdout}{result.stderr}",
            returncode=1,
        )


def _stop_unless_single_alembic_head() -> None:
    """Stop the run with a named reason unless the migrations have one head (#2585).

    Two heads make `alembic upgrade head` refuse to run, and with its output
    captured that used to surface as a bare CalledProcessError. A graph that
    cannot be built at all (a migration that fails to import, a down_revision
    naming a missing revision) raises here, so that is caught and reported too
    rather than ending in an INTERNALERROR traceback.
    """
    from tests._alembic_heads import multiple_heads_message, script_heads

    try:
        heads = script_heads()
    except Exception as exc:  # noqa: BLE001 — any failure to load the graph stops the run
        pytest.exit(
            f"Could not read the Alembic migration graph: {type(exc).__name__}: {exc}",
            returncode=1,
        )
    if len(heads) != 1:
        pytest.exit(multiple_heads_message(heads), returncode=1)


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
        for table in (
            "game_events",
            "games",
            "daily_word_progress",
            "game_entitlements",
            "purchase_events",
            "purchase_links",
            "purchases",
            "bug_logs",
            "daily_challenge_days",
            "players",
        ):
            await conn.execute(text(f"DELETE FROM {table}"))
    yield


# ---------------------------------------------------------------------------
# Shared fixtures (#2953). Fixtures resolve by name, so a test file only has to
# not define its own. A file that needs a *different* shape (no lifespan, no
# Content-Type header, ...) keeps a local definition, which overrides these.
# Plain helpers (``session_headers``) live in ``tests/_helpers.py``.
# ---------------------------------------------------------------------------


@pytest.fixture()
def client() -> Iterator[TestClient]:
    """The app under ``TestClient`` with its lifespan running, against the test DB.

    ``pytest_configure`` guarantees ``DATABASE_URL``, so no configured-check here.
    """
    from fastapi.testclient import TestClient

    from main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def session_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture()
def migration_db_path(tmp_path: Path) -> Path:
    """A scratch SQLite path for a migration test (created by the first alembic run)."""
    return tmp_path / "migration.db"


@pytest.fixture()
def alembic(migration_db_path: Path) -> Alembic:
    """``alembic(*args)`` bound to ``migration_db_path``: ``alembic("upgrade", rev)``."""
    from tests._migration_helpers import run_alembic

    return functools.partial(run_alembic, migration_db_path)

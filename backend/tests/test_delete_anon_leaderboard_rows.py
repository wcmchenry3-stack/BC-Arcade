"""Migration 0026 — delete legacy ``*-anon`` leaderboard rows (#2622).

Two layers, matching the story's acceptance criteria:

* The migration test (``_alembic`` against its own scratch SQLite file, the
  pattern ``test_outcome_migration.py`` uses) upgrades from the prior head,
  seeds sentinel rows with events plus real rows including named Cascade and
  Sudoku rows, upgrades through 0026, and asserts only the sentinel games and
  their events are gone. It also covers the documented no-op downgrade.
* The board test uses the suite's already-migrated DB (``conftest``'s
  ``alembic upgrade head`` already ran 0026) and the live
  ``GET /games/leaderboard/{game_type}`` route: it inserts a sentinel row
  *after* the migration for every enabled board with a legacy sentinel and
  asserts none of them ever shows up. That's the protection old v1.0 clients
  still need until #2644 removes the ``POST /<game>/score`` routes.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parent.parent
_BEFORE = "0025_merge_0024_heads"
_REVISION = "0026_delete_anon_leaderboard"

# The seven legacy sentinels (#2622 context), each written by a per-game
# `POST /<game>/score` route that predates the generic board (#2618).
_SENTINELS = (
    "solitaire-anon",
    "mahjong-anon",
    "hearts-anon",
    "freecell-anon",
    "sort-anon",
    "starswarm-anon",
    "yacht-anon",
)


def _alembic(db_path: Path, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=_BACKEND,
        env=env,
        check=True,
        capture_output=True,
    )


def _insert_game(
    conn: sqlite3.Connection, session_id: str, *, game_type_id: int = 1, name: str | None = None
) -> str:
    gid = uuid.uuid4().hex
    metadata = "{}" if name is None else f'{{"player_name": "{name}"}}'
    conn.execute(
        "INSERT INTO games (id, session_id, game_type_id, final_score, outcome, metadata) "
        "VALUES (?, ?, ?, 100, 'completed', ?)",
        (gid, session_id, game_type_id, metadata),
    )
    conn.commit()
    return gid


def _insert_event(conn: sqlite3.Connection, game_id: str, index: int = 0) -> None:
    conn.execute(
        "INSERT INTO game_events (game_id, event_index, event_type_id, data) VALUES (?, ?, 1, '{}')",
        (game_id, index),
    )
    conn.commit()


def _game_ids(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT id FROM games").fetchall()}


def _event_game_ids(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT DISTINCT game_id FROM game_events").fetchall()}


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "delete_anon_migration.db"


# ---------------------------------------------------------------------------
# Migration test
# ---------------------------------------------------------------------------


def test_upgrade_deletes_only_sentinel_rows_and_their_events(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        sentinel_ids = []
        for session_id in _SENTINELS:
            gid = _insert_game(conn, session_id, name="OldClient")
            _insert_event(conn, gid)
            _insert_event(conn, gid, index=1)
            sentinel_ids.append(gid)

        # Real rows, including named Cascade/Sudoku rows, are untouched (Test
        # coverage > Regression).
        cascade_id = _insert_game(conn, str(uuid.uuid4()), game_type_id=4, name="Cascade")
        _insert_event(conn, cascade_id)
        sudoku_id = _insert_game(conn, str(uuid.uuid4()), game_type_id=8, name="Sudoku")
        _insert_event(conn, sudoku_id)
        # A real session whose id happens to *contain* "anon" but doesn't end
        # in "-anon" must survive: this is a sentinel deletion, not a substring ban.
        lookalike_id = _insert_game(conn, "anonymous-player-42", name="Lookalike")
        real_ids = {cascade_id, sudoku_id, lookalike_id}

    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        remaining = _game_ids(conn)
        assert remaining.isdisjoint(sentinel_ids)
        assert real_ids <= remaining
        # Every sentinel's events are gone; the real rows' events survive.
        remaining_event_games = _event_game_ids(conn)
        assert remaining_event_games.isdisjoint(sentinel_ids)
        assert {cascade_id, sudoku_id} <= remaining_event_games


def test_upgrade_is_a_noop_when_no_sentinel_rows_exist(db_path: Path) -> None:
    """A fresh/clean DB (e.g. the one the rest of the suite runs against)
    upgrades cleanly with nothing to delete."""
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        kept = _insert_game(conn, str(uuid.uuid4()), name="Real")
    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert kept in _game_ids(conn)


def test_downgrade_is_a_documented_noop(db_path: Path) -> None:
    """Downgrade does not restore the deleted rows — there is nothing to
    revert, only a comment explaining why (Test coverage: downgrade)."""
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        sentinel_id = _insert_game(conn, _SENTINELS[0], name="OldClient")
        _insert_event(conn, sentinel_id)
        kept_id = _insert_game(conn, str(uuid.uuid4()), name="Real")

    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert sentinel_id not in _game_ids(conn)

    # Downgrading (schema-wise, a no-op) and re-upgrading must not resurrect
    # the sentinel row or error on an already-clean table.
    _alembic(db_path, "downgrade", _BEFORE)
    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        remaining = _game_ids(conn)
        assert sentinel_id not in remaining
        assert kept_id in remaining


# ---------------------------------------------------------------------------
# Board test — a sentinel row inserted *after* the migration never ranks
# ---------------------------------------------------------------------------

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)


@pytest.fixture()
def client() -> Iterator[object]:
    from fastapi.testclient import TestClient

    from db.base import is_configured

    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


async def _seed_sentinel(game_type: str, session_id: str) -> None:
    from datetime import datetime, timezone

    from sqlalchemy import select

    from db.base import get_session_factory
    from db.models import Game, GameType

    factory = get_session_factory()
    async with factory() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == game_type))
        ).scalar_one()
        db.add(
            Game(
                id=uuid.uuid4(),
                session_id=session_id,
                game_type_id=gt_id,
                game_metadata={"player_name": "OldClient", "level_reached": 1},
                players=[],
                final_score=999999,
                outcome="completed",
                completed_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()


async def _grant_all(session_id: str) -> None:
    """Entitle *session_id* to every game, so a premium board's own 400/403
    checks (unrelated to this story) don't get in the way of the assertion."""
    from sqlalchemy import select

    from db.base import get_session_factory
    from db.models import GameEntitlement, GameType

    factory = get_session_factory()
    async with factory() as db:
        names = (await db.execute(select(GameType.name))).scalars().all()
        for name in names:
            db.add(GameEntitlement(session_id=session_id, game_slug=name))
        await db.commit()


# Every legacy sentinel from #2622's issue body, alongside the game type it
# was written for.
_LEGACY_SENTINEL_GAMES = [
    ("solitaire", "solitaire-anon"),
    ("mahjong", "mahjong-anon"),
    ("hearts", "hearts-anon"),
    ("freecell", "freecell-anon"),
    ("sort", "sort-anon"),
    ("starswarm", "starswarm-anon"),
    ("yacht", "yacht-anon"),
]


def test_every_legacy_sentinel_has_an_enabled_board() -> None:
    """Guards the parametrisation below from going vacuous."""
    from games import leaderboard

    for game_type, _ in _LEGACY_SENTINEL_GAMES:
        assert leaderboard.enabled_board(game_type) is not None, game_type


@pytest.mark.parametrize("game_type,sentinel_session", _LEGACY_SENTINEL_GAMES)
async def test_sentinel_row_inserted_after_migration_never_ranks(
    client, game_type: str, sentinel_session: str
) -> None:
    await _seed_sentinel(game_type, sentinel_session)
    sid = str(uuid.uuid4())
    await _grant_all(sid)  # some of the seven boards are premium; irrelevant here
    partition = "?difficulty_tier=Captain" if game_type == "starswarm" else ""
    r = client.get(f"/games/leaderboard/{game_type}{partition}", headers={"X-Session-ID": sid})
    assert r.status_code == 200, r.text
    names = [e["player_name"] for e in r.json()["entries"]]
    assert "OldClient" not in names
    assert r.json()["entries"] == []

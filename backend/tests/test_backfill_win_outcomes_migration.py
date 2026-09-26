"""Migration 0028 — backfill ``win`` on older Mahjong, Twenty48, Blackjack rows (#2703).

The migration tests run alembic against their own scratch SQLite file (the
pattern of ``test_players_backfill_migration.py``): upgrade to the prior
revision, seed rows the way older app builds stored them, upgrade through 0028
and check that only the certain wins changed, then that a second run changes
nothing. The last test runs the backfill on the session DB and reads the wins
back through ``/stats/me``.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

_BACKEND = Path(__file__).resolve().parent.parent
_BEFORE = "0027_players_display_name"
_REVISION = "0028_backfill_win_outcomes"
_MIGRATION = _BACKEND / "alembic" / "versions" / f"{_REVISION}.py"


def _alembic(db_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=_BACKEND,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )


def _migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("_mig_0028_backfill_win_outcomes", _MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _insert(
    conn: sqlite3.Connection,
    game_type: str,
    outcome: str | None,
    metadata: dict | None = None,
    *,
    completed: bool = True,
    raw_metadata: str | None = None,
) -> str:
    gt_id = conn.execute("SELECT id FROM game_types WHERE name = ?", (game_type,)).fetchone()[0]
    gid = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO games (id, session_id, game_type_id, outcome, completed_at, metadata) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            gid,
            "s-2703",
            gt_id,
            outcome,
            "2026-09-01 12:00:00.000000" if completed else None,
            raw_metadata if raw_metadata is not None else json.dumps(metadata or {}),
        ),
    )
    return gid


def _rows(conn: sqlite3.Connection) -> dict[str, tuple[str | None, str]]:
    return {
        gid: (outcome, metadata)
        for gid, outcome, metadata in conn.execute("SELECT id, outcome, metadata FROM games")
    }


def _seed_old_rows(conn: sqlite3.Connection) -> tuple[set[str], set[str]]:
    """Rows as older builds stored them: ``(certain wins, everything else)``."""
    wins = {
        # Mahjong: a cleared board sent won: true.
        _insert(conn, "mahjong", "completed", {"won": True, "pairs": 72, "layout": "turtle"}),
        # Twenty48: the 2048 tile reached, then Keep Playing or a game over.
        _insert(conn, "twenty48", "kept_playing", {"highest_tile": 2048, "final_score": 20000}),
        _insert(conn, "twenty48", "completed", {"highest_tile": 4096, "final_score": 60000}),
        _insert(conn, "twenty48", "completed", {"highest_tile": 2048.0}),
        # Blackjack: Cash Out, only offered at or above the run's goal.
        _insert(conn, "blackjack", "completed", {"final_chips": 1500, "hands_won": 9}),
    }
    others = {
        # Mahjong: not a cleared board, or not a JSON true.
        _insert(conn, "mahjong", "completed", {"won": False, "pairs": 30}),
        _insert(conn, "mahjong", "completed", {"pairs": 30}),
        _insert(conn, "mahjong", "completed", {"won": "true"}),
        _insert(conn, "mahjong", "completed", {"won": 1}),
        _insert(conn, "mahjong", "abandoned", {"won": True}),
        _insert(conn, "mahjong", "loss", {"won": False}),
        _insert(conn, "mahjong", "completed", {"won": True}, completed=False),
        _insert(conn, "mahjong", None, {"won": True}),
        # Twenty48: below 2048, no tile, or not a JSON number.
        _insert(conn, "twenty48", "completed", {"highest_tile": 1024}),
        _insert(conn, "twenty48", "completed", {"highest_tile": 2047}),
        _insert(conn, "twenty48", "completed", {}),
        _insert(conn, "twenty48", "kept_playing", {}),
        _insert(conn, "twenty48", "completed", {"highest_tile": "4096"}),
        _insert(conn, "twenty48", "completed", {"highest_tile": True}),
        _insert(conn, "twenty48", "completed", {"highest_tile": {"v": 4096}}),
        _insert(conn, "twenty48", "abandoned", {"highest_tile": 4096}),
        # Twenty48: a current build's loss is not rewritten.
        _insert(conn, "twenty48", "loss", {"highest_tile": 512}),
        # Blackjack: a bust sends final_chips 0; builds before the result
        # block sent nothing; malformed values don't count.
        _insert(conn, "blackjack", "completed", {"final_chips": 0, "hands_won": 4}),
        _insert(conn, "blackjack", "completed", {"best_run_chips": 3000, "total_runs": 2}),
        _insert(conn, "blackjack", "completed", {"final_chips": None}),
        _insert(conn, "blackjack", "completed", {"final_chips": "900"}),
        _insert(conn, "blackjack", "completed", {"final_chips": True}),
        _insert(conn, "blackjack", "completed", {"final_chips": -5}),
        _insert(conn, "blackjack", "abandoned", {"final_chips": 800}),
        # Blackjack: a current build's loss is not rewritten.
        _insert(conn, "blackjack", "loss", {"final_chips": 0}),
        # Other games with the same keys are never touched.
        _insert(conn, "solitaire", "completed", {"won": True}),
        _insert(conn, "cascade", "completed", {"highest_tile": 4096}),
        _insert(conn, "yacht", "completed", {"final_chips": 100}),
    }
    return wins, others


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "backfill_win_outcomes.db"


def test_upgrade_rewrites_only_the_certain_wins(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        wins, others = _seed_old_rows(conn)
        conn.commit()
        before = _rows(conn)

    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        after = _rows(conn)

    assert {gid for gid in after if after[gid] != before[gid]} == wins
    for gid in wins:
        # Only the outcome changes; the metadata is left as it was.
        assert after[gid] == ("win", before[gid][1])
    for gid in others:
        assert after[gid] == before[gid]


def test_a_second_run_changes_nothing(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        _seed_old_rows(conn)
        conn.commit()
    first = _alembic(db_path, "upgrade", _REVISION)
    assert "'mahjong': 1, 'twenty48': 3, 'blackjack': 1" in first.stderr
    with sqlite3.connect(db_path) as conn:
        after_first = _rows(conn)

    # Downgrade is a no-op, so the backfilled wins stay...
    _alembic(db_path, "downgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        assert _rows(conn) == after_first
    # ...and running the upgrade again finds nothing left to rewrite.
    second = _alembic(db_path, "upgrade", _REVISION)
    assert "'mahjong': 0, 'twenty48': 0, 'blackjack': 0" in second.stderr
    with sqlite3.connect(db_path) as conn:
        assert _rows(conn) == after_first


def test_upgrade_on_an_empty_games_table(db_path: Path) -> None:
    _alembic(db_path, "upgrade", _BEFORE)
    _alembic(db_path, "upgrade", _REVISION)
    with sqlite3.connect(db_path) as conn:
        assert _rows(conn) == {}


@pytest.mark.parametrize("batch", [1, 3, 500])
def test_backfill_runs_in_batches(db_path: Path, batch: int, monkeypatch) -> None:
    """Wins interleaved with non-wins, an exact multiple of the batch and not."""
    _alembic(db_path, "upgrade", _BEFORE)
    with sqlite3.connect(db_path) as conn:
        wins = set()
        for _ in range(6):
            wins.add(_insert(conn, "mahjong", "completed", {"won": True}))
            _insert(conn, "mahjong", "completed", {"won": False})
        for _ in range(7):
            wins.add(_insert(conn, "twenty48", "kept_playing", {"highest_tile": 2048}))
        conn.commit()

    migration = _migration()
    monkeypatch.setattr(migration, "_BATCH", batch)
    engine = sa.create_engine(f"sqlite:///{db_path}")
    try:
        with engine.begin() as conn:
            assert migration.backfill(conn) == {"mahjong": 6, "twenty48": 7, "blackjack": 0}
        with engine.begin() as conn:
            assert migration.backfill(conn) == {"mahjong": 0, "twenty48": 0, "blackjack": 0}
    finally:
        engine.dispose()

    with sqlite3.connect(db_path) as conn:
        won = {gid for gid, (outcome, _) in _rows(conn).items() if outcome == "win"}
    assert won == wins


def test_offline_sql_renders_one_update_per_game(db_path: Path) -> None:
    out = _alembic(db_path, "upgrade", f"{_BEFORE}:{_REVISION}", "--sql").stdout
    updates = [s for s in out.split(";") if "UPDATE games SET outcome='win'" in s]
    assert len(updates) == 3
    for game_type, update in zip(("mahjong", "twenty48", "blackjack"), updates, strict=True):
        assert f"game_types.name = '{game_type}'" in update
        assert "games.completed_at IS NOT NULL" in update


# ---------------------------------------------------------------------------
# /stats/me reads the backfilled wins
# ---------------------------------------------------------------------------

_T0 = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


def _session_db_sync_url() -> str | None:
    """The session DB as a sync SQLite URL, or None when it is not SQLite.

    The backfill is only ever run here on the conftest's throwaway SQLite
    file, never on an externally provided DATABASE_URL.
    """
    raw = os.environ.get("DATABASE_URL", "")
    if not raw.startswith("sqlite+aiosqlite:///"):
        return None
    return "sqlite:///" + raw[len("sqlite+aiosqlite:///") :]


@pytest.fixture()
def client() -> Iterator[TestClient]:
    from main import app

    with TestClient(app) as c:
        yield c


async def _add(sid: str, game_type: str, at: int, outcome: str, metadata: dict) -> None:
    from sqlalchemy import select

    from db.base import get_session_factory
    from db.models import Game, GameType

    completed_at = _T0 + timedelta(minutes=at)
    async with get_session_factory()() as db:
        gt_id = (
            await db.execute(select(GameType.id).where(GameType.name == game_type))
        ).scalar_one()
        db.add(
            Game(
                session_id=sid,
                game_type_id=gt_id,
                started_at=completed_at - timedelta(minutes=5),
                completed_at=completed_at,
                outcome=outcome,
                final_score=100,
                duration_ms=60_000,
                game_metadata=metadata,
            )
        )
        await db.commit()


async def test_stats_me_counts_the_backfilled_wins(client: TestClient) -> None:
    url = _session_db_sync_url()
    if url is None:
        pytest.skip("runs the backfill only on the conftest SQLite DB")
    sid = str(uuid.uuid4())
    # Older builds' rows, oldest first.
    await _add(sid, "mahjong", 0, "completed", {"won": True, "pairs": 72})
    await _add(sid, "mahjong", 1, "loss", {"won": False, "pairs": 20})
    await _add(sid, "mahjong", 2, "completed", {"won": True, "pairs": 72})
    await _add(sid, "mahjong", 3, "completed", {"won": True, "pairs": 72})
    await _add(sid, "mahjong", 4, "completed", {"won": False, "pairs": 10})
    await _add(sid, "twenty48", 0, "kept_playing", {"highest_tile": 2048})
    await _add(sid, "twenty48", 1, "completed", {"highest_tile": 512})
    await _add(sid, "twenty48", 2, "win", {"highest_tile": 2048})
    await _add(sid, "blackjack", 0, "completed", {"final_chips": 1500})
    await _add(sid, "blackjack", 1, "completed", {"final_chips": 0})

    headers = {"X-Session-ID": sid}
    before = client.get("/stats/me", headers=headers).json()["by_game"]
    assert (before["mahjong"]["won"], before["mahjong"]["lost"]) == (0, 1)
    assert before["twenty48"]["won"] == 1
    assert before["blackjack"]["won"] is None  # no win, loss or push yet

    engine = sa.create_engine(url)
    try:
        with engine.begin() as conn:
            _migration().backfill(conn)
    finally:
        engine.dispose()

    after = client.get("/stats/me", headers=headers).json()["by_game"]
    mahjong = after["mahjong"]
    assert (mahjong["won"], mahjong["lost"], mahjong["tied"]) == (3, 1, 0)
    assert (mahjong["current_win_streak"], mahjong["best_win_streak"]) == (2, 2)
    twenty48 = after["twenty48"]
    assert (twenty48["won"], twenty48["lost"]) == (2, 0)
    assert (twenty48["current_win_streak"], twenty48["best_win_streak"]) == (2, 2)
    blackjack = after["blackjack"]
    assert (blackjack["won"], blackjack["lost"]) == (1, 0)
    # Rows changed outcome only: sessions are unchanged.
    assert [after[g]["sessions"] for g in ("mahjong", "twenty48", "blackjack")] == [5, 3, 2]

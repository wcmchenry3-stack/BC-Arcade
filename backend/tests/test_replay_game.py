"""scripts/replay_game.py (#3277): one game's metadata and events, in order, gaps flagged.

The script is read-only and runs against the test database (SQLite here,
Postgres in production), once in-process for the query/report and once as the
real command line.
"""

from __future__ import annotations

import importlib.util
import pathlib
import subprocess
import sys
import uuid

import pytest
from sqlalchemy import event, select

from db.base import get_engine, get_session_factory
from db.models import EventType, Game, GameEvent, GameType

BACKEND = pathlib.Path(__file__).parent.parent
SCRIPT = BACKEND / "scripts" / "replay_game.py"
_spec = importlib.util.spec_from_file_location("replay_game", SCRIPT)
replay = importlib.util.module_from_spec(_spec)
sys.modules["replay_game"] = replay
_spec.loader.exec_module(replay)

# game type -> (session metadata, replay event types the game records)
GAMES = {
    "yacht": ({"mode": "vs", "difficulty": "hard"}, ["roll", "score"]),
    "hearts": ({"ai_difficulty": "medium"}, ["card_played", "trick_won"]),
    "sudoku": ({"difficulty": "easy", "variant": "classic"}, ["cell_set", "note_toggled"]),
    "starswarm": ({"difficulty_tier": "Captain"}, ["wave_started", "enemy_killed"]),
    "blackjack": ({}, ["bet_placed", "hand_resolved"]),
}


async def _event_type_id(s, game_type_id: int, name: str) -> int:
    found = (
        await s.execute(
            select(EventType.id).where(
                EventType.game_type_id == game_type_id, EventType.name == name
            )
        )
    ).scalar_one_or_none()
    if found is not None:
        return found
    et = EventType(game_type_id=game_type_id, name=name, display_name=name)
    s.add(et)
    await s.flush()
    return et.id


async def _seed(game_type: str, indexes: list[int]) -> uuid.UUID:
    """A completed game of ``game_type`` with one event per index, inserted out of order."""
    metadata, replay_types = GAMES[game_type]
    async with get_session_factory()() as s:
        gt = (await s.execute(select(GameType).where(GameType.name == game_type))).scalar_one()
        game = Game(
            session_id="replay-test-session-id",
            game_type_id=gt.id,
            outcome="completed",
            final_score=42,
            duration_ms=12345,
            game_metadata=metadata,
        )
        s.add(game)
        await s.flush()
        for n, idx in enumerate(reversed(indexes)):
            if idx == 0:
                name = "game_started"
            elif idx == max(indexes):
                name = "game_ended"
            else:
                name = replay_types[n % len(replay_types)]
            s.add(
                GameEvent(
                    game_id=game.id,
                    event_index=idx,
                    event_type_id=await _event_type_id(s, gt.id, name),
                    data={"i": idx, "t_ms": idx * 10},
                )
            )
        await s.commit()
        return game.id


async def _report(game_id: uuid.UUID, **kw) -> str:
    async with get_session_factory()() as s:
        found = await replay.fetch(s, game_id)
    assert found is not None
    return replay.render(*found, **kw)


def _event_lines(report: str) -> list[str]:
    return [ln for ln in report.splitlines() if ln.split()[:1] and ln.split()[0].isdigit()]


def test_find_gaps():
    assert replay.find_gaps([]) == []
    assert replay.find_gaps([0, 1, 2]) == []
    assert replay.find_gaps([0, 1, 4, 5, 9]) == [(2, 3), (6, 8)]
    assert replay.find_gaps([2, 3]) == [(0, 1)]
    assert replay.find_gaps([3, 0, 0, 1]) == [(2, 2)]


@pytest.mark.parametrize("game_type", sorted(GAMES))
async def test_report_in_order_with_gap(game_type: str):
    game_id = await _seed(game_type, [0, 1, 2, 5, 6, 7])
    report = await _report(game_id)

    assert f"game        {game_id}" in report
    assert f"type        {game_type}" in report
    assert "outcome     completed" in report
    assert "final_score 42" in report
    assert "duration_ms 12345" in report
    for key in GAMES[game_type][0]:
        assert key in report
    # The pseudonymous player id is not part of the report.
    assert "replay-test-session-id" not in report

    lines = _event_lines(report)
    assert [int(ln.split()[0]) for ln in lines] == [0, 1, 2, 5, 6, 7]
    assert "game_started" in lines[0] and "lifecycle" in lines[0]
    assert "game_ended" in lines[-1] and "lifecycle" in lines[-1]
    for ln in lines[1:3]:
        # hand_resolved is lifecycle too (blackjack); everything else is replay.
        assert ("lifecycle" if "hand_resolved" in ln else "replay") in ln
    # The gap sits between index 2 and 5.
    gap = [i for i, ln in enumerate(report.splitlines()) if "GAP" in ln]
    assert len(gap) == 1
    body = report.splitlines()
    assert "event_index 3-4 missing (2 events)" in body[gap[0]]
    assert body[gap[0] - 1].split()[0] == "2" and body[gap[0] + 1].split()[0] == "5"
    assert "gaps       1 (2 events missing)" in report
    assert "game_started present" in report and "game_ended   present" in report


async def test_no_gap_reports_none():
    game_id = await _seed("yacht", [0, 1, 2, 3])
    report = await _report(game_id)
    assert "GAP" not in report
    assert "gaps       none" in report


async def test_leading_gap_and_missing_start_flagged():
    game_id = await _seed("hearts", [2, 3, 4])
    report = await _report(game_id)
    lines = report.splitlines()
    first_gap = next(i for i, ln in enumerate(lines) if "GAP" in ln)
    assert "event_index 0-1 missing (2 events)" in lines[first_gap]
    assert first_gap < next(i for i, ln in enumerate(lines) if ln.startswith("      2"))
    assert "game_started MISSING" in report


async def test_game_with_no_events():
    game_id = await _seed("sudoku", [0])
    async with get_session_factory()() as s:
        await s.execute(GameEvent.__table__.delete().where(GameEvent.game_id == game_id))
        await s.commit()
    report = await _report(game_id)
    assert "events (0)" in report
    assert "gaps       none" in report


async def test_payload_truncation():
    game_id = await _seed("yacht", [0, 1])
    short = await _report(game_id, max_chars=5)
    assert "... (+" in short
    full = await _report(game_id, max_chars=0)
    assert "... (+" not in full and '"t_ms":10' in full


async def test_fetch_unknown_game_is_none():
    async with get_session_factory()() as s:
        assert await replay.fetch(s, uuid.uuid4()) is None


async def test_fetch_issues_selects_only():
    game_id = await _seed("yacht", [0, 1, 3])
    seen: list[str] = []

    def record(_conn, _cur, statement, *_a):
        seen.append(statement.lstrip().upper())

    sync_engine = get_engine().sync_engine
    event.listen(sync_engine, "before_cursor_execute", record)
    try:
        async with get_session_factory()() as s:
            await replay.fetch(s, game_id)
    finally:
        event.remove(sync_engine, "before_cursor_execute", record)
    assert seen and all(stmt.startswith("SELECT") for stmt in seen)


def _cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


@pytest.mark.parametrize("game_type", sorted(GAMES))
async def test_cli_against_local_db(game_type: str):
    game_id = await _seed(game_type, [0, 1, 4, 5])
    result = _cli(str(game_id))
    assert result.returncode == 0, result.stderr
    assert f"type        {game_type}" in result.stdout
    assert "event_index 2-3 missing (2 events)" in result.stdout


def test_cli_unknown_game_exits_1():
    result = _cli(str(uuid.uuid4()))
    assert result.returncode == 1
    assert "No game" in result.stderr


def test_cli_bad_id_exits_2():
    result = _cli("not-a-uuid")
    assert result.returncode == 2
    assert "Not a valid game id" in result.stderr

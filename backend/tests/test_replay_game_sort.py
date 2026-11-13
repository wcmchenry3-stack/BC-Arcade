"""scripts/replay_game.py prints a Sort level's rebuilt steps and verdict (#3388).

In-process on synthetic rows (no database): the report of a game of type ``sort``
gets the rebuilt level after the summary, from the shipped catalog.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import uuid
from datetime import UTC, datetime
from typing import Any

from sort.catalog import CATALOG_VERSION
from sort.fast_solver import solve
from sort.generate_levels import SOLVER_BUDGET

BACKEND = pathlib.Path(__file__).parent.parent
SCRIPT = BACKEND / "scripts" / "replay_game.py"
_spec = importlib.util.spec_from_file_location("replay_game_sort", SCRIPT)
replay = importlib.util.module_from_spec(_spec)
sys.modules["replay_game_sort"] = replay
_spec.loader.exec_module(replay)

sys.path.insert(0, str(BACKEND / "scripts"))
import sort_build_catalog as build

LEVEL = 1


def _pours() -> list[list[int]]:
    import json

    level = build.decode(json.loads(build.CATALOG_PATH.read_text())["levels"][LEVEL - 1][0])
    result = solve(level, SOLVER_BUDGET)
    assert result.pours is not None
    return [[0, i, j] for i, j in result.pours]


def _report(events: list[tuple[str, Any]], game_type: str = "sort") -> str:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    game = replay.GameRow(uuid.uuid4(), game_type, now, now, "completed", 1, 1000, {})
    rows = [replay.EventRow(i, name, now, data) for i, (name, data) in enumerate(events)]
    return replay.render(game, rows)


def _game(actions: list[list[int]], ended: dict[str, Any] | None) -> list[tuple[str, Any]]:
    events: list[tuple[str, Any]] = [
        ("game_started", {"level": LEVEL, "catalog": CATALOG_VERSION, "engine_version": 1})
    ]
    for unit, start in enumerate(range(0, len(actions), 25), start=1):
        events.append(
            ("moves", {"v": 1, "unit": unit, "t_ms": unit, "m": actions[start : start + 25]})
        )
    if ended is not None:
        events.append(("game_ended", ended))
    return events


def test_a_sort_report_prints_steps_and_a_complete_verdict() -> None:
    actions = _pours()
    ended = {"level": LEVEL, "moves": len(actions), "undos": 0, "won": True}
    report = _report(_game([*actions[:1], [2, 0, 1], *actions[1:]], ended))
    assert "sort level 1 (catalog" in report
    assert "#1 pour " in report and " ×" in report
    assert "#2 hint 0→1" in report
    assert f"moves {len(actions)} undos 0  SOLVED" in report
    assert "solved  yes" in report
    assert "verdict complete:" in report


def test_a_sort_report_marks_a_tampered_log_invalid() -> None:
    actions = _pours()
    report = _report(_game([[0, 3, 4], *actions], None))
    assert "verdict invalid: action #1 (unit 1): illegal pour 3->4" in report
    assert "FLAG    illegal_pour" in report


def test_a_sort_report_marks_a_truncated_log_incomplete() -> None:
    report = _report(_game(_pours()[:3], None))
    assert "verdict incomplete: no game_ended" in report


def test_a_sort_report_marks_a_catalog_from_another_version_incompatible() -> None:
    events = _game(_pours(), None)
    events[0] = (
        "game_started",
        {"level": LEVEL, "catalog": CATALOG_VERSION + 1, "engine_version": 1},
    )
    report = _report(events)
    assert "verdict invalid: incompatible catalog" in report
    assert "#1 pour" not in report


def test_other_games_get_no_sort_section() -> None:
    assert "sort level" not in _report(_game(_pours(), None), game_type="hearts")

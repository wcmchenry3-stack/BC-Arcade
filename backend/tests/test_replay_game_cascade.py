"""scripts/replay_game.py prints a Cascade game (#3858).

In-process on the golden game's rows (no database): the report of a game of type ``cascade``
gets its story after the summary, read from its events, not re-simulated, and the engine line
the summary prints for every game that records its play.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import uuid
from datetime import UTC, datetime
from typing import Any

BACKEND = pathlib.Path(__file__).parent.parent
SCRIPT = BACKEND / "scripts" / "replay_game.py"
_spec = importlib.util.spec_from_file_location("replay_game_cascade", SCRIPT)
replay = importlib.util.module_from_spec(_spec)
sys.modules["replay_game_cascade"] = replay
_spec.loader.exec_module(replay)

_FIXTURE = BACKEND / "tests" / "fixtures" / "cascade_replay_v1.json"


def _events() -> list[tuple[str, Any]]:
    game = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    return [
        ("game_started", game["game_started"]),
        *((e["type"], e["data"]) for e in game["events"]),
        ("game_ended", game["game_ended"]),
    ]


def _report(events: list[tuple[str, Any]]) -> str:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    game = replay.GameRow(uuid.uuid4(), "cascade", now, now, "win", 10272, 290842, {})
    rows = [replay.EventRow(i, name, now, data) for i, (name, data) in enumerate(events)]
    return replay.render(game, rows)


def test_a_cascade_report_prints_the_events_and_the_story() -> None:
    report = _report(_events())
    assert "type        cascade" in report
    assert "events (18), in event_index order:" in report
    assert "replay     drop" in report and "replay     merge" in report
    assert "  engine     engine_version 1 (current)" in report
    assert "cascade game, read from its events (not re-simulated):" in report
    assert "units      8 (1-8): 143 drops, 132 merges" in report
    assert "capstone   made at step 17450 (290.8 s)" in report
    assert "score      10272 = 6430 merges + 3842 time bonus" in report
    assert "the recorded merges add up to 6430: agrees" in report


def test_an_incompatible_engine_is_flagged_and_the_story_still_reads() -> None:
    events = _events()
    events[0] = ("game_started", {**events[0][1], "engine_version": 7})
    report = _report(events)
    assert "INCOMPATIBLE: incompatible engine: engine_version 7, this reader rebuilds 1" in report
    assert "units      8 (1-8): 143 drops, 132 merges" in report


def test_a_game_with_a_gap_and_no_game_ended_says_so() -> None:
    events = [e for i, e in enumerate(_events()) if i not in (3, len(_events()) - 1)]
    report = _report(events)
    assert "gaps       none" in report  # the rows are renumbered here: no index gap
    assert "outcome    no game_ended" in report


def test_client_strings_are_printed_safely() -> None:
    events = _events()
    events[0] = ("game_started", {**events[0][1], "tuning": "\x1b[31mred" + "x" * 80})
    report = _report(events)
    assert "\x1b" not in report
    assert 'tuning "\\u001b[31mred' in report


def test_a_restored_game_says_its_steps_restart() -> None:
    events = _events()
    name, data = events[5]
    assert name == "drop"
    events[5] = (name, {**data, "rs": 1})
    report = _report(events)
    assert "restored   a relaunch restored the board before unit" in report
    assert "note       the board was restored before unit" in report

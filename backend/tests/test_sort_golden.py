"""Sort replay: the app's golden level read by the backend, and what a level stores (#3389).

``fixtures/sort_replay_golden.json`` holds the events the app really saves for
catalog level 8 played to a win through the real screen, engine, solver and
recorder (``SortScreen.replay.test.tsx``, "the golden level"; that test fails if
the app's recording drifts from the file). Here the backend takes the same events:
every ``moves`` event passes the validator unchanged, the reader rebuilds the level
``complete`` to ``game_ended``'s moves and undos, and ``replay_game`` prints it.

The storage numbers are the ones in ``docs/games/sort.md`` ("Replay recording"):
compact JSON and ``jsonb::text`` bytes for the golden level and for the worst a
level may store, with ``ROW_OVERHEAD_BYTES`` a row, pinned so a change to the
event's shape or to a cap shows up here first.
"""

from __future__ import annotations

import copy
import importlib.util
import itertools
import json
import pathlib
import sys
import uuid
from datetime import UTC, datetime
from typing import Any

from games.replay_caps import ROW_OVERHEAD_BYTES, SORT_CAP, SORT_MAX_UNITS
from payload_size import json_bytes, jsonb_bytes
from sort.catalog import CATALOG_VERSION
from sort.module import module as sort_module
from sort.rebuild import COMPLETE, INCOMPLETE, rebuild, render
from sort.replay import MAX_MOVES_BYTES, validate_moves

BACKEND = pathlib.Path(__file__).parent.parent
_FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "sort_replay_golden.json"

_spec = importlib.util.spec_from_file_location(
    "replay_game_sort_golden", BACKEND / "scripts" / "replay_game.py"
)
replay_game = importlib.util.module_from_spec(_spec)
sys.modules["replay_game_sort_golden"] = replay_game
_spec.loader.exec_module(replay_game)


def _golden() -> dict[str, Any]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _events() -> list[tuple[str, dict[str, Any]]]:
    return [(e["type"], copy.deepcopy(e["data"])) for e in _golden()["events"]]


def _moves() -> list[dict[str, Any]]:
    return [d for name, d in _events() if name == "moves"]


def _actions() -> list[list[int]]:
    return [a for d in _moves() for a in d["m"]]


# ---------------------------------------------------------------------------
# the golden level, read by the backend
# ---------------------------------------------------------------------------


def test_the_fixture_is_a_whole_level_with_every_kind_of_action() -> None:
    events = _events()
    assert [name for name, _ in events] == ["game_started", "moves", "moves", "game_ended"]
    assert events[0][1] == {"level": 8, "catalog": CATALOG_VERSION, "engine_version": 1}
    assert [d["unit"] for d in _moves()] == [1, 2]
    assert len(_moves()[0]["m"]) == 25 and len(_actions()) > 25
    assert {a[0] for a in _actions()} == {0, 1, 2, 3}  # pour, undo, hint, rewind
    assert events[-1][1]["won"] is True and events[-1][1]["replay"]["u"] == 2


def test_every_moves_event_passes_the_validator_unchanged() -> None:
    for data in _moves():
        assert validate_moves(copy.deepcopy(data)) == data
        assert sort_module.validate_event("moves", copy.deepcopy(data)) == data


def test_the_golden_level_rebuilds_complete_to_game_ended() -> None:
    r = rebuild(_events())
    ended = _golden()["events"][-1]["data"]
    assert r.verdict == COMPLETE and r.flags == []
    assert r.solved and all(not b or (len(b) == 4 and len(set(b)) == 1) for b in r.bottles)
    assert (r.level, r.catalog) == (8, CATALOG_VERSION)
    assert (r.moves, r.undos) == (ended["moves"], ended["undos"]) == (8, 4)
    assert len(r.steps) == len(_actions())


def test_the_golden_level_has_a_multi_unit_pour_a_partial_pour_and_a_rewind() -> None:
    r = rebuild(_events())
    pours = [s for s in r.steps if s.kind == "pour"]
    assert any(s.units >= 2 for s in pours)  # a multi-unit pour
    # a partial pour: the top run is longer than the room (rr onto brr: 1 of 2 units)
    partial = next(s for s in pours if (s.src, s.dst) == (1, 0))
    assert (partial.color, partial.units) == ("red", 1)
    assert [(s.kind, s.units) for s in r.steps if s.kind == "rewind"] == [("rewind", 2)]
    assert [s.kind for s in r.steps].count("undo") == 2
    assert [s.kind for s in r.steps].count("hint") > 0


def test_a_hint_changes_nothing_and_each_step_numbers_from_one() -> None:
    r = rebuild(_events())
    assert [s.n for s in r.steps] == list(range(1, len(r.steps) + 1))
    for before, step in itertools.pairwise(r.steps):
        if step.kind == "hint":
            assert (step.moves, step.undos) == (before.moves, before.undos)


def test_a_golden_log_cut_short_or_with_a_lost_unit_is_not_complete() -> None:
    events = _events()
    assert rebuild(events[:-1]).verdict == INCOMPLETE  # no game_ended: truncated
    assert rebuild([events[0], events[2], events[3]]).verdict == INCOMPLETE  # unit 1 lost: a gap
    assert rebuild([events[0], events[1], events[3]]).verdict == INCOMPLETE  # unit 2 lost: a gap


def test_replay_game_prints_the_steps_and_a_complete_verdict() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    game = replay_game.GameRow(uuid.uuid4(), "sort", now, now, "completed", 8, 1000, {})
    rows = [replay_game.EventRow(i, name, now, data) for i, (name, data) in enumerate(_events())]
    report = replay_game.render(game, rows)
    assert "sort level 8 (catalog" in report
    assert "#1 pour 2→3  green ×2  moves 1 undos 0" in report
    assert "#2 undo" in report
    assert "hint 2→1" in report
    assert "back to last good move ×2" in report
    assert "SOLVED" in report and "solved  yes" in report
    assert "verdict complete:" in report
    assert report.count("#") >= len(_actions())
    assert "\n".join(render(rebuild(_events()))) in report


# ---------------------------------------------------------------------------
# what a level stores
# ---------------------------------------------------------------------------

# Measured (bytes). Compact JSON is what the app sends and the validator caps;
# ``jsonb::text`` (", " and ": " separators) is what the database stores and the
# counters charge; "stored" adds ``ROW_OVERHEAD_BYTES`` a row. Quoted in
# docs/games/sort.md: change them together.
PINNED: dict[str, Any] = {
    # the golden level (level 8): unit 1 is a full chunk of 25 actions, unit 2 the last 2
    "golden_compact_rows": [225, 52],
    "golden_compact": 277,
    "golden_jsonb": 365,
    "golden_stored": 765,
    # game_started / game_ended, jsonb (lifecycle rows, not counted by SORT_CAP)
    "started_jsonb": 47,
    "ended_jsonb": 165,
    # the worst level: 12 full chunks of 25 x [0,15,14], t_ms of 7 digits
    "worst_compact": 3_447,
    "worst_jsonb": 4_419,
    "worst_stored": 6_819,
}


def _stored(rows: list[dict[str, Any]]) -> int:
    """A level's stored ``moves`` rows: ``jsonb::text`` plus ``ROW_OVERHEAD_BYTES`` each."""
    return sum(jsonb_bytes(d) + ROW_OVERHEAD_BYTES for d in rows)


def _worst_rows() -> list[dict[str, Any]]:
    """The most an honest level stores: 12 full chunks of the widest action, a 7-digit ``t_ms``."""
    return [
        {"v": 1, "unit": u, "t_ms": 7_200_000 + u, "m": [[0, 15, 14]] * 25}
        for u in range(1, SORT_MAX_UNITS + 1)
    ]


def test_the_golden_level_storage_is_pinned() -> None:
    rows = _moves()
    assert [json_bytes(d) for d in rows] == PINNED["golden_compact_rows"]
    assert sum(json_bytes(d) for d in rows) == PINNED["golden_compact"]
    assert sum(jsonb_bytes(d) for d in rows) == PINNED["golden_jsonb"]
    assert _stored(rows) == PINNED["golden_stored"]
    # the golden level (27 actions, 2 rows) sits in the epic's 0.5 - 1 KB estimate;
    # the docs' 0.8 - 1.2 KB is for 30 - 60 action levels
    assert 500 <= _stored(rows) <= 1_024


def test_the_lifecycle_rows_are_small_and_pinned() -> None:
    started, ended = _events()[0][1], _events()[-1][1]
    assert jsonb_bytes(started) == PINNED["started_jsonb"]
    assert jsonb_bytes(ended) == PINNED["ended_jsonb"]


def test_the_worst_level_storage_is_pinned_and_fits_the_cap() -> None:
    rows = _worst_rows()
    for data in rows:
        assert validate_moves(copy.deepcopy(data)) == data  # the app could send it
    assert sum(json_bytes(d) for d in rows) == PINNED["worst_compact"]
    assert sum(jsonb_bytes(d) for d in rows) == PINNED["worst_jsonb"]
    stored = _stored(rows)
    assert stored == PINNED["worst_stored"]
    assert len(rows) == SORT_CAP.max_events
    assert (
        stored <= SORT_CAP.max_bytes // 2
    )  # the cap leaves room: the validator's widest is twice this


def test_the_widest_event_the_validator_accepts_still_fits_twelve_times() -> None:
    """A chunk at ``MAX_MOVES_BYTES`` (an old or hostile client) stays inside ``SORT_CAP``."""
    filler = [[0, 15, 14]] * 32  # MAX_ACTIONS_PER_EVENT
    row = {"v": 1, "unit": 12, "t_ms": 7_200_000, "m": filler}
    assert json_bytes(row) <= MAX_MOVES_BYTES
    assert SORT_CAP.max_bytes == SORT_MAX_UNITS * (MAX_MOVES_BYTES + ROW_OVERHEAD_BYTES)
    assert SORT_MAX_UNITS * (jsonb_bytes(row) + ROW_OVERHEAD_BYTES) <= SORT_CAP.max_bytes


def test_a_golden_level_is_a_fraction_of_the_cap_and_of_the_worst() -> None:
    assert _stored(_moves()) < _stored(_worst_rows()) // 4
    assert _stored(_moves()) < SORT_CAP.max_bytes // 10

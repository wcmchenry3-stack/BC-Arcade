"""Every backend reader replays by ``engine_version`` (#3912, epic #3273).

For each rebuilder (Sort, Yacht, Daily Word, Blackjack) and for
``scripts/replay_game.py``: the current version replays, a version with no
field replays as version 1, an older version registered through
``ReplayEngines.with_legacy`` (a test-only fake: no game has a second version
yet) replays with its own rules and not today's, and an unknown version gives
an explicit "incompatible engine" result with nothing rebuilt.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

import blackjack.replay as blackjack
import daily_word.replay as daily_word
import sort.rebuild as sort_rebuild
import yacht.replay as yacht
from games.engine_version import CURRENT_ENGINE_VERSIONS

FIXTURES = Path(__file__).parent / "fixtures"

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "replay_game.py"
_spec = importlib.util.spec_from_file_location("replay_game_engine_versions", _SCRIPT)
replay_game = importlib.util.module_from_spec(_spec)
sys.modules["replay_game_engine_versions"] = replay_game
_spec.loader.exec_module(replay_game)

UNKNOWN = 99
REASON = f"incompatible engine: engine_version {UNKNOWN}, this reader rebuilds 1"


def started(version: Any = 1, **data: Any) -> tuple[str, dict[str, Any]]:
    """A ``game_started``; ``version=None`` leaves the field out (an older build)."""
    return "game_started", data if version is None else {**data, "engine_version": version}


# -- Yacht ---------------------------------------------------------------------


def _yacht_turns() -> list[tuple[str, dict[str, Any]]]:
    events = json.loads((FIXTURES / "yacht_turn_events_v1.json").read_text())["events"]
    return [(e["type"], e["data"]) for e in events]


def test_yacht_current_and_missing_versions_rebuild_the_same_cards() -> None:
    plain = yacht.rebuild(_yacht_turns())
    for version in (1, None):
        r = yacht.rebuild([started(version, v=1, mode="vs"), *_yacht_turns()])
        assert r.incompatible is None and r.problems == plain.problems
        assert {s: c.total for s, c in r.cards.items()} == {
            s: c.total for s, c in plain.cards.items()
        }
    assert plain.cards and not plain.problems


def test_yacht_a_legacy_version_replays_with_its_frozen_rules() -> None:
    seen: list[Any] = []

    def frozen(events: list[Any]) -> yacht.Rebuilt:
        seen.append(events)
        return yacht.Rebuilt(problems=["frozen rules ran"])

    engines = yacht.ENGINES.with_legacy(0, frozen)
    r = yacht.rebuild([started(0), *_yacht_turns()], engines)
    assert r.problems == ["frozen rules ran"] and r.cards == {} and len(seen) == 1
    assert yacht.rebuild([started(1), *_yacht_turns()], engines).cards  # today's still apply


def test_yacht_an_unknown_version_is_incompatible_and_nothing_is_rebuilt() -> None:
    r = yacht.rebuild([started(UNKNOWN), *_yacht_turns()])
    assert r.incompatible == REASON and r.problems == [REASON] and r.cards == {}
    assert yacht.render_scorecards(r, 405)[1:] == [f"  {REASON}; nothing rebuilt"]


# -- Daily Word ----------------------------------------------------------------

GUESSES = ("guess_submitted", {"g": ["crane", "slate"], "t": ["apaaa", "ccccc"]})


def test_daily_word_current_and_missing_versions_rebuild_the_board() -> None:
    for version in (1, None):
        board = daily_word.rebuild([started(version, puzzle_id="2026-05-03:en"), GUESSES])
        assert board.incompatible is None and board.problems == []
        assert board.guesses == ["crane", "slate"] and board.won


def test_daily_word_a_legacy_version_replays_with_its_frozen_rules() -> None:
    frozen = lambda events: daily_word.RebuiltBoard(problems=["frozen rules ran"])
    engines = daily_word.ENGINES.with_legacy(0, frozen)
    board = daily_word.rebuild([started(0), GUESSES], engines)
    assert board.problems == ["frozen rules ran"] and board.rows == []


def test_daily_word_an_unknown_version_is_incompatible_and_nothing_is_rebuilt() -> None:
    board = daily_word.rebuild([started(UNKNOWN), GUESSES])
    assert board.incompatible == REASON and board.problems == [REASON] and board.rows == []
    assert daily_word.render_board(board)[1:] == [f"  {REASON}; nothing rebuilt"]


# -- Blackjack -----------------------------------------------------------------


def _blackjack_events() -> list[tuple[str, dict[str, Any]]]:
    run = json.loads((FIXTURES / "blackjack_replay_v1.json").read_text())
    return [(e["type"], e["data"]) for e in run["events"]]


def test_blackjack_current_and_missing_versions_read_the_rounds() -> None:
    plain = blackjack.render_rounds(_blackjack_events())
    assert plain and "incompatible" not in "\n".join(plain)
    for version in (1, None):
        events = [started(version, starting_chips=1000), *_blackjack_events()]
        assert blackjack.read(events).incompatible is None
        assert blackjack.render_rounds(events) == plain


def test_blackjack_a_legacy_version_reads_with_its_frozen_reader() -> None:
    frozen_round = blackjack.Round(unit=1, bet=7)
    engines = blackjack.ENGINES.with_legacy(0, lambda events: [frozen_round])
    run = blackjack.read([started(0), *_blackjack_events()], engines)
    assert run.incompatible is None and run.rounds == [frozen_round]


def test_blackjack_an_unknown_version_is_incompatible_and_nothing_is_rebuilt() -> None:
    events = [started(UNKNOWN), *_blackjack_events()]
    run = blackjack.read(events)
    assert run.incompatible == REASON and run.rounds == []
    assert blackjack.render_rounds(events) == [f"{REASON}; nothing rebuilt"]


# -- Sort ----------------------------------------------------------------------

CATALOG: dict[str, Any] = {"version": 7, "seed": 0, "legend": ["red"], "levels": [["AAA,A", 1]]}
SORT_START = {"level": 1, "catalog": 7}
SORT_MOVES = ("moves", {"v": 1, "unit": 1, "t_ms": 1, "m": [[0, 1, 0]]})
SORT_END = ("game_ended", {"level": 1, "moves": 1, "undos": 0, "won": True})


def _sort(version: Any, engines: Any = None) -> sort_rebuild.Rebuilt:
    events = [started(version, **SORT_START), SORT_MOVES, SORT_END]
    return sort_rebuild.rebuild(events, CATALOG, engines)


def test_sort_current_and_missing_versions_rebuild_the_level() -> None:
    for version in (1, None):
        r = _sort(version)
        assert r.verdict == sort_rebuild.COMPLETE and r.solved and r.moves == 1


def test_sort_a_legacy_version_replays_with_its_frozen_reader() -> None:
    class Frozen(sort_rebuild._Reader):
        def apply(self, action: list[int], unit: int) -> None:
            self.flag("frozen", sort_rebuild.INVALID, "frozen rules ran")

    r = _sort(0, sort_rebuild.ENGINES.with_legacy(0, Frozen))
    assert r.opening is not None and r.reason == "frozen rules ran"


def test_sort_an_unknown_version_is_incompatible_and_nothing_is_rebuilt() -> None:
    r = _sort(UNKNOWN)
    assert r.verdict == sort_rebuild.INVALID and r.reason == REASON
    assert r.opening is None and r.steps == []


# -- scripts/replay_game.py ----------------------------------------------------

ALL_GAMES = sorted(CURRENT_ENGINE_VERSIONS)


def _report(game_type: str, events: list[tuple[str, Any]]) -> str:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    game = replay_game.GameRow(uuid.uuid4(), game_type, now, now, "completed", 0, 1, {})
    rows = [replay_game.EventRow(i, name, now, data) for i, (name, data) in enumerate(events)]
    return replay_game.render(game, rows)


def _engine_line(report: str) -> str:
    return next(line for line in report.splitlines() if line.startswith("  engine "))


@pytest.mark.parametrize("game_type", ALL_GAMES)
def test_the_report_names_the_current_version_and_reads_a_missing_one_as_1(game_type: str) -> None:
    for version in (1, None):
        line = _engine_line(_report(game_type, [started(version)]))
        assert line == "  engine     engine_version 1 (current)"


@pytest.mark.parametrize("game_type", ALL_GAMES)
def test_the_report_flags_an_unknown_version_as_incompatible(game_type: str) -> None:
    report = _report(game_type, [started(UNKNOWN)])
    assert _engine_line(report) == f"  engine     INCOMPATIBLE: {REASON}; nothing rebuilt"
    assert '"engine_version":99' in report  # the stored events are still printed as sent


@pytest.mark.parametrize("module", [blackjack, daily_word, sort_rebuild, yacht])
def test_the_report_names_a_legacy_version_its_reader_supports(
    module: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    game_type = module.ENGINES.game
    monkeypatch.setattr(module, "ENGINES", module.ENGINES.with_legacy(0, module.ENGINES.rules[1]))
    line = _engine_line(_report(game_type, [started(0)]))
    assert line == "  engine     engine_version 0 (older, replayed with its frozen rules)"


@pytest.mark.parametrize(
    ("game_type", "events"),
    [
        ("yacht", _yacht_turns()),
        ("daily_word", [GUESSES]),
        ("blackjack", _blackjack_events()),
        ("sort", [("game_started", SORT_START), SORT_MOVES, SORT_END]),
    ],
)
def test_the_report_rebuilds_nothing_for_an_unknown_version(
    game_type: str, events: list[tuple[str, Any]]
) -> None:
    events = [
        (n, {**d, "engine_version": UNKNOWN}) if n == "game_started" else (n, d) for n, d in events
    ]
    if events[0][0] != "game_started":
        events = [started(UNKNOWN), *events]
    report = _report(game_type, events)
    assert REASON in report
    for rebuilt in ("player total", "scored guesses", "run: ", "final board:", "  result   "):
        assert rebuilt not in report


def test_a_game_that_records_no_engine_version_gets_no_engine_line() -> None:
    assert "  engine " not in _report("starswarm", [("game_started", {})])

"""games/engine_version.py (#3912, epic #3273): which rules replay a recorded game.

The shared resolver every reader uses: the current version replays, an older
version registered with ``with_legacy`` replays with its own rules, and any other
value (unknown, sunset, not an integer) is incompatible with one wording. A
``game_started`` without the field (or a log without one) is version 1. The
current versions are held equal to the app's constants.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from games.engine_version import (
    CURRENT,
    CURRENT_ENGINE_VERSIONS,
    INCOMPATIBLE,
    LEGACY,
    MISSING_ENGINE_VERSION,
    UNPRINTABLE,
    ReplayEngines,
    engine_version_of,
    incompatible_reason,
    printable,
    replay_engines,
)

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src" / "game"

# A rules object stands for whatever a game's reader replays with.
TODAY = object()
OLD = object()


def engines() -> ReplayEngines[object]:
    return ReplayEngines("demo", 1, {1: TODAY})


def test_the_current_version_replays_with_todays_rules() -> None:
    r = engines().resolve({"engine_version": 1})
    assert (r.kind, r.version, r.rules, r.reason, r.ok) == (CURRENT, 1, TODAY, None, True)


def test_a_missing_field_or_a_missing_game_started_is_version_1() -> None:
    assert MISSING_ENGINE_VERSION == 1
    for started in ({}, {"seed": 4}, None):
        r = engines().resolve(started)
        assert (r.kind, r.version, r.rules) == (CURRENT, 1, TODAY)
    assert engine_version_of({"engine_version": None}) is None  # present but null: not missing


def test_an_older_version_registered_as_legacy_replays_with_its_own_rules() -> None:
    reg = engines().with_legacy(0, OLD)
    assert reg.supported == (0, 1)
    old = reg.resolve({"engine_version": 0})
    assert (old.kind, old.version, old.rules, old.ok) == (LEGACY, 0, OLD, True)
    assert reg.resolve({"engine_version": 1}).rules is TODAY
    assert engines().supported == (1,)  # with_legacy returns a copy


@pytest.mark.parametrize("version", [2, 0, -1, "1", None, True, False, 1.0, 1.5, [1], {"v": 1}])
def test_any_other_value_is_incompatible_and_carries_no_rules(version: Any) -> None:
    r = engines().resolve({"engine_version": version})
    assert (r.kind, r.rules, r.ok) == (INCOMPATIBLE, None, False)
    assert r.version == version
    assert r.reason is not None and r.reason.startswith("incompatible engine: engine_version ")


def test_a_sunset_version_reads_as_incompatible() -> None:
    """Once an old-rules path is removed (#3908: after REPLAY_RETENTION_DAYS), its version is unknown."""
    with_old = engines().with_legacy(0, OLD)
    assert with_old.resolve({"engine_version": 0}).kind == LEGACY
    assert engines().resolve({"engine_version": 0}).kind == INCOMPATIBLE


def test_the_reason_is_sorts_wording_and_lists_every_supported_version() -> None:
    assert (
        engines().resolve({"engine_version": 2}).reason
        == "incompatible engine: engine_version 2, this reader rebuilds 1"
    )
    assert (
        engines().with_legacy(0, OLD).resolve({"engine_version": "x"}).reason
        == 'incompatible engine: engine_version "x", this reader rebuilds 0, 1'
    )
    long = incompatible_reason("é" * 60, [1])
    assert long.isascii() and "..." in long  # client text is escaped and truncated


def test_resolve_events_reads_the_first_game_started() -> None:
    events = [
        ("moves", {"engine_version": 9}),
        ("game_started", {"engine_version": 2}),
        ("game_started", {"engine_version": 1}),
    ]
    assert engines().resolve_events(events).version == 2
    assert engines().resolve_events([("moves", {})]).kind == CURRENT


def test_bad_registrations_are_refused() -> None:
    with pytest.raises(ValueError):
        ReplayEngines("demo", 1, {2: TODAY})  # no rules for the current version
    with pytest.raises(ValueError):
        engines().with_legacy(1, OLD)  # the current version is not legacy
    with pytest.raises(ValueError):
        engines().with_legacy(True, OLD)  # type: ignore[arg-type]


def test_replay_engines_starts_from_the_games_current_version() -> None:
    reg = replay_engines("sudoku", TODAY)
    assert (reg.game, reg.current, reg.supported) == ("sudoku", 1, (1,))
    with pytest.raises(KeyError):
        replay_engines("not_a_game", TODAY)


def _frontend_version(game: str) -> int:
    if game == "sort":
        path, name = FRONTEND / "sort" / "replay.ts", "SORT_REPLAY_ENGINE_VERSION"
    else:
        path, name = FRONTEND / game / "engine.ts", "ENGINE_VERSION"
    found = re.search(rf"^export const {name} = (\d+);", path.read_text(), re.MULTILINE)
    assert found, f"{name} not found in {path}"
    return int(found.group(1))


@pytest.mark.parametrize("game", sorted(CURRENT_ENGINE_VERSIONS))
def test_current_versions_equal_the_apps_constants(game: str) -> None:
    assert CURRENT_ENGINE_VERSIONS[game] == _frontend_version(game)


def _deep_list(depth: int) -> list[Any]:
    value: list[Any] = []
    for _ in range(depth):
        value = [value]
    return value


@pytest.mark.parametrize("version", [10**5000, _deep_list(200_000)], ids=["long_int", "deep_list"])
def test_a_value_that_cannot_be_printed_is_incompatible_not_a_traceback(version: Any) -> None:
    r = engines().resolve({"engine_version": version})
    assert r.kind == INCOMPATIBLE
    assert r.reason == f"incompatible engine: engine_version {UNPRINTABLE}, this reader rebuilds 1"


def test_a_recorded_float_1_0_is_incompatible_here_though_the_app_reads_it_as_1() -> None:
    """Documented twin difference: JS has one number type, so replayEngine.ts reads
    ``1.0`` as 1 (current); Python keeps it a float. The app always records an int."""
    r = engines().resolve(json.loads('{"engine_version": 1.0}'))
    assert r.kind == INCOMPATIBLE and r.version == 1.0


@pytest.mark.parametrize(
    ("value", "shown"),
    [
        ([1, 2], "[1,2]"),
        ({"a": 1, "b": [True, None]}, '{"a":1,"b":[true,null]}'),
        ([[{"v": "x"}]], '[[{"v":"x"}]]'),
        ("é✓", '"\\u00e9\\u2713"'),
    ],
)
def test_printable_matches_the_apps_json_stringify(value: Any, shown: str) -> None:
    """frontend/src/game/_shared/__tests__/replayEngine.test.ts pins the same strings."""
    assert printable(value) == shown

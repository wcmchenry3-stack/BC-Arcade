"""Cascade's replay events and golden game (#3858, epic #3273; replay policy #3908).

``fixtures/cascade_replay_v1.json`` holds one seeded game played on the app's real engine and
recorded through its real GameRecorder (pinned by
``frontend/src/game/cascade/__tests__/replay.fixture.test.ts``): its ``game_started`` data, its
``drop`` / ``merge`` events and its ``game_ended`` data. Every event must validate as sent (a
rejection here would drop a real game's replay), the story must read from the events alone (no
re-simulation: physics replays bit for bit only on the JS engine that recorded it), and the
stored game must fit the server's cap with room.
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

import pytest

from cascade import events as cascade_events
from cascade.events import MAX_DROP_BYTES, MAX_MERGE_BYTES, validate_replay_event
from cascade.models import MAX_TIER
from cascade.module import module as cascade_module
from cascade.replay import merge_points, read, render
from games.engine_version import CURRENT_ENGINE_VERSIONS
from games.replay_caps import (
    CASCADE_CAP,
    CASCADE_MAX_UNITS,
    ROW_OVERHEAD_BYTES,
    cap_for,
    json_bytes,
)
from observability import report

_FIXTURE = Path(__file__).parent / "fixtures" / "cascade_replay_v1.json"
_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "game" / "_shared"
_QUEUE_CONFIG = (_TS / "eventQueueConfig.ts").read_text(encoding="utf-8")
_REPLAY_TS = (_TS.parent / "cascade" / "replay.ts").read_text(encoding="utf-8")
# Drops per unit (``CASCADE_DROPS_PER_UNIT`` in replay.ts): 30 since #3967, 20 before.
# No f-strings in this file: the replay fixture guard hashes its tokens, and Python 3.12+
# tokenizes f-strings differently from 3.11, so an f-string gives each version its own hash.
_DROPS_PER_UNIT = 30

# Written out by hand, not read from the fixture: what the seeded game ended on. Re-recorded on
# the 12-tier ladder (#3967 / #3975, owner decision #3974): 143 drops, 132 merges, 6430, step
# 17450 and 8 units on the 11-tier ladder with 20-drop units.
_DROPS = 271
_MERGES = 242
_MERGE_SCORE = 18862
_CAPSTONE_STEP = 32799
_UNITS = 10


def _game() -> dict[str, Any]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _pairs(game: dict[str, Any]) -> list[tuple[str, Any]]:
    return [
        ("game_started", game["game_started"]),
        *((e["type"], e["data"]) for e in game["events"]),
        ("game_ended", game["game_ended"]),
    ]


@pytest.fixture(autouse=True)
def sent(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    """Sentry messages, captured; the drop throttles start empty for each test."""
    calls: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(report.sentry_sdk, "capture_message", lambda m, **kw: calls.append((m, kw)))
    monkeypatch.setattr(cascade_events, "_throttles", {})
    return calls


def _ts_const(name: str) -> int:
    found = re.search("export const " + name + r" = ([\d* ]+);", _QUEUE_CONFIG)
    assert found, name
    value = 1
    for factor in found.group(1).split("*"):  # a literal like "32 * 1024"
        value *= int(factor)
    return value


# --- the golden game ----------------------------------------------------------


def test_every_event_the_app_builds_validates_and_is_stored_as_sent(sent: list) -> None:
    for e in _game()["events"]:
        data = e["data"]
        assert cascade_module.validate_event(e["type"], copy.deepcopy(data)) == data
        cap = MAX_DROP_BYTES if e["type"] == "drop" else MAX_MERGE_BYTES
        assert len(json.dumps(data, separators=(",", ":")).encode()) <= cap
    assert sent == []


def test_game_started_carries_the_seeds_tuning_and_engine_version() -> None:
    data = _game()["game_started"]
    # `app_version` is optional: the fixture was recorded with one, and the app records none
    # until #3942 (lifecycle data is stored as sent either way).
    assert set(data) - {"app_version"} == {
        "fruit_set",
        "theme",
        "seed",
        "engine_seed",
        "tuning",
        "engine_version",
    }
    without = {k: v for k, v in data.items() if k != "app_version"}
    assert cascade_module.validate_event("game_started", copy.deepcopy(without)) == without
    assert data["engine_version"] == CURRENT_ENGINE_VERSIONS["cascade"] == 1
    assert cascade_module.validate_event("game_started", copy.deepcopy(data)) == data


def test_the_story_reads_from_the_events_alone() -> None:
    story = read(_pairs(_game()))
    assert story.invalid == 0
    assert story.units == list(range(1, _UNITS + 1))
    assert len(story.drops) == _DROPS
    assert len(story.merges) == _MERGES
    # The merges alone give the merge score: a merge into tier n scores 2 ** n.
    assert story.merge_score == _MERGE_SCORE
    assert story.ended is not None
    assert story.ended["merge_score"] == _MERGE_SCORE
    assert story.ended["outcome"] == "win"
    assert story.ended["capstone_step"] == _CAPSTONE_STEP
    # The capstone is the last merge: two tier-10 pieces (#3960; tier 9 on the 11-tier ladder).
    assert story.merges[-1][:2] == (_CAPSTONE_STEP, MAX_TIER - 1)
    # Steps only move forward, and every chain counts from 1 after a drop.
    steps = [s for s, _, _ in story.drops]
    assert steps == sorted(steps)
    assert all(c >= 1 for _, _, c in story.merges)


def test_the_story_render_prints_the_game() -> None:
    text = "\n".join(render(_pairs(_game())))
    assert "cascade game, read from its events (not re-simulated):" in text
    assert (
        "units      "
        + str(_UNITS)
        + " (1-"
        + str(_UNITS)
        + "): "
        + str(_DROPS)
        + " drops, "
        + str(_MERGES)
        + " merges"
        in text
    )
    assert "score from merges " + str(_MERGE_SCORE) in text
    assert "capstone   made at step " + str(_CAPSTONE_STEP) in text
    assert "the recorded merges add up to " + str(_MERGE_SCORE) + ": agrees" in text
    assert 'outcome    "win" at step ' + str(_CAPSTONE_STEP) in text


def test_a_game_with_its_tail_missing_says_the_merges_disagree() -> None:
    game = _game()
    game["events"] = game["events"][:-2]  # the last unit never arrived
    text = "\n".join(render(_pairs(game)))
    assert "DISAGREES" in text


def test_a_bad_event_is_counted_not_guessed() -> None:
    game = _game()
    game["events"][0]["data"]["d"][0][2] = 11  # the capstone is never dropped
    story = read(_pairs(game))
    assert story.invalid == 1


def test_the_stored_game_fits_the_cap_with_room() -> None:
    """What the server stores: ``jsonb::text`` plus ``ROW_OVERHEAD_BYTES`` a row."""
    rows = _game()["events"]
    stored = sum(json_bytes(e["data"]) + ROW_OVERHEAD_BYTES for e in rows)
    assert len(rows) == 2 * _UNITS
    assert stored == 13_089
    assert len(rows) <= CASCADE_CAP.max_events // 4
    assert stored <= CASCADE_CAP.max_bytes // 4


# --- the caps -----------------------------------------------------------------


def test_the_byte_caps_and_unit_count_are_the_apps() -> None:
    assert _ts_const("CASCADE_DROP_MAX_BYTES") == MAX_DROP_BYTES
    assert _ts_const("CASCADE_MERGE_MAX_BYTES") == MAX_MERGE_BYTES
    assert _ts_const("CASCADE_MAX_UNITS") == CASCADE_MAX_UNITS
    assert cap_for("cascade") == CASCADE_CAP


def test_the_unit_size_is_the_apps_and_keeps_the_960_drop_ceiling() -> None:
    """#3967: 30 drops a unit and 32 units a game, the same 960 drops as 20 x 48 before."""
    found = re.search(r"export const CASCADE_DROPS_PER_UNIT = (\d+);", _REPLAY_TS)
    assert found and int(found.group(1)) == _DROPS_PER_UNIT
    assert _DROPS_PER_UNIT <= cascade_events.MAX_DROPS_PER_EVENT
    assert CASCADE_MAX_UNITS * _DROPS_PER_UNIT == 960


def _widest_unit(unit: int, merges: int | None = None) -> list[dict[str, Any]]:
    """The widest honest unit: 30 drops, 32 danger moments and 6-digit steps (an hour of play is
    216,000 steps), the widest envelope, and ``merges`` merges (a full 1 KB part by default)."""
    drop = {
        "d": [[999_999, 3800, 5]] * _DROPS_PER_UNIT,
        "z": [[999_999, 180]] * 32,
        "v": 1,
        "unit": unit,
        "t_ms": 2_147_483_647,
    }
    merge: dict[str, Any] = {"m": [], "v": 1, "unit": unit, "t_ms": 2_147_483_647}
    entry = [999_999, 9, 99]
    while merges is None or len(merge["m"]) < merges:
        grown = {**merge, "m": [*merge["m"], entry]}
        if len(json.dumps(grown, separators=(",", ":"))) > MAX_MERGE_BYTES:
            break
        merge = grown
    return [drop, merge]


def test_the_widest_honest_events_validate() -> None:
    drop, merge = _widest_unit(CASCADE_MAX_UNITS)
    assert validate_replay_event("drop", drop) == drop
    assert validate_replay_event("merge", merge) == merge


def test_a_game_of_the_most_units_fits_the_server_cap() -> None:
    """32 units of the widest honest rows (danger moments are capped per game, so one unit
    carries them; a unit of 30 drops makes about 27 merges, 45 is generous)."""
    rows: list[dict[str, Any]] = []
    for unit in range(1, CASCADE_MAX_UNITS + 1):
        drop, merge = _widest_unit(unit, merges=45)
        if unit > 1:
            drop.pop("z")
        rows += [drop, merge]
    stored = sum(json_bytes(r) + ROW_OVERHEAD_BYTES for r in rows)
    assert len(rows) <= CASCADE_CAP.max_events
    assert stored == 58_997
    assert stored <= CASCADE_CAP.max_bytes


# --- validation ----------------------------------------------------------------


def _drop(**over: Any) -> dict[str, Any]:
    return {"d": [[10, 2000, 3]], "v": 1, "unit": 1, "t_ms": 0, **over}


def _merge(**over: Any) -> dict[str, Any]:
    return {"m": [[12, 3, 1]], "v": 1, "unit": 1, "t_ms": 0, **over}


@pytest.mark.parametrize(
    "data",
    [
        _drop(d=[], z=[[5, 30]]),
        _drop(d=[], rs=1),
        _drop(z=[[5, 180]], rs=1),
        _merge(part=0, parts=2),
    ],
)
def test_valid_shapes(data: dict[str, Any]) -> None:
    name = "merge" if "m" in data else "drop"
    assert validate_replay_event(name, data) == data


@pytest.mark.parametrize(
    ("name", "data", "reason"),
    [
        ("drop", _drop(d=[]), "invalid"),
        ("drop", _drop(d=[[10, 2000, 11]]), "invalid"),  # the capstone is never dropped
        ("drop", _drop(d=[[10, 4001, 3]]), "invalid"),  # past the bin
        ("drop", _drop(d=[[10, 2000.0, 3]]), "invalid"),
        ("drop", _drop(d=[[10, 2000, True]]), "invalid"),
        ("drop", _drop(z=[[5, 181]]), "invalid"),
        ("drop", _drop(z=[]), "invalid"),
        ("drop", _drop(rs=2), "invalid"),
        ("drop", _drop(v=2), "invalid"),
        ("drop", _drop(unit=0), "invalid"),
        ("drop", _drop(part=0, parts=2), "invalid"),  # a drop event is never split
        ("drop", {"drop_index": 1, "fruit_tier": 2, "x": 150.5, "score_before": 0}, "invalid"),
        ("drop", _drop(d=[[10, 2000, 3]] * 33), "invalid"),
        ("drop", _drop(d=[[10, 2000, 3]] * 32, pad="x" * 700), "oversize"),
        ("merge", _merge(m=[]), "invalid"),
        ("merge", _merge(m=[[12, 3, 0]]), "invalid"),  # chains count from 1
        ("merge", _merge(m=[[12, 11, 1]]), "invalid"),  # nothing above the capstone
        ("merge", _merge(part=0), "invalid"),
        ("merge", _merge(part=2, parts=2), "invalid"),
        ("merge", {"from_tier": 3, "to_tier": 4, "x": 1.5, "y": 2.5, "score_after": 8}, "invalid"),
        ("merge", _merge(m=[[12, 3, 1]] * 120), "oversize"),
    ],
)
def test_a_bad_event_is_dropped_and_reported_by_reason(
    name: str, data: dict[str, Any], reason: str, sent: list
) -> None:
    assert cascade_module.validate_event(name, data) is None
    assert len(sent) == 1
    message, kw = sent[0]
    assert message == "cascade event: " + name + " " + reason
    assert kw["tags"] == {"game_type": "cascade", "event_type": name, "reason": reason}
    # never a value from the payload
    assert "2000" not in json.dumps(kw.get("extras", {}))


def test_reports_are_throttled_per_type_and_reason(sent: list) -> None:
    for _ in range(50):
        validate_replay_event("drop", _drop(v=2))
        validate_replay_event("merge", _merge(v=2))
    assert len(sent) == 2


def test_lifecycle_events_are_stored_as_sent() -> None:
    probe = {"anything": [1, 2], "end_step": 5}
    assert cascade_module.validate_event("game_ended", dict(probe)) == probe


def test_merge_points_double_per_tier() -> None:
    assert [merge_points(t) for t in range(11)] == [2**n for n in range(1, 12)]
    # The winning merge (two tier-10 pieces) makes the capstone, worth 2048 (#3960).
    assert merge_points(MAX_TIER - 1) == 2_048


def test_the_12_tier_ladder_boundaries(sent: list) -> None:
    """#3975: a merge from tier 10 (the win) is valid; nothing merges from or drops the capstone."""
    assert MAX_TIER == 11
    assert validate_replay_event("merge", _merge(m=[[12, 10, 1]])) == _merge(m=[[12, 10, 1]])
    assert validate_replay_event("drop", _drop(d=[[10, 2000, 5]])) == _drop(d=[[10, 2000, 5]])
    assert validate_replay_event("merge", _merge(m=[[12, 11, 1]])) is None
    assert validate_replay_event("merge", _merge(m=[[12, 12, 1]])) is None
    assert validate_replay_event("drop", _drop(d=[[10, 2000, 11]])) is None
    assert validate_replay_event("drop", _drop(d=[[10, 2000, 12]])) is None
    assert sent  # the rejects are reported, never raised

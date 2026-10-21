"""The app's golden wave timelines through the backend's validator and reader (#3396, epic #3390).

``frontend/src/game/starswarm/__tests__/__fixtures__/golden-replay-seed42.timelines.json`` is
recorded by the app's ``goldenTimelines.test.ts`` from the real engine: the seed-42 golden
replays with the timeline on, and targeted runs (cleared waves then a death in combat, a boss
wave, a death during the extraction, late impacts, a pause and restore, an older build's save,
an abandoned run, an overflowing wave, the dial off and a prolonged run at the run budget).

Here every recorded ``wave_completed`` and ``wave_timeline`` passes the real validators exactly
as sent, and every non-dev timeline of the targeted runs reconciles with every check of
``starswarm/replay.py``. The app runs a port of the same checks over the same runs
(``helpers/timelineReconcile.ts``), so a check, a code or a capture that changes on one side
fails CI on the other (docs/games/starswarm-diagnostics.md, "Reader and reconciliation").
"""

from __future__ import annotations

import copy
import json
import pathlib

import pytest

from games.replay_caps import ROW_OVERHEAD_BYTES, STARSWARM_CAP, ReplayCap
from starswarm import models, replay, timeline

FIXTURE = (
    pathlib.Path(__file__).resolve().parents[2]
    / "frontend/src/game/starswarm/__tests__/__fixtures__/golden-replay-seed42.timelines.json"
)
CASES = json.loads(FIXTURE.read_text())
GOLDEN = [c for c in CASES if c["name"].startswith("golden/")]
TARGETED = [c for c in CASES if not c["name"].startswith("golden/")]
# The golden replays top the pilot's lives up outside the engine (PILOT_LIVES) after the first
# wave's stats opened with 3, so their lives and hull arithmetic is skewed: they are reconciled
# with every other check (their dev waves too, since nothing changes their counts). The targeted
# runs open their stats with the lives they fly with and are reconciled with every check.
SKEWED_BY_PILOT_LIVES = "lives and hull arithmetic"


def _events(case: dict) -> list[tuple[str, dict]]:
    """The run's rows in the order the app sends them: every wave, then the timelines."""
    waves = [(models.WAVE_COMPLETED, copy.deepcopy(w)) for w in case["closedWaves"]]
    tls = [(timeline.WAVE_TIMELINE, copy.deepcopy(t)) for t in case["closedTimelines"]]
    return waves + tls


def test_the_fixture_covers_the_scenarios():
    names = [c["name"] for c in CASES]
    assert names == [
        "golden/wave1-lieutenantJG",
        "golden/wave3-lieutenant-actions",
        "golden/wave5-boss-carrier",
        "cleared-waves-then-death-in-combat",
        "boss-wave",
        "death-during-extraction",
        "late-impacts-after-the-clear",
        "pause-and-restore-mid-wave",
        "restore-from-an-older-build-save",
        "abandoned-mid-wave",
        "overflow-every-class",
        "recorder-disabled",
        "prolonged-every-wave-damaged",
    ]
    assert sum(len(c["closedTimelines"]) for c in CASES) > 64


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_every_row_passes_the_validators_as_sent(case: dict):
    for name, data in _events(case):
        validate = (
            timeline.validate_wave_timeline
            if name == timeline.WAVE_TIMELINE
            else models.validate_wave_completed
        )
        stored = validate(copy.deepcopy(data))
        assert stored == data, (case["name"], name, data.get("wave"))


def test_the_size_measurement_uses_the_real_caps():
    # frontend/src/game/starswarm/__tests__/timelineSizes.test.ts mirrors these two as
    # ROW_OVERHEAD and STARSWARM_CAP; change both sides together
    assert ROW_OVERHEAD_BYTES == 200
    cap = ReplayCap(max_events=264, max_bytes=149_500)
    assert cap == STARSWARM_CAP


@pytest.mark.parametrize("case", GOLDEN, ids=[c["name"] for c in GOLDEN])
def test_golden_timelines_reconcile_but_for_the_lives_path(case: dict):
    waves, unreadable = replay.analyze(_events(case))
    assert unreadable == []
    paired = [w for w in waves if w.timeline is not None]
    assert paired and len(paired) == len(case["closedTimelines"])
    skewed = 0
    for w in paired:
        assert w.summary is not None and w.problem is None
        checks = replay.reconcile(w.summary, w.timeline)  # dev waves included
        failed = [f"{c.name}: {c.detail}" for c in checks if not c.ok]
        assert checks and [f for f in failed if not f.startswith(SKEWED_BY_PILOT_LIVES)] == [], (
            case["name"],
            w.wave,
            failed,
        )
        skewed += any(f.startswith(SKEWED_BY_PILOT_LIVES) for f in failed)
    # the exemption is still needed: drop it once PILOT_LIVES no longer skews the replays
    assert skewed > 0, case["name"]


@pytest.mark.parametrize("case", TARGETED, ids=[c["name"] for c in TARGETED])
def test_every_timeline_reconciles_with_every_check(case: dict):
    waves, unreadable = replay.analyze(_events(case))
    assert unreadable == []
    paired = [w for w in waves if w.timeline is not None]
    assert len(paired) == len(case["closedTimelines"])
    for w in paired:
        assert w.summary is not None, (case["name"], w.wave, "orphan")
        assert w.problem is None
        if w.dev:
            continue  # dev waves: decoded, not checked
        failed = [f"{c.name}: {c.detail}" for c in w.checks if not c.ok]
        assert w.checks and failed == [], (case["name"], w.wave, w.outcome, failed)
    # presence on the server is advisory; with the device's counts in hand it is exact (the
    # app's presence check): a candidate wave without a timeline is one the counts account for
    over = case["closedTimelinesOverflow"]
    if not case["closedTimelines"] and not any(v for k, v in over.items() if k != "full"):
        return  # the dial off from the start: nothing kept, nothing counted
    missing = [w for w in waves if w.timeline is None and w.note]
    assert len(missing) <= over["waves"] + over["unrecorded"] + over["devRepeats"]

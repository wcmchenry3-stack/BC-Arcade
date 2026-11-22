"""pytest suite for tools/nightly/gate.py (#4054): when the nightly runs its heavy jobs."""

import datetime as dt
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "gate.py"
_spec = importlib.util.spec_from_file_location("nightly_gate", SCRIPT)
gate = importlib.util.module_from_spec(_spec)
sys.modules["nightly_gate"] = gate
_spec.loader.exec_module(gate)

A = "a" * 40
B = "b" * 40
TUESDAY, MONDAY = 2, 1


def test_unchanged_dev_on_a_weekday_skips():
    decision = gate.decide(A, A, TUESDAY, force=False)
    assert decision == gate.Decision(False, "skipped, dev unchanged")


def test_changed_dev_runs():
    decision = gate.decide(B, A, TUESDAY, force=False)
    assert decision.run
    assert "changed" in decision.reason


def test_missing_tag_runs():
    decision = gate.decide(A, "", TUESDAY, force=False)
    assert decision.run
    assert "no nightly/last-green tag" in decision.reason


def test_monday_runs_even_when_unchanged():
    decision = gate.decide(A, A, MONDAY, force=False)
    assert decision.run
    assert "Monday" in decision.reason


def test_force_runs_even_when_unchanged():
    decision = gate.decide(A, A, TUESDAY, force=True)
    assert decision.run
    assert "forced" in decision.reason


def test_red_night_reruns_next_night():
    # Night 1 tested B and was red, so the tag stayed on A. Night 2: dev is still B.
    assert gate.decide(B, A, TUESDAY, force=False).run


@pytest.mark.parametrize("weekday", range(2, 8))
def test_every_non_monday_skips_when_unchanged(weekday):
    assert not gate.decide(A, A, weekday, force=False).run


def test_outputs_are_run_reason_and_last_green():
    lines = gate.outputs(B, A, TUESDAY, force=False)
    assert lines == [
        "run=true",
        "reason=dev changed since the last green night",
        f"last_green={A}",
    ]


def test_outputs_without_tag_have_empty_last_green():
    lines = gate.outputs(B, "", TUESDAY, force=False)
    assert lines[-1] == "last_green="


def run_cli(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], capture_output=True, text=True, check=False
    )


def test_cli_prints_github_output_lines():
    proc = run_cli("--head", A, "--last-green", A, "--weekday", "3", "--force", "false")
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.splitlines()[:2] == ["run=false", "reason=skipped, dev unchanged"]


def test_cli_empty_last_green_and_force_true():
    proc = run_cli("--head", A, "--last-green", "", "--weekday", "3", "--force", "true")
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.startswith("run=true\nreason=forced")


@pytest.mark.parametrize(
    "args",
    [
        ("--head", "main"),
        ("--head", A, "--last-green", "abc"),
        ("--head", A, "--force", "maybe"),
        ("--head", A, "--weekday", "8"),
        ("--head", f"{A}\nrun=true"),
    ],
)
def test_cli_rejects_bad_input(args):
    proc = run_cli(*args)
    assert proc.returncode == 2
    assert "run=" not in proc.stdout


def test_cli_defaults_weekday_to_today():
    proc = run_cli("--head", A, "--last-green", A)
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.split("\n")[0] in ("run=true", "run=false")


# ---- Fallback schedule and dedupe (#4056) ----------------------------------------------------

NOW = dt.datetime(2026, 11, 22, 16, 0, tzinfo=dt.UTC)


def run_at(run_id, hours_ago, minutes_extra=0, event="workflow_dispatch", branch="dev"):
    created = NOW - dt.timedelta(hours=hours_ago, minutes=minutes_extra)
    return {
        "id": run_id,
        "created_at": created.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "event": event,
        "head_branch": branch,
    }


def test_recent_runs_exclude_the_current_run():
    runs = [run_at(1, 0), run_at(2, 8)]
    assert gate.recent_other_runs(runs, "1", NOW) == 1
    assert gate.recent_other_runs(runs, 1, NOW) == 1
    assert gate.recent_other_runs([run_at(1, 0)], "1", NOW) == 0


def test_recent_runs_window_edge_is_inclusive_at_20_hours():
    assert gate.recent_other_runs([run_at(2, 20)], "1", NOW) == 1
    assert gate.recent_other_runs([run_at(2, 20, minutes_extra=1)], "1", NOW) == 0
    assert gate.recent_other_runs([run_at(2, 19, minutes_extra=59)], "1", NOW) == 1


def test_an_on_time_fallback_does_not_see_yesterdays_dispatch():
    # Fallback at 08:37; yesterday's 08:00 dispatch was 24 h 37 m ago. Today's 08:00 was 37 m ago.
    assert gate.recent_other_runs([run_at(2, 24, minutes_extra=37)], "1", NOW) == 0
    assert gate.recent_other_runs([run_at(2, 10, minutes_extra=36)], "1", NOW) == 1


def test_only_dispatched_runs_dedupe_not_earlier_fallback_runs():
    schedule_run = run_at(2, 19, event="schedule")
    assert gate.recent_other_runs([schedule_run], "1", NOW) == 0
    assert gate.recent_other_runs([schedule_run, run_at(3, 8)], "1", NOW) == 1
    assert gate.recent_other_runs([run_at(4, 8, event="push")], "1", NOW) == 0
    no_event = {"id": 5, "created_at": run_at(5, 1)["created_at"]}
    assert gate.recent_other_runs([no_event], "1", NOW) == 0


def test_feature_branch_dispatch_does_not_stand_in_for_the_dev_nightly():
    """Codex on #4070: a manual dispatch on another branch tests another SHA."""
    feature = run_at(2, 3, branch="feat/x")
    assert gate.recent_other_runs([feature], "1", NOW, branch="dev") == 0
    assert gate.recent_other_runs([feature, run_at(3, 3)], "1", NOW, branch="dev") == 1
    assert (
        gate.recent_other_runs([{**run_at(4, 3), "head_branch": None}], "1", NOW, branch="dev") == 0
    )


def test_recent_runs_ignore_unparseable_dates():
    runs = [{"id": 2, "created_at": "garbage"}, {"id": 3}, {"id": 4, "created_at": None}]
    assert gate.recent_other_runs(runs, "1", NOW) == 0


def test_scheduled_run_with_an_earlier_run_is_a_noop_even_after_a_red_night():
    # Dev changed (the last green tag is elsewhere), as after a red night: still a no-op.
    decision = gate.decide_scheduled(B, A, TUESDAY, force=False, other_runs=1)
    assert decision == gate.Decision(
        False, "skipped, already ran today (external trigger)", duplicate=True
    )


def test_scheduled_run_without_an_earlier_run_runs_and_flags_the_missed_trigger():
    decision = gate.decide_scheduled(B, A, TUESDAY, force=False, other_runs=0)
    assert decision.run and decision.trigger_missed and not decision.duplicate


def test_scheduled_run_flags_the_missed_trigger_even_when_dev_is_unchanged():
    decision = gate.decide_scheduled(A, A, TUESDAY, force=False, other_runs=0)
    assert not decision.run and decision.reason == "skipped, dev unchanged"
    assert decision.trigger_missed


def test_scheduled_run_with_an_unreadable_runs_list_fails_open_without_flagging():
    decision = gate.decide_scheduled(B, A, TUESDAY, force=False, other_runs=None)
    assert decision.run and not decision.trigger_missed and not decision.duplicate


def test_dispatch_outputs_are_unchanged_and_never_flag():
    lines = gate.outputs(B, A, TUESDAY, force=False, event="workflow_dispatch", other_runs=3)
    assert len(lines) == 3 and lines[0] == "run=true"


def test_schedule_outputs_carry_trigger_missed_and_duplicate():
    assert gate.outputs(B, A, TUESDAY, False, "schedule", 0)[3:] == [
        "trigger_missed=true",
        "duplicate=false",
    ]
    dup = gate.outputs(B, A, TUESDAY, False, "schedule", 2)
    assert dup[:2] == ["run=false", "reason=skipped, already ran today (external trigger)"]
    assert dup[3:] == ["trigger_missed=false", "duplicate=true"]


def test_cli_schedule_dedupes_from_a_runs_file(tmp_path):
    now = dt.datetime.now(dt.UTC)
    runs = tmp_path / "runs.json"
    runs.write_text(
        json.dumps(
            [
                {"id": 7, "created_at": now.isoformat(), "event": "schedule"},  # this run
                {
                    "id": 6,
                    "created_at": (now - dt.timedelta(hours=9)).isoformat(),
                    "event": "workflow_dispatch",
                },
            ]
        )
    )
    args = ("--head", B, "--last-green", A, "--event", "schedule", "--run-id", "7")
    proc = run_cli(*args, "--runs", str(runs))
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.splitlines()[:2] == [
        "run=false",
        "reason=skipped, already ran today (external trigger)",
    ]
    earlier = {"id": 5, "created_at": (now - dt.timedelta(hours=9)).isoformat()}
    runs.write_text(json.dumps([{**earlier, "event": "schedule"}]))
    proc = run_cli(*args, "--runs", str(runs))
    assert "run=true" in proc.stdout and "trigger_missed=true" in proc.stdout
    # --branch: a feature-branch dispatch doesn't dedupe the default-branch fallback (#4070).
    runs.write_text(
        json.dumps([{**earlier, "event": "workflow_dispatch", "head_branch": "feat/x"}])
    )
    proc = run_cli(*args, "--runs", str(runs), "--branch", "dev")
    assert "run=true" in proc.stdout and "trigger_missed=true" in proc.stdout
    proc = run_cli(*args, "--runs", str(tmp_path / "missing.json"))
    assert "run=true" in proc.stdout and "trigger_missed=false" in proc.stdout

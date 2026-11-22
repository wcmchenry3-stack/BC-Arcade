"""pytest suite for tools/nightly/gate.py (#4054): when the nightly runs its heavy jobs."""

import importlib.util
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


def test_outputs_include_range_and_last_green():
    lines = gate.outputs(B, A, TUESDAY, force=False)
    assert lines == [
        "run=true",
        "reason=dev changed since the last green night",
        f"last_green={A}",
        f"commit_range={A[:12]}..{B[:12]}",
    ]


def test_outputs_without_tag_have_empty_range():
    lines = gate.outputs(B, "", TUESDAY, force=False)
    assert "commit_range=" in lines and "last_green=" in lines


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

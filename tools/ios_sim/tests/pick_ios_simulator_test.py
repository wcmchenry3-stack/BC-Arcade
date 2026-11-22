"""pytest suite for pick_ios_simulator.py (#2347): preferred runtime, fallback with a
warning annotation, the create path, empty runtimes, and paired --*-json flags.

Fixtures mirror `xcrun simctl list runtimes|devices available -j` on the macos-26
image (iOS 26.2, 26.4.1 and 26.5 runtimes with iPhones), plus a hypothetical iOS 27.0
runtime with no devices to exercise the fallback and create paths."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pick_ios_simulator as pick

FIXTURES = Path(__file__).resolve().parent / "fixtures"
RUNTIMES = str(FIXTURES / "runtimes.json")
DEVICES = str(FIXTURES / "devices.json")


def load():
    runtimes = json.loads(Path(RUNTIMES).read_text())["runtimes"]
    devices = json.loads(Path(DEVICES).read_text())["devices"]
    return runtimes, devices


def test_prefers_newest_runtime_of_preferred_major_and_base_iphone(capsys):
    assert pick.choose(*load(), prefer_major="26") == ("use", "B-265")
    assert "::warning::" not in capsys.readouterr().err


def test_falls_back_to_newest_runtime_with_warning(capsys):
    action, argv = pick.choose(*load(), prefer_major="25")
    assert action == "create"
    assert argv[-1] == "com.apple.CoreSimulator.SimRuntime.iOS-27-0"
    assert "::warning::No iOS 25.x" in capsys.readouterr().err


def test_creates_base_iphone_when_runtime_has_none():
    action, argv = pick.choose(*load(), prefer_major=None)
    assert action == "create"
    # iPhone 18 beats 18 Pro and SE; iPad types are ignored.
    assert argv == [
        "xcrun",
        "simctl",
        "create",
        pick.CI_DEVICE_NAME,
        "18",
        "com.apple.CoreSimulator.SimRuntime.iOS-27-0",
    ]


def test_skips_non_ios_and_unavailable_runtimes():
    runtimes = [
        {"identifier": "tv", "version": "30.0", "platform": "tvOS"},
        {"identifier": "old", "version": "19.0", "platform": "iOS", "isAvailable": False},
        {"identifier": "ok", "version": "18.0", "platform": "iOS"},
    ]
    devices = {"ok": [{"name": "iPhone 15", "udid": "U"}]}
    assert pick.choose(runtimes, devices, None) == ("use", "U")


@pytest.mark.parametrize(
    "names,expected",
    [
        (["iPhone SE (3rd generation)", "iPhone 16 Pro", "iPhone 16"], "iPhone 16"),
        (["iPhone SE (3rd generation)", "iPhone 16 Pro Max", "iPhone 16 Pro"], "iPhone 16 Pro"),
        (["iPhone SE (3rd generation)", "iPhone Air"], "iPhone Air"),
        (["iPhone 16", "iPhone 17"], "iPhone 17"),
    ],
)
def test_iphone_ranking(names, expected):
    assert min(names, key=pick.iphone_rank) == expected


def test_main_prints_only_udid(capsys):
    assert (
        pick.main(["--prefer-major", "26", "--runtimes-json", RUNTIMES, "--devices-json", DEVICES])
        == 0
    )
    assert capsys.readouterr().out == "B-265\n"


def test_main_dry_run_create(capsys):
    assert pick.main(["--runtimes-json", RUNTIMES, "--devices-json", DEVICES]) == 0
    assert capsys.readouterr().out == pick.DRY_RUN_UDID + "\n"


def test_main_empty_runtimes_exits_nonzero(tmp_path, capsys):
    empty = tmp_path / "empty.json"
    empty.write_text('{"runtimes": []}')
    assert pick.main(["--runtimes-json", str(empty), "--devices-json", DEVICES]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "::error::no available iOS simulator runtime" in captured.err


def test_json_flags_must_be_paired():
    with pytest.raises(SystemExit) as exc:
        pick.main(["--runtimes-json", RUNTIMES])
    assert exc.value.code == 2

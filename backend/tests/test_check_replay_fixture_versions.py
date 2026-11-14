"""Tests for scripts/check_replay_fixture_versions.py, the replay fixture version guard (#3911).

Each test builds a tiny git repo (one game, its engine_version constant, a pinned fixture, a test
that replays it and a test with hard-coded results), commits it as the base, makes a branch change
and runs the guard against the base. The last tests run the guard on this repository's real
manifest. No DATABASE_URL needed.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
from typing import Any

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "check_replay_fixture_versions", REPO / "scripts" / "check_replay_fixture_versions.py"
)
assert _spec and _spec.loader
guard = importlib.util.module_from_spec(_spec)
sys.modules["check_replay_fixture_versions"] = guard  # dataclasses look the module up
_spec.loader.exec_module(guard)

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git is needed")

ENGINE = "src/game/dice/engine.ts"
FIXTURE = "fixtures/dice_replay_v1.json"
FIXTURE_V2 = "fixtures/dice_replay_v2.json"
EXPECT = "src/game/dice/__tests__/expect.test.ts"
EXPECT_BODY = '// pinned results\nit("rebuilds", () => {\n  expect(score).toBe(42);\n});\n'

MANIFEST: dict[str, Any] = {
    "scan": ["fixtures/**/*"],
    "test_globs": ["src/**/__tests__/**/*.ts"],
    "games": {
        "dice": {
            "version": {"file": ENGINE, "name": "ENGINE_VERSION"},
            "fixtures": [{"path": FIXTURE, "engine_version": 1}],
            "expectations": [EXPECT],
            "retired_versions": {},
        }
    },
    "not_replay": [{"path": "fixtures/other.json", "reason": "not a replay log"}],
    "accepted_changes": [],
}


def git(root: pathlib.Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-C", str(root), *args],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def write(root: pathlib.Path, path: str, body: str | dict) -> None:
    file = root / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(body if isinstance(body, str) else json.dumps(body, indent=2) + "\n")


def manifest(root: pathlib.Path) -> dict[str, Any]:
    return json.loads((root / guard.MANIFEST).read_text())


def set_version(root: pathlib.Path, version: int) -> None:
    write(root, ENGINE, f"export const ENGINE_VERSION = {version};\nexport const OTHER = 9;\n")


@pytest.fixture
def repo(tmp_path: pathlib.Path) -> tuple[pathlib.Path, str]:
    git(tmp_path, "init", "-q")
    write(tmp_path, guard.MANIFEST, copy.deepcopy(MANIFEST))
    set_version(tmp_path, 1)
    write(tmp_path, FIXTURE, {"seed": 7, "moves": [1, 2, 3], "final": {"score": 42}})
    write(tmp_path, "fixtures/other.json", {"x": 1})
    write(tmp_path, "src/game/dice/__tests__/replay.test.ts", 'load("dice_replay_v1.json");\n')
    write(tmp_path, EXPECT, EXPECT_BODY)
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "base")
    return tmp_path, git(tmp_path, "rev-parse", "HEAD")


def run(root: pathlib.Path, base: str) -> list[str]:
    return [f"{path}: {msg}" for path, msg in guard.run(root, base).errors]


def change_fixture(root: pathlib.Path, path: str = FIXTURE) -> None:
    write(root, path, {"seed": 7, "moves": [1, 2, 3], "final": {"score": 43}})


def add_v2(root: pathlib.Path) -> None:
    """The policy's bump: v1 stays frozen, the new recording is a separate v2 fixture."""
    set_version(root, 2)
    change_fixture(root, FIXTURE_V2)
    write(
        root,
        "src/game/dice/__tests__/replay.test.ts",
        'load("dice_replay_v1.json");\nload("dice_replay_v2.json");\n',
    )
    data = manifest(root)
    data["games"]["dice"]["fixtures"].append({"path": FIXTURE_V2, "engine_version": 2})
    write(root, guard.MANIFEST, data)


# --------------------------------------------------------------------------- the guard itself


def test_an_unchanged_branch_passes(repo) -> None:
    root, base = repo
    assert run(root, base) == []


def test_a_fixture_change_without_a_bump_fails_with_the_message(repo) -> None:
    root, base = repo
    change_fixture(root)
    errors = run(root, base)
    assert len(errors) == 1
    assert FIXTURE in errors[0]
    assert guard.BUMP_MESSAGE in errors[0]
    assert "this change alters how stored games replay" in errors[0]
    assert guard.main(["--root", str(root), "--base", base]) == 1


def test_a_bump_that_keeps_the_old_fixture_and_adds_a_new_one_passes(repo) -> None:
    root, base = repo
    add_v2(root)
    assert run(root, base) == []
    assert guard.main(["--root", str(root), "--base", base]) == 0


def test_a_bump_with_the_fixture_re_recorded_and_the_old_one_kept_passes(repo) -> None:
    root, base = repo
    old = (root / FIXTURE).read_text()
    add_v2(root)
    # same outcome, other layout: the v1 copy moved to a new name, the old name re-recorded at v2
    write(root, "fixtures/dice_replay_frozen_v1.json", old)
    write(
        root,
        "src/game/dice/__tests__/replay.test.ts",
        'load("dice_replay_frozen_v1.json"); load("dice_replay_v1.json");\n',
    )
    data = manifest(root)
    data["games"]["dice"]["fixtures"] = [
        {"path": FIXTURE, "engine_version": 2},
        {"path": "fixtures/dice_replay_frozen_v1.json", "engine_version": 1},
    ]
    write(root, guard.MANIFEST, data)
    change_fixture(root)
    (root / FIXTURE_V2).unlink()
    assert run(root, base) == []


def test_a_bump_that_re_records_in_place_without_keeping_the_old_fixture_fails(repo) -> None:
    root, base = repo
    set_version(root, 2)
    change_fixture(root)
    data = manifest(root)
    data["games"]["dice"]["fixtures"][0]["engine_version"] = 2
    write(root, guard.MANIFEST, data)
    errors = run(root, base)
    assert any("changed in place" in e and FIXTURE in e for e in errors)


def test_a_frozen_old_fixture_may_not_change_even_after_the_bump(repo) -> None:
    root, _ = repo
    add_v2(root)
    git(root, "add", "-A")
    git(root, "commit", "-qm", "bump")
    bumped = git(root, "rev-parse", "HEAD")
    change_fixture(root, FIXTURE)
    errors = run(root, bumped)
    assert any("frozen at engine_version 1" in e and guard.BUMP_MESSAGE in e for e in errors)


def test_json_reformatting_is_not_a_change(repo) -> None:
    root, base = repo
    data = json.loads((root / FIXTURE).read_text())
    (root / FIXTURE).write_text(json.dumps(data, indent=4, sort_keys=True))
    assert run(root, base) == []


def test_an_accepted_change_with_the_exact_hash_passes_and_goes_stale_after(repo) -> None:
    root, base = repo
    write(
        root, FIXTURE, {"seed": 7, "moves": [1, 2, 3], "final": {"score": 42}, "engine_version": 1}
    )
    sha = guard.content_hash(FIXTURE, (root / FIXTURE).read_bytes())
    data = manifest(root)
    data["accepted_changes"] = [
        {"path": FIXTURE, "sha256": sha, "reason": "adds engine_version only (#3909)"}
    ]
    write(root, guard.MANIFEST, data)
    assert run(root, base) == []
    # the entry approves that content only: a later edit fails as stale and as an unbumped change
    change_fixture(root)
    errors = run(root, base)
    assert any("stale" in e for e in errors)
    assert any(guard.BUMP_MESSAGE in e for e in errors)


def test_an_accepted_change_needs_a_reason(repo) -> None:
    root, base = repo
    change_fixture(root)
    data = manifest(root)
    sha = guard.content_hash(FIXTURE, (root / FIXTURE).read_bytes())
    data["accepted_changes"] = [{"path": FIXTURE, "sha256": sha, "reason": " "}]
    write(root, guard.MANIFEST, data)
    assert any("give a reason" in e for e in run(root, base))


def test_the_hash_cli_prints_what_an_entry_needs(repo, capsys) -> None:
    root, _ = repo
    assert guard.main(["--root", str(root), "--hash", FIXTURE]) == 0
    assert capsys.readouterr().out.strip() == guard.content_hash(
        FIXTURE, (root / FIXTURE).read_bytes()
    )


def test_removing_an_old_fixture_fails_until_its_version_is_retired(repo) -> None:
    root, _ = repo
    add_v2(root)
    git(root, "add", "-A")
    git(root, "commit", "-qm", "bump")
    bumped = git(root, "rev-parse", "HEAD")
    (root / FIXTURE).unlink()
    write(root, "src/game/dice/__tests__/replay.test.ts", 'load("dice_replay_v2.json");\n')
    data = manifest(root)
    data["games"]["dice"]["fixtures"] = [{"path": FIXTURE_V2, "engine_version": 2}]
    write(root, guard.MANIFEST, data)
    errors = run(root, bumped)
    assert any("was removed" in e and "retired_versions" in e for e in errors)
    # the documented sunset: retire the expired version, with a reason
    data["games"]["dice"]["retired_versions"] = {
        "1": "v1 logs expired 30 days after v2 shipped (#1)"
    }
    write(root, guard.MANIFEST, data)
    assert run(root, bumped) == []


def test_a_retired_version_whose_fixture_is_still_listed_fails(repo) -> None:
    root, base = repo
    add_v2(root)
    data = manifest(root)
    data["games"]["dice"]["retired_versions"] = {"1": "expired"}
    write(root, guard.MANIFEST, data)
    assert any("retired, so its fixture must be removed" in e for e in run(root, base))


def test_a_renamed_fixture_with_the_same_content_passes(repo) -> None:
    root, base = repo
    (root / FIXTURE).rename(root / "fixtures/dice_v1.json")
    write(root, "src/game/dice/__tests__/replay.test.ts", 'load("dice_v1.json");\n')
    data = manifest(root)
    data["games"]["dice"]["fixtures"] = [{"path": "fixtures/dice_v1.json", "engine_version": 1}]
    write(root, guard.MANIFEST, data)
    assert run(root, base) == []


def test_a_fixture_no_test_replays_fails(repo) -> None:
    root, base = repo
    write(root, "src/game/dice/__tests__/replay.test.ts", "// nothing loads it\n")
    assert any("no test replays this fixture" in e for e in run(root, base))


def test_an_unclassified_fixture_fails(repo) -> None:
    root, base = repo
    write(root, "fixtures/new_game_v1.json", {"seed": 1})
    assert any("fixtures/new_game_v1.json" in e and "not in" in e for e in run(root, base))


def test_an_engine_version_that_goes_down_fails(repo) -> None:
    root, _ = repo
    add_v2(root)
    git(root, "add", "-A")
    git(root, "commit", "-qm", "bump")
    bumped = git(root, "rev-parse", "HEAD")
    set_version(root, 1)
    assert any("went down" in e for e in run(root, bumped))


def test_a_bump_needs_a_fixture_at_the_new_version(repo) -> None:
    root, base = repo
    set_version(root, 2)
    assert any(
        "no fixture is recorded under the current engine_version 2" in e for e in run(root, base)
    )


def test_an_unreadable_version_constant_fails(repo) -> None:
    root, base = repo
    write(root, ENGINE, "export const ENGINE_VERSION = 1;\nexport const ENGINE_VERSION = 2;\n")
    assert any("cannot read" in e for e in run(root, base))


def test_changed_hard_coded_results_without_a_bump_fail(repo) -> None:
    root, base = repo
    write(root, EXPECT, EXPECT_BODY.replace("42", "43"))
    errors = run(root, base)
    assert any(EXPECT in e and guard.BUMP_MESSAGE in e for e in errors)


def test_added_assertions_and_comments_in_an_expectation_test_pass(repo) -> None:
    root, base = repo
    body = EXPECT_BODY.replace("// pinned results", "// pinned results, reworded").replace(
        "});", "  expect(moves).toBe(3);\n});"
    )
    write(root, EXPECT, body + "\n")
    assert run(root, base) == []


def test_changed_hard_coded_results_with_a_bump_pass(repo) -> None:
    root, base = repo
    add_v2(root)
    write(root, EXPECT, EXPECT_BODY.replace("42", "43"))
    assert run(root, base) == []


def test_a_missing_base_commit_is_an_error(repo) -> None:
    root, _ = repo
    assert any("not available" in e for e in run(root, "0" * 40))


def test_a_base_without_the_manifest_uses_the_branch_manifest(tmp_path: pathlib.Path) -> None:
    git(tmp_path, "init", "-q")
    set_version(tmp_path, 1)
    write(tmp_path, FIXTURE, {"seed": 7})
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-qm", "before the guard")
    base = git(tmp_path, "rev-parse", "HEAD")
    write(tmp_path, guard.MANIFEST, copy.deepcopy(MANIFEST))
    write(tmp_path, "fixtures/other.json", {"x": 1})
    write(tmp_path, "src/game/dice/__tests__/replay.test.ts", 'load("dice_replay_v1.json");\n')
    write(tmp_path, EXPECT, EXPECT_BODY)
    assert run(tmp_path, base) == []
    write(tmp_path, FIXTURE, {"seed": 8})
    assert any(guard.BUMP_MESSAGE in e for e in run(tmp_path, base))


# --------------------------------------------------------------------------- this repository


def test_the_real_manifest_passes_its_static_rules() -> None:
    report = guard.run(REPO, None, static=True)
    assert report.errors == []


def test_the_real_manifest_covers_every_game_that_records_an_engine_version() -> None:
    games = json.loads((REPO / guard.MANIFEST).read_text())["games"]
    assert set(games) == {
        "solitaire",
        "freecell",
        "mahjong",
        "sort",
        "sudoku",
        "hearts",
        "yacht",
        "twenty48",
        "blackjack",
        "daily_word",
    }


def test_the_ci_step_runs_the_guard() -> None:
    ci = (REPO / ".github" / "workflows" / "ci.yml").read_text()
    assert "scripts/check_replay_fixture_versions.py" in ci

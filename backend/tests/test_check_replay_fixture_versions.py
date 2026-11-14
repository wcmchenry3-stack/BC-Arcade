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


# --------------------------------------------------------------------------- review round 1


def commit(root: pathlib.Path, message: str) -> str:
    git(root, "add", "-A")
    git(root, "commit", "-qm", message)
    return git(root, "rev-parse", "HEAD")


def test_removing_a_game_from_the_manifest_fails(repo) -> None:
    """Finding 1: the game drops out and its fixture moves to not_replay, then changes."""
    root, base = repo
    data = manifest(root)
    del data["games"]["dice"]
    data["not_replay"].append({"path": FIXTURE, "reason": "gone"})
    write(root, guard.MANIFEST, data)
    change_fixture(root)
    assert any("dice: removed from games" in e for e in run(root, base))


def test_a_fixture_moved_to_not_replay_fails(repo) -> None:
    root, base = repo
    add_v2(root)
    base = commit(root, "bump")
    data = manifest(root)
    data["games"]["dice"]["fixtures"] = [{"path": FIXTURE_V2, "engine_version": 2}]
    data["not_replay"].append({"path": FIXTURE, "reason": "not a replay log"})
    write(root, guard.MANIFEST, data)
    assert any("no longer pinned under dice" in e and FIXTURE in e for e in run(root, base))


def test_a_game_is_retired_only_once_its_constant_is_gone(repo) -> None:
    root, base = repo
    data = manifest(root)
    del data["games"]["dice"]
    data["not_replay"].append({"path": FIXTURE, "reason": "dice removed (#1)"})
    data["retired_games"] = {
        "dice": {"version": MANIFEST["games"]["dice"]["version"], "reason": "game removed in #1"}
    }
    write(root, guard.MANIFEST, data)
    write(root, "src/game/dice/__tests__/expect.test.ts", "")
    assert any("still exists" in e for e in run(root, base))
    write(root, ENGINE, "export const OTHER = 9;\n")  # the game's code is gone
    assert run(root, base) == []
    data["retired_games"]["dice"]["reason"] = "gone"
    write(root, guard.MANIFEST, data)
    assert any("retired_games dice: the reason must name" in e for e in run(root, base))


def test_an_expectation_dropped_from_the_list_is_still_checked(repo) -> None:
    root, base = repo
    data = manifest(root)
    data["games"]["dice"]["expectations"] = []
    write(root, guard.MANIFEST, data)
    write(root, EXPECT, EXPECT_BODY.replace("42", "43"))
    assert any(EXPECT in e and guard.BUMP_MESSAGE in e for e in run(root, base))


def test_repointing_the_version_to_a_higher_constant_fails(repo) -> None:
    root, base = repo
    data = manifest(root)
    data["games"]["dice"]["version"]["name"] = "OTHER"  # reads 9
    write(root, guard.MANIFEST, data)
    change_fixture(root)
    errors = run(root, base)
    assert any("version constant moved" in e for e in errors)


def test_moving_the_version_constant_with_the_same_value_passes(repo) -> None:
    root, base = repo
    write(root, "src/game/dice/version.ts", "export const DICE_ENGINE_VERSION = 1;\n")
    write(root, ENGINE, "export const OTHER = 9;\n")
    data = manifest(root)
    data["games"]["dice"]["version"] = {
        "file": "src/game/dice/version.ts",
        "name": "DICE_ENGINE_VERSION",
    }
    write(root, guard.MANIFEST, data)
    assert run(root, base) == []
    change_fixture(root)  # and the bump guard still works at the new location
    assert any(guard.BUMP_MESSAGE in e for e in run(root, base))


def test_a_version_cannot_be_retired_in_the_change_that_bumps_it(repo) -> None:
    """Finding 2: bump 1 -> 2, delete v1, add v2 and retire 1, all in one change."""
    root, base = repo
    add_v2(root)
    (root / FIXTURE).unlink()
    write(root, "src/game/dice/__tests__/replay.test.ts", 'load("dice_replay_v2.json");\n')
    data = manifest(root)
    data["games"]["dice"]["fixtures"] = [{"path": FIXTURE_V2, "engine_version": 2}]
    data["games"]["dice"]["retired_versions"] = {"1": "v1 logs expired 2026-12-15 (#1)"}
    write(root, guard.MANIFEST, data)
    errors = run(root, base)
    assert any("cannot be retired in the change that replaces it" in e for e in errors)
    assert any("was removed" in e for e in errors)


def test_a_retirement_reason_needs_a_date_or_an_issue(repo) -> None:
    root, _ = repo
    add_v2(root)
    bumped = commit(root, "bump")
    (root / FIXTURE).unlink()
    write(root, "src/game/dice/__tests__/replay.test.ts", 'load("dice_replay_v2.json");\n')
    data = manifest(root)
    data["games"]["dice"]["fixtures"] = [{"path": FIXTURE_V2, "engine_version": 2}]
    data["games"]["dice"]["retired_versions"] = {"1": "gone"}
    write(root, guard.MANIFEST, data)
    assert any("must name a date" in e for e in run(root, bumped))
    for reason in ("v1 logs expired 2026-12-15", "expired, see #4021"):
        data["games"]["dice"]["retired_versions"] = {"1": reason}
        write(root, guard.MANIFEST, data)
        assert run(root, bumped) == []


def add_second_game(root: pathlib.Path) -> None:
    """A second game, cards, sharing the dice expectation file (like Solitaire and FreeCell)."""
    write(root, "src/game/cards/engine.ts", "export const ENGINE_VERSION = 1;\n")
    write(root, "fixtures/cards_v1.json", {"seed": 3})
    write(root, "src/game/cards/__tests__/replay.test.ts", 'load("cards_v1.json");\n')
    data = manifest(root)
    data["games"]["cards"] = {
        "version": {"file": "src/game/cards/engine.ts", "name": "ENGINE_VERSION"},
        "fixtures": [{"path": "fixtures/cards_v1.json", "engine_version": 1}],
        "expectations": [EXPECT],
        "retired_versions": {},
    }
    write(root, guard.MANIFEST, data)


def test_a_shared_expectation_may_change_when_one_owner_bumped(repo) -> None:
    """Finding 3: the dice bump keeps v1 and changes the shared file's dice assertion."""
    root, _ = repo
    add_second_game(root)
    base = commit(root, "two games")
    add_v2(root)
    write(root, EXPECT, EXPECT_BODY.replace("42", "43"))
    assert run(root, base) == []


def test_a_shared_expectation_change_without_any_bump_names_every_owner(repo) -> None:
    root, _ = repo
    add_second_game(root)
    base = commit(root, "two games")
    write(root, EXPECT, EXPECT_BODY.replace("42", "43"))
    errors = run(root, base)
    assert len(errors) == 1 and "cards, dice: hard-coded replay results changed" in errors[0]


TS_BODY = """/** Pinned results of the dice replay. */
describe("dice", () => {
  it("rebuilds the board", () => {
    expect(rebuild(events).board).toEqual([2, 4, 8, 16]);
    expect(rebuild(events).score).toBe(42);
  });
});
"""

TS_REFORMATTED = """/**
 * Pinned results of the dice replay, reworded.
 */
describe("dice replay", () => {
  // the board after the last move
  it("rebuilds the final board", () => {
    expect(rebuild(events).board).toEqual([
      2, 4, 8, 16,
    ]);
    expect(
      rebuild(events).score
    ).toBe(42);
  });
});
"""

PY_BODY = '''"""Dice replay."""


def test_rebuilds() -> None:
    """The rebuilt score."""
    assert rebuild(events).score == 42  # pinned
    assert render(events) == "#1 roll 6"
'''

PY_REFORMATTED = '''"""Dice replay: what the server rebuilds, reworded."""


def test_the_server_rebuilds_the_score() -> None:
    """The rebuilt score, reworded."""
    # a comment
    assert (
        rebuild(events).score == 42
    )
    assert render(events) == "#1 roll 6"
'''


@pytest.mark.parametrize(
    ("path", "body", "reformatted", "changed"),
    [
        (EXPECT, TS_BODY, TS_REFORMATTED, TS_BODY.replace("16", "32")),
        (
            "backend/tests/test_dice.py",
            PY_BODY,
            PY_REFORMATTED,
            PY_BODY.replace("#1 roll 6", "#1 roll 5"),
        ),
    ],
)
def test_re_wrapping_comments_docstrings_and_titles_are_not_result_changes(
    tmp_path: pathlib.Path, path: str, body: str, reformatted: str, changed: str
) -> None:
    """Finding 4: a formatter re-wrap, a reworded comment or docstring, a renamed test title or
    test function is not a change; a changed value is, even inside a string holding `#`."""
    assert not guard.results_changed(path, body.encode(), reformatted.encode())
    assert guard.results_changed(path, body.encode(), changed.encode())
    assert guard.results_changed(path, reformatted.encode(), changed.encode())


def test_a_comment_marker_inside_a_string_is_kept() -> None:
    path = "src/x.test.ts"
    before = b'expect(url).toBe("http://a//b"); // note\n'
    after = b'expect(url).toBe("http://a//c"); // note\n'
    assert guard.results_changed(path, before, after)


def test_a_reformatted_expectation_file_passes_the_guard(repo) -> None:
    root, base = repo
    write(
        root,
        EXPECT,
        '// pinned\nit("rebuilds the dice", () => {\n  expect(\n    score\n  ).toBe(42);\n});\n',
    )
    assert run(root, base) == []


# --------------------------------------------------------------------------- review round 2


def retire_dice(root: pathlib.Path) -> None:
    """Take dice out of games into retired_games, its fixture into not_replay, then re-record it."""
    data = manifest(root)
    del data["games"]["dice"]
    data["not_replay"].append({"path": FIXTURE, "reason": "dice removed (#1)"})
    data["retired_games"] = {
        "dice": {"version": MANIFEST["games"]["dice"]["version"], "reason": "game removed in #1"}
    }
    write(root, guard.MANIFEST, data)
    change_fixture(root)


@pytest.mark.parametrize(
    "engine",
    [
        (
            "export const ENGINE_VERSION = 1;\n"
            "function _unused() {\n  const ENGINE_VERSION = 1;\n  return ENGINE_VERSION;\n}\n"
        ),
        "export const ENGINE_VERSION = 1 as const;\n",
    ],
    ids=["second-definition", "as-const"],
)
def test_a_game_whose_constant_is_still_in_its_file_cannot_be_retired(repo, engine: str) -> None:
    """B1: read_version cannot read these, but the constant (and the game) is still there."""
    root, base = repo
    write(root, ENGINE, engine)
    commit(root, "constant read differently")
    base = git(root, "rev-parse", "HEAD~1")
    retire_dice(root)
    write(root, EXPECT, EXPECT_BODY.replace("42", "43"))
    errors = run(root, base)
    assert any("retired_games dice: `ENGINE_VERSION` still exists" in e for e in errors)


def test_retiring_one_owner_leaves_a_shared_expectation_checked_for_the_other(repo) -> None:
    root, _ = repo
    add_second_game(root)
    base = commit(root, "two games")
    retire_dice(root)
    write(root, ENGINE, "export const OTHER = 9;\n")
    write(root, EXPECT, EXPECT_BODY.replace("42", "43"))
    assert any("cards, dice: hard-coded replay results changed" in e for e in run(root, base))


def test_an_expectation_renamed_with_changes_fails(repo) -> None:
    """S1: rename the test, change a value, repoint expectations."""
    root, base = repo
    renamed = "src/game/dice/__tests__/expect2.test.ts"
    (root / EXPECT).unlink()
    write(root, renamed, EXPECT_BODY.replace("42", "43"))
    data = manifest(root)
    data["games"]["dice"]["expectations"] = [renamed]
    write(root, guard.MANIFEST, data)
    assert any("deleted or renamed with changes" in e and EXPECT in e for e in run(root, base))
    write(root, renamed, EXPECT_BODY)  # renamed unchanged: fine
    assert run(root, base) == []


def test_an_expectation_deleted_and_unlisted_fails(repo) -> None:
    root, base = repo
    (root / EXPECT).unlink()
    data = manifest(root)
    data["games"]["dice"]["expectations"] = []
    write(root, guard.MANIFEST, data)
    assert any("deleted or renamed with changes" in e for e in run(root, base))
    add_v2(root)  # with a bump the old test may go
    assert run(root, base) == []


EXPECT_TS = """it("rebuilds", () => {
  expect(state.score).toBe(60);
  expect(state.tableau).toEqual([
    "5c",
    "13d? 7d",
  ]);
  expect(f(a, b)).toEqual([1, -2]);
  expect((a + b) * c).toBe(3);
});
"""
EXPECT_PY = "def test_rebuilds() -> None:\n    EXPECTED = 60\n    assert score == EXPECTED\n"


@pytest.mark.parametrize(
    ("path", "body", "edited"),
    [
        ("t.test.ts", EXPECT_TS, EXPECT_TS.replace("toBe(60)", "toBe(60 + 1)")),
        ("t.test.ts", EXPECT_TS, EXPECT_TS.replace("score).toBe(60)", "score).not.toBe(60)")),
        ("t.test.ts", EXPECT_TS, EXPECT_TS.replace('    "5c",\n', '    "5c",\n    "1s",\n')),
        ("t.test.ts", EXPECT_TS, EXPECT_TS.replace("[1, -2]", "[1 -2]")),
        ("t.test.ts", EXPECT_TS, EXPECT_TS.replace("(a + b) * c", "a + b * c")),
        ("t.test.ts", EXPECT_TS, EXPECT_TS.replace("f(a, b)", "f(a)(b)")),
        ("t.py", EXPECT_PY, EXPECT_PY.replace("EXPECTED = 60", "EXPECTED = 60 + 1")),
    ],
    ids=["plus-one", "not", "tableau-entry", "comma", "parens", "call-split", "python-plus-one"],
)
def test_an_insertion_inside_a_statement_is_a_change(path: str, body: str, edited: str) -> None:
    """S2: inserted tokens are free only as whole new statements; `,`/`;`/`(`/`)` only where a
    formatter puts them."""
    assert guard.results_changed(path, body.encode(), edited.encode())


@pytest.mark.parametrize(
    ("path", "body", "edited"),
    [
        (
            "t.test.ts",
            EXPECT_TS,
            EXPECT_TS.replace(
                "  expect(state.score).toBe(60);\n",
                "  expect(state.score).toBe(60);\n  expect(state.moves).toBe(3);\n",
            ),
        ),
        (
            "t.test.ts",
            EXPECT_TS,
            EXPECT_TS.replace('[\n    "5c",\n    "13d? 7d",\n  ]', '["5c", "13d? 7d"]'),
        ),
        (
            "t.test.ts",
            EXPECT_TS,
            EXPECT_TS.replace(
                "expect(state.score).toBe(60);", "expect(\n    state.score\n  ).toBe(60);"
            ),
        ),
        ("t.py", EXPECT_PY, EXPECT_PY + "    assert moves == 3\n"),
        (
            "t.py",
            EXPECT_PY,
            EXPECT_PY.replace(
                "assert score == EXPECTED", "assert (\n        score == EXPECTED\n    )"
            ),
        ),
    ],
    ids=["new-statement", "unwrap-array", "wrap-call", "python-new-statement", "python-parens"],
)
def test_new_statements_and_re_wrapping_stay_free(path: str, body: str, edited: str) -> None:
    assert not guard.results_changed(path, body.encode(), edited.encode())


def test_a_kept_copy_does_not_excuse_an_in_place_re_record_without_a_bump(repo) -> None:
    """S3: copy the v1 fixture, list the copy at v1, edit the original in place, no bump."""
    root, base = repo
    copy_path = "fixtures/dice_replay_v1_orig.json"
    write(root, copy_path, (root / FIXTURE).read_text())
    write(root, "src/game/dice/__tests__/replay.test.ts", 'load("dice_replay_v1.json");\n')
    write(root, "src/game/dice/__tests__/copy.test.ts", "// dice_replay_v1_orig.json\n")
    data = manifest(root)
    data["games"]["dice"]["fixtures"].append({"path": copy_path, "engine_version": 1})
    write(root, guard.MANIFEST, data)
    change_fixture(root)
    assert any(FIXTURE in e and guard.BUMP_MESSAGE in e for e in run(root, base))


def test_a_comment_that_holds_assertions_is_compared() -> None:
    """N1: a regex literal with `/*` makes the scanner read code as a comment: fail closed."""
    path = "t.test.ts"
    body = 'const re = /a\\/*b/;\nexpect(x).toBe(1);\nconst s = "*/";\n'
    assert guard.results_changed(path, body.encode(), body.replace("toBe(1)", "toBe(2)").encode())


def test_an_each_table_is_data_not_a_title() -> None:
    """N2: the first argument of it.each is the data table."""
    path = "t.test.ts"
    body = 'it.each`\n  a | b\n  ${1} | ${60}\n`("x", () => {});\ntest.each("${60}")("x", f);\n'
    assert guard.results_changed(path, body.encode(), body.replace('"${60}"', '"${61}"').encode())
    titled = 'test.skip("old title", () => { expect(a).toBe(1); });\n'
    assert not guard.results_changed(
        path, titled.encode(), titled.replace("old title", "new").encode()
    )


def test_a_non_integer_retired_version_is_a_readable_error(repo, capsys) -> None:
    """N4: no traceback, the run fails."""
    root, base = repo
    data = manifest(root)
    data["games"]["dice"]["retired_versions"] = {"x": "2026-12-15"}
    write(root, guard.MANIFEST, data)
    assert any("retired version 'x' is not an integer" in e for e in run(root, base))
    assert guard.main(["--root", str(root), "--base", base]) == 1


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


def test_the_real_manifest_lists_the_tests_that_hand_write_replay_results() -> None:
    """Finding 5: tests whose own literals pin a rebuilt outcome are expectations."""
    games = json.loads((REPO / guard.MANIFEST).read_text())["games"]
    listed = {name: set(g["expectations"]) for name, g in games.items()}
    assert "frontend/src/game/twenty48/__tests__/replay.fixture.test.ts" in listed["twenty48"]
    assert "frontend/src/game/blackjack/__tests__/replay.golden.test.tsx" in listed["blackjack"]
    assert "frontend/src/game/daily_word/__tests__/replay.fixture.test.ts" in listed["daily_word"]
    # its PINNED dict is byte sizes, but it also pins the rebuilt moves/undos and steps
    assert "backend/tests/test_sort_golden.py" in listed["sort"]
    shared = "frontend/src/game/_shared/cards/__tests__/fixtureReplay.test.ts"
    assert shared in listed["solitaire"] and shared in listed["freecell"]


def test_the_ci_step_runs_the_guard() -> None:
    ci = (REPO / ".github" / "workflows" / "ci.yml").read_text()
    assert "scripts/check_replay_fixture_versions.py" in ci

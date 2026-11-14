#!/usr/bin/env python3
"""Replay fixture version guard (#3911): a pinned replay result may not move without an engine_version bump.

Stdlib-only. Run from the repo root:

    python3 scripts/check_replay_fixture_versions.py                # diff vs merge-base with origin/dev
    python3 scripts/check_replay_fixture_versions.py --base <rev>   # diff vs a given commit
    python3 scripts/check_replay_fixture_versions.py --static       # manifest checks only, no git
    python3 scripts/check_replay_fixture_versions.py --hash <path>  # the sha256 an accepted_changes entry needs

The manifest, ``.github/replay-fixtures.json``, names for each replayable game its
``engine_version`` constant, its pinned fixtures (each with the version it was recorded under)
and the tests that hard-code replay results. Policy (#3908): a change that alters how stored
games replay bumps the game's engine_version and keeps the old fixture, frozen, until old logs
expire; a retired version's fixture is removed by listing it in ``retired_versions`` (in a
later change than the bump), and a game whose code is deleted leaves via ``retired_games``.
Docs: docs/CI-CHECKS.md#replay-fixture-version-guard-3911.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tokenize
from dataclasses import dataclass, field
from pathlib import Path

MANIFEST = ".github/replay-fixtures.json"
DOCS = "docs/CI-CHECKS.md#replay-fixture-version-guard-3911"
BUMP_MESSAGE = (
    "this change alters how stored games replay: bump engine_version and keep the old rules "
    "until old logs expire (see docs)"
)
# A retirement (a version or a whole game) names when or why: a date or an issue number.
RETIRE_REASON = re.compile(r"\d{4}-\d{2}-\d{2}|#\d+")
# TS/JS scanner: strings and comments are matched first, so `//` or `#` inside a string stays.
_TS_TOKEN = re.compile(
    r"""(?P<str>"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)"""
    r"""|(?P<com>//[^\n]*|/\*[\s\S]*?\*/)|(?P<tok>\w+|[^\w\s])"""
)
_TEST_CALLS = {"it", "test", "describe"}
# Punctuation a formatter adds or drops when it re-wraps an expression.
_WRAP = frozenset({",", ";", "(", ")"})


@dataclass
class Report:
    errors: list[tuple[str, str]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def error(self, path: str, message: str) -> None:
        self.errors.append((path, message))


# --------------------------------------------------------------------------- content


def canonical(path: str, data: bytes) -> bytes:
    """What the guard compares: JSON parsed and re-serialised (so reformatting is not a
    change), any other file as its code tokens (see ``code_tokens``)."""
    if path.endswith(".json"):
        try:
            return json.dumps(json.loads(data), sort_keys=True, separators=(",", ":")).encode()
        except ValueError:
            return data
    return "\x00".join(code_tokens(path, data)).encode()


def content_hash(path: str, data: bytes) -> str:
    return hashlib.sha256(canonical(path, data)).hexdigest()


def code_tokens(path: str, data: bytes) -> list[str]:
    """A test file as a token list, so whitespace and line wrapping never count. Comments,
    docstrings, test titles (the first string of ``it``/``test``/``describe``) and Python test
    function names are dropped: renaming or re-wording them changes no replay result."""
    text = data.decode("utf-8", "replace")
    return _py_tokens(text) if path.endswith(".py") else _ts_tokens(text)


def _ts_tokens(text: str) -> list[str]:
    out: list[str] = []
    for match in _TS_TOKEN.finditer(text):
        if match.lastgroup == "com":
            continue
        token = match.group()
        if match.lastgroup == "str" and _is_title(out):
            continue
        out.append(token)
    return out


def _is_title(prev: list[str]) -> bool:
    """True if the next token is the title string of ``it(``, ``describe.each(...)(`` etc."""
    if not prev or prev[-1] != "(":
        return False
    i = len(prev) - 2
    while i >= 1 and prev[i - 1] == ".":  # it.each / describe.skip / test.only
        i -= 2
    return i >= 0 and prev[i] in _TEST_CALLS


def _py_tokens(text: str) -> list[str]:
    skip = {tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT}
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (tokenize.TokenError, SyntaxError):
        return text.split()
    out: list[str] = []
    line_start = True
    for i, tok in enumerate(tokens):
        if tok.type in skip or tok.type == tokenize.ENDMARKER:
            line_start = line_start or tok.type in (
                tokenize.NEWLINE,
                tokenize.INDENT,
                tokenize.DEDENT,
            )
            continue
        nxt = tokens[i + 1].type if i + 1 < len(tokens) else tokenize.ENDMARKER
        docstring = (
            line_start
            and tok.type == tokenize.STRING
            and nxt in (tokenize.NEWLINE, tokenize.ENDMARKER)
        )
        test_name = out[-1:] == ["def"] and tok.type == tokenize.NAME
        line_start = False
        if not (docstring or test_name):
            out.append(tok.string)
    return out


def results_changed(path: str, base: bytes, head: bytes) -> bool:
    """True if a token of ``base`` is gone or replaced in ``head``. Pure additions pass, and so
    does adding or dropping only the punctuation a formatter moves when it re-wraps."""
    old, new = code_tokens(path, base), code_tokens(path, head)
    ops = difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes()
    for tag, i1, i2, j1, j2 in ops:
        if tag in ("equal", "insert"):
            continue
        if set(old[i1:i2]) | set(new[j1:j2]) <= _WRAP:
            continue
        return True
    return False


def read_version(text: str, name: str) -> int | None:
    pattern = rf"^\s*(?:export\s+)?(?:const\s+)?{re.escape(name)}\b\s*(?::[^=\n]+)?=\s*(\d+)\s*;?\s*(?:#.*|//.*)?$"
    found = re.findall(pattern, text, flags=re.MULTILINE)
    return int(found[0]) if len(found) == 1 else None


# --------------------------------------------------------------------------- sources


class Tree:
    """Files of the working tree (``rev=None``) or of a commit."""

    def __init__(self, root: Path, rev: str | None = None) -> None:
        self.root, self.rev = root, rev

    def read(self, path: str) -> bytes | None:
        if self.rev is None:
            file = self.root / path
            return file.read_bytes() if file.is_file() else None
        out = subprocess.run(
            ["git", "-C", str(self.root), "show", f"{self.rev}:{path}"],
            capture_output=True,
            check=False,
        )
        return out.stdout if out.returncode == 0 else None

    def manifest(self) -> dict | None:
        data = self.read(MANIFEST)
        return json.loads(data) if data is not None else None


def glob_files(root: Path, patterns: list[str]) -> set[str]:
    found: set[str] = set()
    for pattern in patterns:
        found.update(p.relative_to(root).as_posix() for p in root.glob(pattern) if p.is_file())
    return found


def game_version(tree: Tree, game: dict) -> int | None:
    text = tree.read(game["version"]["file"])
    return (
        None
        if text is None
        else read_version(text.decode("utf-8", "replace"), game["version"]["name"])
    )


def retired(game: dict) -> set[int]:
    return {int(v) for v in game.get("retired_versions", {})}


# --------------------------------------------------------------------------- static rules


def accept_hint(path: str, data: bytes | None) -> str:
    sha = content_hash(path, data) if data is not None else "-"
    return (
        "If the change does not alter replay outcomes (e.g. a field added), accept it in "
        f'{MANIFEST} accepted_changes: {{"path": "{path}", "sha256": "{sha}", "reason": "..."}}. '
        f"Docs: {DOCS}"
    )


def check_game_static(
    root: Path, name: str, game: dict, tests: dict[str, str], report: Report
) -> int | None:
    """One game's version constant, fixtures and expectation tests. Returns its version."""
    current = game_version(Tree(root), game)
    if current is None:
        report.error(
            game["version"]["file"],
            f"{name}: cannot read `{game['version']['name']}` (exactly one integer constant expected)",
        )
        return None
    for version, why in game.get("retired_versions", {}).items():
        if int(version) >= current or not RETIRE_REASON.search(str(why)):
            report.error(
                MANIFEST,
                f"{name}: retired version {version} must be older than {current} and its reason "
                "must name a date (YYYY-MM-DD) or an issue (#123)",
            )
    for fixture in game["fixtures"]:
        check_fixture_static(root, name, fixture, current, retired(game), tests, report)
    if all(f["engine_version"] != current for f in game["fixtures"]):
        report.error(
            MANIFEST, f"{name}: no fixture is recorded under the current engine_version {current}"
        )
    for path in game.get("expectations", []):
        if not (root / path).is_file():
            report.error(path, f"{name}: expectation test listed in {MANIFEST} does not exist")
    return current


def check_fixture_static(
    root: Path,
    name: str,
    fixture: dict,
    current: int,
    gone: set[int],
    tests: dict[str, str],
    report: Report,
) -> None:
    path, version = fixture["path"], fixture["engine_version"]
    if not (root / path).is_file():
        report.error(path, f"{name}: fixture listed in {MANIFEST} does not exist")
        return
    if not isinstance(version, int) or not 1 <= version <= current:
        report.error(
            path, f"{name}: engine_version {version} is not between 1 and the current {current}"
        )
    if version in gone:
        report.error(path, f"{name}: version {version} is retired, so its fixture must be removed")
    base = Path(path).name
    if not any(base in text for test, text in tests.items() if test != path):
        report.error(
            path, f"{name}: no test replays this fixture (its file name appears in no test)"
        )


def check_classified(root: Path, manifest: dict, report: Report) -> None:
    """Every scanned file is exactly one game's fixture or a not_replay entry."""
    listed: dict[str, str] = {}
    owners = [(f["path"], name) for name, g in manifest["games"].items() for f in g["fixtures"]]
    for entry in manifest.get("not_replay", []):
        owners.append((entry["path"], "not_replay"))
        if not (root / entry["path"]).is_file() or not entry.get("reason", "").strip():
            report.error(
                MANIFEST, f"{entry['path']}: not_replay entry needs an existing file and a reason"
            )
    for path, owner in owners:
        if path in listed:
            report.error(MANIFEST, f"{path}: listed twice ({listed[path]} and {owner})")
        listed[path] = owner
    for path in sorted(glob_files(root, manifest["scan"]) - set(listed)):
        report.error(
            path,
            f"fixture is not in {MANIFEST}: list it under its game's fixtures, "
            "or in not_replay with a reason",
        )


def check_accepted(root: Path, manifest: dict, report: Report) -> None:
    """An accepted change approves one exact content: it goes stale when the file changes."""
    pinned = {
        p
        for g in manifest["games"].values()
        for p in [f["path"] for f in g["fixtures"]] + g.get("expectations", [])
    }
    for entry in manifest.get("accepted_changes", []):
        path = entry.get("path", "")
        data = Tree(root).read(path)
        if path not in pinned or not entry.get("reason", "").strip():
            report.error(
                MANIFEST,
                f"accepted_changes {path!r}: must name a pinned fixture or expectation test "
                "and give a reason",
            )
        elif data is None or content_hash(path, data) != entry.get("sha256"):
            report.error(
                MANIFEST,
                f"accepted_changes {path}: stale (it approves one exact content and the file "
                "has changed since); remove it",
            )


def check_static(root: Path, manifest: dict, report: Report) -> dict[str, int]:
    """Rules that need no history. Returns each game's current version."""
    tests = {
        p: (root / p).read_text("utf-8", "replace")
        for p in glob_files(root, manifest["test_globs"])
    }
    versions: dict[str, int] = {}
    for name, game in manifest["games"].items():
        current = check_game_static(root, name, game, tests, report)
        if current is not None:
            versions[name] = current
    check_classified(root, manifest, report)
    check_accepted(root, manifest, report)
    check_retired_games(root, manifest, report)
    return versions


def check_retired_games(root: Path, manifest: dict, report: Report) -> None:
    """``retired_games`` holds games taken out of the guard: allowed only once the game's code is
    gone (its version constant can no longer be read), with a dated or numbered reason."""
    for name, entry in manifest.get("retired_games", {}).items():
        if name in manifest["games"]:
            report.error(MANIFEST, f"retired_games {name}: still listed under games")
        if not RETIRE_REASON.search(str(entry.get("reason", ""))):
            report.error(
                MANIFEST,
                f"retired_games {name}: the reason must name a date (YYYY-MM-DD) or an issue (#123)",
            )
        version = entry.get("version", {})
        text = Tree(root).read(version.get("file", ""))
        constant = version.get("name", "")
        if not version.get("file") or not constant:
            report.error(MANIFEST, f'retired_games {name}: give the game\'s old "version"')
        elif (
            text is not None and read_version(text.decode("utf-8", "replace"), constant) is not None
        ):
            report.error(
                version.get("file", MANIFEST),
                f"retired_games {name}: `{version.get('name')}` still exists; a game leaves the "
                "guard only when its code (and its engine_version constant) is removed",
            )


# --------------------------------------------------------------------------- diff rules


@dataclass
class GameDiff:
    """One game, base commit against the working tree."""

    name: str
    game: dict
    old_game: dict
    before: int
    current: int
    head: Tree
    base: Tree
    accepted: set[tuple[str, str]]

    @property
    def bumped(self) -> bool:
        return self.current > self.before

    @property
    def constant(self) -> str:
        return f"`{self.game['version']['name']}` in {self.game['version']['file']}"

    def is_accepted(self, path: str, data: bytes | None) -> bool:
        return data is not None and (path, content_hash(path, data)) in self.accepted

    def check(self, report: Report) -> None:
        if self.current < self.before:
            report.error(
                self.game["version"]["file"],
                f"{self.name}: {self.constant} went down from {self.before} to {self.current}",
            )
            return
        gone = self.check_retirements(report)
        heads = [
            (f["path"], f["engine_version"], self.head.read(f["path"]))
            for f in self.game["fixtures"]
        ]
        for fixture in self.old_game["fixtures"]:
            if fixture["engine_version"] not in gone:
                self.check_old_fixture(fixture["path"], fixture["engine_version"], heads, report)
        for path, version, data in heads:
            self.check_relabel(path, version, data, report)

    def check_retirements(self, report: Report) -> set[int]:
        """The retired versions that count. A newly retired version must be older than the
        base's version: the bump has to ship first, then the old version expires (#3908)."""
        old = retired(self.old_game)
        valid = set(old)
        for version in sorted(retired(self.game) - old):
            if version < self.before:
                valid.add(version)
                continue
            report.error(
                MANIFEST,
                f"{self.name}: engine_version {version} cannot be retired in the change that "
                f"replaces it (the base is still at {self.before}). Ship the bump first, and retire "
                f"{version} in a later change once its logs have expired. Docs: {DOCS}",
            )
        return valid

    def check_old_fixture(
        self, path: str, version: int, heads: list[tuple[str, int, bytes | None]], report: Report
    ) -> None:
        """A base fixture must still be pinned under its game, unchanged and at its version."""
        old = self.base.read(path)
        if old is None:
            return
        kept = any(
            v == version and data is not None and canonical(p, data) == canonical(path, old)
            for p, v, data in heads
        )
        new = self.head.read(path)
        listed = any(p == path for p, _, _ in heads)
        if kept or (listed and self.is_accepted(path, new)):
            return
        if new is None:
            message = (
                f"fixture for engine_version {version} was removed. {BUMP_MESSAGE}. To sunset an "
                f'expired version add "{version}": "<date or issue>" to '
                f"games.{self.name}.retired_versions. Docs: {DOCS}"
            )
        elif not listed:
            message = (
                f"fixture for engine_version {version} is no longer pinned under {self.name} "
                f"(moved to not_replay or dropped from the manifest). {BUMP_MESSAGE}. Docs: {DOCS}"
            )
        elif version < self.before:
            message = (
                f"fixture frozen at engine_version {version} changed. {BUMP_MESSAGE}. "
                f"{accept_hint(path, new)}"
            )
        elif self.bumped:
            message = (
                f"{self.constant} went {self.before} -> {self.current} but the fixture recorded under "
                f"{version} was changed in place. Keep the old one: restore it (listed at "
                f"engine_version {version}) and add the new recording as a separate fixture at "
                f"engine_version {self.current}. Docs: {DOCS}"
            )
        else:
            message = (
                f"{BUMP_MESSAGE}. {self.constant} is still {self.current}. {accept_hint(path, new)}"
            )
        report.error(path, f"{self.name}: {message}")

    def check_relabel(self, path: str, version: int, data: bytes | None, report: Report) -> None:
        """A fixture whose content changed on this branch holds the current rules' results."""
        old = self.base.read(path)
        if old is None or data is None or version == self.current or self.is_accepted(path, data):
            return
        old_paths = {f["path"] for f in self.old_game["fixtures"]}
        if path in old_paths and canonical(path, old) != canonical(path, data):
            report.error(
                path,
                f"{self.name}: a changed fixture must be listed at the current engine_version "
                f"{self.current}",
            )


@dataclass
class Diff:
    root: Path
    manifest: dict
    base_rev: str
    versions: dict[str, int]
    report: Report

    def __post_init__(self) -> None:
        self.head, self.base = Tree(self.root), Tree(self.root, self.base_rev)
        self.base_manifest = self.base.manifest() or self.manifest
        self.accepted = {
            (e.get("path"), e.get("sha256")) for e in self.manifest.get("accepted_changes", [])
        }

    def check(self) -> None:
        games, old_games = self.manifest["games"], self.base_manifest["games"]
        done: set[str] = set()  # bumped or fully retired: their expectation tests may change
        for name in sorted(set(games) | set(old_games)):
            old_game, game = old_games.get(name), games.get(name)
            # a new game has nothing stored under older rules yet
            before = game_version(self.base, old_game) if old_game else None
            if old_game is None or before is None:
                continue
            if game is None:
                if self.check_removed_game(name, old_game):
                    done.add(name)
                continue
            if name not in self.versions:
                continue  # unreadable constant: reported by the static rules
            if not self.check_version_location(name, old_game, game, before):
                continue
            diff = GameDiff(
                name,
                game,
                old_game,
                before,
                self.versions[name],
                self.head,
                self.base,
                self.accepted,
            )
            diff.check(self.report)
            if diff.bumped:
                done.add(name)
        self.check_expectations(done)

    def check_removed_game(self, name: str, old_game: dict) -> bool:
        """A game leaves the manifest only as a full retirement (see ``check_retired_games``)."""
        entry = self.manifest.get("retired_games", {}).get(name)
        if entry is not None and entry.get("version") == old_game["version"]:
            self.report.notes.append(f"{name}: retired game, its fixtures are no longer pinned")
            return True
        self.report.error(
            MANIFEST,
            f"{name}: removed from games. {BUMP_MESSAGE}. A game leaves the guard only when its "
            f'code is gone: list it in retired_games with its old "version" and a dated reason. '
            f"Docs: {DOCS}",
        )
        return False

    def check_version_location(self, name: str, old_game: dict, game: dict, before: int) -> bool:
        """The constant may move (a refactor) only if it reads the same value as at the base;
        a bump at a new location would compare two different constants."""
        if old_game["version"] == game["version"] or self.versions[name] == before:
            return True
        self.report.error(
            game["version"]["file"],
            f"{name}: the version constant moved from `{old_game['version']['name']}` in "
            f"{old_game['version']['file']} and its value changed ({before} -> "
            f"{self.versions[name]}). Move it and bump it in separate changes. Docs: {DOCS}",
        )
        return False

    def check_expectations(self, done: set[str]) -> None:
        """Tests that hard-code replay results, over the base and branch lists. A file shared by
        several games (Solitaire and FreeCell) may change when any of them bumped (or retired)."""
        owners: dict[str, set[str]] = {}
        for games in (self.base_manifest["games"], self.manifest["games"]):
            for name, game in games.items():
                for path in game.get("expectations", []):
                    owners.setdefault(path, set()).add(name)
        for path, names in sorted(owners.items()):
            old, new = self.base.read(path), self.head.read(path)
            if old is None or new is None or names & done:
                continue
            if (path, content_hash(path, new)) in self.accepted:
                continue
            if results_changed(path, old, new):
                games = ", ".join(sorted(names))
                self.report.error(
                    path,
                    f"{games}: hard-coded replay results changed. {BUMP_MESSAGE}. Only additions "
                    f"are free. {accept_hint(path, new)}",
                )


def check_diff(
    root: Path, manifest: dict, base_rev: str, versions: dict[str, int], report: Report
) -> None:
    Diff(root, manifest, base_rev, versions, report).check()


# --------------------------------------------------------------------------- entry point


def default_base(root: Path) -> str | None:
    out = subprocess.run(
        ["git", "-C", str(root), "merge-base", "origin/dev", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    )
    return out.stdout.strip() or None


def run(root: Path, base: str | None, static: bool = False) -> Report:
    report = Report()
    manifest = json.loads((root / MANIFEST).read_text("utf-8"))
    versions = check_static(root, manifest, report)
    if static:
        return report
    rev = base or default_base(root)
    if rev is None:
        report.notes.append("no base commit (origin/dev not fetched?): manifest checks only")
        return report
    if subprocess.run(
        ["git", "-C", str(root), "cat-file", "-e", f"{rev}^{{commit}}"],
        capture_output=True,
        check=False,
    ).returncode:
        report.error(MANIFEST, f"base commit {rev} is not available (fetch it first)")
        return report
    check_diff(root, manifest, rev, versions, report)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument(
        "--base", help="commit to compare against (default: merge-base with origin/dev)"
    )
    parser.add_argument("--static", action="store_true", help="manifest checks only, no history")
    parser.add_argument(
        "--hash", metavar="PATH", help="print the sha256 an accepted_changes entry needs"
    )
    args = parser.parse_args(argv)
    root = args.root.resolve()
    if args.hash:
        print(content_hash(args.hash, (root / args.hash).read_bytes()))
        return 0
    report = run(root, args.base, args.static)
    annotate = os.environ.get("GITHUB_ACTIONS") == "true"
    for note in report.notes:
        print(f"note: {note}")
    for path, message in report.errors:
        print(f"::error file={path}::{message}" if annotate else f"ERROR {path}: {message}")
    if report.errors:
        print(f"{len(report.errors)} replay fixture problem(s). Docs: {DOCS}")
        return 1
    print("Replay fixtures match their engine_version")
    return 0


if __name__ == "__main__":
    sys.exit(main())

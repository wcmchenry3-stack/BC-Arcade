"""Build the PR comment for the doc-reminder workflow (#3448).

Reads the path -> doc mapping from ``.github/doc-reminder.yml``, takes the list of files a PR
changes, and prints the markdown comment body. Advisory only: a bad config never raises out
of ``main`` (the workflow also runs with ``continue-on-error``).

Usage::

    python tools/doc_reminder/doc_reminder.py --changed changed.txt [--repo-root .]
        [--config .github/doc-reminder.yml] [--out comment.md]

Exit status is 0 unless the arguments are invalid. The first line of the output is
``<!-- doc-reminder -->`` so the workflow can find and edit its sticky comment.. When nothing
matches, the body is that marker plus ``NO_SUGGESTIONS``.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml

MARKER = "<!-- doc-reminder -->"
NO_SUGGESTIONS = "No doc suggestions for the files changed in this PR."
_NAME = "{name}"


@dataclass
class Suggestion:
    doc: str
    triggers: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    touched: bool = False


def glob_to_regex(glob: str) -> re.Pattern[str]:
    """Compile a path glob. ``*`` stays within a segment, ``**`` crosses segments and
    ``{name}`` is one non-empty segment captured as ``name``."""
    out: list[str] = []
    i = 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif glob.startswith("**", i):
            out.append(".*")
            i += 2
        elif glob.startswith(_NAME, i):
            out.append("(?P<name>[^/]+)")
            i += len(_NAME)
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(glob[i]))
            i += 1
    return re.compile("^" + "".join(out) + "$")


def match(glob: str, path: str) -> dict[str, str] | None:
    """Return the captures (possibly empty) if ``path`` matches ``glob``, else None."""
    m = glob_to_regex(glob).match(path)
    return m.groupdict() if m else None


def load_config(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise TypeError(f"{path}: top level must be a mapping")
    return data


def suggest(changed: list[str], config: dict, repo_root: Path | None = None) -> list[Suggestion]:
    """Map changed files to docs. Docs that do not exist under ``repo_root`` are dropped
    (pass ``repo_root=None`` to skip the check). Docs the PR itself changed are kept but
    flagged ``touched`` so the comment can tick them."""
    changed_set = set(changed)
    ignore = [glob_to_regex(g) for g in config.get("ignore") or []]
    by_doc: dict[str, Suggestion] = {}
    for rule in config.get("rules") or []:
        for path in changed:
            if any(rx.match(path) for rx in ignore):
                continue
            for glob in rule.get("paths") or []:
                captures = match(glob, path)
                if captures is None:
                    continue
                for doc_tmpl in rule.get("docs") or []:
                    if _NAME in doc_tmpl and "name" not in captures:
                        continue
                    doc = doc_tmpl.replace(_NAME, captures.get("name", ""))
                    if repo_root is not None and not (repo_root / doc).is_file():
                        continue
                    s = by_doc.setdefault(doc, Suggestion(doc, touched=doc in changed_set))
                    if path not in s.triggers:
                        s.triggers.append(path)
                    note = rule.get("note")
                    if note and note not in s.notes:
                        s.notes.append(note)
                break  # one matching glob per rule and path is enough
    return sorted(by_doc.values(), key=lambda s: s.doc)


def render(suggestions: list[Suggestion], max_triggers: int = 3) -> str:
    if not suggestions:
        return f"{MARKER}\n{NO_SUGGESTIONS}\n"
    lines = [
        MARKER,
        "### Docs that may need updating",
        "",
        (
            "Based on the paths this PR changes. Advisory only; a ticked box means this PR "
            "already edits that doc."
        ),
        "",
    ]
    for s in suggestions:
        shown = ", ".join(f"`{t}`" for t in s.triggers[:max_triggers])
        extra = len(s.triggers) - max_triggers
        if extra > 0:
            shown += f" and {extra} more"
        note = f" ({' '.join(s.notes)})" if s.notes else ""
        box = "x" if s.touched else " "
        lines.append(f"- [{box}] `{s.doc}`: changed {shown}{note}")
    lines.append("")
    return "\n".join(lines)


def build_comment(changed: list[str], config: dict, repo_root: Path | None) -> str:
    return render(suggest(changed, config, repo_root))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--changed", required=True, help="file with one changed path per line")
    ap.add_argument("--repo-root", default=".")
    ap.add_argument("--config", default=None)
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)
    root = Path(args.repo_root)
    config_path = Path(args.config) if args.config else root / ".github" / "doc-reminder.yml"
    lines = Path(args.changed).read_text(encoding="utf-8").splitlines()
    changed = [ln.strip() for ln in lines if ln.strip()]
    try:
        body = build_comment(changed, load_config(config_path), root)
    except Exception as exc:  # noqa: BLE001 - advisory: never fail the PR over a config problem
        print(f"doc-reminder: {exc}", file=sys.stderr)
        body = f"{MARKER}\n{NO_SUGGESTIONS}\n"
    if args.out:
        Path(args.out).write_text(body, encoding="utf-8")
    else:
        sys.stdout.write(body)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

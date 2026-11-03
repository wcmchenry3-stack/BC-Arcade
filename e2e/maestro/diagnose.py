"""Print bounded failure context from Maestro debug output to the job log.

Usage: python3 e2e/maestro/diagnose.py [<debug-root>]   (default: maestro-debug)

The smoke workflows run `maestro test --debug-output maestro-debug/<dir>
--flatten-debug-output ...` per flow directory, so each directory gets one
maestro.log plus one commands-(<flow>).json per flow (TestDebugReporter at
v1.39.13). Maestro 2.x (the iOS leg) instead writes <dir>/<flow>/commands.json
with each step's view hierarchy in a separate file listed in the step's
`artifacts`; both layouts are read. Artifacts can't always be fetched, so on
failure this prints, for every flow with a failed command:

  - the failed command and its error message;
  - the elements in the failure-time view hierarchy whose resource-id or text
    matches IDS_OF_INTEREST / TEXT_OF_INTEREST, with their bounds (to calibrate
    the drag flows' percentage coordinates and see which labels Maestro
    actually sees);
  - once per run, the first MAX_ELEMENTS labelled elements of the first failure's
    hierarchy, unfiltered (shows an unexpected screen, e.g. a system alert or the
    dev-client launcher);
  - the last LOG_TAIL lines of that directory's maestro.log.

Total output is capped at MAX_LINES lines.
"""

import glob
import json
import os
import re
import sys

MAX_LINES = 300
LOG_TAIL = 40
MAX_ELEMENTS = 40
IDS_OF_INTEREST = re.compile(
    r"^(freecell-|solitaire-|hearts-hand-card-|score-row-|yacht-|game-tile-|nav-back)"
)
# Matched anywhere in text + accessibilityText (iOS puts labels there, not in resource-id).
TEXT_OF_INTEREST = re.compile(
    r"Tableau column|Your hand|BC Arcade|Load embedded bundle|game-tile-|Development|Fetch"
    r"|Reload|Allow|Don[’']t Allow|\bOK\b"
)


class Out:
    def __init__(self) -> None:
        self.lines = 0

    def __call__(self, text: str = "") -> None:
        if self.lines >= MAX_LINES:
            return
        for line in text.splitlines() or [""]:
            if self.lines == MAX_LINES - 1:
                print("... (output capped)")
                self.lines = MAX_LINES
                return
            print(line[:300])
            self.lines += 1


def _command_name(command: dict) -> str:
    for key, value in command.items():
        if value is not None:
            return key
    return "unknown"


def _error_message(error) -> str:
    if isinstance(error, dict):
        return str(error.get("message") or error.get("localizedMessage") or error)[:300]
    return str(error)[:300]


def _walk(node, found: list, unfiltered: bool = False) -> None:
    if not isinstance(node, dict) or len(found) >= MAX_ELEMENTS:
        return
    attrs = node.get("attributes") or {}
    rid = attrs.get("resource-id") or ""
    text = attrs.get("text") or ""
    a11y = attrs.get("accessibilityText") or ""
    if (
        (unfiltered and (rid or text or a11y))
        or IDS_OF_INTEREST.match(rid)
        or TEXT_OF_INTEREST.search(text + " " + a11y)
    ):
        found.append(f"    {rid or '-'} bounds={attrs.get('bounds')} text={text!r} a11y={a11y!r}")
    for child in node.get("children") or []:
        _walk(child, found, unfiltered)


def _hierarchy(meta: dict, commands_path: str):
    """Maestro 1.x inlines the hierarchy; 2.x lists it as a step artifact file."""
    if meta.get("hierarchy"):
        return meta["hierarchy"]
    for artifact in meta.get("artifacts") or []:
        if "HIERARCHY" in str(artifact.get("type", "")).upper() and artifact.get("path"):
            try:
                with open(os.path.join(os.path.dirname(commands_path), artifact["path"])) as f:
                    return json.load(f)
            except (OSError, ValueError):
                return None
    return None


def main(root: str) -> None:
    out = Out()
    commands_files = sorted(
        glob.glob(os.path.join(root, "*", "commands-*.json"))
        + glob.glob(os.path.join(root, "*", "*", "commands.json"))
    )
    failed_dirs = set()
    dumped_unfiltered = False
    for path in commands_files:
        try:
            with open(path) as f:
                entries = json.load(f)
        except (OSError, ValueError) as exc:
            out(f"## {path}: unreadable ({exc})")
            continue
        failed = [e for e in entries if (e.get("metadata") or {}).get("status") == "FAILED"]
        if not failed:
            continue
        failed_dirs.add(os.path.join(root, os.path.relpath(path, root).split(os.sep)[0]))
        out(f"## {os.path.relpath(path, root)}")
        for entry in failed:
            meta = entry.get("metadata") or {}
            command = entry.get("command") or {}
            name = _command_name(command)
            out(f"  FAILED {name}: {json.dumps(command.get(name))[:250]}")
            out(f"  error: {_error_message(meta.get('error'))}")
            hierarchy = _hierarchy(meta, path)
            found: list = []
            _walk(hierarchy, found)
            if found:
                out("  elements of interest at failure:")
                for line in found:
                    out(line)
            if hierarchy and not dumped_unfiltered:
                dumped_unfiltered = True
                everything: list = []
                _walk(hierarchy, everything, unfiltered=True)
                out(
                    f"  first {MAX_ELEMENTS} labelled elements at failure (unfiltered, once per run):"
                )
                for line in everything:
                    out(line)
    for directory in sorted(failed_dirs):
        log = os.path.join(directory, "maestro.log")
        if os.path.exists(log):
            out(f"## tail of {os.path.relpath(log, root)}")
            with open(log, errors="replace") as f:
                for line in f.readlines()[-LOG_TAIL:]:
                    out("  " + line.rstrip())
    if not failed_dirs:
        out(f"No failed commands found under {root}/ (a parse error leaves no commands file).")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "maestro-debug")

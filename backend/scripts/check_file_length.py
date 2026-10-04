"""Fail if any backend .py file exceeds MAX_LINES (quality gate, #2951 / epic #2950)."""

import pathlib
import sys

MAX_LINES = 800
EXCLUDED_DIRS = {"tests", "alembic", ".venv", "venv", "node_modules", "__pycache__"}
# Existing offenders; remove each entry when its split lands.
ALLOWED = {
    "games/service.py",  # TODO(#2991): split games/service.py
    "purchases/google_notifications.py",  # TODO(#2998): split google_notifications.py
}

root = pathlib.Path(__file__).resolve().parent.parent
bad = []
for path in sorted(root.rglob("*.py")):
    rel = path.relative_to(root)
    if EXCLUDED_DIRS & set(rel.parts) or rel.as_posix() in ALLOWED:
        continue
    n = len(path.read_text(encoding="utf-8").splitlines())
    if n > MAX_LINES:
        bad.append(f"{rel.as_posix()}: {n} lines (max {MAX_LINES})")
if bad:
    print("Backend files over the length limit (split them, or see #2951):", *bad, sep="\n  ")
    sys.exit(1)
print(f"OK: no backend .py file over {MAX_LINES} lines")

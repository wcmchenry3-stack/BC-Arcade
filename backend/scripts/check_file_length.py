"""Fail if any backend .py file exceeds its line cap (quality gate, #2951 / epic #2950).

Every file is capped at MAX_LINES unless it has an entry in CAPS (its line count when the
gate landed), so even the known big files cannot grow. The check is self-expiring: a CAPS
entry fails with "remove <path> from CAPS" once the file is at or under MAX_LINES (or gone).
"""

from __future__ import annotations

import pathlib
import sys

MAX_LINES = 800
EXCLUDED_DIRS = {"tests", "alembic", ".venv", "venv", "node_modules", "__pycache__"}
CAPS = {
    "purchases/google_notifications.py": 813,  # TODO(#2998): split google_notifications.py
}

root = pathlib.Path(__file__).resolve().parent.parent


def line_count(rel: str) -> int | None:
    path = root / rel
    return len(path.read_text(encoding="utf-8").splitlines()) if path.exists() else None


bad = []
for path in sorted(root.rglob("*.py")):
    parts = path.relative_to(root).parts
    if EXCLUDED_DIRS & set(parts):
        continue
    rel = "/".join(parts)
    cap = CAPS.get(rel, MAX_LINES)
    n = line_count(rel)
    if n > cap:
        bad.append(f"{rel}: {n} lines (max {cap})")
for rel in sorted(CAPS):
    n = line_count(rel)
    if n is None:
        bad.append(f"remove {rel} from CAPS (file no longer exists)")
    elif n <= MAX_LINES:
        bad.append(f"remove {rel} from CAPS (now {n} lines, at or under {MAX_LINES})")
if bad:
    print("Backend file-length check failed (split files, or see #2951):", *bad, sep="\n  ")
    sys.exit(1)
print(f"OK: no backend .py file over its cap (default {MAX_LINES} lines)")

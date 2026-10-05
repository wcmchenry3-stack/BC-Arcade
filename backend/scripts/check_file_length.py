"""Fail if any backend .py file exceeds MAX_LINES (quality gate, #2951 / epic #2950).

Allow-lists are self-expiring so they shrink as the splits land:
  * ALLOWED: files already over MAX_LINES. Fails once the file is at or under MAX_LINES
    (or deleted) with "remove <path> from ALLOWED".
  * NEAR_LIMIT: files just under MAX_LINES that a trivial edit would tip over. They get
    NEAR_LIMIT_SLACK extra lines; the entry fails once the file drops below
    MAX_LINES - NEAR_LIMIT_SLACK (i.e. it was split) or is deleted.
"""

import pathlib
import sys

MAX_LINES = 800
NEAR_LIMIT_SLACK = 50
EXCLUDED_DIRS = {"tests", "alembic", ".venv", "venv", "node_modules", "__pycache__"}
ALLOWED = {
    "games/service.py",  # TODO(#2991): split games/service.py
    "purchases/google_notifications.py",  # TODO(#2998): split google_notifications.py
}
NEAR_LIMIT = {
    "games/leaderboard.py",  # TODO(#2992): 798 lines, split before it grows
    "purchases/service.py",  # TODO(#2998): 793 lines, split before it grows
}

root = pathlib.Path(__file__).resolve().parent.parent


def line_count(rel: str) -> int | None:
    path = root / rel
    return len(path.read_text(encoding="utf-8").splitlines()) if path.exists() else None


bad = []
for path in sorted(root.rglob("*.py")):
    rel = path.relative_to(root).as_posix()
    if EXCLUDED_DIRS & set(path.relative_to(root).parts) or rel in ALLOWED:
        continue
    limit = MAX_LINES + (NEAR_LIMIT_SLACK if rel in NEAR_LIMIT else 0)
    n = line_count(rel)
    if n > limit:
        bad.append(f"{rel}: {n} lines (max {limit})")
for rel in sorted(ALLOWED):
    n = line_count(rel)
    if n is None:
        bad.append(f"remove {rel} from ALLOWED (file no longer exists)")
    elif n <= MAX_LINES:
        bad.append(f"remove {rel} from ALLOWED (now {n} lines, at or under {MAX_LINES})")
for rel in sorted(NEAR_LIMIT):
    n = line_count(rel)
    if n is None:
        bad.append(f"remove {rel} from NEAR_LIMIT (file no longer exists)")
    elif n < MAX_LINES - NEAR_LIMIT_SLACK:
        bad.append(f"remove {rel} from NEAR_LIMIT (now {n} lines, well under {MAX_LINES})")
if bad:
    print("Backend file-length check failed (split files, or see #2951):", *bad, sep="\n  ")
    sys.exit(1)
print(f"OK: no backend .py file over {MAX_LINES} lines")

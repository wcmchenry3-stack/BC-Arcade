#!/usr/bin/env python3
"""Fail if a tracked file exceeds the size limit and is not allow-listed (#2967).

Stdlib-only. Run from anywhere inside the repo:  python3 scripts/check_large_files.py

Checks every file in `git ls-files`. Allow-listed paths are exempt; anything else
over the limit (newly added or grown) fails the PR. To tolerate a large file
deliberately, add its path/glob to ALLOWLIST with a reason.
"""

from __future__ import annotations

import fnmatch
import os
import subprocess
import sys

LIMIT_BYTES = 5 * 1024 * 1024  # 5 MiB (issue #2967)

# (glob, reason). fnmatch globs: "*" also matches "/".
ALLOWLIST: list[tuple[str, str]] = [
    # Cascade source art, force-tracked past .gitignore. Not in the app bundle.
    # Moves to Git LFS under epic #3033; delete these two entries then.
    ("celestial_images/*", "Cascade source art -> LFS in #3033"),
    ("fruit_images/*", "Cascade source art -> LFS in #3033"),
    # Background music; right-sizing tracked in #1779.
    ("frontend/assets/sounds/*.mp3", "BGM sizes, #1779"),
]


def allowed(path: str) -> bool:
    return any(fnmatch.fnmatch(path, glob) for glob, _ in ALLOWLIST)


def main() -> int:
    root = subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"], text=True
    ).strip()
    files = subprocess.check_output(
        ["git", "-C", root, "ls-files", "-z"], text=True
    ).split("\0")
    offenders = []
    for rel in filter(None, files):
        full = os.path.join(root, rel)
        if os.path.islink(full) or not os.path.isfile(full):
            continue
        size = os.path.getsize(full)
        if size > LIMIT_BYTES and not allowed(rel):
            offenders.append((rel, size))
    for rel, size in sorted(offenders, key=lambda o: -o[1]):
        print(
            f"::error file={rel}::{rel} is {size / 1048576:.1f} MiB (limit {LIMIT_BYTES // 1048576} MiB)"
        )
    if offenders:
        print(
            "\nTracked files over the limit. Shrink/optimize them, use Git LFS, or (with a "
            "reason) add to ALLOWLIST in scripts/check_large_files.py."
        )
        return 1
    print(
        f"OK: no tracked file over {LIMIT_BYTES // 1048576} MiB outside the allow-list."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Fail if a tracked file exceeds the size limit and is not allow-listed (#2967).

Stdlib-only. Run from anywhere inside the repo:  python3 scripts/check_large_files.py

Checks every file in `git ls-files`. Grandfathered files (exact path, size cap) may not grow; any other file
over the limit fails the PR.
"""

from __future__ import annotations

import os
import subprocess
import sys

LIMIT_BYTES = 5 * 1024 * 1024  # 5 MiB (issue #2967)

# Exact path -> size cap in bytes. A listed file may not grow past its cap; any
# unlisted file over LIMIT_BYTES fails, even inside these directories.
# Cascade source art is force-tracked past .gitignore and is not in the app bundle.
# The celestial_images/ and fruit_images/ entries go away when #3033 moves the art
# to Git LFS. If a sound file ever exceeds the limit, list it here explicitly (#1779).
GRANDFATHERED: dict[str, int] = {
    "celestial_images/earth.png": 6274815,
    "celestial_images/jupiter.png": 8975886,
    "celestial_images/mars.png": 8385593,
    "celestial_images/mercury.png": 7789380,
    "celestial_images/milkyway.png": 7768274,
    "celestial_images/neptune.png": 7970062,
    "celestial_images/pluto.png": 7398949,
    "celestial_images/saturn.png": 8835928,
    "celestial_images/sun.png": 8453418,
    "celestial_images/uranus.png": 8195105,
    "celestial_images/venus.png": 7587525,
    "fruit_images/apple.png": 6615197,
    "fruit_images/blueberry.png": 6811784,
    "fruit_images/cherry.png": 7176170,
    "fruit_images/coconut.png": 7155948,
    "fruit_images/dragonfruit.png": 6905582,
    "fruit_images/grapes.png": 6711208,
    "fruit_images/lemon.png": 6136900,
    "fruit_images/orange.png": 5513566,
    "fruit_images/peach.png": 7180903,
    "fruit_images/pineapple.png": 6347997,
    "fruit_images/pumpkin.png": 6948929,
    "fruit_images/watermelon.png": 7022094,
}


def find_offenders(sizes: dict[str, int]) -> list[tuple[str, int]]:
    """Return (path, size) for each file over its cap, largest first."""
    bad = [
        (path, size)
        for path, size in sizes.items()
        if size > GRANDFATHERED.get(path, LIMIT_BYTES)
    ]
    return sorted(bad, key=lambda o: -o[1])


def main() -> int:
    root = subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"], text=True
    ).strip()
    files = subprocess.check_output(
        ["git", "-C", root, "ls-files", "-z"], text=True
    ).split("\0")
    sizes: dict[str, int] = {}
    for rel in filter(None, files):
        full = os.path.join(root, rel)
        if os.path.islink(full) or not os.path.isfile(full):
            continue
        sizes[rel] = os.path.getsize(full)
    offenders = find_offenders(sizes)
    for rel, size in offenders:
        print(
            f"::error file={rel}::{rel} is {size / 1048576:.1f} MiB (limit {LIMIT_BYTES // 1048576} MiB)"
        )
    if offenders:
        print(
            "\nTracked files over the limit. Shrink/optimize them, use Git LFS, or (with a "
            "reason) see GRANDFATHERED in scripts/check_large_files.py."
        )
        return 1
    print(
        f"OK: no tracked file over {LIMIT_BYTES // 1048576} MiB outside the allow-list."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

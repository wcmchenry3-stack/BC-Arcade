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
# If a sound file ever exceeds the limit, list it here explicitly (#1779).
GRANDFATHERED: dict[str, int] = {
    # Star Swarm music session archive (#3642) — design/audition artifacts, not game assets.
    "docs/games/starswarm-music/Other_Working_Audio/00-draft-full.mp3": 12235615,
    "docs/games/starswarm-music/Rounds/Round_21/starswarm-round21-full-rough.mp3": 5881052,
    "docs/games/starswarm-music/Rounds/Round_23/starswarm-round23-integrated-rough.mp3": 5881052,
    # Star Swarm Rounds 44 and 46 (#3734): the seven-minute ambient foundation and the
    # integrated signature mix. Audition artifacts, not game assets; kept bit-exact (never
    # re-encoded) so the approved render stays reproducible. Same precedent as Round 21/23.
    "docs/games/starswarm-music/Rounds/Round_44/starswarm-round44-seven-minute-ambient-foundation.mp3": 6721196,
    "docs/games/starswarm-music/Rounds/Round_46/starswarm-round46-seven-minute-signature-mix.mp3": 6721196,
    # Star Swarm background music (#3638): the one 6:52.7 track that replaces the four Pixabay
    # tracks (11.28 MB combined). The owner's Round 46 render with the loop edit
    # (tools/assets/make_starswarm_bgm_loop.py): fades trimmed, 3 s seam, +2.9 dB, one encode.
    "frontend/assets/sounds/starswarm-bgm.mp3": 6604461,
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

#!/usr/bin/env python3
"""Validate a Mahjong layout JSON file.

Usage: python3 scripts/validate-mahjong-layout.py path/to/layout.json [expected_count]

Checks:
  - Exactly <expected_count> tiles (default 144)
  - No duplicate (col, row, layer) coordinates
  - Even tile count per layer (solvability precondition)

Exit code 0 = valid, non-zero = invalid.
"""

import json
import sys


def validate(path: str, expected: int = 144) -> bool:
    with open(path) as f:
        tiles = json.load(f)

    ok = True

    if len(tiles) != expected:
        print(f"FAIL: expected {expected} tiles, got {len(tiles)}")
        ok = False

    seen: set[tuple] = set()
    for t in tiles:
        k = (t["col"], t["row"], t["layer"])
        if k in seen:
            print(f"FAIL: duplicate coordinate {k}")
            ok = False
        seen.add(k)

    by_layer: dict[int, int] = {}
    for t in tiles:
        by_layer[t["layer"]] = by_layer.get(t["layer"], 0) + 1
    for layer, count in sorted(by_layer.items()):
        if count % 2 != 0:
            print(f"FAIL: layer {layer} has odd count {count}")
            ok = False
        else:
            print(f"  layer {layer}: {count} tiles ✓")

    if ok:
        print(f"OK — {path} ({len(tiles)} tiles, {len(by_layer)} layers)")
    return ok


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    expected = int(sys.argv[2]) if len(sys.argv) > 2 else 144
    sys.exit(0 if validate(path, expected) else 1)

"""Subset the two Material icon fonts to the glyphs the app uses (#3843).

The app draws its icons with `@expo/vector-icons`' `createIconSet`, but ships
only the glyphs listed in `frontend/src/components/icons/iconNames.ts`
(`MATERIAL_ICON_NAMES`, `MATERIAL_COMMUNITY_ICON_NAMES`). This script reads
those lists, takes each glyph's codepoint from the upstream glyph map in
`frontend/node_modules/@expo/vector-icons` (the version pinned in
`frontend/package-lock.json`) and writes, per family:

    frontend/assets/fonts/<Family>.subset.ttf              the subset font
    frontend/src/components/icons/<Family>.glyphmap.json   name -> codepoint

The subset keeps the upstream outlines, metrics and hinting, and the family
and licence name records (fontTools' defaults keep name IDs 0-6 on the Windows
platform only, so the Mac-platform records and the generator-credit IDs 10 and
11 are dropped). The layout features are dropped too: icon fonts are looked up
by codepoint. A glyph renders exactly as it did from the full font.

Adding an icon: add its name to the list in `iconNames.ts`, then run from the
repo root (after `cd frontend && npm ci`):

    python tools/assets/subset_icon_fonts.py

and commit the regenerated `.ttf` and `.glyphmap.json` files.
`frontend/src/__tests__/iconSubset.test.ts` fails when they are stale.
Needs fontTools (pinned in tools/assets/requirements.txt); the output is
byte-for-byte reproducible for a given fontTools and `@expo/vector-icons`
version.

Licences: Material Icons (Google) and Material Design Icons (Pictogrammers)
are Apache License 2.0; see `frontend/assets/fonts/CREDITS.md`.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
NAMES_TS = FRONTEND / "src/components/icons/iconNames.ts"
UPSTREAM = FRONTEND / "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons"
FONT_OUT = FRONTEND / "assets/fonts"
MAP_OUT = FRONTEND / "src/components/icons"

# family -> name of the `as const` list in iconNames.ts
FAMILIES = {
    "MaterialIcons": "MATERIAL_ICON_NAMES",
    "MaterialCommunityIcons": "MATERIAL_COMMUNITY_ICON_NAMES",
}


def read_names(ts_source: str, const: str) -> list[str]:
    """The string literals of `export const <const> = [ ... ] as const;`."""
    m = re.search(rf"export const {const} = \[(.*?)\] as const;", ts_source, re.DOTALL)
    if not m:
        raise SystemExit(f"{const} not found in {NAMES_TS}")
    names = re.findall(r'"([^"]+)"', m.group(1))
    if len(names) != len(set(names)):
        raise SystemExit(f"{const} lists a name twice")
    return names


def glyph_map(family: str, names: list[str]) -> dict[str, int]:
    upstream = json.loads((UPSTREAM / f"glyphmaps/{family}.json").read_text())
    missing = [n for n in names if n not in upstream]
    if missing:
        raise SystemExit(f"{family} has no glyph named {', '.join(missing)}")
    return {n: upstream[n] for n in sorted(names)}


def subset_font(family: str, codepoints: list[int], out: Path) -> None:
    from fontTools import subset

    options = subset.Options()
    options.layout_features = []  # icon glyphs are looked up by codepoint only
    options.glyph_names = True
    font = subset.load_font(str(UPSTREAM / f"Fonts/{family}.ttf"), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    subset.save_font(font, str(out), options)


def main() -> int:
    if not UPSTREAM.is_dir():
        print(f"{UPSTREAM} is missing: run `cd frontend && npm ci` first", file=sys.stderr)
        return 1
    ts_source = NAMES_TS.read_text()
    FONT_OUT.mkdir(parents=True, exist_ok=True)
    for family, const in FAMILIES.items():
        gmap = glyph_map(family, read_names(ts_source, const))
        font_path = FONT_OUT / f"{family}.subset.ttf"
        subset_font(family, sorted(set(gmap.values())), font_path)
        map_path = MAP_OUT / f"{family}.glyphmap.json"
        map_path.write_text(json.dumps(gmap, indent=2) + "\n")
        print(f"{family}: {len(gmap)} glyphs, {font_path.stat().st_size} B font")
    return 0


if __name__ == "__main__":
    sys.exit(main())

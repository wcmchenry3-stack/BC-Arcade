# Icon fonts (subset): source and licence

`MaterialIcons.subset.ttf` and `MaterialCommunityIcons.subset.ttf` are generated files (#3843): the
upstream icon fonts from `@expo/vector-icons` (the version in `frontend/package-lock.json`) cut down
to the glyphs the app uses. The outlines, metrics, hinting and name table are the upstream ones, so
every icon renders exactly as it did from the full font.

- Used names: `frontend/src/components/icons/iconNames.ts` (one `as const` list per family).
- Generator: `python tools/assets/subset_icon_fonts.py` from the repo root, after
  `cd frontend && npm ci`. It also writes the matching
  `frontend/src/components/icons/<Family>.glyphmap.json`.
- To add an icon: add its name to the family's list, run the generator, commit the `.ttf` and
  `.glyphmap.json`. `frontend/src/__tests__/iconSubset.test.ts` fails if they are stale, and `tsc`
  rejects any icon name that is not listed.

Do not edit these files by hand.

## Licences

| File                                | Upstream                                               | Licence            |
| ----------------------------------- | ------------------------------------------------------ | ------------------ |
| `MaterialIcons.subset.ttf`          | Material Icons, Copyright 2018 Google, Inc.            | Apache License 2.0 |
| `MaterialCommunityIcons.subset.ttf` | Material Design Icons (Pictogrammers and contributors) | Apache License 2.0 |

Both are distributed through `@expo/vector-icons` (loader MIT, Copyright (c) 2015 Joel Arvidsson,
Copyright (c) 2020 650 Industries). The subset fonts are modified versions of the upstream fonts:
only unused glyphs and layout tables were removed. Licence text:
https://www.apache.org/licenses/LICENSE-2.0. See also `docs/ASSETS.md` (licence notices) and
`docs/audits/ASSET-RIGHTS-AUDIT.md`.

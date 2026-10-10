# Asset System

## Directory map

```
frontend/assets/
├── icon.png            App icon (1024×1024, PNG)
├── adaptive-icon.png   Android adaptive layer (1024×1024, PNG)
├── splash-icon.png     Splash screen (PNG)
├── favicon.png         Web favicon (PNG)
├── logo.png            In-app logo (PNG)
│
├── mahjong/            42 tile SVGs (rendered via react-native-svg at runtime)
├── starswarm/          WebP sprites — player, enemies (incl. Carrier), bullets
│   ├── CREDITS.md      Source file + pack for every sprite (Kenney CC0)
│   ├── explosion/      20-frame fire strip (PNG)
│   └── powerups/       Power-up PNGs + CREDITS.md
├── cosmos-baked/       Pre-baked 512 px palette PNG sprites, Cascade celestial theme (Skia canvas)
├── fruits-baked/       Pre-baked 512 px palette PNG sprites, Cascade fruit theme (Skia canvas)
├── fruit-icons/        256 px WebP thumbnails, Cascade fruit theme (FruitGlyph UI)
├── celestial-icons/    256 px WebP thumbnails, Cascade celestial theme (FruitGlyph UI)
├── cosmos-vertices.json   Polygon hit-box data for celestial theme (pipeline only, not bundled)
├── fruit-vertices.json    Polygon hit-box data for fruit theme (pipeline only, not bundled)
├── svg-sprites/        generate_svg_sprites.py output (not imported, not bundled)
│
└── sounds/             All audio (MP3 for BGM, OGG for SFX)
    └── SOUND_CREDITS.md
```

Pipeline input directories live at the repo root. They are **tracked in version control** (force-added past the `.gitignore` entries for `fruit_images/` and `celestial_images/`), as plain files, **not Git LFS** (`.gitattributes` has no `filter=lfs` rule). They are source art for `tools/assets/bake_sprites.py` and are not in the app bundle:

- `fruit_images/` (~77 MB, 12 PNGs) — high-res PNG sources for the fruit theme
- `celestial_images/` (~86 MB, 12 PNGs) — high-res PNG sources for the celestial theme

A third input directory holds the **full-resolution processed icons** (background removed, WebP, up to 2048 px), moved out of `frontend/assets/` in #2833 so Metro no longer bundles them:

- `cascade_icon_masters/fruit-icons/`, `cascade_icon_masters/celestial-icons/` (~10.5 MB, 24 WebPs) — input for `bake_sprites.py`, `extract_vertices.py` and `make_icon_thumbnails.py`; output of `remove_backgrounds.py`

Most of the `fruit_images/` and `celestial_images/` PNGs are over 5 MiB, so `scripts/check_large_files.py` (the `Large tracked file guard` step of the CI job `repo-hygiene`, #2967) grandfathers them by exact path with a size cap. Moving them to Git LFS is tracked in #3033; that change removes the grandfathered entries. The older `frontend/assets/source-icons/` bundle stays gitignored; it and the original-resolution art are in **Google Drive** (`bc-arcade` folder):
https://drive.google.com/drive/folders/1LW97pBFsqfG67bQKvQwkhMlLBswzIVhm

## Format rules

| Format    | When to use                                                          |
| --------- | -------------------------------------------------------------------- |
| WebP      | Game sprites, theme thumbnails — best compression with alpha channel |
| Baked PNG | Cascade pre-baked sprites only — Skia pipeline requires PNG          |
| SVG       | Mahjong tiles — rendered via `react-native-svg` at runtime           |
| MP3       | BGM (background music)                                               |
| OGG       | SFX (short sound effects)                                            |

**Why two formats per Cascade theme?** `icons` (WebP) are transparent-background images for React Native `<Image>` components. `baked` (PNG) are pre-composited, clipped sprites for single-call Skia `drawImage` — produced by `bake_sprites.py`. They are different assets, not duplicates: a baked sprite is padded to its `bakedClipR` circle (the cherry fills about a third of its canvas), so it would draw too small in a `FruitGlyph`.

## Rendered sizes (#2833)

Rule: a runtime image must be at least its largest rendered size in points times the device pixel ratio (3x on phones, 2x on iPads, which have the larger point sizes; take the larger product), plus a margin. Anything much bigger only costs bundle size and decode memory. Measured on the files as of #2833:

| Family                                                              | Files (bundled) | Pixels                     | Drawn by                                                                  | Largest rendered size                                                             | Pixels needed                                                                                                          | Verdict                                                       |
| ------------------------------------------------------------------- | --------------- | -------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `fruit-icons/`, `celestial-icons/`                                  | 22 (11 + 11)    | 256 px (were 1024–2816 px) | `FruitGlyph` (`<Image resizeMode="contain">`)                             | 22 pt in `NextFruitPreview`; 32 pt in the `__DEV__` tier panel                    | 32 pt × 3 = 96 px                                                                                                      | 256 px, a 2.6x margin. Downscaled from up to 2048 px          |
| `fruits-baked/`, `cosmos-baked/`                                    | 22 (11 + 11)    | 512 px                     | `PieceRenderer` in `CascadeScreen.tsx`, Skia `<Image>` in a `scale` group | half-size = `radius × bakedClipR` world units; canvas `scale = min(w/400, h/600)` | tier 0: 116 units × ~1.06 × 3 ≈ 370 px (phone), × ~2.0 × 2 ≈ 465 px (iPad Pro 13"); tier 10: 345 units → over 1,000 px | Already at or below need. Not resized, palette-quantized only |
| `icon.png`                                                          | app.json only   | 1024 px, 8-bit palette     | store/app icon source                                                     | —                                                                                 | 1024 px (App Store)                                                                                                    | Kept; already palette, re-encoding would grow it              |
| `ios/.../App-Icon-1024x1024@1x.png`                                 | iOS binary      | 1024 px RGB, no alpha      | App Store icon                                                            | —                                                                                 | 1024 px, no alpha                                                                                                      | Lossless re-compress only (−2.4%)                             |
| `starswarm/`, `mahjong/` (SVG), `logo.png`, splash/adaptive/favicon | all             | small                      | —                                                                         | —                                                                                 | —                                                                                                                      | All under 60 KB; not changed                                  |

The world is 400 × 600 units. The canvas takes the whole game area, so `scale` peaks around 2.0–2.3 on a 13" iPad in portrait (1376 pt tall at most, so `scale` can never pass 1376 / 600 ≈ 2.3) and around 1.06 on a 440 pt-wide phone. Baked sprites should stay at 512 px or more; a bigger bake (`HALF` in `bake_sprites.py`) would sharpen the top tiers on tablets.

`pumpkin` and `milkyway` are future tiers that no `FruitSet` uses. They are not imported in `src/game/cascade/images.ts` (so they do not ship), but their files stay in the asset and master folders for the pipeline.

Vertex JSONs (`*-vertices.json`) and `bakedClipR` are in normalised units (1.0 = physics radius), not pixels, so resizing any image does not change hit-boxes.

## Size budgets

| Asset type        | Budget                      |
| ----------------- | --------------------------- |
| BGM               | ≤ 2 MB per track (see note) |
| SFX               | ≤ 50 KB                     |
| Game image (WebP) | ≤ 500 KB                    |
| App icon (PNG)    | ≤ 500 KB                    |
| Baked PNG         | ≤ 200 KB                    |

**BGM note**: all 7 BGM tracks are encoded at 128 kbps stereo (re-encoded in #1024). Long looping tracks (3–5 min) naturally exceed 2 MB at this bitrate. The budget is a target for _new_ tracks. Current files: `mahjong-bg-{1,2,3}.mp3` (2.3–4.8 MB), `starswarm-bg-{1,2,3,4}.mp3` (2.2–3.1 MB).

## Credits and attribution

Full rights inventory: [`docs/audits/ASSET-RIGHTS-AUDIT.md`](audits/ASSET-RIGHTS-AUDIT.md) (#2782). It lists
every shipped file, what is verified and what is not. Repeat it before each release that adds
assets: `node frontend/scripts/list-bundled-assets.mjs` lists what code actually bundles.

Source records live beside the assets: `sounds/SOUND_CREDITS.md` for audio and a `CREDITS.md` beside
each Star Swarm sprite folder.

### Required attribution (shipped in v1.0)

| Asset                                                  | Creator and source                                                                          | License                                                   | Credit to show                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `sounds/freecell-game-win.mp3` (FreeCell, Bottle Sort) | humanoide9000, "victory-fanfare", https://freesound.org/people/humanoide9000/sounds/466133/ | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | "Victory fanfare" by humanoide9000 on Freesound, CC BY 4.0. Re-encoded to MP3 (low-quality preview). |

The app has no credits or licenses screen yet, so this credit is not displayed in-app. That is an
open gap tracked in the audit (Section 6, follow-up 1); until it is closed or the sound is replaced
with a CC0 one, this table and `ATTRIBUTION.md` are the only place the credit appears.

### License notices to carry with bundled fonts and icon fonts

| Package                            | What ships                                             | License                                                         |
| ---------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| `@expo-google-fonts/space-grotesk` | Space Grotesk 400, 700                                 | SIL OFL 1.1, (c) The Space Grotesk Project Authors; wrapper MIT |
| `@expo-google-fonts/manrope`       | Manrope 400, 600, 700                                  | SIL OFL 1.1, (c) The Manrope Project Authors; wrapper MIT       |
| `@expo/vector-icons`               | `MaterialIcons.ttf`, `MaterialCommunityIcons.ttf` only | Loader MIT; upstream icon fonts Apache 2.0                      |

### Everything else

All other recorded audio and sprites are Kenney CC0, Freesound CC0 or the Pixabay Content License,
none of which requires attribution. Pixabay forbids redistributing the files on their own, so they
must stay inside the app.

**Not recorded (UNVERIFIED, owner must confirm or replace):** Mahjong tile SVGs (42), Cascade fruit
and celestial art (48), app icon, splash and logo art (5 plus 29 native derivatives), Blackjack
`bust`/`card-deal`/`push` sounds (3), Mahjong layouts (25, authorship only). Details in the audit.
Do not add new assets without a source, license and download date in the matching credits file.

If a CC-BY (or similar) asset is added, the license-snapshot policy in `SOUND_CREDITS.md` applies
and an in-app credit is required.

`src/__tests__/assetCredits.test.ts` fails if a Star Swarm sprite or sound ships without a
credits entry.

The #2488 salvage/hull pickups are drawn procedurally, so they have no files yet; sprites for them
need Kenney source files supplied from outside the build container (as errant-asteroid sprites
were for #2573).

## Per-game asset registries

Each game exposes its own lazy-loaded registry (`src/assets/<game>/`), introduced in #1627. Only import assets for the game that's actively loaded — do not add to `_shared/` unless the asset is truly cross-game.

> **Note:** `_shared/images.ts` and `_shared/sounds.ts` were the pre-#1627 monolithic registries and are now retired. New assets go in per-game registries only.

Adding a new shared image set: add imports + export object to `_shared/images.ts`.

## Offline strategy

`app.json` sets `assetBundlePatterns: ["assets/**"]`, which embeds the entire `assets/` directory into the native binary at build time. Combined with the per-game lazy preloader hook (added in #1627), assets are available offline in two layers:

1. **Native bundle**: everything in `assets/**` is embedded — zero network required after install.
2. **Preloader hook**: warms the React Native asset cache at game-start so first-frame load is instant.

## Prebuild optimization

`npm run prebuild` runs `scripts/optimize-assets.js` (`sharp`) before every native build:

```bash
cd frontend && npm run prebuild      # or: node scripts/optimize-assets.js
```

- Lossless crush of `icon.png`, `splash-icon.png`, `adaptive-icon.png`, `favicon.png`.
- `fruits-baked/` and `cosmos-baked/`: 256-colour palette PNG with alpha (libimagequant, dithered). A file is replaced only when the result is smaller and visually lossless (PSNR at least 45 dB on premultiplied RGBA; the #2833 set scored 46.6–58.4 dB). Palette files are skipped.

The script is idempotent.

## Regenerating baked Cascade sprites

Source images are in `fruit_images/` and `celestial_images/` at the repo root (tracked as plain files today; see "Directory map" above and #3033).

```bash
pip install Pillow
python tools/assets/bake_sprites.py
```

Reads the full-resolution icons in `cascade_icon_masters/`. Writes `fruits-baked/` and `cosmos-baked/` (truecolor PNG), updates `fruit-vertices.json` / `cosmos-vertices.json`. Then run `cd frontend && node scripts/optimize-assets.js` to quantize the new sprites (about 60% smaller), and copy the new `bakedClipR` values into `src/theme/fruitSets.ts`.

## Regenerating the runtime icon thumbnails

```bash
python tools/assets/make_icon_thumbnails.py            # 256 px, Lanczos, WebP q90, alpha kept
python tools/assets/make_icon_thumbnails.py --size 384 # if a UI ever draws icons larger than 85 pt
```

Reads `cascade_icon_masters/*-icons/`, writes `frontend/assets/fruit-icons/` and `frontend/assets/celestial-icons/`. Never put full-resolution art in `frontend/assets/`: every imported file there ships in the app.

## Converting icon PNGs to WebP

```bash
python tools/assets/convert_icons_to_webp.py cascade_icon_masters/fruit-icons
python tools/assets/convert_icons_to_webp.py cascade_icon_masters/celestial-icons
```

Then run `make_icon_thumbnails.py` (above).

Do **not** run on `*-baked/` directories — Skia textures must stay PNG.

## Adding assets for a new game

1. **Images** — export as WebP, target ≤ 500 KB each, place in `assets/<game>/`.
2. **BGM** — encode at 128 kbps stereo MP3, target ≤ 2 MB, place in `assets/sounds/<game>-bg-N.mp3`. Add credit to `SOUND_CREDITS.md`.
3. **SFX** — encode as OGG, target ≤ 50 KB each, place in `assets/sounds/<game>-<action>.ogg`. Add credit to `SOUND_CREDITS.md`.
4. **Registry** — create `frontend/src/assets/<game>/` with image + sound exports. See `starswarm/assets.ts` as the pattern.
5. **Bundle size check** — run `cd frontend && npm run bundlesize` and confirm no threshold is breached.

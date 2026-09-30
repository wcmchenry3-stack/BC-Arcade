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
├── cosmos-baked/       Pre-baked PNG sprites for Cascade celestial theme
├── fruits-baked/       Pre-baked PNG sprites for Cascade fruit theme
├── fruit-icons/        WebP thumbnails for Cascade fruit theme picker
├── celestial-icons/    WebP thumbnails for Cascade celestial theme picker
├── cosmos-vertices.json   Polygon hit-box data for celestial theme
├── fruit-vertices.json    Polygon hit-box data for fruit theme
│
└── sounds/             All audio (MP3 for BGM, OGG for SFX)
    └── SOUND_CREDITS.md
```

Pipeline input directories live at the repo root but are **gitignored** (large source art, not shipped):

- `fruit_images/` (~77 MB) — high-res PNG sources for the fruit theme
- `celestial_images/` (~86 MB) — high-res PNG sources for the celestial theme

Originals and the older `source-icons/` bundle are stored in **Google Drive** (`bc-arcade` folder):
https://drive.google.com/drive/folders/1LW97pBFsqfG67bQKvQwkhMlLBswzIVhm

## Format rules

| Format    | When to use                                                          |
| --------- | -------------------------------------------------------------------- |
| WebP      | Game sprites, theme thumbnails — best compression with alpha channel |
| Baked PNG | Cascade pre-baked sprites only — Skia pipeline requires PNG          |
| SVG       | Mahjong tiles — rendered via `react-native-svg` at runtime           |
| MP3       | BGM (background music)                                               |
| OGG       | SFX (short sound effects)                                            |

**Why two formats per Cascade theme?** `icons` (WebP) are transparent-background images for React Native `<Image>` components. `baked` (PNG) are pre-composited, clipped sprites for single-call Skia `drawImage` — produced by `bake_sprites.py`. They are different assets, not duplicates.

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
assets: `node frontend/scripts/list-bundled-assets.js` lists what code actually bundles.

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

`npm run prebuild` crushes the four PNG app icons using `sharp` before every native build:

```bash
cd frontend && npm run prebuild
```

Icons optimized: `icon.png`, `splash-icon.png`, `adaptive-icon.png`, `favicon.png`. The script is idempotent.

## Regenerating baked Cascade sprites

Source images are in `fruit_images/` and `celestial_images/` (gitignored — download from Google Drive).

```bash
pip install Pillow
python frontend/scripts/bake_sprites.py
```

Writes `fruits-baked/` and `cosmos-baked/`, updates `fruit-vertices.json` / `cosmos-vertices.json`.

## Converting icon PNGs to WebP

```bash
python frontend/scripts/convert_icons_to_webp.py frontend/assets/fruit-icons
python frontend/scripts/convert_icons_to_webp.py frontend/assets/celestial-icons
```

Do **not** run on `*-baked/` directories — Skia textures must stay PNG.

## Adding assets for a new game

1. **Images** — export as WebP, target ≤ 500 KB each, place in `assets/<game>/`.
2. **BGM** — encode at 128 kbps stereo MP3, target ≤ 2 MB, place in `assets/sounds/<game>-bg-N.mp3`. Add credit to `SOUND_CREDITS.md`.
3. **SFX** — encode as OGG, target ≤ 50 KB each, place in `assets/sounds/<game>-<action>.ogg`. Add credit to `SOUND_CREDITS.md`.
4. **Registry** — create `frontend/src/assets/<game>/` with image + sound exports. See `starswarm/assets.ts` as the pattern.
5. **Bundle size check** — run `cd frontend && npm run bundlesize` and confirm no threshold is breached.

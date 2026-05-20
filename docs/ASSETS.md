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
├── starswarm/          WebP sprites — player, enemies, bullets, powerups
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

| Format | When to use |
|---|---|
| WebP | Game sprites, theme thumbnails — best compression with alpha channel |
| Baked PNG | Cascade pre-baked sprites only — Skia pipeline requires PNG |
| SVG | Mahjong tiles — rendered via `react-native-svg` at runtime |
| MP3 | BGM (background music) |
| OGG | SFX (short sound effects) |

**Why two formats per Cascade theme?** `icons` (WebP) are transparent-background images for React Native `<Image>` components. `baked` (PNG) are pre-composited, clipped sprites for single-call Skia `drawImage` — produced by `bake_sprites.py`. They are different assets, not duplicates.

## Size budgets

| Asset type | Budget |
|---|---|
| BGM | ≤ 2 MB per track (see note) |
| SFX | ≤ 50 KB |
| Game image (WebP) | ≤ 500 KB |
| App icon (PNG) | ≤ 500 KB |
| Baked PNG | ≤ 200 KB |

**BGM note**: all 7 BGM tracks are encoded at 128 kbps stereo (re-encoded in #1024). Long looping tracks (3–5 min) naturally exceed 2 MB at this bitrate. The budget is a target for *new* tracks. Current files: `mahjong-bg-{1,2,3}.mp3` (2.3–4.8 MB), `starswarm-bg-{1,2,3,4}.mp3` (2.2–3.1 MB).

## Per-game asset registries

Each game exposes its own lazy-loaded registry (`src/assets/<game>/`), introduced in #1627. Only import assets for the game that's actively loaded — do not add to `_shared/` unless the asset is truly cross-game.

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

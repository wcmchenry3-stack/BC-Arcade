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
├── fonts/             Subset icon fonts (MaterialIcons, MaterialCommunityIcons; generated, #3843) + CREDITS.md
├── home/              Home tile images (the Star Swarm hex badge, generated, #3599) + CREDITS.md
├── mahjong/            42 tile SVGs (rendered via react-native-svg at runtime)
├── starswarm/          WebP sprites — player layers, Buddy, enemies (incl. Carrier), rocks, shots, pickups
│   ├── CREDITS.md      Source for every sprite (all original and generated since #3595)
│   ├── player/         P1-P3 ship layers (base, guns2, guns3, plating1, plating2), generated
│   ├── enemy/          The hive's sprites and damage layers, generated
│   ├── rock/           Asteroid shapes and ore veins, generated
│   ├── shot/           Projectiles, generated
│   └── pickup/         Power-up tokens, salvage crate, hull plate, generated
│
└── sounds/             All audio (MP3 for BGM, OGG for SFX)
    └── SOUND_CREDITS.md
```

**Cascade has no image files (#3698).** Its 24 pieces (12 fruits, 12 cosmos) are drawn in code at runtime from `frontend/src/game/cascade/art/` (Skia paths, gradients, circles and strokes; colours in `src/theme/theme.cascade.ts`), about 17 KB of minified JS for both sets. The art is original to the project and code-generated: see [Cascade's art](games/cascade.md#art-3698). `src/game/cascade/__tests__/assetBudget.test.ts` fails if a Cascade image comes back to `frontend/assets/` or a Cascade source imports one.

The original high-res source art (`fruit_images/`, `celestial_images/`, 163 MB) was deleted in #3692, and the sprites made from it (`fruit-icons/`, `celestial-icons/`, `fruits-baked/`, `cosmos-baked/`), their full-resolution masters (`cascade_icon_masters/`) and the scripts that processed them (`bake_sprites.py`, `remove_backgrounds.py`, `convert_icons_to_webp.py`, `make_icon_thumbnails.py`) in #3698. Git history was not rewritten, so clone size is unchanged. `fruit_images/` and `celestial_images/` stay in `.gitignore`.

The older `frontend/assets/source-icons/` bundle stays gitignored; it and the original-resolution art are in **Google Drive** (`bc-arcade` folder):
https://drive.google.com/drive/folders/1LW97pBFsqfG67bQKvQwkhMlLBswzIVhm

## Format rules

| Format | When to use                                                          |
| ------ | -------------------------------------------------------------------- |
| WebP   | Game sprites, theme thumbnails — best compression with alpha channel |
| SVG    | Mahjong tiles — rendered via `react-native-svg` at runtime           |
| MP3    | BGM (background music)                                               |
| OGG    | SFX (short sound effects)                                            |

## Rendered sizes (#2833)

Rule: a runtime image must be at least its largest rendered size in points times the device pixel ratio (3x on phones, 2x on iPads, which have the larger point sizes; take the larger product), plus a margin. Anything much bigger only costs bundle size and decode memory. Measured on the files as of #2833:

| Family                                                              | Files (bundled) | Pixels                 | Drawn by              | Largest rendered size | Pixels needed       | Verdict                                                                                                                              |
| ------------------------------------------------------------------- | --------------- | ---------------------- | --------------------- | --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `icon.png`                                                          | app.json only   | 1024 px, 8-bit palette | store/app icon source | —                     | 1024 px (App Store) | Kept; already palette, re-encoding would grow it                                                                                     |
| `ios/.../App-Icon-1024x1024@1x.png`                                 | iOS binary      | 1024 px RGB, no alpha  | App Store icon        | —                     | 1024 px, no alpha   | Lossless re-compress only (−2.4%)                                                                                                    |
| `starswarm/`, `mahjong/` (SVG), `logo.png`, splash/adaptive/favicon | all             | small                  | —                     | —                     | —                   | Star Swarm 65,376 B (63.8 KB) in 43 images after #3708, plus the 2,698 B home tile icon (#3599); see `games/starswarm-art-design.md` |

The world is 400 × 600 units. The canvas takes the whole game area, so `scale` peaks around 2.0–2.3 on a 13" iPad in portrait (1376 pt tall at most, so `scale` can never pass 1376 / 600 ≈ 2.3) and around 1.06 on a 440 pt-wide phone. Cascade's code-drawn pieces have no fixed resolution: the board rasterises them at the board's `scale` times the device pixel ratio (`game/cascade/art/sprites.ts`), so they are sharp at every size.

## Size budgets

| Asset type        | Budget                      |
| ----------------- | --------------------------- |
| BGM               | ≤ 2 MB per track (see note) |
| SFX               | ≤ 50 KB                     |
| Game image (WebP) | ≤ 500 KB                    |
| App icon (PNG)    | ≤ 500 KB                    |
| Baked PNG         | ≤ 200 KB                    |

**SFX size note**: every Star Swarm effect is under the 50 KB SFX budget (the largest,
`starswarm-lightning-loop.ogg`, is about 29 KB); no Star Swarm file needs an exception.

**BGM note**: the three Mahjong tracks, `mahjong-bg-{1,2,3}.mp3` (2.3–4.8 MB), are encoded at 128 kbps stereo (re-encoded in #1024). Long looping tracks (3–5 min) naturally exceed 2 MB at this bitrate. The budget is a target for _new_ tracks.

**Star Swarm BGM exception (#3638)**: Star Swarm has one original 6:52.7 track, `starswarm-bgm.mp3` (Round 46 with the loop edit): 6.60 MB (6,604,461 B), MP3 24 kHz stereo 128 kbps. It is over the 2 MB per-track budget but under the 11.28 MB of the four Pixabay tracks it replaced (`starswarm-bg-1..4.mp3`, deleted in #3638), which is the epic's ceiling (#3635); `scripts/check_large_files.py` allow-lists it at its exact size. The loop edit (`tools/assets/make_starswarm_bgm_loop.py`: fades trimmed, 3 s seam, +2.9 dB, one encode) leaves it at −21.5 LUFS, so it plays at its own volume, 0.57, where Mahjong's music plays at the shared 0.2 (`useBackgroundMusic`'s `volume` option).

## Credits and attribution

Full rights inventory: [`docs/audits/ASSET-RIGHTS-AUDIT.md`](audits/ASSET-RIGHTS-AUDIT.md) (#2782). It lists
every shipped file, what is verified and what is not. Repeat it before each release that adds
assets: `node frontend/scripts/list-bundled-assets.mjs` lists what code actually bundles.

Source records live beside the assets: `sounds/SOUND_CREDITS.md` for audio, a `CREDITS.md` beside
each Star Swarm sprite folder, `home/CREDITS.md` for the home tile images, and `fonts/CREDITS.md` for the subset icon fonts. Original Star Swarm
sprites (the three player ships' layers, Buddy, the enemies, the asteroids, the projectiles and the
pickups, #3592, #3600, #3593, #3596, #3594, #3595, #3708) and the Star Swarm home tile icon
(`home/starswarm-tile.webp`, #3599) are generated by `tools/assets/draw_starswarm_art.py`; their
rows name the recipe, and the
design log is [`games/starswarm-art-design.md`](games/starswarm-art-design.md). Its explosions,
Smart Bomb flash and nebula background have no image files: they are drawn in code (#3597).

### Required attribution

None for audio or sprites. The only CC BY 4.0 file, `sounds/freecell-game-win.mp3` ("Victory fanfare" by humanoide9000 on Freesound), stopped shipping in #3661 and was deleted in #3871, so the app needs no credit screen for it. Fonts and icon fonts still carry the license notices below.

### License notices to carry with bundled fonts and icon fonts

| Package                              | What ships                                                                          | License                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `@expo-google-fonts/space-grotesk`   | Space Grotesk 400, 700                                                              | SIL OFL 1.1, (c) The Space Grotesk Project Authors; wrapper MIT |
| `@expo-google-fonts/manrope`         | Manrope 400, 600, 700                                                               | SIL OFL 1.1, (c) The Manrope Project Authors; wrapper MIT       |
| `@expo/vector-icons`                 | The `createIconSet` loader only; no font from the package                           | Loader MIT                                                      |
| `frontend/assets/fonts/*.subset.ttf` | Subsets of Material Icons (Google) and Material Design Icons (Pictogrammers), #3843 | Apache 2.0; notice in `frontend/assets/fonts/CREDITS.md`        |

### Everything else

All other recorded audio and sprites are Kenney CC0, Freesound CC0 or the Pixabay Content License,
none of which requires attribution. Star Swarm's sound effects are original sounds synthesized in-house
(generator `tools/assets/synth_starswarm_sfx.py`, design log
[`games/starswarm-sound-design.md`](games/starswarm-sound-design.md)), and its background music is an
original, project-owned track (design log [`games/starswarm-music-design.md`](games/starswarm-music-design.md),
#3638); see the sound table in [`games/starswarm.md`](games/starswarm.md#sound). Pixabay forbids redistributing the files on their own, so they
must stay inside the app.

**Not recorded (UNVERIFIED, owner must confirm or replace):** Mahjong tile SVGs (42), app icon, splash and logo art (5 plus 29 native derivatives), Blackjack
`bust`/`card-deal`/`push` sounds (3), Mahjong layouts (25, authorship only). Details in the audit.
Do not add new assets without a source, license and download date in the matching credits file.

If a CC-BY (or similar) asset is added, the license-snapshot policy in `SOUND_CREDITS.md` applies
and an in-app credit is required.

`src/__tests__/assetCredits.test.ts` fails if a Star Swarm sprite or sound ships without a
credits entry.

The #2488 salvage crate and hull plate, drawn procedurally until then, are generated sprites
since #3595 (`starswarm/pickup/salvage.webp`, `hull.webp`), in one family with the four power-ups;
the procedural shapes remain only as the fallback while a sprite loads.

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

- Lossless crush of `icon.png`, `splash-icon.png`, `adaptive-icon.png`, `favicon.png`. (It also palette-quantized Cascade's baked sprites until they were replaced by code-drawn pieces in #3698.)

The script is idempotent.

## Tweaking a generated asset

The in-house sounds (`synth_starswarm_sfx.py`, `synth_arcade_sfx.py`, `synth_puzzle_sfx.py`) and the Star Swarm sprites (`draw_starswarm_art.py`) are the output of their scripts in `tools/assets/`. Tests fail when a shipped file stops matching its generator (#3672), so a change always goes through the script:

1. Edit the recipe in the generator script.
2. Rerun the generator for that name into a scratch folder, e.g. `python tools/assets/synth_puzzle_sfx.py /tmp/out daily-word-win` (sprites: `python tools/assets/draw_starswarm_art.py --out /tmp/out <name>`).
3. Listen to or look at the result, then copy it over the shipped file in `frontend/assets/`.
4. Run `cd tools && python -m pytest`. `synth_shipped_test.py` (sounds) and `draw_starswarm_art_test.py` (sprites, pixel for pixel) must pass. The sound test compares decoded samples, which in practice means bit-exact decoded PCM under a matched ffmpeg/libvorbis build: its 2% relative RMS tolerance only absorbs trivial float differences, it fails a 0.17 dB recipe change, and it does not survive an encoder change (a libvorbis quality change moves the decode by 2% to 18%). It needs ffmpeg with libvorbis; CI gets it from the pinned `ubuntu-24.04` runner image plus an apt install, and under CI a missing ffmpeg fails the test instead of skipping. If the test fails and you changed no recipe, the encoder build probably changed: refresh the shipped sounds with the procedure below.

### Pinned generator libraries

`tools/assets/requirements.txt` pins numpy, scipy, Pillow, colour-science and pytest to exact versions, and CI's `Test tools (pytest)` job installs that file, so local, cloud and CI runs produce the same output (#3816: a cloud container with Pillow 12.3 instead of 13 failed the sprite tests, because Pillow 12's LANCZOS downscale differs). Install the file; do not rely on whatever is preinstalled. To upgrade one of them, bump the pin, regenerate **every** generated asset into scratch folders, review the diff (decoded PCM hashes for sounds, pixel diffs for sprites), and ship any changed files in the same PR. The audio encoder is the system `ffmpeg`/libvorbis, not a Python package, so it cannot be pinned there. CI takes it from the `ubuntu-24.04` runner image (pinned in `ci.yml`); a new ffmpeg/libvorbis build means regenerating the sounds, like a library bump. Dependabot watches `tools/assets/requirements.txt` for security updates only (`open-pull-requests-limit: 0` in `.github/dependabot.yml`): a version bump changes generator output, so it is never an automatic PR and always goes through this procedure.

## Adding assets for a new game

1. **Images** — export as WebP, target ≤ 500 KB each, place in `assets/<game>/`.
2. **BGM** — encode at 128 kbps stereo MP3, target ≤ 2 MB, place in `assets/sounds/<game>-bg-N.mp3`. Add credit to `SOUND_CREDITS.md`.
3. **SFX** — encode as OGG, target ≤ 50 KB each, place in `assets/sounds/<game>-<action>.ogg`. Add credit to `SOUND_CREDITS.md`.
4. **Registry** — create `frontend/src/assets/<game>/` with image + sound exports. See `starswarm/assets.ts` as the pattern.
5. **Bundle size check** — run `cd frontend && npm run bundlesize` and confirm no threshold is breached.

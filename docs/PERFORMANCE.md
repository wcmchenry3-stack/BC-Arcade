# Performance Testing

Performance tests measure API response times and frontend Core Web Vitals. They are **non-blocking** — they never gate PRs or deploys, but run nightly and on-demand to catch regressions.

## Tools

| Layer    | Tool                                                           | Config                       |
| -------- | -------------------------------------------------------------- | ---------------------------- |
| Backend  | [Locust](https://locust.io) 2.32.4                             | `backend/perf/locustfile.py` |
| Frontend | [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) | `frontend/lighthouserc.json` |

---

## Running Locally

### Backend (Locust)

Requires the backend to be running first:

```bash
cd backend
python -m pip install -r requirements-dev.txt
python -m uvicorn main:app --reload   # keep this running
```

In a second terminal:

```bash
cd backend

# Game flow — single user, sequential (correct for global game state)
locust -f perf/locustfile.py \
  --headless --users 1 --spawn-rate 1 --run-time 60s \
  --host http://localhost:8000 --csv perf-gameflow \
  YachtGameUser

# Leaderboard — 10 concurrent users
locust -f perf/locustfile.py \
  --headless --users 10 --spawn-rate 2 --run-time 60s \
  --host http://localhost:8000 --csv perf-leaderboard \
  LeaderboardUser

# Read-only polling — 20 users
locust -f perf/locustfile.py \
  --headless --users 20 --spawn-rate 5 --run-time 60s \
  --host http://localhost:8000 --csv perf-readonly \
  ReadOnlyUser
```

Check results against thresholds:

```bash
cd backend
python perf/check_thresholds.py --csv perf-gameflow
python perf/check_thresholds.py --csv perf-leaderboard
python perf/check_thresholds.py --csv perf-readonly
```

Locust also has a browser UI. Omit `--headless` to open it at http://localhost:8089.

### Frontend (Lighthouse CI)

```bash
cd frontend
npm install
EXPO_PUBLIC_API_URL=https://dev-games-api.buffingchi.com npx expo export --platform web
npx @lhci/cli@0.14.0 autorun --config=lighthouserc.json
```

Results are saved to `frontend/.lighthouseci/`. Open any `.html` file in a browser to view the full Lighthouse report.

---

## SLOs (Service Level Objectives)

Defined in `backend/perf/thresholds.json`. These are calibrated for the Render free-tier deployment, measured after the warm-up step.

| Scenario               | Users | p95 target | Error rate |
| ---------------------- | ----- | ---------- | ---------- |
| Game flow (sequential) | 1     | < 500 ms   | 0%         |
| Leaderboard concurrent | 10    | < 300 ms   | < 1%       |
| Read-only polling      | 20    | < 200 ms   | 0%         |

**Frontend thresholds** (in `frontend/lighthouserc.json`):

| Metric              | Warn threshold | Fail threshold                       |
| ------------------- | -------------- | ------------------------------------ |
| Performance score   | < 0.75         | — (warn only)                        |
| Accessibility score | < 0.90         | **< 0.90 (hard fail — WCAG 2.2 AA)** |
| LCP                 | > 4000 ms      | — (warn only)                        |
| CLS                 | > 0.25         | — (warn only)                        |
| TBT                 | > 600 ms       | — (warn only)                        |

To update thresholds, edit `backend/perf/thresholds.json` or `frontend/lighthouserc.json`.

---

## CI Workflow

The `perf.yml` workflow runs:

- **Nightly at 06:00 UTC** against the production Render URLs
- **On demand** via GitHub Actions → "Run workflow" (configurable URL, users, duration)
- **Post-deploy** when called from `deploy.yml` (1-user smoke check)

To trigger manually:

1. Go to Actions → "Performance Tests" → "Run workflow"
2. Set the target URL (default: production), users, and duration

Artifacts (Locust CSVs and Lighthouse HTML reports) are retained for 30 days.

---

## Known Limitations

### Single global game instance

The Yacht backend has one global `game` variable. It is **not concurrent-safe**. Running the game flow with more than 1 user will cause state collisions (mixed round counts, wrong phase errors). This is expected and documented, not a bug in the tests.

The `YachtGameUser` class must always be run with `--users 1`. Concurrent stress testing only applies to the leaderboard endpoints.

### Render free-tier cold starts

The free tier shuts down after ~15 minutes of inactivity. Cold starts add 20–45 seconds to the first request. The CI workflow includes a warm-up step (up to 5 curl retries × 15s) before timing begins. First-request latency is not representative of steady-state performance.

### Matter.js runtime performance

Lighthouse measures initial load quality (LCP, CLS, TBT) on the static export. It does **not** measure frame rate or physics jank during gameplay. Runtime performance of the Matter.js physics engine requires a Playwright trace or browser DevTools recording — not covered by this setup.

---

## Reusable Pattern

This performance testing setup is designed to be extracted to `wcmchenry3-stack/.github` as shared callable workflows:

- `called-perf-backend.yml` — parametric Locust runner
- `called-perf-frontend.yml` — parametric Lighthouse CI runner

Other projects in the stack adopt the pattern by adding a `perf.yml` that calls these shared workflows with project-specific inputs (target URL, locustfile path, dist dir). See the shared repo for details.

---

## JS Bundle Baseline

> **Epic 2a — Story #527** | Measured: 2026-04-15 | Expo SDK 55 / Hermes / Android | No code changes in this section.

### Methodology

```bash
cd frontend
npx expo export --platform android --source-maps --output-dir dist-android-sourcemap
# source-map-explorer cannot parse .hbc directly; source map parsed manually for module breakdown
```

The Android export produces a single Hermes bytecode file. Module sizes below are estimated from `sourcesContent` in the accompanying `.hbc.map` source map (13 MB). Sizes reflect unminified source — Hermes compiles this down to **4.5 MB HBC** shipped on device.

### Bundle totals

| Component                                     | Size        |
| --------------------------------------------- | ----------- |
| JS bundle (Hermes bytecode, shipped)          | **4.5 MB**  |
| JS bundle (source content in map, unminified) | 8.3 MB      |
| Bundled assets (images, fonts, JSON)          | **74.8 MB** |
| **Total on-device (JS + assets)**             | **~79 MB**  |

### JS module breakdown (top packages by source size)

| Package                           | Source size | % of JS | Notes                                                          |
| --------------------------------- | ----------- | ------- | -------------------------------------------------------------- |
| `react-native`                    | 2,364 KB    | 27.8%   | Framework — unavoidable                                        |
| `react-native-reanimated`         | 837 KB      | 9.8%    | Animation worklets                                             |
| `@sentry/core`                    | 765 KB      | 9.0%    | ⚠️ See Sentry note below                                       |
| `@sentry/react-native`            | 413 KB      | 4.8%    | ⚠️                                                             |
| `react-reconciler`                | 377 KB      | 4.4%    | React runtime                                                  |
| `matter-js`                       | 366 KB      | 4.3%    | Cascade native physics (Android/iOS) — expected, not removable |
| `@shopify/react-native-skia`      | 307 KB      | 3.6%    | GPU canvas for Cascade                                         |
| `@sentry-internal/replay`         | 299 KB      | 3.5%    | ⚠️ Session replay SDK                                          |
| `react-native-gesture-handler`    | 263 KB      | 3.1%    | Input handling                                                 |
| `@sentry/browser`                 | 213 KB      | 2.5%    | ⚠️                                                             |
| `@react-navigation/core`          | 158 KB      | 1.9%    | Navigation                                                     |
| `@react-native/virtualized-lists` | 152 KB      | 1.8%    | RN list components                                             |
| `@sentry-internal/browser-utils`  | 135 KB      | 1.6%    | ⚠️                                                             |
| `expo`                            | 123 KB      | 1.4%    |                                                                |
| `@sentry/react`                   | 103 KB      | 1.2%    | ⚠️                                                             |
| `react-native-screens`            | 97 KB       | 1.1%    |                                                                |
| `react-native-worklets`           | 97 KB       | 1.1%    | Reanimated worklets                                            |
| `i18next`                         | 81 KB       | 0.9%    | Internationalization                                           |
| `@sentry-internal/feedback`       | 76 KB       | 0.9%    | ⚠️ Feedback widget SDK                                         |
| `@sentry-internal/replay-canvas`  | 32 KB       | 0.4%    | ⚠️                                                             |
| `[app code]`                      | ~260 KB     | ~3.1%   | All game screens, engines, shared infrastructure               |
| **Total mapped**                  | **8.3 MB**  | 100%    |                                                                |

### Findings

**⚠️ Sentry accounts for ~2.0 MB (24.5%) of JS source content** across seven packages: `@sentry/core`, `@sentry/react-native`, `@sentry-internal/replay`, `@sentry/browser`, `@sentry-internal/browser-utils`, `@sentry/react`, `@sentry-internal/feedback`, `@sentry-internal/replay-canvas`. The session replay and feedback SDKs add meaningful weight. Evaluate whether session replay is intentionally enabled — if not, it can be tree-shaken by removing the `Sentry.replayIntegration()` call.

**`matter-js` (366 KB) is active and expected.** Cascade's native engine (`engine.native.ts`) uses matter-js for polygon body physics on Android and iOS. `@dimforge/rapier2d-compat` (Rapier2D) is the web-only engine — it does **not** appear in the Android bundle. Metro's `.native.ts` platform resolution routes correctly.

**`@dimforge/rapier2d-compat` is absent from the Android bundle.** The `.native.ts` extension on `frontend/src/game/cascade/engine.native.ts` causes Metro to select the native engine (matter-js) on Android. Rapier2D is web-only and adds zero weight to the Android build.

**Pachisi has been removed from the codebase (#550).** All `src/game/pachisi/`, `src/components/pachisi/`, `src/screens/PachisiScreen.tsx`, and backend routes were deleted. The Android bundle is unaffected.

**App code is ~260 KB (~3.1%) of JS.** All five game engines, screens, shared infrastructure, and i18n strings together are a small fraction of the total. JS bundle size is not where the size problem lives — assets are.

**The 74.8 MB of bundled assets dominate.** See [Asset Inventory](#asset-inventory) for breakdown. Converting `fruit-icons/` + `celestial-icons/` (62.9 MB PNG) to WebP is the highest-ROI action available (Epic 2b).

---

## Build Configuration Baseline

> **Epic 2a — Story #528** | Confirmed: 2026-04-15 | Sources: `gradle.properties`, `android/app/build.gradle` | No code changes in this section.

### Confirmed configuration

| Setting                | Current state                       | Source                                                                                                |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Store format**       | **AAB**                             | Confirmed by user — manually uploaded to Google Play Console internal track                           |
| **ABI split**          | Active via AAB                      | Play delivers per-ABI slices automatically from AAB                                                   |
| **ABIs built**         | armeabi-v7a, arm64-v8a, x86, x86_64 | `gradle.properties:31` — all four ABIs compiled                                                       |
| **R8 / minify**        | **OFF**                             | `build.gradle:69` — `enableMinifyInReleaseBuilds` defaults to `false`; not set in `gradle.properties` |
| **Resource shrinking** | **OFF**                             | `build.gradle:124-125` — `enableShrinkResourcesInReleaseBuilds` defaults to `'false'`; not set        |
| **Legacy packaging**   | `false`                             | `gradle.properties:62` — native libs not compressed in APK/AAB (correct)                              |
| **Hermes**             | Enabled                             | `gradle.properties:42` — `hermesEnabled=true`                                                         |
| **New Architecture**   | Enabled                             | `gradle.properties:38` — `newArchEnabled=true`                                                        |
| **PNG crunching**      | Enabled in release                  | `gradle.properties:26` — `android.enablePngCrunchInReleaseBuilds=true`                                |
| **WebP support**       | Enabled (static)                    | `gradle.properties:53-54` — `expo.webp.enabled=true`; animated WebP disabled                          |
| **GIF support**        | Enabled                             | `gradle.properties:50` — `expo.gif.enabled=true`                                                      |

### Native library sizes (requires build)

The `.so` files for native modules are compiled from C++ source at build time (each package ships a `CMakeLists.txt`). They are **not pre-built in `node_modules/`** and cannot be measured without running the release build.

To measure, run:

```bash
cd frontend/android
./gradlew bundleDebug   # or bundleRelease with signing config

# Then use bundletool to extract per-ABI APKs and inspect .so sizes:
bundletool build-apks --bundle=app/build/outputs/bundle/debug/app-debug.aab \
  --output=/tmp/app.apks --mode=universal
unzip -o /tmp/app.apks -d /tmp/app-apks-extracted
# android-icon-background.png
# Inside /tmp/app-apks-extracted/universal.apk → lib/{abi}/*.so
```

Expected large contributors (approximate arm64-v8a sizes based on published release notes):

| Native library                        | Approx. arm64-v8a | Source               |
| ------------------------------------- | ----------------- | -------------------- |
| `react-native` core (Hermes VM + JSI) | ~6–8 MB           | Published benchmarks |
| `@shopify/react-native-skia`          | ~8–12 MB          | GPU rendering engine |
| `react-native-reanimated`             | ~3–5 MB           | Worklets runtime     |
| `@sentry/react-native`                | ~1–2 MB           | Crash reporting      |
| `react-native-gesture-handler`        | ~1 MB             | Input handling       |

> **Action for Epic 2b:** Once measured, populate a replacement table here with actual byte counts. The most impactful configuration change available right now (before measurement) is enabling R8 + resource shrinking — these are confirmed OFF and can be turned on in `gradle.properties`.

### Key flags for Epic 2b

- **R8 + resource shrinking are the highest-ROI build config change.** Enable by adding to `gradle.properties`:

  ```
  android.enableMinifyInReleaseBuilds=true
  android.enableShrinkResourcesInReleaseBuilds=true
  ```

  Requires proguard rules review — test against all game flows before shipping.

- **All 4 ABIs are built.** AAB delivery means Play strips unused ABIs per install, so the installed size is already ABI-correct. No action needed here.

- **PNG crunching is enabled** but all shipped images are already PNG. WebP conversion (Epic 2b) supersedes crunching for game assets.

---

## Asset Inventory

> **Epic 2a — Story #529** | Measured: 2026-04-15 | No code changes in this section.

### Directory map

| Directory                                       | Size         | Files    | Bundled?      | Owner / Purpose                                                                                     |
| ----------------------------------------------- | ------------ | -------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `assets/source-icons/cosmos/`                   | 85.6 MB      | 12 PNG   | No            | Pipeline input — master source files for `npm run process-assets`. Not imported by app code.        |
| `assets/source-icons/fruits/`                   | 76.8 MB      | 12 PNG   | No            | Pipeline input — same as above.                                                                     |
| `assets/celestial-icons/`                       | 36.8 MB      | 12 PNG   | **Yes**       | Cosmos theme UI icons. Imported in `src/theme/fruitSets.ts`.                                        |
| `assets/fruit-icons/`                           | 26.1 MB      | 12 PNG   | **Yes**       | Fruits theme UI icons. Imported in `src/theme/fruitSets.ts`.                                        |
| `assets/logo.png`                               | 7.1 MB       | 1 PNG    | **Yes**       | App logo. Imported in `src/components/shared/AppHeader.tsx`.                                        |
| `assets/adaptive-icon.png`                      | 7.1 MB       | 1 PNG    | Platform only | Android adaptive icon (`app.json`). Identical file to `logo.png`.                                   |
| `assets/icon.png`                               | 7.1 MB       | 1 PNG    | Platform only | App icon (`app.json`). Identical file to `logo.png`.                                                |
| `assets/cosmos-baked/`                          | 1.2 MB       | 12 PNG   | **Yes**       | Cosmos game pieces (Skia pre-composited). Imported in `src/theme/useFruitImages.ts`.                |
| `assets/fruits-baked/`                          | 1.0 MB       | 12 PNG   | **Yes**       | Fruits game pieces (Skia pre-composited). Imported in `src/theme/useFruitImages.ts`.                |
| `assets/cosmos-vertices.json`                   | 43 KB        | 1 JSON   | **Yes**       | Cascade physics polygon vertices for Cosmos theme.                                                  |
| `assets/fruit-vertices.json`                    | 58 KB        | 1 JSON   | **Yes**       | Cascade physics polygon vertices for Fruits theme.                                                  |
| `assets/*.png` (Android icons, splash, favicon) | ~0.2 MB      | 4 PNG    | Platform only | App store / launcher assets.                                                                        |
| Hearts                                          | —            | —        | No            | No dedicated asset directory — lobby card uses Unicode ♥ emoji; all card rendering is programmatic. |
| `src/game/sudoku/puzzles.json`                  | ~261 KB      | 1 JSON   | **Yes**       | Sudoku puzzle bank — 3 000 unique-solution puzzles (1 000 per difficulty). ~60 KB gzipped over the wire. Imported by `src/game/sudoku/engine.ts`. |
| Sudoku (lobby card)                             | —            | —        | No            | No dedicated asset directory — lobby card uses Unicode 🧩 emoji; the board and cells are programmatic. |
| **Repo total**                                  | **249.1 MB** | 83 files |               |                                                                                                     |
| **Bundled game assets**                         | **~72 MB**   |          |               | `celestial-icons` + `fruit-icons` + `logo` + `*-baked` + JSON                                       |
| **Not bundled (pipeline inputs)**               | **162.4 MB** |          |               | `source-icons/` — needed locally, not shipped                                                       |

### Asset pipeline

The `source-icons/` directories are the master source files for the Cascade game piece pipeline:

```
source-icons/{fruits,cosmos}/*.png   →   npm run process-assets   →   {fruits,cosmos}-baked/*.png
                                         (remove_backgrounds.py)
```

The baked outputs are the files actually used for in-game Skia rendering. The `*-icons/` files (medium-size PNGs) are used for UI display (selection screens, theme pickers) and are a separate set from the baked game-piece textures.

### Two-tier image architecture

Each theme set ships two separate image tiers:

| Tier                          | Directories                        | Size    | Use                                       |
| ----------------------------- | ---------------------------------- | ------- | ----------------------------------------- |
| **UI icons** (large)          | `fruit-icons/`, `celestial-icons/` | 62.9 MB | `fruitSets.ts` — theme selector, previews |
| **Baked game pieces** (small) | `fruits-baked/`, `cosmos-baked/`   | 2.2 MB  | `useFruitImages.ts` — in-game Skia canvas |

### Findings and flags for Epic 2b

1. **`celestial-icons/` + `fruit-icons/` = 62.9 MB of large PNGs bundled into the app.** These are the highest-priority WebP conversion candidates. At typical WebP compression ratios for photographic content (70–80% reduction), conversion could save ~44–50 MB from the shipped app.

2. **`source-icons/` (162.4 MB) live inside `frontend/assets/`** alongside bundled assets. Metro does not bundle unreferenced files, so these are not shipped — but their location is misleading and creates risk of accidental inclusion if a future developer imports one. Recommend moving them to a dedicated `assets-source/` directory outside `frontend/assets/`, or documenting their role clearly in `CONTRIBUTING.md`.

3. **`adaptive-icon.png`, `icon.png`, and `logo.png` are identical files** (confirmed by MD5 hash). `logo.png` is bundled (imported by `AppHeader.tsx`); the other two are platform-only. The 7.1 MB master is large for an in-app logo — this should be replaced with a purpose-sized PNG or WebP in Epic 2b.

4. **`pumpkin` (fruit) and `milkyway` (cosmos) are "reserved for future use"** but are statically imported in `fruitSets.ts` (lines 14, 26) and therefore bundled. Combined size: ~6.7 MB. These can be removed from the import list until the tier is actually needed.

5. **`cosmos-baked/` includes `milkyway.png`** but `useFruitImages.ts` does not import it (only 11 of 12 cosmos items are loaded). The file is in the directory but unreferenced by `useFruitImages.ts`; it may be referenced via `fruitSets.ts` — verify before flagging for removal.

### Not orphaned (corrects Epic 2a assumption)

The epic listed `/celestial_images/` as "suspected dead weight." Investigation found:

- The actual paths are `celestial-icons/` and `cosmos-baked/` (not `celestial_images/`).
- Both are actively imported and in use.
- A third set (`source-icons/cosmos/`) is the pipeline input — intentional and necessary locally.

---

## Per-Game Size Budget, Standalone Criteria, and Pachisi Decision

> **Epic 2a — Story #530** | Authored: 2026-04-15 | Depends on: #527, #528, #529 | No code changes in this section.

### Baseline recap (from #527, #528, #529)

| Metric                               | Measured value                                 |
| ------------------------------------ | ---------------------------------------------- |
| Total on-device (JS + assets)        | ~79 MB                                         |
| JS bundle (Hermes, shipped)          | 4.5 MB                                         |
| Bundled assets                       | 74.8 MB                                        |
| Cascade game assets (images + JSON)  | ~65 MB PNG (~15 MB target after WebP, Epic 2b) |
| Yacht / Blackjack / 2048 game assets | **0 MB** — fully code-rendered                 |
| Cascade JS contribution              | ~60 KB (source)                                |
| Other games JS contribution (each)   | ~20–40 KB (source)                             |

### Per-game size budget

Three of the four shipped games (Yacht, Blackjack, 2048) contribute **zero game-specific assets** — their game state is rendered in code. Cascade is the sole asset-heavy game, and its footprint is driven by a two-theme image set that will be addressed separately in Epic 2b.

Based on this baseline the standard budget for new games is:

| Component                | Budget          | Notes                                                                       |
| ------------------------ | --------------- | --------------------------------------------------------------------------- |
| **Game-specific JS**     | < 100 KB source | Current games: 20–65 KB each — budget is generous                           |
| **Game-specific assets** | **≤ 5 MB**      | Per game, after optimisation (WebP, appropriate resolution)                 |
| **Combined per-game**    | **≤ 5.1 MB**    | Shared assets (logo, fonts, navigation icons) are excluded from this budget |

**What "game-specific assets" means:** Images, sounds, fonts, and data files that are only required by a single game and would not exist if that game were removed. Shared infrastructure (app logo, navigation icons, i18n strings) is excluded.

**Why 5 MB:** A single-theme casual game with 12–15 game piece images at appropriate display resolution (WebP, ~200×200 px, ~20–40 KB each) lands at ~0.5–0.6 MB per theme. Even a two-theme game is well under 5 MB. This leaves room for additional assets (backgrounds, overlays, sound effects) while keeping growth bounded.

**What 5 MB enables comfortably:**

- Card games, dice games, puzzle games (code-rendered): trivially under budget
- A single-theme image game (12 pieces, WebP): ~0.5–1 MB
- A two-theme image game (24 pieces, WebP): ~1–2 MB
- A game with short ambient audio clip (~30s, compressed OGG/AAC): 1–3 MB

### Cascade grandfathering

Cascade is grandfathered above the 5 MB budget. It predates this policy and carries significant asset weight for legitimate design reasons (two full image themes). Its current footprint and Epic 2b reduction target:

| State                       | Asset size | Notes                                                                                                         |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| Current (PNG)               | ~65 MB     | fruit-icons/ + celestial-icons/ + baked sets                                                                  |
| Target after Epic 2b (WebP) | ~10–15 MB  | Estimated 70–80% PNG-to-WebP reduction                                                                        |
| Optimisation opportunities  |            | Remove pumpkin + milkyway reserved imports (~6.7 MB); convert logo.png to purpose-sized WebP (~0.5 MB target) |

Cascade's larger footprint is tracked separately in Epic 2b and does not set a precedent for future games.

### Audio strategy

Offline audio is not currently implemented in any game. If added in a future epic, audio budgets would apply to all games under the same per-game ceiling:

| Audio type                             | Typical size | Notes                                     |
| -------------------------------------- | ------------ | ----------------------------------------- |
| Short ambient loop (30s, OGG 128 kbps) | ~0.5 MB      | Fits easily within 5 MB budget            |
| Full game track (3 min, OGG 128 kbps)  | ~3 MB        | Uses majority of budget — weigh carefully |
| Sound effects set (10 clips)           | ~0.5–1 MB    | Usually fine                              |

**Policy:** If a game requires more than one background track or a large sound effect library (> 2 MB audio alone), evaluate against the standalone game criteria below.

### Standalone game criteria

A game must be built as a standalone app if it meets **any** of the following thresholds. A game that approaches but does not meet these thresholds should still be reviewed before development begins.

| Criterion                                                   | Threshold                                                    | Reason                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Game-specific assets after optimisation                     | **> 20 MB**                                                  | Directly drives download size and install growth beyond reasonable suite overhead                                                   |
| Game requires a unique native library                       | **Any**                                                      | Each native `.so` adds 5–15 MB per ABI to the binary; libraries not shared with other suite games are unjustifiable in a shared app |
| Game-specific audio                                         | **> 3 MB**                                                   | Indicates a soundtrack-level audio investment that belongs in a dedicated product                                                   |
| Requires a native rendering engine not already in the suite | **Any** (e.g., 3D via React Native Three Fiber, GPU shaders) | New GPU/rendering native libs dominate binary size                                                                                  |

**Evaluation process for a proposed new game before development begins:**

1. Estimate asset requirements (themes × pieces × resolution × format)
2. Estimate audio requirements (track count, length, format)
3. Identify any required native libraries not already in `frontend/package.json`
4. If any standalone threshold is met → build as a separate app
5. If assets are 10–20 MB (approaching threshold) → bring to team for review before starting
6. Document the evaluation result in the game's design document and `GAME-CONTRACT.md` checklist

### Arcade shooter evaluation (worked example)

A vertical arcade shooter is listed as a potential future paid game. Evaluated against the criteria above:

| Requirement                                           | Estimate                 | Budget impact                |
| ----------------------------------------------------- | ------------------------ | ---------------------------- |
| Sprite sheet (player, enemies, bullets, explosions)   | 5–15 MB                  | ~5–15 MB                     |
| Background parallax layers                            | 2–5 MB                   | ~2–5 MB                      |
| Audio (theme music + sound effects)                   | 3–8 MB                   | ~3–8 MB                      |
| Particle systems                                      | Code-rendered, no assets | ~0 MB                        |
| Potential native library (GPU particles, 3D elements) | 8–15 MB per ABI          | Standalone trigger           |
| **Estimated total**                                   | **10–38 MB**             | **Likely exceeds threshold** |

**Provisional verdict:** An arcade shooter almost certainly exceeds the 20 MB asset threshold and may require a unique native rendering library. **Build as a standalone app if pursued.** Confirm this evaluation against the actual design spec before development begins.

### Pachisi decision

**Status: Resolved — removed in #550.**

Pachisi was removed from the codebase (Path A). All frontend directories (`src/game/pachisi/`, `src/components/pachisi/`, `src/screens/PachisiScreen.tsx`), the backend router, and DB seed row were deleted. The Android bundle is unaffected.

---

## Lazy Loading Decision

> **Epic 2a — Story #557** | Implemented: 2026-04-18 | Branch: `feat/lazy-loading-557` | Expo SDK 55 / Hermes / Android + iOS

### Methodology

Cold-start time is measured from the JS-side start time (captured in `src/utils/appTiming.ts` at module-load — the earliest reachable JS timestamp) to when `HomeScreen`'s `useEffect` fires on first render. The delta is logged via:

```
[cold-start] HomeScreen ready: <N> ms
```

**Android — read from device:**

```bash
# With static imports (baseline — checkout commit before this PR):
adb logcat -s ReactNativeJS | grep cold-start

# With lazy imports (this branch):
adb logcat -s ReactNativeJS | grep cold-start
```

Build for release before measuring: `cd frontend/android && ./gradlew assembleRelease`

**iOS — read from device:**

```bash
# Physical device (Xcode must be open and device connected):
# Xcode → Window → Devices and Simulators → select device → open Console
# Filter by "cold-start"

# Simulator (faster iteration, less representative):
xcrun simctl spawn booted log stream --level debug 2>/dev/null | grep cold-start
```

Build via Xcode for a Release scheme before measuring — debug builds include the Metro bundler and are not representative of cold-start.

Navigation-to-game-screen time (jank check) is measured manually: note the timestamp when the navigation gesture is initiated and when the screen's first frame renders (visible as a spinner duration).

### Measurements

Cold-start timing via `performance.now()` instrumentation (`src/utils/appTiming.ts` + `HomeScreen` `useEffect`) was not capturable in the Expo Go dev-server environment: Metro's own `lazy=true` bundle splitting loads `appTiming.ts` as a deferred chunk, so the timestamp is not set before `HomeScreen` mounts. This instrumentation is correct for a production build (where Metro lazy bundling is not active) — see methodology above for how to measure against a release build.

| Metric                                             | Platform      | Static imports (baseline) | Lazy imports        | Notes                                          |
| -------------------------------------------------- | ------------- | ------------------------- | ------------------- | ---------------------------------------------- |
| Cold-start: JS start → HomeScreen ready            | Android       | not captured              | not captured        | Expo Go dev server — see above                 |
| Cold-start: JS start → HomeScreen ready            | iOS           | not captured              | not captured        | Expo Go dev server — see above                 |
| Navigation → lazy screen (tab): first visit        | iOS simulator | no spinner                | brief spinner       | Correct — module loads once, cached thereafter |
| Navigation → lazy screen (tab): repeat visit       | iOS simulator | no spinner                | no spinner          | Correct — cached module renders synchronously  |
| Navigation → `Twenty48Screen` (stack): every visit | iOS simulator | no spinner                | **visible spinner** | ⚠️ See stack-screen finding below              |

### Stack-screen spinner finding

**Observed:** `Twenty48Screen` shows a visible loading spinner on every navigation, not just the first. This is because React Navigation unmounts stack screens when the user presses back — so on each return visit, React mounts a fresh component tree with a new `Suspense` boundary. Even though `React.lazy()` caches the resolved module, the new Suspense boundary evaluates it synchronously and should not flash in theory; in practice a brief spinner is visible in the dev build, likely exaggerated by Metro's dev-mode overhead.

**Risk in production:** In a production Hermes build (no Metro dev server), the cached lazy module resolves synchronously and the Suspense fallback should not render at all on repeat visits. This needs verification against a release build before ship.

**If the spinner persists in release:** convert `CascadeScreen`, `BlackjackBettingScreen`, `BlackjackTableScreen`, and `Twenty48Screen` back to static imports. Tab screens (`LeaderboardScreen`, `SettingsScreen`, `GameDetailScreen`) do not have this problem and can remain lazy regardless.

### Decision

**Lazy loading adopted** — `React.lazy()` applied to 7 non-initial screens: `CascadeScreen`, `BlackjackBettingScreen`, `BlackjackTableScreen`, `Twenty48Screen`, `LeaderboardScreen`, `GameDetailScreen`, `SettingsScreen`. `HomeScreen`, `GameScreen`, and `ProfileScreen` remain eager.

**Rationale:** Even if the Hermes cold-start delta is small (expected, per issue #557 notes: "Hermes bytecode already strips most parse-time cost"), lazy loading provides a structural benefit: module-level side-effects in game screens (Matter.js world setup, Skia canvas initialization, context providers) are deferred until the user navigates to those screens. This reduces work before `HomeScreen` is interactive regardless of parse-time savings.

**Implementation notes:**

- A `withSuspense` HOC wraps each lazy component at the `Screen` registration site, so the spinner is scoped to the navigating screen rather than replacing the entire app.
- `HomeScreen` and `GameScreen` (Yacht) are kept eager — they are the two most common landing destinations and must never show a spinner.
- `ProfileScreen` is kept eager as it is the initial screen of `ProfileStack` and is always pre-mounted when the tab bar renders.
- The `appTiming.ts` module (`src/utils/appTiming.ts`) remains in the codebase as timing infrastructure for future cold-start regression checks against release builds.
- **Follow-up required:** verify the stack-screen spinner finding against a release build before merging to `main`.

---

## JS Bundle Size Guardrail

> **Epic 2b — Issues #556 / #581** | Implemented: 2026-04-18 | Branch: `feat/webp-enforcement-bundle-limit-556-581`

### Hard limit

The `android-bundle-check` CI job enforces a **5.5 MB hard limit** on the uncompressed Hermes bytecode bundle (`dist/index.android.bundle`). The job fails if the limit is exceeded. Additionally, `bundlesize2` runs against the `"bundlesize"` config in `frontend/package.json` to provide a structured pass/fail report.

**Baseline at time of implementation:** 4.5 MB (pre-#554/#555 measurement from PERFORMANCE.md asset inventory). The limit was set at 4.5 MB × 1.11 ≈ 5.0 MB to allow ~10% headroom for normal feature growth.

**Updated (#688 — card deck system):** Adding `react-native-svg` for the Classic card deck pushed the bundle to 5.01 MB. Limit raised to 5.5 MB (5.01 MB × 1.10 ≈ 5.5 MB) to restore headroom.

### Updating the limit

When a deliberate size increase is approved (e.g. a new game or major feature), update both:

1. `frontend/package.json` — the `"bundlesize"` array `maxSize` field
2. The `MAX_BYTES` and baseline comment in the `android-bundle-check` CI step

Commit the update in the same PR as the size-increasing change so reviewers can see both together.

### PR comment

Every pull request receives an automated comment from `android-bundle-check` showing the current bundle size and delta vs the 4.5 MB baseline. No action is needed unless the delta is large or the hard limit is breached.

For new game additions specifically, the reviewer checklist in [`docs/GAME-CONTRACT.md` — Size Budget](GAME-CONTRACT.md#size-budget) requires the delta to stay ≤ 200 KB.

### WebP icon enforcement

A separate CI gate in `test-frontend` (`assetTransparency.test.ts`) asserts that no raw PNGs exist in non-exempt icon subdirectories under `frontend/assets/`. To convert new PNGs before staging:

```bash
python frontend/scripts/convert_icons_to_webp.py frontend/assets/fruit-icons
python frontend/scripts/convert_icons_to_webp.py frontend/assets/celestial-icons
```

**Exempt directories** (must stay PNG, never pass to the script):

- `*-baked/` (`fruits-baked/`, `cosmos-baked/`) — Skia pipeline textures
- `source-icons/` — local pipeline inputs, not bundled

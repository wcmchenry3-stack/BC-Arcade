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

# Game flow — one Yacht game through /games, sequential
locust -f perf/locustfile.py \
  --headless --users 1 --spawn-rate 1 --run-time 60s \
  --host http://localhost:8000 --csv perf-gameflow \
  YachtGameUser

# Leaderboard — 10 concurrent users
locust -f perf/locustfile.py \
  --headless --users 10 --spawn-rate 2 --run-time 60s \
  --host http://localhost:8000 --csv perf-leaderboard \
  LeaderboardUser

# Read-only (catalog, stats, history) — 20 users
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
- **From another workflow** via `workflow_call` (no caller today)

To trigger manually:

1. Go to Actions → "Performance Tests" → "Run workflow"
2. Set the target URL (default: production), users, and duration

Artifacts (Locust CSVs and Lighthouse HTML reports) are retained for 30 days.

---

## Known Limitations

### Game flow is the sync path, not gameplay

Yacht runs on the device; the server only records games. `YachtGameUser` replays what the app's `SyncWorker` sends for one solo game (`POST /games`, 13 `POST /games/{id}/events` batches, `PATCH /games/{id}/complete`, `GET /games/{id}/rank`), with a fresh `X-Session-ID` per game so it stays under the per-session write limits (10/minute for create and complete). The old server-side `/yacht/*` routes it used to drive were removed in #2630. Every request is session-scoped, so it can run with more than one user.

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

**⚠️ Sentry accounts for ~2.0 MB (24.5%) of JS source content** across seven packages: `@sentry/core`, `@sentry/react-native`, `@sentry-internal/replay`, `@sentry/browser`, `@sentry-internal/browser-utils`, `@sentry/react`, `@sentry-internal/feedback`, `@sentry-internal/replay-canvas`. Replay-related packages are present in the dependency bundle, but BC Arcade does **not** initialize `Sentry.replayIntegration()`; Session Replay is not an active runtime data flow. The feedback package is used by the in-app Sentry User Feedback flow. See [FEEDBACK-OBSERVABILITY.md](FEEDBACK-OBSERVABILITY.md).

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
./gradlew bundleDebug   # or: ./gradlew bundleRelease -PALLOW_DEBUG_SIGNED_RELEASE=true
# (local, never-uploaded builds only: the result is debug-signed; docs/ANDROID-CI.md)

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

Build for release before measuring: `cd frontend/android && ./gradlew assembleRelease -PALLOW_DEBUG_SIGNED_RELEASE=true`

> Local release builds fail without the Play upload keystore unless you pass `-PALLOW_DEBUG_SIGNED_RELEASE=true`. That opt-out is fine for local profiling/smoke builds, but the result is debug-signed: never upload or distribute it (docs/ANDROID-CI.md).

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

The `android-bundle-check` CI job enforces an **8.0 MB hard limit** (`MAX_BYTES=8388608`) on `dist/index.android.bundle`. The job fails if the limit is exceeded. Additionally, `bundlesize2` runs against the `"bundlesize"` config in `frontend/package.json` to provide a structured pass/fail report. "MB" here means 1,048,576 bytes, as in CI.

**What is measured.** CI builds the file with `npx expo export:embed --platform android --dev false` and no `--bytecode` flag, so it is **minified JavaScript, before Hermes compiles it**. Gradle compiles that JS to Hermes bytecode later in the release build. The number tracks what we ship closely but not exactly. For example, the minifier escapes every non-ASCII character in the translations as `\uXXXX`, which adds about 240 KB to the measured file but nothing to the bytecode.

**Real bytecode, for context.** The Hermes bytecode for the 7.27 MB bundle below is 9,351,141 bytes (about 9.35 million bytes, or 8.92 MB in CI's units), measured with `hermesc -O -emit-binary` from `node_modules/hermes-compiler`. It is larger than the JS. If the limit is ever re-based on bytecode, start from that figure.

**History.**

- 4.5 MB: baseline when the guardrail was added (#556 / #581). The first limit was 5.0 MB.
- 5.5 MB: limit raised for `react-native-svg` and the Classic card deck (#688).
- 6.0 MB: limit raised for Expo SDK 56 and new games (#1977).
- 8.0 MB: limit raised for `@sentry/react-native` 7 → 8 (#1965).
- **7.74 MB → 7.27 MB (2026-09-30, #2869).** The bundle had reached 7.74 MB (8,114,007 bytes), 280 KB under the limit, before the premium client work (`expo-iap`, the five premium games made visible). Two behaviour-preserving changes cut 483 KB and left **752 KB of headroom** (769,634 bytes):

| Change                                                                                                                                                                       | Bundle after              | Saved  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------ |
| Baseline (`dev` at e5bb82b2)                                                                                                                                                 | 8,114,007 B (7.74 MB)     | –      |
| Yacht oracle table: delta + zigzag + byte planes before zlib (`frontend/src/game/yacht/oracle/tableCodec.ts`). Values bit-identical, pinned by `pinnedEV.test.ts`.           | 7,828,231 B (7.47 MB)     | 279 KB |
| Sudoku puzzle banks shipped packed (`puzzleBanks.generated.ts`, from `tools/generators/pack-sudoku-puzzles.ts`). JSON stays the source of truth; `puzzleBanks.test.ts` pins equality. | **7,618,974 B (7.27 MB)** | 204 KB |

The final row is CI's exact command with `--reset-cache`. The earlier rows were built with `--sourcemap-output` as well, which adds about 100 bytes (see below).

### Measuring and analysing the bundle

Build the bundle as CI does, with a source map added, then run the analysis script (from `frontend/`):

```bash
mkdir -p dist
npx expo export:embed --platform android --dev false \
  --entry-file "$(node -e "require('expo/scripts/resolveAppEntry')" . android absolute | tail -n 1)" \
  --bundle-output dist/index.android.bundle \
  --assets-dest /tmp/assets \
  --sourcemap-output dist/index.android.bundle.map
stat --printf="%s\n" dist/index.android.bundle   # CI's number, plus ~100 B (below)
node scripts/analyze-bundle.mjs 25               # top 25 contributors
```

`--sourcemap-output` appends a `//# sourceMappingURL=index.android.bundle.map` line, which adds about 100 bytes (95 on the 7.27 MB bundle). Leave it off, and add `--reset-cache`, to reproduce CI's figure to the byte. `scripts/analyze-bundle.mjs` runs `source-map-explorer` and groups mapped code by npm package, or by directory for app code. Metro emits JSON modules (translations, puzzle data, icon glyph maps) without source mappings, so `source-map-explorer` lumps them into "[unmapped]". The script finds those modules in the bundle text and labels them instead. `dist/` is gitignored; delete it when you're done, since the map is about 20 MB.

**Top contributors after #2869 (7.27 MB):**

| #   | Contributor                                                                      | KB    | Share |
| --- | -------------------------------------------------------------------------------- | ----- | ----- |
| 1   | JSON: translations (13 locales × 19 namespaces)                                  | 840.5 | 11.3% |
| 2   | npm: react-native-reanimated                                                     | 739.0 | 9.9%  |
| 3   | src/game/yacht/ (oracle table 599 KB)                                            | 618.5 | 8.3%  |
| 4   | npm: react-native                                                                | 566.0 | 7.6%  |
| 5   | npm: @sentry/conventions                                                         | 340.4 | 4.6%  |
| 6   | npm: @sentry/core                                                                | 339.6 | 4.6%  |
| 7   | npm: @sentry/react-native                                                        | 295.7 | 4.0%  |
| 8   | npm: @shopify/react-native-skia                                                  | 264.6 | 3.6%  |
| 9   | JSON: icon glyph maps (@expo/vector-icons MaterialCommunityIcons, MaterialIcons) | 225.4 | 3.0%  |
| 10  | Bundle glue, license comments, whitespace                                        | 203.4 | 2.7%  |
| 11  | npm: react-native-gesture-handler                                                | 187.8 | 2.5%  |
| 12  | src/game/sudoku/ (packed banks 155 KB)                                           | 165.4 | 2.2%  |
| 13  | npm: @sentry/replay                                                              | 123.6 | 1.7%  |
| 14  | npm: react-reconciler                                                            | 111.3 | 1.5%  |
| 15  | [no source] (Metro prelude and polyfills)                                        | 110.1 | 1.5%  |
| 16  | npm: @sentry/browser                                                             | 101.8 | 1.4%  |
| 17  | npm: react-native-svg                                                            | 101.8 | 1.4%  |
| 18  | npm: expo                                                                        | 92.8  | 1.2%  |
| 19  | JSON: other data (Mahjong layouts and other game data)                           | 91.1  | 1.2%  |
| 20  | npm: react-native-worklets                                                       | 90.5  | 1.2%  |

Sentry packages together (`conventions`, `core`, `react-native`, `replay`, `browser`, `browser-utils`, `feedback`, `react`) come to about 1.3 MB.

### Options not taken (yet)

These were looked at for #2869 and left alone, either because they wouldn't reduce the shipped size or because they need an owner decision:

- **Inlining Sentry's attribute-name constants at build time** (341 KB). Sentry imports about 25 string constants from `@sentry/conventions/attributes`, a 340 KB module that Metro can't tree-shake. A Babel plugin that replaced them with their values was built and measured for #2869, then dropped: it couples the build to a transitive Sentry package, and the owner declined it.
- **Lazy-loading game screens and engines.** Native Metro doesn't split bundles: a lazy `require` or `React.lazy` still puts the module in `index.android.bundle`. It only defers evaluation. The screens are already lazy for startup (see _Lazy Loading Decision_ above).
- **Keeping non-active translations out of the bundle.** Every locale is reachable through `import()` in `src/i18n/localeLoaders.ts`, and native Metro bundles every `import()` target. Moving translations out would mean downloading them (breaks offline play) or shipping them as native assets read at runtime (new native-asset code path). Not worth it while there's headroom.
- **Minifier `ascii_only: false`.** Would cut ~240 KB from the measured file by writing translations as UTF-8 instead of `\uXXXX` escapes. It doesn't change the Hermes bytecode, so it would only move the metric. If we do it, it should come with measuring real bytecode instead (below).
- **Measure Hermes bytecode in CI** (`expo export:embed --bytecode`, or the `.hbc` from the Gradle build) so the guardrail tracks what ships. The limit would need re-basing (see _Real bytecode_ above), which is an owner decision.
- **Icon glyph-map subset** (225 KB). `createIconSet` with only the glyphs we use. Needs every icon name to be static, which is not yet true everywhere.
- **Expo experimental tree shaking** (`EXPO_UNSTABLE_TREE_SHAKING`). Could trim Sentry's tracing, replay and feedback code, which we don't use, but it changes how every module is bundled and has to be set in the Gradle and Xcode Cloud builds too. Not measured.
- **Raising the limit.** Not needed now. If it is later, record the owner's approval and the reason here, following _Updating the limit_ below.

### Updating the limit

When a deliberate size increase is approved (e.g. a new game or major feature), update both:

1. `frontend/package.json` — the `"bundlesize"` array `maxSize` field
2. The `MAX_BYTES` and baseline comment in the `android-bundle-check` CI step

Commit the update in the same PR as the size-increasing change so reviewers can see both together.

### PR comment

Every pull request receives an automated comment from `android-bundle-check` showing the current bundle size and delta vs the original 4.5 MB baseline. No action is needed unless the delta is large or the hard limit is breached.

For new game additions specifically, the reviewer checklist in [`docs/GAME-CONTRACT.md` — Size Budget](GAME-CONTRACT.md#size-budget) requires the delta to stay ≤ 200 KB.

### WebP icon enforcement

A separate CI gate in `test-frontend` (`assetTransparency.test.ts`) asserts that no raw PNGs exist in non-exempt icon subdirectories under `frontend/assets/`. To convert new PNGs before staging:

```bash
python tools/assets/convert_icons_to_webp.py frontend/assets/fruit-icons
python tools/assets/convert_icons_to_webp.py frontend/assets/celestial-icons
```

**Exempt directories** (must stay PNG, never pass to the script):

- `*-baked/` (`fruits-baked/`, `cosmos-baked/`) — Skia pipeline textures
- `source-icons/` — local pipeline inputs, not bundled

---

## Star Swarm native renderer (#2567)

Epic #2562 moved Star Swarm's native canvas off per-frame React state (#2198). The scene is one
Skia Picture recorded on the UI thread, and the HUD re-renders only when a value in it changes.
This section records what that bought on real hardware.

### How to measure

1. Use a release build against the pre-launch API: a Play test build via Gradle on a budget
   Android phone, and a TestFlight build via Xcode Cloud on an older iPhone. Dev builds run React
   in development mode and are not representative.
2. Open the Star Swarm dev panel (`DEV` button) and turn on _Frame readout_. How to read it is in
   [`TESTING.md`](TESTING.md#star-swarm-reading-the-frame-readout-2567).
3. Record the readout after about ten seconds in each scenario. Close the panel before reading.
   The legacy column comes from the dev panel's _Legacy renderer_ switch, which exists only in
   builds from before #2567 removed it (#2594 is the last). To re-measure it, build one of those.
   - **Wave 1 idle:** set wave 1, New Game, don't fire.
   - **Wave 5 boss:** set wave 5, New Game, hold fire.
   - **Wave 9 lightning:** set wave 9, New Game, trigger _lightning_, hold fire.
   - **Paused:** any wave, press pause.
4. Memory: with the Picture renderer, play for ten minutes and compare the app's memory at the
   start and end (Xcode's memory gauge, or Android Studio's profiler on a profileable build). It
   should stay flat. A steady climb means Pictures are not being released.

### Results

Numbers are `avg / p95 ms · commits/s`. Filled in from the owner's device runs. The last column
is the Picture renderer after the #2963 allocation cuts (below); measure it with a build from the
#2963 merge or later, the same way.

| Device               | Scenario         | Legacy renderer | Picture renderer | After #2963 |
| -------------------- | ---------------- | --------------- | ---------------- | ----------- |
| Budget Android (TBD) | Wave 1 idle      | —               | —                | TODO        |
| Budget Android (TBD) | Wave 5 boss      | —               | —                | TODO        |
| Budget Android (TBD) | Wave 9 lightning | —               | —                | TODO        |
| Budget Android (TBD) | Paused           | —               | —                | TODO        |
| Older iPhone (TBD)   | Wave 1 idle      | —               | —                | TODO        |
| Older iPhone (TBD)   | Wave 5 boss      | —               | —                | TODO        |
| Older iPhone (TBD)   | Wave 9 lightning | —               | —                | TODO        |
| Older iPhone (TBD)   | Paused           | —               | —                | TODO        |

Memory over ten minutes with the Picture renderer: — (Android), — (iPhone). After #2963: TODO
(Android), TODO (iPhone).

### Per-frame allocation (#2963)

After the Picture renderer landed, each frame still made a lot of short-lived garbage on the JS
thread (and the copy of the display list sent to the UI thread). #2963 removed most of it without
changing what is drawn or how the game plays:

- **Starfield.** The 95 stars never change after they are placed: three depth layers, each
  scrolling at its own speed, with a fixed opacity and no twinkle. `tickStarfield` used to copy
  all 95 star objects every frame, and `buildFrame` turned them into 95 circle ops (plus a
  background fill op), each with a template-literal key and an `rgba()` string. Now the stars and
  background are recorded once per canvas size into their own Pictures (one per depth layer, so
  the parallax is kept). The game loop advances one shared scroll clock, and each layer slides by
  its own offset on the UI thread, drawn twice (a canvas-height apart) so stars wrap at the bottom
  as before. `tickStarfield` now only advances the clock. A frame where only the stars move (the
  pre-wave countdown) publishes nothing. A wave-1 display list is 96 ops shorter (135 → 39).
- **Display list.** Colours are packed `0xAARRGGBB` numbers (`render/color.ts`). Alpha is stored
  as a byte (1/255 steps, where the old strings used 0.001 steps), which looks the same. Op `key`s
  are built only when `setDebugOpKeys(true)` is on (tests). Ops no longer copy a `rect` object
  into themselves with a spread, and the shared helpers (`carrierOps`, `buddyOps`,
  `upgradePickupOps`) append to the frame's list instead of returning their own.
- **UI-thread replay.** `drawFrame` no longer parses a colour string for every op of every frame.
  Its two paints and a colour cache are made once per runtime and kept on that runtime's
  `globalThis` (module state is not shared with the UI runtime, and what a worklet captures is a
  copy). Each polygon's `SkPath` is disposed after it is drawn. `sameHud` compares fields directly
  instead of calling `Object.keys`.
- **Engine tick.** A sub-tick with nothing to do hands back the same state and lists it was
  given. Map-then-filter passes are fused into one loop that keeps the input array when nothing
  changed (for example an empty bullet list). One pass in `tick()` works out the tick's alive
  roster, difficulty scale, boss-wave flag and Carrier armor (`TickCtx`). It is shared only with
  the sub-ticks that run before anything can change the roster, so every value is exactly what the
  old code computed at the same point. Tier stats are copied on first write instead of spread for
  every bullet. The reinforcement slot check compares coordinates directly instead of building a
  `Set` of strings. Nothing is pooled or mutated: the engine stays immutable, and the frame gate
  still compares by identity. The golden replay fixture is unchanged, and a raw (unrounded)
  per-tick state hash over seven seeded scenarios matched byte for byte before and after.

Jest micro-benchmarks (Node 22 under jest, this container, not a device — use them to compare
before and after, not as absolute numbers):

| Benchmark                                             | Before #2963               | After #2963                |
| ----------------------------------------------------- | -------------------------- | -------------------------- |
| `tick` × 10,000, seeded wave 9 (`tick.bench.test.ts`) | 6.97–7.26 s (≈700 µs/tick) | 6.25–6.96 s (≈630 µs/tick) |
| GC passes during those 10,000 ticks                   | 204                        | 178                        |
| `buildFrame` × 20,000, wave-9 state after 900 ticks   | 302 ms (15 µs/frame)       | 27 ms (1.4 µs/frame)       |
| `buildFrame` ops, seeded wave 1, all sprites loaded   | 135                        | 39                         |

The `buildFrame` "before" column leaves out the per-frame `tickStarfield` copy of 95 stars, which
#2963 also removed. To run the tick benchmark:
`cd frontend && STARSWARM_BENCH=1 node --expose-gc node_modules/.bin/jest src/game/starswarm/__tests__/tick.bench.test.ts`
(without `STARSWARM_BENCH=1`, CI runs a 500-tick smoke of it). The heap delta it prints is noisy
because the collector runs during the loop, so the GC pass count is the better signal.

Profiling the tick benchmark after #2963 shows that most of the remaining time goes into copying
whole `Enemy` objects (`{ ...enemy, … }`) in `tickFormation` and the `tickEnemies` per-ship map:
about half of the self time under V8. That is the next thing to look at, once the engine split (#2988)
has landed.

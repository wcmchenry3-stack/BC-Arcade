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

## Store Size: Current Budgets and Measurements

> **Epic #2828** (children #2829–#2834) | Measured: 2026-10-10 | Branch `feat/perf-size-epic-2828` on `dev` a19aadc5, before merge | Android JS and packaged assets only. Native libraries, Hermes bytecode, AAB and IPA sizes are **not measured yet** (see [Native and Store Artifact Sizes](#native-and-store-artifact-sizes-not-yet-measured)).

Everything in this section is current. The April 2026 sections further down are kept as history and say so. Numbers here always name a date, a config and a denominator.

### Configs and denominators

| Name          | How it is built                                                                                                             | What it contains                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Store**     | `EXPO_PUBLIC_API_URL=https://games-api.buffingchi.com`, `EXPO_PUBLIC_TEST_HOOKS=0`, `expo export:embed --dev false`         | The 7 v1 games. Hidden premium games are stubbed out (#2830).                     |
| **All games** | `EXPO_PUBLIC_API_URL=https://dev-games-api.buffingchi.com` (pre-launch API), same command; e2e (`TEST_HOOKS=1`) is the same | All 12 games. This is what the premium store build will look like once un-hidden. |

- **JS** = bytes of `index.android.bundle` as Metro writes it: minified JavaScript, **before** Hermes compiles it to bytecode.
- **Packaged assets** = bytes of every file under `--assets-dest`. Gradle and Xcode copy these into the APK/IPA, before APK/AAB compression.
- MiB = 1,048,576 bytes. KB in bucket tables = 1,024 bytes.

### Enforced budgets

The source of truth is the `android-bundle-check` job in `.github/workflows/ci.yml` (flags to `frontend/scripts/size-report.mjs`) and `frontend/package.json`.

| Budget                     | Value                              | Measured on                                       | Enforced by                                                      | Effect                                                |
| -------------------------- | ---------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| JS hard limit              | 8,388,608 B (8 MiB)                | Store bundle, `dist/index.android.bundle`         | `--max-js 8388608` in step "Size budgets"                        | CI fails                                              |
| JS warn threshold          | 6,291,456 B (6.0 MiB)              | Store bundle                                      | `--warn-js 6291456`                                              | `::warning`, CI passes                                |
| Packaged assets hard limit | 4,194,304 B (4 MiB)                | Store `dist/assets`                               | `--max-assets 4194304`                                           | CI fails                                              |
| Hidden-premium asset guard | 0 files                            | Store `dist/assets`                               | `--forbid-hidden-assets`                                         | CI fails                                              |
| All-games JS ceiling       | 8,388,608 B (8 MiB)                | All-games bundle, `dist/all/index.android.bundle` | Step "All-games JS ceiling (pre-launch config)"                  | CI fails                                              |
| `bundlesize`               | `"8 mB"` (= 8 MiB), no compression | `dist/index.android.bundle` (store)               | `npx bundlesize`, `"bundlesize"` in `frontend/package.json`      | Informational: the step has `continue-on-error: true` |
| Hidden-locale guard        | 0 strings                          | Store bundle JS                                   | `--forbid-hidden-locales`                                        | CI fails                                              |
| PR comment baseline        | 5,818,990 B                        | Store bundle                                      | `BASELINE_BYTES` in the PR-comment step                          | Delta shown, no gate                                  |
| Release APK size report    | none                               | `android-release-smoke` universal arm64 APK       | Step "APK size report (non-blocking)"                            | Step summary only                                     |
| New game JS delta          | ≤ 200 KB                           | Reviewer check                                    | [`GAME-CONTRACT.md` — Size Budget](GAME-CONTRACT.md#size-budget) | Review                                                |

Why 8 MiB stays the JS limit (decided in #2829): the store bundle was 6.24 MiB then (5.55 MiB since #3150), but the premium release un-hides the games and becomes the 7.11 MiB all-games bundle. 8 MiB leaves about 0.89 MiB (12%) of growth over that ceiling. Lowering the limit now would only fail the premium launch. Drift on today's store bundle is caught by the 6.0 MiB warning (about 8% over 5.55 MiB; it was 6.75 MiB before #3150). The all-games ceiling is checked now, not at launch. The assets limit (4 MiB, about 23% over the 3.25 MiB store payload) will fail by design when games are un-hidden: that needs a deliberate re-budget, not a quiet increase.

CI builds the store bundle with the env set explicitly. A gitignored `frontend/.env` on a dev machine points at the pre-launch API and would otherwise make a bundle with all 12 games, because Expo loads `.env` before Metro runs.

### Reproducing the numbers

```bash
cd frontend
mkdir -p dist
ENTRY_FILE=$(node -e "require('expo/scripts/resolveAppEntry')" . android absolute | tail -n 1)
EXPO_PUBLIC_API_URL=https://games-api.buffingchi.com EXPO_PUBLIC_TEST_HOOKS=0 \
  npx expo export:embed --platform android --dev false --entry-file "$ENTRY_FILE" \
    --bundle-output dist/index.android.bundle --assets-dest dist/assets
npm run size-report        # JS + packaged-asset buckets + checked-in source contributors
npm run test:size-report   # unit tests for the script (node:test)
```

For the all-games numbers use `EXPO_PUBLIC_API_URL=https://dev-games-api.buffingchi.com` and a different output dir. Always pass the env explicitly; `npm run size-report` only reads `dist/`.

### Measurements (2026-10-10)

| Config                                                       | JS (minified, pre-Hermes)  | Packaged assets             | Files |
| ------------------------------------------------------------ | -------------------------- | --------------------------- | ----: |
| Before the epic (`dev` a19aadc5, store)                      | 7,651,589 B (7.30 MiB)     | about 38 MB                 |   206 |
| After #2830 (hidden screens stubbed)                         | 6,736,164 B (6.42 MiB)     | about 3.5 MB                |    53 |
| After #2830 + #2832, store                                   | 6,544,825 B (6.24 MiB)     | 3,403,575 B (3.25 MiB)      |    52 |
| **After #3150, store (current): non-launch locales stubbed** | **5,818,990 B (5.55 MiB)** | **3,403,575 B (3.25 MiB)**  |    52 |
| **After #2830 + #2832, all games (premium ceiling)**         | **7,460,309 B (7.11 MiB)** | **28,744,159 B (27.4 MiB)** |   205 |

Notes: the #3150 row was measured against 6,544,912 B for the same tree without the locale stub, so dropping the ten non-launch locales saves 725,922 B (0.69 MiB, 11.1%) of Android store JS; the iOS store bundle is 5,816,474 B, and the all-games bundle keeps all 13 locales (7,458,736 B). The first two rows are from the #2830 comparison runs; the last two were re-measured with `size-report.mjs` and re-checked for the store row on the final tree. Asset byte counts are exact; Metro's "Copying N asset files" log line says 53 and 206 because it counts a directory entry, `size-report.mjs` counts files. Adding `--sourcemap-output` appends 95 bytes to the bundle (6,544,920 B). The stale PR-comment baseline before this epic was 4,718,592 B (4.5 MB, 2026-04).

### Android artifact inputs

What the Android build copies into the APK/AAB besides native code. Source: `size-report.mjs` on the 2026-10-10 builds above.

**Store config** (JS 6,544,825 B + assets 3,403,575 B):

| Bucket                  | Files |      KB | Notes                                                               |
| ----------------------- | ----: | ------: | ------------------------------------------------------------------- |
| Fonts                   |    14 | 2,710.8 | Manrope ×7, Space Grotesk ×5, MaterialIcons, MaterialCommunityIcons |
| Sounds                  |    19 |   567.0 | SFX only (see residuals below)                                      |
| App logo                |     1 |    37.6 | `assets/logo.png` via `AppHeader`                                   |
| React Navigation images |    17 |     6.2 | Library images                                                      |
| Other                   |     1 |     2.2 | `raw/keep.xml`                                                      |

**All-games config** (JS 7,460,309 B + assets 28,744,159 B):

| Bucket                              | Files |                       KB |
| ----------------------------------- | ----: | -----------------------: |
| Sounds (BGM and SFX)                |    45 |                   22,211 |
| Fonts                               |    14 |                    2,711 |
| Celestial and cosmos Cascade images |    24 |                    1,614 |
| Fruit Cascade images                |    24 |                    1,203 |
| Mahjong tile SVGs                   |    42 |                    221.5 |
| Star Swarm sprites                  |    37 |                     59.1 |
| App logo, library images, other     |    19 | about 51 (by difference) |

The largest JS payloads that are checked-in data rather than code (source bytes entering Metro): Yacht `oracleTable.generated.ts` 599.9 KB, i18n locale JSON (13 locales) 631.7 KB, Sudoku `puzzleBanks.generated.ts` 155.5 KB. `size-report.mjs --sources` also lists the checked-in `assets/` buckets (sounds 22.2 MB, `cosmos-baked` 1.2 MB, `fruits-baked` 0.95 MB, `icon.png` 0.49 MB, `celestial-icons` 0.41 MB, `fruit-icons` 0.25 MB, mahjong 0.22 MB). Those are repo sizes from before the #2833 re-encode and are not what ships; see the Image section.

**iOS.** The JS is the same Metro output (the same 6,544,825 B store bundle). iOS packaging was not run here, so IPA contents, App Thinning sizes and per-device download sizes are pending the owner checklist below.

### Native and Store Artifact Sizes (not yet measured)

This environment has no Android SDK, bundletool, Xcode or signing keys, so **no AAB, APK, IPA, `.so`, dex or Hermes bytecode was built or measured for #2828**. Nothing in this section is an estimate: the April table of "approximate" native library sizes taken from published benchmarks was removed. The owner fills the table below from a real build.

| Metric (date, commit, config recorded with each)                               | Android store | Android all games | iOS store | iOS all games |
| ------------------------------------------------------------------------------ | ------------- | ----------------- | --------- | ------------- |
| AAB / IPA bytes                                                                | TBD           | TBD               | TBD       | TBD           |
| Play download size / App Store thinned download size                           | TBD           | TBD               | TBD       | TBD           |
| Install size (reference device and max)                                        | TBD           | TBD               | TBD       | TBD           |
| `lib/<abi>/*.so` total (arm64-v8a)                                             | TBD           | TBD               | n/a       | n/a           |
| Hermes bytecode (`assets/index.android.bundle` in APK, `main.jsbundle` in app) | TBD           | TBD               | TBD       | TBD           |
| `classes*.dex`                                                                 | TBD           | TBD               | n/a       | n/a           |
| `react-native-audio-api` delta (with vs without)                               | TBD           | TBD               | TBD       | TBD           |

**Android checklist** (Android SDK, bundletool, Play upload key):

1. `cd frontend/android && ./gradlew bundleRelease` with the config's env set, then record the bytes of `app/build/outputs/bundle/release/app-release.aab`.
2. `java -jar bundletool.jar build-apks --bundle=app-release.aab --output=app.apks --mode=universal`, then `bundletool get-size total --apks=app.apks`, and again with `--device-spec=pixel.json` (from `bundletool get-device-spec` on a real device) for min and max download size.
3. `apkanalyzer apk file-size` and `apkanalyzer apk download-size` on the universal APK, and `apkanalyzer files list --files-only app-universal.apk | sort`. Record the split of `lib/` (`.so`), `classes*.dex`, `assets/index.android.bundle` (Hermes bytecode) and `res/raw`.
4. Upload to the internal testing track and read Play Console → App bundle explorer → Download size and Install size per device config.
5. Repeat with `EXPO_PUBLIC_API_URL=https://dev-games-api.buffingchi.com` for the premium forecast.

**iOS checklist** (Xcode on macOS):

1. `xcodebuild archive` the Release scheme with the store env.
2. `xcodebuild -exportArchive` with an `ExportOptions.plist` (`method: app-store-connect` or ad-hoc, `thinning: <thin-for-all-variants>`) and read `App Thinning Size Report.txt` (per-variant compressed and uncompressed sizes).
3. After TestFlight processing, read the App Store file sizes (download size per device) in App Store Connect.
4. From the `.xcarchive`, record the `main.jsbundle` (Hermes) size and `du -sh` of the `.app` and its Frameworks.

Record date, commit, env config, artifact bytes, per-device sizes and the JS, asset and native split in this section.

**CI hook.** `android-release-smoke` is the only CI job that produces a release APK (`assembleRelease`, arm64-v8a, universal, debug-signed). Its non-blocking "APK size report" step writes the APK bytes and compressed and uncompressed KB by group (`lib/`, `classes*.dex`, JS or Hermes bundle, `res/raw`, `res/`) to the step summary. Use it for trends, not as the Play download size.

### Store build: hidden premium exclusion (#2830)

Before the epic, a store bundle shipped the five hidden premium games' code and assets (206 asset files, about 38 MB) even though no route reached them. Two facts shaped the fix:

- **`assetBundlePatterns: ["assets/**"]` in `app.json` does not package assets in this project.** The native projects are committed (bare workflow) and `expo-updates` is not installed, so the APK/IPA contains exactly the assets that Metro's dependency graph `require()`s, copied by `expo export:embed --assets-dest`. Changing `app.json` did not change the count (verified: 206 files before, 53 after, `app.json` unchanged).
- **`React.lazy()` / `import()` on native does not split the Hermes bundle.** A lazily imported screen, its whole module subtree and the assets it requires are all in the single bundle. Lazy loading only defers evaluation.

**Mechanism.** `frontend/metro/storeBundle.js` wraps `resolver.resolveRequest` (chained after Sentry's resolver; wired in `frontend/metro.config.js`). In a store bundle it resolves the hidden games' screen modules to `src/screens/StoreBuildExcludedScreen.tsx`, which renders nothing:

| Hidden game | Stubbed modules                                                                    |
| ----------- | ---------------------------------------------------------------------------------- |
| Blackjack   | `BlackjackBetting`, `BlackjackTable`, `BlackjackVictory`, `BlackjackStats` screens |
| Cascade     | `CascadeScreen`                                                                    |
| Hearts      | `HeartsScreen`                                                                     |
| Mahjong     | `MahjongScreen`, `MahjongLayoutInspector`, `MahjongLayoutDetail` screens           |
| Star Swarm  | `StarSwarmScreen`                                                                  |

A build counts as a store build when `!context.dev && EXPO_PUBLIC_TEST_HOOKS !== "1"` and `EXPO_PUBLIC_API_URL` is not the pre-launch API. This mirrors `SHOW_HIDDEN_GAMES` in `src/entitlements/gameVisibility.ts` minus `__DEV__`. The stubs are unreachable: `visiblePremiumRoutes()` registers no route for hidden games, and the Mahjong inspector screens are only opened from `MahjongScreen`. Dev, e2e (`TEST_HOOKS=1`) and pre-launch-API builds keep all 12 games.

**Guards.** `src/entitlements/__tests__/storeBundle.test.ts` pins parity between the Metro predicate and `envFlags` (including lookalike hosts), the stub list against `HIDDEN_GAMES`, coverage of every `PREMIUM_ROUTES` lazy import, and resolver passthrough. In CI, `--forbid-hidden-assets` fails the job if any hidden-only asset (BGM, `celestial-icons`, `fruit-icons`, `cosmos-baked`, `fruits-baked`, vertices JSON, Mahjong tile art, Star Swarm sprites) is packaged.

**What remains in the store bundle (known limitation).**

- Small shared modules that free surfaces import: hidden games' i18n namespaces (all locales), the `GameDetail` Hearts and Star Swarm sections, Hearts and Blackjack scorecards and models, the Blackjack and Hearts contexts and storage, and the Star Swarm engine (reached through `scoreLedger`, `GameDetail` and `LeaderboardScreen`). All pure JS, no large assets.
- Four sounds that look premium by name (`hearts-moon-shot.mp3`, `blackjack-win.ogg`, `cascade-fruit-merge.ogg`, `cascade-game-over.ogg`) are required by free games through the shared sound registry. The guard deliberately does not flag SFX.
- The Blackjack and Hearts providers stay mounted at startup (about 26 KB of source).
- No premium-only native dependency exists (`matter-js` and `poly-decomp` are pure JS), so native size is unchanged by #2830.

### Sentry JS cost (#2832)

The April finding "Sentry ~24.5%" (below, historical) was a share of **raw `sourcesContent`** in the source map: unminified source text, summed over mapped modules, from a different SDK version. It is not installed size and not shipped JS. The numbers that matter for the bundle are the minified bytes.

| Measure (2026-10-10, `@sentry/react-native` 8.27.0, `@sentry/core` and `browser` 10.75.0) | @sentry/* bytes | Denominator                          |  Share |
| ----------------------------------------------------------------------------------------- | --------------: | ------------------------------------ | -----: |
| Minified, original config (`dev` a19aadc5)                                                |       1,386,809 | 7,651,684 B bundle                   | 18.12% |
| Minified, current store config (#2832 options)                                            |       1,196,103 | 6,544,901 B bundle                   | 18.28% |
| `sourcesContent`, original config                                                         |       2,268,892 | 13,559,977 B summed `sourcesContent` | 16.73% |
| `sourcesContent`, current store config                                                    |       1,896,091 | 11,141,467 B summed `sourcesContent` | 17.02% |

The share barely moves because #2830 shrank the denominator in the same period. The absolute change is the point: **−190,706 B of Sentry JS** (−191,244 B of bundle, −2.84%), and −372,801 B of `sourcesContent`.

**Change.** `frontend/metro.config.js` passes `getSentryExpoConfig(__dirname, { includeWebReplay: false, includeWebFeedback: false })`. These supported options make Sentry's own Metro resolver return an empty module for `@sentry/replay`, `@sentry-internal/replay`, the web feedback widget and the browser feedback wrappers. Removed (minified, baseline build): replay 126,551 B, replay-canvas 14,475 B, feedback 49,227 B. They apply on all platforms; web never initialises Sentry (`shouldInitSentry`).

**Why it is safe.** The app never calls `replayIntegration()` or `mobileReplayIntegration()` and sets no replay sample rates; native mobile replay is a separate RN module and is unaffected. In-app feedback uses core `Sentry.captureFeedback(...)` with attachments (`useFeedbackSubmit.ts`), not the web `feedbackIntegration` widget. Crash capture, app-hang tracking, breadcrumbs, `Sentry.metrics`, console-error forwarding and source-map upload are untouched. See [FEEDBACK-OBSERVABILITY.md](FEEDBACK-OBSERVABILITY.md).

**What remains** (minified, baseline build; no supported flag removes it): `@sentry/conventions` 348,607 B (a single `attributes` module), `@sentry/core` 347,725 B, `@sentry/react-native` 302,749 B, `@sentry/browser` 104,291 B, `@sentry/browser-utils` 51,001 B, `@sentry/react` 42,183 B. Patching or deep-importing past this was out of scope (see _Options not taken_).

**Init cost** is static analysis only; nothing was profiled on a device. `Sentry.init` runs synchronously at `App.tsx` module scope (about 25 default integrations, no tracing, replay or profiling because no sample rates are set) and bridges to the native SDK. No init-level change was made. Native SDK versions are Sentry Cocoa 9.29.0 and sentry-android 8.57.0 (podspec and Gradle); native sizes are not measured.

### Images (#2833)

Two tiers per Cascade theme: 256 px WebP UI thumbnails (`fruit-icons/`, `celestial-icons/`, drawn by `FruitGlyph` at up to 32 pt) and 512 px palette PNG sprites (`fruits-baked/`, `cosmos-baked/`, drawn by Skia in `PieceRenderer`). They are not duplicates. The full-resolution processed icons moved to `cascade_icon_masters/` so Metro no longer bundles them. Rendered-size reasoning, the pipeline and the regeneration commands are in [ASSETS.md](ASSETS.md#rendered-sizes-2833), [Prebuild optimization](ASSETS.md#prebuild-optimization) and [Regenerating the runtime icon thumbnails](ASSETS.md#regenerating-the-runtime-icon-thumbnails). Not repeated here.

Bytes of bundled files, 2026-10-10 (all-games config; Cascade is a hidden game, so none of this is in the store bundle):

| Family                           | Bundled files | Before (B, all files) | After (B, bundled) | Change                   |
| -------------------------------- | ------------: | --------------------: | -----------------: | ------------------------ |
| `fruit-icons`, `celestial-icons` |            22 |            10,541,694 |            622,388 | 1024–2816 px → 256 px    |
| `fruits-baked`, `cosmos-baked`   |            22 |             2,210,015 |            670,395 | 512 px kept, palette PNG |
| **Cascade total**                |        **44** |        **12,751,709** |      **1,292,783** | **−89.9% (−11.46 MB)**   |

(After = sum of the two theme directories: icons 250,642 + 371,746; baked 359,716 + 310,679. Before counts all 48 files, including the unbundled `pumpkin` and `milkyway` files.) `pumpkin` and `milkyway` were also dropped from `src/game/cascade/images.ts`: before that they cost 1,657,949 B in the bundle. The iOS `App-Icon-1024x1024@1x.png` went from 1,575,612 to 1,537,275 B (lossless only). The store bundle ships only `logo.png` (37.6 KB) as an in-app image.

### Audio

Audio is not sized or planned here. In the store config the 19 packaged sounds are 567.0 KB of SFX; the 45 sounds (22,211 KB) of the all-games config are mostly BGM behind the hidden games. BGM format, bitrate, per-track budgets and the engine choice are owned by epic #1779 and #1787; the current budgets and track list are in [ASSETS.md](ASSETS.md#size-budgets). `react-native-audio-api` stays installed for that decision (next section).

### Native dependency audit (#2831)

Method (2026-10-10): for every `dependencies` entry, checked `node_modules` for `android/`, `ios/`, podspec and `expo-module.config.json`, grepped `frontend/src`, `App.tsx` and `index.ts` for production importers, and ran `npx knip --production` (clean). **No dependency was removed**: none was clearly unused by shipped functionality with low removal risk.

| Group                                 | Packages                                                                                                                                                                                                                         | Verdict                                                                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework                             | `expo`, `expo-modules-core`, `react-native`, `react`                                                                                                                                                                             | Keep                                                                                                                                                                         |
| Web only (no native cost)             | `react-dom`, `react-native-web`                                                                                                                                                                                                  | Keep (Expo Web is a supported secondary platform)                                                                                                                            |
| Native, used everywhere               | `async-storage`, `netinfo`, `@sentry/react-native`, `react-native-reanimated`, `gesture-handler`, `safe-area-context`, `react-native-svg`, `expo-haptics`, `expo-blur`, `expo-linear-gradient`, `expo-localization`, `expo-font` | Keep, each has production importers                                                                                                                                          |
| Required peers, no direct import      | `react-native-worklets` (reanimated 4), `react-native-screens` (native-stack)                                                                                                                                                    | Keep                                                                                                                                                                         |
| Largest native cost, premium-only use | `@shopify/react-native-skia` (Star Swarm and Mahjong canvases; Skia is C++, 24M of source)                                                                                                                                       | Keep; per-game owners starswarm and mahjong. Standalone-app rule applies to anything new                                                                                     |
| Audio                                 | `expo-audio` (SFX and current BGM), `react-native-audio-api` 0.13.5                                                                                                                                                              | Keep both for now, see below                                                                                                                                                 |
| Dev tooling                           | `expo-dev-client`                                                                                                                                                                                                                | Keep. Its native modules `expo-dev-launcher` and `expo-dev-menu` are `debugOnly` in autolinking, so they are not linked in Release (not verified with a release binary here) |
| JS only                               | navigation (3), `i18next` stack, `@formatjs/intl-pluralrules`, `fflate`, `@expo/vector-icons`, `matter-js`, `poly-decomp`                                                                                                        | Keep. `matter-js` is Cascade physics (hidden game, in the all-games bundle only)                                                                                             |

**`react-native-audio-api` is kept, justified by #1779.** Its only importer is the dev spike screen `src/screens/__dev__/AudioLibrarySpikeScreen.tsx`, which nothing imports, so neither the library's JS nor the screen is in the production JS bundle; only the native library ships (autolinked). It is the candidate gapless BGM engine (spike #1782, preliminary recommendation 2026-05-22: `AudioBufferSourceNode.loop` for BGM) while `expo-audio` keeps SFX. If #1779 settles on `expo-audio` for BGM, remove it: `package.json`, the `app.json` plugin entry, the Podfile `DISABLE_AUDIOAPI_FFMPEG` line, `disableAudioapiFFmpeg` in `android/gradle.properties`, the `RNAudioAPI` lock entry, the audio-api bullets in [ANDROID-CI.md](ANDROID-CI.md), and the spike screen.

Already trimmed: FFmpeg is disabled for audio-api on every path (`app.json` `disableFFmpeg: true`, Podfile `DISABLE_AUDIOAPI_FFMPEG`, Gradle `disableAudioapiFFmpeg=true`), and its microphone, background-mode and foreground-service options are off. Not set: `DISABLE_AUDIOAPI_STATIC_EXTERNAL_LIBS` (opus and vorbis static libraries). Setting it would shrink the library further if BGM is mp3/wav/aac only, but it needs a real build and depends on the #1782 asset-format decision.

Package size on disk (2026-10-10, `node_modules`, v0.13.5): 14M total (common C++ 7.9M, compiled JS 3.9M, `src/` 820K, `android/` 460K, `ios/` 260K). No prebuilt `.so` or xcframework is checked in, so this is **not** the binary size. The binary delta (with vs without the dependency) is in the TBD table above.

### Startup, navigation, and runtime (#2834)

> Measured: 2026-10-10 | Static analysis of a real Android release bundle (`--dev false`, 3,169 modules, 7,651,684 B, built from the working tree's `.env.production` before the store exclusion) and Node/V8 timings. **No device measurements exist yet.** There was no device, simulator, Android SDK, Xcode or Hermes VM in the environment. V8 has a JIT and runs on a desktop CPU; Hermes on a phone is an interpreter and typically several times slower. Use V8 figures to rank work, never as device numbers.

#### Startup path

1. Native: process, Hermes VM, bytecode load, splash. Not visible to JS.
2. `index.ts`: `pluralRulesPolyfill` first (#2754), then `expo`, then `App`.
3. `App.tsx` module load evaluates 1,671 of 3,169 modules (3,951,364 B of 7.58 MB source, 52%): `appTiming` first (`APP_START_MS`), i18n init, static imports of Home, Yacht (`GameScreen`), Profile and Locked screens, all providers, `@sentry/react-native`, navigation, reanimated, gesture-handler; `SessionLogger.init()`; synchronous `Sentry.init(...)`. This build has `inlineRequires: false`, so imports run when the importing module runs. App code is about 8% of the eager bytes (173 modules, 322,537 B); dependencies are 92%.
4. First render waits on `useFonts` (5 TTFs, 466 KB) behind a spinner, then on i18n namespaces through a Suspense boundary.
5. `EntitlementProvider` reads the cached token from AsyncStorage and calls `GET /entitlements`.
6. `HomeScreen` mount: the `cold_start_ms` Sentry metric; then `prefetchLobbyGameScreens` on `setTimeout(0)`; `flushQueuedGames()` and `GET /stats/me`; `warmTodayMeta()`.

Heavy data is already off the startup path: the Yacht oracle table (613,392 B source) is `require()`d inside `getOracleTable()`; the i18n locale JSON (840 KB) loads through `import()` for the active language plus `en`; the Sudoku banks (159,077 B) load when the Sudoku screen module is first evaluated, which the lobby prefetch does right after Home mounts. The two glyph maps (231 KB) are eager.

Largest eager packages (source bytes): reanimated 773 KB, `@sentry/*` about 1.1 MB (before #2832; now about 190 KB less), `@expo/vector-icons` 239 KB, react-native 230 KB, gesture-handler 212 KB.

#### Code evaluated when each v1 screen first opens

The 7 v1 store games are yacht, twenty48, solitaire, freecell, sudoku, sort and daily_word (the 12-game grid minus `HIDDEN_GAMES`: blackjack, cascade, hearts, starswarm, mahjong). New modules beyond the startup set, minified source bytes (a measure of evaluation work, not time):

| Screen               | New modules | New bytes | Biggest items                                                   |
| -------------------- | ----------: | --------: | --------------------------------------------------------------- |
| Yacht (`GameScreen`) |           0 |         0 | Already eager. Oracle table loads on first AI query or VS start |
| 2048                 |          16 |     29 KB | `Twenty48Screen` 8.3 KB, engine 4.8 KB                          |
| Solitaire            |          37 |     70 KB | `SolitaireScreen` 14 KB, engine 9 KB                            |
| FreeCell             |          36 |     68 KB | engine 8.5 KB, `FreeCellScreen` 7.9 KB                          |
| Sort                 |         130 |    161 KB | `SortBoard` 14 KB, `react-native-svg` extract and transform     |
| Sudoku               |          20 |    190 KB | `puzzleBanks.generated.ts` 159 KB (84% of the chunk)            |
| Daily Word           |          13 |     27 KB | `DailyWordScreen` 7.5 KB, `useDailyWordSubmit` 4 KB             |

`prefetchLobbyGameScreens` evaluates the last six rows (545 KB) on the JS thread in the first tick after Home paints. In a release bundle `import()` resolves from the same bundle, so the three-at-a-time throttle does not make it concurrent. This is the largest identifiable avoidable cost on the startup path, and still a hypothesis until a device trace shows jank or a delayed first touch.

#### Existing instrumentation

- `cold_start_ms` (Sentry distribution): `performance.now() - APP_START_MS` at the Home first effect. JS start to Home only; excludes native start and bytecode load; includes fonts and the i18n Suspense.
- `screen_mount_ms{screen}` (Sentry distribution, emitted by `SuspenseMountTimer` in `App.tsx`): tap to lazy-screen commit, including module evaluation if not prefetched. Not "first playable frame". Yacht is eager and emits none.
- Neither is emitted in test-hooks builds (CI and Maestro), on web, or without `EXPO_PUBLIC_SENTRY_DSN`, so Maestro flows cannot read them. There is no first-playable metric and no tracing; do not enable `tracesSampleRate` without reviewing [STORE-PRIVACY-ANSWERS.md](STORE-PRIVACY-ANSWERS.md) and [DATA-INVENTORY.md](DATA-INVENTORY.md).
- The old `[cold-start] HomeScreen ready: <N> ms` log line **no longer exists** (`grep -rn "cold-start" frontend/src frontend/App.tsx` finds only a comment in `appTiming.ts`). Any `adb logcat | grep cold-start` instruction is stale; use the Sentry metric or the procedure below.

#### Device profiling procedure

Not yet run on a device. Definitions, so numbers compare across builds:

- **Cold start:** process not running, device idle; `force-stop` on Android, swipe away and wait 10 s on iOS. Report "cold after reboot" separately.
- **T0** launch request. **T1** first Home frame with the game grid (`game-tile-yacht` visible). **T2** tap on a tile. **T3** destination screen committed. **T4** first playable frame (board drawn, accepts input, no spinner).
- **Devices:** one low-end Android, one older iPhone, one current mid-range device; the same devices for every comparison.
- **Build:** release-equivalent only. Android: `cd frontend/android && ./gradlew assembleRelease -PALLOW_DEBUG_SIGNED_RELEASE=true` (local only, debug-signed, never distribute; [ANDROID-CI.md](ANDROID-CI.md)). iOS: the Release scheme from Xcode, or the Xcode Cloud TestFlight build. Never `eas build`. Measure both a store build (7 games) and a pre-launch-API build (12 games). Dev builds run React in dev mode and are not representative.
- **Protocol:** install, open once, settle 30 s, then 10 cold launches; discard the first; report median and p90. Run airplane mode on and off as separate series. Battery above 50%, not charging, normal thermal state, fixed brightness.

Android cold start (T0 to splash, then T1):

```bash
APP=com.buffingchi.games
adb shell am force-stop $APP
adb shell am start -S -W -n $APP/.MainActivity   # TotalTime ends at the splash window, NOT at Home
# T1: screen recording, count frames (16.7 ms at 60 fps)
adb shell screenrecord --time-limit 15 --bit-rate 8000000 /sdcard/cold.mp4 &
sleep 1; adb shell am start -W -n $APP/.MainActivity; wait; adb pull /sdcard/cold.mp4
adb shell cmd package compile -m speed-profile -f $APP   # once, so ART state is identical across builds
```

Android memory, jank and traces:

```bash
adb shell am force-stop $APP; adb shell am start -W -n $APP/.MainActivity; sleep 30
adb shell dumpsys meminfo $APP | grep -E "TOTAL PSS|TOTAL RSS|Java Heap|Native Heap|Graphics|Code|Private Other"
adb shell dumpsys gfxinfo $APP reset       # then tap a tile, make a move, go back
adb shell dumpsys gfxinfo $APP framestats
adb shell perfetto -o /data/misc/perfetto-traces/nav.pftrace -t 20s -b 64mb \
  sched freq idle am wm gfx view input binder_driver dalvik res -a $APP
adb pull /data/misc/perfetto-traces/nav.pftrace   # open at https://ui.perfetto.dev, inspect the mqt_js thread
```

Record TOTAL PSS and Native Heap (the Hermes heap shows up in native / Private Other) after settle and after 5 round trips into each game; a steady climb is a leak signal. In the Perfetto trace measure JS-thread busy time from Home's first commit to the end of the lobby prefetch; over about 100 ms of unbroken JS time delays the first touch response.

Hermes JS sampling profile (release builds do not expose the profiler; use a dev-client build with production-mode JS, which cannot capture cold start):

```bash
cd frontend
npx expo start --no-dev --minify
# On device: dev menu -> Enable Sampling Profiler, do the action, disable it
npx @react-native-community/cli profile-hermes ./hermes-profiles
```

`@react-native-community/cli` is not in `frontend/node_modules`, so `npx react-native profile-hermes` does not work as is; the `npx @react-native-community/cli ...` form downloads it. Open the `.cpuprofile` in Chrome DevTools → Performance.

iOS (Release build on a physical device):

```bash
xcrun xctrace list devices
xcrun xctrace record --template 'App Launch' --device <UDID> --time-limit 20s \
  --output launch.trace --launch -- com.buffingchi.games
# Also: --template 'Time Profiler' | 'Allocations'.  Or Xcode: Product > Profile (Cmd+I)
```

Read time to first frame and the `com.facebook.react.JavaScript` call tree; take T1 by frame-counting a screen recording; use Instruments "Animation Hitches" for tile tap to game screen. After release, Xcode Organizer (Launch Time, Hang Rate) and Play Console vitals (App startup time, Slow rendering) are the authoritative field numbers; lab runs explain regressions.

**A/B protocol for size PRs** (acceptance is "no measurable regression"): build base and head release builds with the same env and signing; alternate 10 cold launches each, 10 navigations to each of the 7 games, then memory. Starting thresholds, to tune after the first baseline: median `TotalTime` or T1 worse by 5% or 100 ms, `mqt_js` busy time in the prefetch window worse by 10%, PSS after settle up 5 MB, any new jank in `gfxinfo`. Device-free pre-check: rebuild the bundle and compare the eval-at-load module count and bytes (1,671 modules, 3.95 MB source on 2026-10-10) and the table above; a change that moves bytes from lazy to eager shows immediately. This cannot prove "no runtime regression" without device runs.

#### Baseline table (7 v1 store games)

Per device, release build, 10 launches, median / p90. **All measured cells are TBD: no device has been used.** Static payloads come from the table above.

| Game       | Prefetched? | New code at first open | Tap to commit (`screen_mount_ms`, prefetched) | Tap to commit if not prefetched | First playable frame                        | PSS after 5 round trips |
| ---------- | ----------- | ---------------------- | --------------------------------------------- | ------------------------------- | ------------------------------------------- | ----------------------- |
| Yacht      | n/a (eager) | 0 (VS: + oracle)       | TBD                                           | n/a                             | TBD solo, TBD VS first AI turn              | TBD                     |
| 2048       | yes         | 29 KB                  | TBD                                           | TBD                             | TBD                                         | TBD                     |
| Solitaire  | yes         | 70 KB                  | TBD                                           | TBD                             | TBD                                         | TBD                     |
| FreeCell   | yes         | 68 KB                  | TBD                                           | TBD                             | TBD                                         | TBD                     |
| Sort       | yes         | 161 KB (130 modules)   | TBD                                           | TBD                             | TBD                                         | TBD                     |
| Sudoku     | yes         | 190 KB (159 KB bank)   | TBD                                           | TBD                             | TBD (includes bank decode)                  | TBD                     |
| Daily Word | yes         | 27 KB                  | TBD                                           | TBD                             | TBD (includes today fetch or offline cache) | TBD                     |

Global rows, also TBD: cold start T0 to T1 (online, offline), JS-thread busy time from T1 to T1 + 2 s, PSS 30 s after Home, and `cold_start_ms` from Sentry for the same build.

#### Game-loop cost (V8, ranking only)

Per-operation cost is small for every v1 engine: 2048 `move` 0.017 ms median, Solitaire and FreeCell `dealGame` under 0.015 ms, FreeCell `getHintMoves` 0.065 ms, Sudoku `loadPuzzle` 0.08–0.25 ms (first call per difficulty 17.8–20.0 ms for classic easy and medium, which includes the bank decode), Sort `solve()` 10 ms (37 ms first), Yacht `holdStrategy` 0.009 ms warm. There is no move-level hotspot; per-frame cost for these games is a rendering question (React, Skia, reanimated) that Node cannot answer.

The one heavy one-shot is the **Yacht oracle**: `getOracleTable()` 197 ms cold (module eval about 81 ms plus `fflate` decode 22–100 ms) and `buildHoldOptions()` 256–365 ms steady (452 ms cold), run synchronously on the JS thread in `preloadOracleTable()`'s `setTimeout(0)` at VS game start (`useYachtCpuOpponent.ts`) or at the first AI move. That is roughly 0.5–0.65 s of JS-thread blocking in V8 at the start of a fresh-session VS game, with about a million transition objects of allocation churn (`multisetIndex.ts`). Hermes is likely a multiple of this.

#### Recommendations (prioritized; all hypotheses until P0 is done)

| Priority | Item                                                                                                                                                                                                                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Run the procedure above on one low-end Android and one older iPhone, on a store build, and fill the baseline table. Fix the A/B thresholds from it.                                                                                                                                                                                                      |
| P1       | Lobby prefetch contention (545 KB evaluated right after Home paints). Only if the P0 trace shows JS-thread contention in the first 2 s: stagger the prefetch (for example start about 1.5 s after Home, one task per tick), and/or `require()` the Sudoku bank lazily inside `poolFor` as the Yacht oracle does (same decode work, identical behaviour). |
| P1       | Yacht VS-start freeze. If the device measurement is above about 250 ms: compute `targetIndex` with index arithmetic instead of sort/join, chunk `buildHoldOptions` across ticks during the VS intro, or ship the hold options as packed data. Output must stay bit-identical (oracle and AI golden tests, `yacht-sim-gate.yml`).                         |
| P2       | Sentry and reanimated are about 40% of eager source. Check whether Sentry init and module evaluation is a measurable share of T0 to T1 before touching them; any removal must pass the A/B protocol.                                                                                                                                                     |
| P2       | Five TTFs (466 KB) gate the first React frame. Measure `useFonts` resolve time on the low-end device; if material, render the shell with system fonts or cut unused weights.                                                                                                                                                                             |
| P3       | `fflate` (34 KB), the plural-rules polyfill and locale data (39 KB) and the glyph maps (231 KB) are small eager costs. Leave them unless the P0 trace shows them.                                                                                                                                                                                        |
| P3       | `LeaderboardScreen`'s lazy chunk (118 KB) pulls in the hidden Star Swarm engine (about 38 KB). Not a startup issue; worth a look in dead-code work.                                                                                                                                                                                                      |
| P3       | Add a one-line `console.info` of `cold_start_ms` in non-store builds so the number is readable with `adb logcat -s ReactNativeJS` where Sentry is disabled.                                                                                                                                                                                              |

Nothing was changed for startup in #2828: no measurement showed a safe, clearly beneficial deferral. The size work already merged (oracle and Sudoku banks lazy, #2869) is consistent with this map.

### Safeguards already in place

Verified in `frontend/android/gradle.properties` and `frontend/android/app/build.gradle` on 2026-10-10. These were recommendations in April and are done.

| Safeguard                | State                                                                        | Source                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Hermes                   | On                                                                           | `hermesEnabled=true`                                                        |
| R8 minification          | **On** (#554)                                                                | `android.enableMinifyInReleaseBuilds=true`; read in `build.gradle`          |
| Resource shrinking       | **On** (#554)                                                                | `android.enableShrinkResourcesInReleaseBuilds=true`; read in `build.gradle` |
| PNG crunching            | On in release                                                                | `android.enablePngCrunchInReleaseBuilds=true`                               |
| WebP (static)            | On; animated WebP off                                                        | `expo.webp.enabled=true`, `expo.webp.animated=false`                        |
| WebP icon enforcement    | CI test                                                                      | `assetTransparency.test.ts` (see below)                                     |
| Native libs uncompressed | `useLegacyPackaging=false`                                                   | `expo.useLegacyPackaging=false`                                             |
| ABIs built               | armeabi-v7a, arm64-v8a, x86, x86_64; Play serves per-ABI slices from the AAB | `reactNativeArchitectures=...`                                              |
| New Architecture         | On                                                                           | `newArchEnabled=true`                                                       |
| Store payload guard      | CI                                                                           | `--forbid-hidden-assets`, `storeBundle.test.ts`                             |

---

## JS Bundle Size Guardrail

> **Epic 2b — Issues #556 / #581** | Implemented: 2026-04-18 | Updated 2026-10-10 (#2829). Current limits are in [Enforced budgets](#enforced-budgets).

### Hard limit

The current enforced numbers (JS limit, warn threshold, packaged-assets limit, all-games ceiling) are in the [Enforced budgets](#enforced-budgets) table above. The JS limit is **8 MiB (`--max-js 8388608`)** on the store-config bundle `dist/index.android.bundle`; `bundlesize2` also runs against the `"bundlesize"` config in `frontend/package.json` (`"8 mB"`, which it reads as 8 MiB) but that step is non-blocking. "MB" in this doc means 1,048,576 bytes unless it says otherwise.

**What is measured.** CI builds the file with `npx expo export:embed --platform android --dev false` and no `--bytecode` flag, so it is **minified JavaScript, before Hermes compiles it to bytecode**. It is not a Hermes bytecode budget. Gradle compiles the JS to bytecode later in the release build, and the bytecode is larger: the number tracks what ships closely but not exactly. For example, the minifier escapes every non-ASCII character in the translations as `\uXXXX`, which adds about 240 KB to the measured file but nothing to the bytecode.

**Real bytecode, for context (historical).** On 2026-09-30 the bytecode for the 7.27 MB bundle below was 9,351,141 bytes (8.92 MiB), measured with `hermesc -O -emit-binary` from `node_modules/hermes-compiler`; on 2026-10-10 the 7.65 MB bundle gave 9.4 MB the same way. Gradle passes different flags, so do not quote either as the shipped size; read it from a built APK/IPA. If the limit is ever re-based on bytecode, start from a measured Gradle build.

**History.**

- 4.5 MB: baseline when the guardrail was added (#556 / #581). The first limit was 5.0 MB.
- 5.5 MB: limit raised for `react-native-svg` and the Classic card deck (#688).
- 6.0 MB: limit raised for Expo SDK 56 and new games (#1977).
- 8.0 MB: limit raised for `@sentry/react-native` 7 → 8 (#1965).
- **8.0 MiB kept, meaning changed (2026-10-10, #2829).** The store bundle is 6.24 MiB after #2830 and #2832; 8 MiB now guards the 7.11 MiB all-games ceiling that the premium release will reach, with a 6.75 MiB warning on the store bundle and a 4 MiB packaged-assets limit. See [Enforced budgets](#enforced-budgets).
- **7.74 MB → 7.27 MB (2026-09-30, #2869).** The bundle had reached 7.74 MB (8,114,007 bytes), 280 KB under the limit, before the premium client work (`expo-iap`, the five premium games made visible). Two behaviour-preserving changes cut 483 KB and left **752 KB of headroom** (769,634 bytes):

| Change                                                                                                                                                                                | Bundle after              | Saved  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------ |
| Baseline (`dev` at e5bb82b2)                                                                                                                                                          | 8,114,007 B (7.74 MB)     | –      |
| Yacht oracle table: delta + zigzag + byte planes before zlib (`frontend/src/game/yacht/oracle/tableCodec.ts`). Values bit-identical, pinned by `pinnedEV.test.ts`.                    | 7,828,231 B (7.47 MB)     | 279 KB |
| Sudoku puzzle banks shipped packed (`puzzleBanks.generated.ts`, from `tools/generators/pack-sudoku-puzzles.ts`). JSON stays the source of truth; `puzzleBanks.test.ts` pins equality. | **7,618,974 B (7.27 MB)** | 204 KB |

The final row is CI's exact command with `--reset-cache`. The earlier rows were built with `--sourcemap-output` as well, which adds about 100 bytes (see below).

### Measuring and analysing the bundle

Build the bundle as CI does, with a source map added, then run the analysis script (from `frontend/`):

```bash
mkdir -p dist
EXPO_PUBLIC_API_URL=https://games-api.buffingchi.com EXPO_PUBLIC_TEST_HOOKS=0 \
  npx expo export:embed --platform android --dev false \
  --entry-file "$(node -e "require('expo/scripts/resolveAppEntry')" . android absolute | tail -n 1)" \
  --bundle-output dist/index.android.bundle \
  --assets-dest /tmp/assets \
  --sourcemap-output dist/index.android.bundle.map
stat --printf="%s\n" dist/index.android.bundle   # CI's number, plus ~100 B (below)
node scripts/analyze-bundle.mjs 25               # top 25 contributors
```

`--sourcemap-output` appends a `//# sourceMappingURL=index.android.bundle.map` line, which adds about 100 bytes (95 on the 7.27 MB bundle). Leave it off, and add `--reset-cache`, to reproduce CI's figure to the byte. `scripts/analyze-bundle.mjs` runs `source-map-explorer` and groups mapped code by npm package, or by directory for app code. Metro emits JSON modules (translations, puzzle data, icon glyph maps) without source mappings, so `source-map-explorer` lumps them into "[unmapped]". The script finds those modules in the bundle text and labels them instead. `dist/` is gitignored; delete it when you're done, since the map is about 20 MB.

**Top contributors after #2869 (historical: 2026-09-30, all 12 games, 7.27 MB, before #2830 and #2832):**

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

Sentry packages together (`conventions`, `core`, `react-native`, `replay`, `browser`, `browser-utils`, `feedback`, `react`) came to about 1.3 MB then. #2832 has since removed about 190 KB of that (replay and feedback); see [Sentry JS cost (#2832)](#sentry-js-cost-2832).

### Options not taken (yet)

These were looked at for #2869 and left alone, either because they wouldn't reduce the shipped size or because they need an owner decision:

- **Inlining Sentry's attribute-name constants at build time** (341 KB). Sentry imports about 25 string constants from `@sentry/conventions/attributes`, a 340 KB module that Metro can't tree-shake. A Babel plugin that replaced them with their values was built and measured for #2869, then dropped: it couples the build to a transitive Sentry package, and the owner declined it.
- **Lazy-loading game screens and engines.** Native Metro doesn't split bundles: a lazy `require` or `React.lazy` still puts the module in `index.android.bundle`. It only defers evaluation. The screens are already lazy for startup (see _Lazy Loading Decision_ above).
- **Keeping non-active translations out of the bundle.** Every offered locale is reachable through `import()` in `src/i18n/localeLoaders.ts`, and native Metro bundles every `import()` target. (The locales a store build does not offer at all are a different case and are stubbed out at bundle time, #3150: see `frontend/metro/storeBundle.js`.) Moving translations out would mean downloading them (breaks offline play) or shipping them as native assets read at runtime (new native-asset code path). Not worth it while there's headroom.
- **Minifier `ascii_only: false`.** Would cut ~240 KB from the measured file by writing translations as UTF-8 instead of `\uXXXX` escapes. It doesn't change the Hermes bytecode, so it would only move the metric. If we do it, it should come with measuring real bytecode instead (below).
- **Measure Hermes bytecode in CI** (`expo export:embed --bytecode`, or the `.hbc` from the Gradle build) so the guardrail tracks what ships. The limit would need re-basing (see "Real bytecode" above), which is an owner decision.
- **Icon glyph-map subset** (225 KB). `createIconSet` with only the glyphs we use. Needs every icon name to be static, which is not yet true everywhere.
- **Expo experimental tree shaking** (`EXPO_UNSTABLE_TREE_SHAKING`). Could trim Sentry's tracing code, which we don't use (replay and the web feedback widget are already stubbed by the supported #2832 options), but it changes how every module is bundled and has to be set in the Gradle and Xcode Cloud builds too. Not measured.
- **Deleting hidden-game code from store builds beyond their screens.** #2830 stubs the hidden screens and drops their assets; small shared modules (i18n namespaces, scorecards, the Star Swarm engine reached through shared screens) remain. See _Store build: hidden premium exclusion_ above.
- **Raising the limit.** Not needed now. If it is later, record the owner's approval and the reason here, following _Updating the limit_ below.

### Updating the limit

When a deliberate size increase is approved (e.g. a new game or major feature, or un-hiding premium games), update everything that carries the number, in the same PR as the size-increasing change so reviewers see them together:

1. The `android-bundle-check` flags in `.github/workflows/ci.yml`: `--max-js`, `--warn-js`, `--max-assets` (store step) and `--max-js` (all-games step), plus the budget comment block above them.
2. `frontend/package.json`: the `"bundlesize"` `maxSize` field.
3. `BASELINE_BYTES` and the "Delta vs ... baseline" label in the PR-comment step, and the numbers in this doc.

Record the owner's approval and the reason in the history list above. Un-hiding the premium games removes `metro/storeBundle.js` exclusions for the store build and will fail the 4 MiB assets limit by design (27.4 MiB all-games assets): re-budget deliberately.

### PR comment

Every pull request receives an automated comment from `android-bundle-check` with the store-config JS bundle size, packaged-asset size and file count, each with its limit, and the JS delta vs the 5.55 MiB store baseline (`BASELINE_BYTES=6544825`, 2026-10-10; it was a stale 4.5 MB before #2829). No action is needed unless the delta is large or a hard limit is breached.

For new game additions specifically, the reviewer checklist in [`docs/GAME-CONTRACT.md` — Size Budget](GAME-CONTRACT.md#size-budget) requires the delta to stay ≤ 200 KB.

### WebP icon enforcement

A separate CI gate in `test-frontend` (`assetTransparency.test.ts`) asserts that no raw PNGs exist in non-exempt icon subdirectories under `frontend/assets/`. To convert new PNGs before staging:

```bash
python tools/assets/convert_icons_to_webp.py frontend/assets/fruit-icons
python tools/assets/convert_icons_to_webp.py frontend/assets/celestial-icons
```

**Exempt directories** (must stay PNG, never pass to the script):

- `*-baked/` (`fruits-baked/`, `cosmos-baked/`) — Skia pipeline textures (palette-quantized by `npm run prebuild`, see [ASSETS.md](ASSETS.md#prebuild-optimization))
- `source-icons/` — local pipeline inputs, not bundled

---

## Historical Measurements (2026-04)

The sections from _JS Bundle Baseline_ to _Lazy Loading Decision_ are snapshots from April 2026 (Epic 2a, Expo SDK 55, all games visible, before the WebP conversion, R8 and the store-build exclusion). They are kept for the record. **Do not quote their numbers as current;** use [Store Size: Current Budgets and Measurements](#store-size-current-budgets-and-measurements). Where a finding has since been acted on, the section says so.

---

## JS Bundle Baseline

> **Historical (2026-04-15)** | Epic 2a — Story #527 | Expo SDK 55 / Hermes / Android, all games, pre-WebP | No code changes in this section. Superseded by the current section above.

### Methodology

```bash
cd frontend
npx expo export --platform android --source-maps --output-dir dist-android-sourcemap
# source-map-explorer cannot parse .hbc directly; source map parsed manually for module breakdown
```

The Android export produces a single Hermes bytecode file. Module sizes below are estimated from `sourcesContent` in the accompanying `.hbc.map` source map (13 MB). Sizes reflect unminified source. The April run reported **4.5 MB HBC** shipped on device. That figure is not comparable with later numbers: a 2026-10-10 `hermesc -O -emit-binary` compile of a 7.65 MB minified bundle gave 9.4 MB, and the Gradle build passes different flags. Take Hermes bytecode size from a built APK/IPA (see the native checklist), not from this table.

### Bundle totals

| Component (2026-04-15)                        | Size        |
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

**⚠️ Sentry accounted for ~2.0 MB (24.5%) of summed `sourcesContent`** (2026-04-15 build, 8.3 MB of unminified source text taken from the source map) across eight packages: `@sentry/core`, `@sentry/react-native`, `@sentry-internal/replay`, `@sentry/browser`, `@sentry-internal/browser-utils`, `@sentry/react`, `@sentry-internal/feedback`, `@sentry-internal/replay-canvas`. That 24.5% is a share of raw source-map `sourcesContent`, with that build's SDK version. It is not installed size and not shipped bytes. Current numbers with their denominators are in [Sentry JS cost (#2832)](#sentry-js-cost-2832): on 2026-10-10 Sentry was 18.12% of the minified bundle (16.73% of `sourcesContent`) before, and Replay and the web Feedback widget have since been stubbed out of the bundle. BC Arcade does **not** initialize `Sentry.replayIntegration()`; Session Replay is not an active runtime data flow. In-app feedback uses `Sentry.captureFeedback`, not the web feedback widget. See [FEEDBACK-OBSERVABILITY.md](FEEDBACK-OBSERVABILITY.md).

**`matter-js` (366 KB) is active and expected.** Cascade's native engine (`engine.native.ts`) uses matter-js for polygon body physics on Android and iOS. `@dimforge/rapier2d-compat` (Rapier2D) is the web-only engine — it does **not** appear in the Android bundle. Metro's `.native.ts` platform resolution routes correctly.

**`@dimforge/rapier2d-compat` is absent from the Android bundle.** The `.native.ts` extension on `frontend/src/game/cascade/engine.native.ts` causes Metro to select the native engine (matter-js) on Android. Rapier2D is web-only and adds zero weight to the Android build.

**Pachisi has been removed from the codebase (#550).** All `src/game/pachisi/`, `src/components/pachisi/`, `src/screens/PachisiScreen.tsx`, and backend routes were deleted. The Android bundle is unaffected.

**App code is ~260 KB (~3.1%) of JS.** All five game engines, screens, shared infrastructure, and i18n strings together are a small fraction of the total. JS bundle size is not where the size problem lives — assets are.

**The 74.8 MB of bundled assets dominate.** See [Asset Inventory](#asset-inventory) for breakdown. Converting `fruit-icons/` + `celestial-icons/` (62.9 MB PNG) to WebP was the highest-ROI action available. **Done:** 256 px thumbnails and palette sprites in #2833 (see [Images (#2833)](#images-2833)); the hidden-game assets are also excluded from store builds (#2830).

---

## Build Configuration Baseline

> **Historical (2026-04-15)** | Epic 2a — Story #528 | Sources: `gradle.properties`, `android/app/build.gradle`. **R8 and resource shrinking were OFF in this snapshot and have been ON since #554;** the verified current state is in _Safeguards already in place_ above.

### Configuration as of 2026-04-15

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

### Status of the April recommendations

Resolved or superseded; verified on 2026-10-10.

| April item                                    | Status                                                                                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enable R8 and resource shrinking              | Done (#554): `android.enableMinifyInReleaseBuilds=true`, `android.enableShrinkResourcesInReleaseBuilds=true`                                                                     |
| PNG crunching / WebP conversion               | Crunching still on; WebP and palette re-encode done in #2833; CI test enforces WebP icons                                                                                        |
| ABIs: all four built, Play strips per install | Unchanged and still correct                                                                                                                                                      |
| Table of approximate native library sizes     | Removed: they were estimates from published benchmarks. Real numbers are an owner task, see [Native and Store Artifact Sizes](#native-and-store-artifact-sizes-not-yet-measured) |

---

## Asset Inventory

> **Historical (2026-04-15)** | Epic 2a — Story #529. Sizes, file counts and the "Bundled?" column are as of April, before #2830 and #2833. The current directory map and rules are in [ASSETS.md](ASSETS.md). New games still add their directories here (see [`GAME-CONTRACT.md`](GAME-CONTRACT.md)).

### Directory map

| Directory                                       | Size         | Files    | Bundled?      | Owner / Purpose                                                                                                                                   |
| ----------------------------------------------- | ------------ | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets/source-icons/cosmos/`                   | 85.6 MB      | 12 PNG   | No            | Pipeline input — master source files for `npm run process-assets`. Not imported by app code.                                                      |
| `assets/source-icons/fruits/`                   | 76.8 MB      | 12 PNG   | No            | Pipeline input — same as above.                                                                                                                   |
| `assets/celestial-icons/`                       | 36.8 MB      | 12 PNG   | **Yes**       | Cosmos theme UI icons. Imported in `src/theme/fruitSets.ts`.                                                                                      |
| `assets/fruit-icons/`                           | 26.1 MB      | 12 PNG   | **Yes**       | Fruits theme UI icons. Imported in `src/theme/fruitSets.ts`.                                                                                      |
| `assets/logo.png`                               | 7.1 MB       | 1 PNG    | **Yes**       | App logo. Imported in `src/components/shared/AppHeader.tsx`.                                                                                      |
| `assets/adaptive-icon.png`                      | 7.1 MB       | 1 PNG    | Platform only | Android adaptive icon (`app.json`). Identical file to `logo.png`.                                                                                 |
| `assets/icon.png`                               | 7.1 MB       | 1 PNG    | Platform only | App icon (`app.json`). Identical file to `logo.png`.                                                                                              |
| `assets/cosmos-baked/`                          | 1.2 MB       | 12 PNG   | **Yes**       | Cosmos game pieces (Skia pre-composited). Imported in `src/theme/useFruitImages.ts`.                                                              |
| `assets/fruits-baked/`                          | 1.0 MB       | 12 PNG   | **Yes**       | Fruits game pieces (Skia pre-composited). Imported in `src/theme/useFruitImages.ts`.                                                              |
| `assets/cosmos-vertices.json`                   | 43 KB        | 1 JSON   | **Yes**       | Cascade physics polygon vertices for Cosmos theme.                                                                                                |
| `assets/fruit-vertices.json`                    | 58 KB        | 1 JSON   | **Yes**       | Cascade physics polygon vertices for Fruits theme.                                                                                                |
| `assets/*.png` (Android icons, splash, favicon) | ~0.2 MB      | 4 PNG    | Platform only | App store / launcher assets.                                                                                                                      |
| Hearts                                          | —            | —        | No            | No dedicated asset directory — lobby card uses Unicode ♥ emoji; all card rendering is programmatic.                                               |
| `src/game/sudoku/puzzles.json`                  | ~261 KB      | 1 JSON   | **Yes**       | Sudoku puzzle bank — 3 000 unique-solution puzzles (1 000 per difficulty). ~60 KB gzipped over the wire. Imported by `src/game/sudoku/engine.ts`. |
| Sudoku (lobby card)                             | —            | —        | No            | No dedicated asset directory — lobby card uses Unicode 🧩 emoji; the board and cells are programmatic.                                            |
| **Repo total**                                  | **249.1 MB** | 83 files |               |                                                                                                                                                   |
| **Bundled game assets**                         | **~72 MB**   |          |               | `celestial-icons` + `fruit-icons` + `logo` + `*-baked` + JSON                                                                                     |
| **Not bundled (pipeline inputs)**               | **162.4 MB** |          |               | `source-icons/` — needed locally, not shipped                                                                                                     |

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
| **UI icons** (large, April)   | `fruit-icons/`, `celestial-icons/` | 62.9 MB | `fruitSets.ts` — theme selector, previews |
| **Baked game pieces** (small) | `fruits-baked/`, `cosmos-baked/`   | 2.2 MB  | `useFruitImages.ts` — in-game Skia canvas |

Since #2833 the UI icon tier is 256 px thumbnails and the baked tier is palette PNG; see [Images (#2833)](#images-2833).

### Findings and flags for Epic 2b (status as of 2026-10-10)

| #   | April finding                                                                                 | Status                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `celestial-icons/` + `fruit-icons/` = 62.9 MB of large PNGs bundled                           | Done. WebP (earlier) and 256 px thumbnails (#2833); the 24 bundled-icon files are now about 0.62 MB. Full-resolution masters moved to `cascade_icon_masters/` |
| 2   | `source-icons/` lives under `frontend/assets/`                                                | Not bundled (Metro ignores unreferenced files). Pipeline inputs and their location are described in [ASSETS.md](ASSETS.md#directory-map)                      |
| 3   | `adaptive-icon.png`, `icon.png`, `logo.png` are identical 7.1 MB files; `logo.png` is bundled | The store bundle now packages `logo.png` at 37.6 KB (2026-10-10). `icon.png` (491 KB) and `adaptive-icon.png` are platform-only                               |
| 4   | `pumpkin` and `milkyway` are imported but unused (~6.7 MB)                                    | Done in #2833: no longer imported in `src/game/cascade/images.ts`                                                                                             |
| 5   | `cosmos-baked/milkyway.png` referenced?                                                       | Moot; same change as 4                                                                                                                                        |

### Not orphaned (corrects Epic 2a assumption)

The epic listed `/celestial_images/` as "suspected dead weight." Investigation found:

- The actual paths are `celestial-icons/` and `cosmos-baked/` (not `celestial_images/`).
- Both are actively imported and in use.
- A third set (`source-icons/cosmos/`) is the pipeline input — intentional and necessary locally.

---

## Per-Game Size Budget, Standalone Criteria, and Pachisi Decision

> **Epic 2a — Story #530** | Authored: 2026-04-15 | The per-game budget and standalone criteria are **current policy**. The "Baseline recap" and Cascade numbers are April snapshots.

### Baseline recap (2026-04-15, historical)

| Metric (2026-04-15)                  | Measured value                                 |
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

**Update (2026-10-10, #2833).** Cascade's bundled images are now 1,292,783 B across 44 files (the April "~65 MB" and "~10–15 MB target" are superseded), and Cascade is a hidden game, so none of it ships in a store build today (#2830). JS and audio were not re-assessed against this budget.

### Audio strategy

The April placeholder here assumed no game had offline audio. That is no longer true: the all-games build packages 45 sounds (22,211 KB on 2026-10-10), of which the store build keeps 19 SFX files (567.0 KB). BGM format, bitrate, per-track budgets and engine choice are owned by epic #1779 and #1787 and the budgets live in [ASSETS.md](ASSETS.md#size-budgets). The standalone-app audio threshold below (> 3 MB game-specific audio) still applies to new games.

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

> **Epic 2a — Story #557** | Implemented: 2026-04-18 | Expo SDK 55 / Hermes / Android + iOS. The decision stands. The measurement instructions in the original write-up referred to a `[cold-start] HomeScreen ready` log line that **no longer exists**; they were replaced on 2026-10-10 by [Startup, navigation, and runtime (#2834)](#startup-navigation-and-runtime-2834).

### Methodology

The JS-side start time is captured in `src/utils/appTiming.ts` at module load (the earliest reachable JS timestamp). `HomeScreen` reports the delta to its first `useEffect` as the Sentry distribution `cold_start_ms`; it no longer writes a log line, so `adb logcat | grep cold-start` and the Xcode Console filter find nothing. The commands to measure cold start, navigation and memory on release builds (Android and iOS), and the A/B protocol, are in [Startup, navigation, and runtime (#2834)](#device-profiling-procedure). Local release builds need `-PALLOW_DEBUG_SIGNED_RELEASE=true` and are debug-signed: never upload or distribute them ([ANDROID-CI.md](ANDROID-CI.md)).

### Measurements

Cold-start timing via `performance.now()` instrumentation (`src/utils/appTiming.ts` + `HomeScreen` `useEffect`) was not capturable in the Expo Go dev-server environment (April 2026): Metro's own `lazy=true` bundle splitting loads `appTiming.ts` as a deferred chunk, so the timestamp is not set before `HomeScreen` mounts. The instrumentation is correct for a production build. No device numbers have been captured since either (still TBD, see the baseline table in the Startup section).

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
- **Follow-up (still open, now measurable):** verify the stack-screen spinner finding on a release build. `screen_mount_ms{screen}` and the tap-to-commit steps in the profiling procedure cover it; no device run has been done.

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
whole `Enemy` objects (`{ ...enemy, … }`) in `tickFormation` and the `tickEnemies` per-ship map
(both in `engine/enemies.ts` since the #2988 split): about half of the self time under V8. That
is the next thing to look at.

The #2988 split itself is performance-neutral: the `Tuning` parameter is one object threaded
through the sub-ticks (no per-tick allocation), and the identity-preserving passes above are
unchanged (`mapKeep` / `mapFilterKeep` live in `engine/roster.ts`). An interleaved A/B of the
same benchmark (three rounds, `dev`'s `engine.ts` swapped in and out on the same loaded
container) measured 929–1022 µs/tick before the split and 824–892 µs/tick after it, with the GC
pass count unchanged (179 vs 179–180); on the idle container `dev` measured 632–721 µs/tick.

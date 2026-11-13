# Maestro

Maestro runs smoke tests against the **native** Android and iOS builds. It covers what Playwright structurally cannot: native rendering, touch input, device navigation, and offline mode. Game logic, scoring, and edge cases are covered by Playwright and backend unit tests.

> **Status (2026-11-03).** Work restarted after v1.0 (plan on #3175). Both legs run on PRs into `dev` and `main` again: Android (#2400) and iOS (#2347). Neither is a required check yet (#2153 / #1902). Neither runs on push to `main`: Render's prod deploy waits for every check on the commit, so a red smoke check there would block deploys.

## Prerequisites

Install the Maestro CLI once. CI pins **v1.39.13** for Android and **v2.12.1** for iOS (1.39.13's XCTest driver predates Xcode 26 / iOS 26, the only simulators on the `macos-26` runner) — match the leg you are debugging to avoid behaviour differences:

```bash
export MAESTRO_VERSION=1.39.13
curl -Ls "https://get.maestro.mobile.dev" | bash
```

Or via Homebrew (may trail the pinned version):

```bash
brew tap mobile-dev-inc/tap
brew install maestro
```

Verify: `maestro --version`

You also need a running device or simulator/emulator before executing any flow. **Build and start the app with `EXPO_PUBLIC_TEST_HOOKS=1` set** — e.g. `EXPO_PUBLIC_TEST_HOOKS=1 npx expo run:ios` / `run:android` from `frontend/`. Without it, Solitaire/FreeCell deal random boards (drag.yaml's fixed-deal assertions will fail) and Solitaire shows the draw-mode picker modal that no flow taps through (see [`e2e/maestro/README.md`](../e2e/maestro/README.md#pre-game-selectors)).

## Running flows

```bash
# Single flow
maestro test e2e/maestro/flows/yacht/smoke.yaml

# All flows in one game directory
maestro test e2e/maestro/flows/yacht/

# All game flows (excludes _shared/, which contains subflows not meant to run standalone)
maestro test $(find e2e/maestro/flows -name "*.yaml" ! -path "*/_shared/*")
```

See [`e2e/maestro/README.md`](../e2e/maestro/README.md) for flow authoring details, shared subflow usage, pre-game selectors, and the offline flow.

## CI behaviour

| | Android | iOS |
|---|---|---|
| Runner | `ubuntu-latest` | `macos-26`, newest installed Xcode 26.x (the image default). `macos-15`'s Xcode 26.3 fails to compile expo-modules-core in Swift 6 mode (#2347) |
| App build | `assembleDebug` with the JS bundle forced in (see "Debug builds skip JS bundling" in [ANDROID-CI.md](ANDROID-CI.md)) | **Release** simulator build (`-configuration Release -sdk iphonesimulator`, unsigned): embeds a production bundle and leaves out expo-dev-client. A Debug build's embedded dev bundle RedBoxes ("Cannot create devtools websocket connections in embedded environments", #2347) |
| Device | API 34 emulator (Pixel 6, x86_64) | iPhone simulator picked at run time by `tools/ios_sim/pick_ios_simulator.py`: newest iOS 26.x runtime (`PREFERRED_IOS_MAJOR`), else the newest runtime with a warning; base-model iPhone preferred, created if the runtime has none |
| Maestro CLI | 1.39.13 (action default) | 2.12.1 (iOS-only `version:` input; 2.0.4+ supports Xcode 26) |
| Trigger | PRs into `dev`/`main` (scoped, see below; draft PRs skipped until marked ready), manual `workflow_dispatch` and a weekly `schedule` on `dev` (Mondays 09:23 UTC; both full suite, or a dispatch with `flows: cascade-demo` / `flows: mahjong-demo` for the [Cascade demos](#cascade-demo-flows-3705) / [Mahjong demos](#mahjong-demo-flows-3801)) — **not** push to `main` (removed 2026-09-23: a red check blocked prod deploys) | PRs into `main` (full suite); PRs into `dev` **only when they change a native/iOS path** (see below, #3547); `workflow_dispatch` and a weekly `schedule` on `dev` (Mondays 10:41 UTC; both full suite, or a dispatch with `flows: cascade-demo` / `flows: mahjong-demo`) — **not** push to `main` |
| Timeout | 60 min | 120 min |
| Before the flows | Pre-downloads the emulator system image, retrying a corrupt download (#3705) | Warm-up: launches the app once and waits for Home (#3677, see below) |
| Offline flow | ✅ included | ❌ excluded (requires `toggleAirplaneMode`, Android-only) |

Both jobs write a Markdown pass/fail table to the GitHub Actions job summary and upload these artifacts:

| Artifact | When | Kept | Contents |
|---|---|---|---|
| `maestro-{android,ios}-results` | always | 7 days | JUnit reports, `maestro-debug/` (logs, `commands-*.json`, hierarchies), `~/.maestro/tests/` |
| `maestro-{android,ios}-media` | always, **pass or fail** (#3705) | 14 days | every named `takeScreenshot` (`<name>.png`) and `startRecording` video (`<name>.mp4`) |
| `maestro-{android,ios}-screenshots` | only when a flow fails | 7 days | failure screenshots (iOS also `xcodebuild.log`) |

Where the files are, by platform:

- **Android** (Maestro 1.39.13): in the working directory, so at the artifact's top level as `<name>.png` / `<name>.mp4`.
- **iOS** (Maestro 2.12.1, run with `--debug-output maestro-debug/<dir> --flatten-debug-output`): in each flow's debug bundle, `maestro-debug/<dir>/<flow>/takeScreenshot/<name>.png` and `maestro-debug/<dir>/<flow>/startRecording/<name>.mp4`, kept at those paths in the artifact.

In a `flows: cascade-demo` or `flows: mahjong-demo` dispatch the upload fails the job if it finds no media; on every other run an empty upload is ignored. The media artifact costs artifact storage only, bounded by its retention. To fetch it: Actions → the run → **Artifacts**, or `gh run download <run-id> -n maestro-android-media`.

### Android: emulator image download

`reactivecircus/android-emulator-runner` downloads the API 34 `google_apis` x86_64 system image itself, and a corrupt download ("Error reading Zip content from a SeekableByteChannel", #3668 and #3674) still exits 0, so the emulator then fails to boot. The step "Download the emulator system image (retried)" installs it first with `sdkmanager`, checks that `package.xml` and `system.img` are on disk, and retries a bad download from scratch, up to 3 times. The emulator step then finds the image installed. It is retried, not cached: the image is about 1.5 GB of the repo's 10 GB cache quota.

### iOS: warm-up before the first flow (#3677)

The first flow of every iOS run was the slowest by far. In every full run from 2026-11-03 to 2026-11-09, `blackjack/smoke` (always first) took 1m31s to 3m05s, while `cascade/smoke` right after it took 50s to 1m45s. In run 42629193406 it failed: one tap's screenshot took about 10 s, so `navigate-to.yaml`'s 10 s `screenLabel` wait got too few hierarchy polls. The failure-time hierarchy already showed the Blackjack screen (its header and table picker), so the screen did mount: the cost was the cold simulator, not Blackjack.

So the job runs `e2e/maestro/flows/_shared/warm-up.yaml` once, after installing the app and before the per-game loop: it launches the app with clean state and waits for the Home grid. It opens no game, so a game screen that is really slow to mount still fails its own flow, and no timeout was raised. It is not a test (no report, no summary row) and not fatal: if the app can't reach Home, every flow fails next and says so. It costs about 2 minutes (one more Maestro driver start plus one app launch). Its logs are in `maestro-debug/_warm-up`.

### Cascade demo flows (#3705)

Visual and audio stories must show the owner the change running on iOS and Android before they merge ([`design-review.md`](../.claude/skills/ship-story/references/design-review.md), Step 2). Cloud sessions have no emulator or simulator, so the demos come from CI. `e2e/maestro/flows/cascade/` has demo flows next to `smoke.yaml`:

| Flow | Shows | Screenshots (`.png`) | Video (`.mp4`) |
|---|---|---|---|
| `demo-open.yaml` | Home → Cascade board | `cascade-demo-open` | `cascade-demo-open` |
| `demo-drop.yaml` | one drop down the middle | `cascade-demo-drop-before`, `cascade-demo-drop-after` | `cascade-demo-drop` |
| `demo-merge.yaml` | drops until the score container (`cascade-score`, label "Score: N") leaves 0, i.e. a merge | `cascade-demo-merge-before`, `cascade-demo-merge-after` | `cascade-demo-merge` |
| `demo-chain.yaml` | `cascade-test-chain`, then two drops: a chain of 3 merges (14 points; score check "Score: ≥10") | `cascade-demo-chain-before`, `cascade-demo-chain-after` | `cascade-demo-chain` |
| `demo-danger.yaml` | `cascade-test-near-lid`: the spawner's clock ring draining, then the lid ends the game | `cascade-demo-danger-ring`, `cascade-demo-danger-result` | `cascade-demo-danger` |
| `demo-loss.yaml` | `cascade-test-fill-bin`: the lid rule ends the game, then the result card (`cascade-result-title`) | `cascade-demo-loss-before`, `cascade-demo-loss-filled`, `cascade-demo-loss-result` | `cascade-demo-loss` |

#### Test controls (#3719)

Maestro cannot call the app's `__cascade_*` hooks (`game/cascade/testHooks.ts`): they live on the app's JavaScript `globalThis`, and Maestro's `runScript`/`evalScript` run in Maestro's own engine on the host. So the Cascade screen shows a small, faint row of buttons under the board (`components/cascade/CascadeTestControls.tsx`) **only when `EXPO_PUBLIC_TEST_HOOKS=1`**. One row of four buttons, not a menu: each is one `tapOn`, and an open menu would need a second tap and a wait. Each runs a set-up that restores a pile into the real engine (`cascadeSetup` in `testHooks.ts`), so the engine's rules play out; the same set-ups are hooks too (`__cascade_setupChain`, `__cascade_setupNearLid`, `__cascade_fillBin`, `__cascade_seedQueue(tiers)`) for Playwright.

| testID | Set-up | What follows |
|---|---|---|
| `cascade-test-chain` | tiers 1, 2, 3 side by side on the floor; queue scripted as cherries | two taps on the board make 3 merges (holds for a drop within 3 px of the middle) |
| `cascade-test-near-lid` | a capstone, a tier 10 and a tier 9 stacked over the lid, then 1.5 s simulated (past the restore grace) | the ring drains and the lid ends the game about 2.5 s later |
| `cascade-test-fill-bin` | that tower plus a second tower, both over the lid | the lid ends the game about 4 s after (overflow rule; nothing is forced) |
| `cascade-test-game-over` | none: forces the result card | an extra, not used by the demos |

Win set-up is blocked on #3699: `testHooks.ts` has a marked TODO for `setupWin` and the component for a `cascade-test-win` button; there is no UI yet.

Store builds: the Cascade screen resolves to an empty stub in a store bundle (`metro/storeBundle.js`, #2830), so the controls and set-ups are not in it. The control also checks the flag itself. `storeBundle.test.ts` pins both the stub and that only `CascadeScreen` imports them; `CascadeScreen.hooks.test.tsx` pins that the buttons are absent without the flag.

#### Artifact size cap (#3719)

Both smoke workflows run `e2e/maestro/cap_media.py` before the uploads: any `.mp4`/`.png` over `MAX_MEDIA_MB` (100) in the workspace root, `maestro-debug/` or (Android) `~/.maestro/tests/` is deleted and a `::warning::` annotation names it. The cap is per file and drops the file rather than failing the run: a demo's other screenshots and videos still arrive, and the warning says what is missing. It is a cap on size, not on recording time: Maestro has no recording time limit, and Android's recorder stops at 3 minutes by itself. A normal demo video is a few MB, so 100 MB leaves wide headroom.

Not covered yet, and why:

- **Win**: Cascade has no win state yet (#3699). Add `demo-win.yaml` and the `cascade-test-win` control with it.
- **Chain sensitivity**: the chain depends on the first cherry landing within about 3 px of the middle; a tap lands there give or take 1 px. If the layout changes, re-check `testSetups.test.ts`.
- **Not run on a device yet**: the three flows and the controls were written without Maestro; the first dispatch of `flows: cascade-demo` after #3719 merges is their first run.

The demo flows are tagged `demo` (`tags: [demo]` in each file's header). Every PR, weekly and full run passes `--exclude-tags=demo`, so they never slow down or break the smoke suite. To run **only** them, dispatch either smoke workflow with `flows: cascade-demo`:

```bash
# On the PR's branch; runs only cascade/demo-*.yaml, records video, uploads maestro-<platform>-media
gh workflow run mobile-smoke-android.yml --ref <branch> -f flows=cascade-demo
gh workflow run mobile-smoke-ios.yml --ref <branch> -f flows=cascade-demo
# Then find the run and download the media:
gh run list --workflow mobile-smoke-android.yml --event workflow_dispatch --branch <branch> -L 1
gh run download <run-id> -n maestro-android-media
```

Or in the GitHub UI: Actions → **Mobile Smoke — Android** (or **— iOS**) → **Run workflow** → pick the branch and `cascade-demo`. A dispatched run is not attached to the PR's checks, so it neither gates nor replaces the PR's own smoke run. It uses the workflow file **on that branch**, so the branch needs this change (from `dev` on).

Expected run time (from the 2026-11-12 run, before `demo-chain`, `demo-danger` and `demo-loss`; each adds about 30 to 60 s): Android about 15 minutes (setup and APK build about 10, emulator boot about 3, the three demos about 2). iOS about 40 to 55 minutes (setup, CocoaPods and the Release build about 27, warm-up about 2, the demos about 3). Android's screen recorder stops at 3 minutes, so a demo that runs longer loses the end of its video; keep each demo well under that.

Can a Claude session start the dispatch? Unverified (the 2026-11-12 dispatches were started by the owner). The session's GitHub integration got 403 "Resource not accessible by integration" when re-running jobs (#3674); a dispatch needs the same `actions: write` access, so expect the same until it has been tried. If it fails, the owner starts the run (command or UI above) and the design-review demo step says so.

To add demo flows for another game: tag them `demo`, add a `flows` option to both workflows' `workflow_dispatch` input, and a matching case in `detect-maestro-scope.yml`'s `scope` step. Mahjong's are below (#3801).

### Mahjong demo flows (#3801)

Mahjong's real look on iOS and Android can't be seen from a cloud session, so the faded and blurry tile reports (#3684) can't be reproduced or checked there. `e2e/maestro/flows/mahjong/` has demo flows next to `smoke.yaml`, which they leave untouched (its `mahjong-smoke` screenshot is taken after a hint tap, so a glow is in the frame):

| Flow | Shows | Screenshots (`.png`) | Video (`.mp4`) |
|---|---|---|---|
| `demo-open.yaml` | Home → Mahjong, Turtle layout, the untouched board (no hint, no tile tap), three shots about 5 s, 15 s and 25 s after the board shows | `mahjong-demo-open`, `mahjong-demo-open-late`, `mahjong-demo-open-late2` | `mahjong-demo-open` |
| `demo-zoom.yaml` | the same board, then a double-tap on the board viewport (`mahjong-board-viewport`), to show the tiles' crispness zoomed in | `mahjong-demo-zoom` | `mahjong-demo-zoom` |

Both use the shared subflow `_shared/open-mahjong.yaml` (the same steps as `smoke.yaml`: `navigate-to.yaml` for the hidden game, tap `mahjong-layout-turtle` if the picker shows, wait for `mahjong-board-viewport`). They are tagged `demo`, so every other run leaves them out (`--exclude-tags=demo`). Dispatch either workflow with `flows: mahjong-demo` to run only `mahjong/demo-*.yaml` (`--include-tags=demo`, whatever changed):

```bash
# On the branch to look at; records video, uploads maestro-<platform>-media
gh workflow run mobile-smoke-android.yml --ref <branch> -f flows=mahjong-demo
gh workflow run mobile-smoke-ios.yml --ref <branch> -f flows=mahjong-demo
# Then find the run and download the media:
gh run list --workflow mobile-smoke-android.yml --event workflow_dispatch --branch <branch> -L 1
gh run download <run-id> -n maestro-android-media
```

As for Cascade, the upload fails the job if it finds no media, a dispatched run is not attached to the PR's checks, and it uses the workflow file on that branch (so the branch needs this change, from `dev` on). Each flow is a handful of steps, so it is expected to stay far inside Android's 3-minute recorder limit (not yet measured: the flows have never run on a device).

Notes:

- **The zoom tap.** The board zooms on `Gesture.Tap().numberOfTaps(2)` (`game/mahjong/useBoardZoomPan.ts`, "Board camera" in [`games/mahjong.md`](games/mahjong.md)); from the fitted view it zooms to readable tiles centred on the tap. On a 390 x 844 phone Turtle fits at about 25.6 px a tile (`games/mahjong.md`, `zoom.test.ts`), above the 24 px opening-zoom threshold, so it should open fitted and the double-tap zooms in. If a device opened Turtle already zoomed in, the double-tap would zoom out instead (`zoomAt` toggles); the compare-with-`mahjong-demo-open` fallback below covers that too. `doubleTapOn` with the viewport's testID taps its centre, a point Maestro resolves the same way on both platforms. A tile under the tap is selected too (the second tap of a double-tap keeps it selected), so the zoomed frame may show one selected tile.
- **Random deal.** The deal is random (no seed hook is reachable from Maestro, see the Cascade notes), so the tiles differ per run. The look of the tiles (faded, blurry) does not depend on the deal.
- **Three open shots.** The first Android run (run 43454289761) showed suit-colour fallback blocks instead of tile faces at the default zoom, with real faces after a double-tap. The tile faces rasterise after the commit on a timer (`tileFaces.ts`), so the blocks may be a transient or permanent. `demo-open.yaml` photographs the board three times to tell them apart: if `-late` and `-late2` show faces, the blocks were transient; if they still show blocks, they are permanent. Maestro has no sleep command and `waitForAnimationToEnd` returns once the screen is still, so each pause is an `extendedWaitUntil` on an id that never exists with `optional: true`, which runs its full timeout and then continues (not yet verified on a device). The flow takes about 30 s, well under the 3-minute recorder limit.
- **Not run locally.** These flows were written without a device; the first dispatch is their first run. If the double-tap misses (the camera did not move), the screenshot shows the fitted board, so compare it with `mahjong-demo-open`.
- **Web counterparts.** `e2e/tests/mahjong-demo-shots.spec.ts` (Playwright, #3804) takes `mahjong-demo-open.png` and `mahjong-demo-zoom.png` on the web build, from the fixed `E2E_DEAL_SEED` deal (#3803; the Maestro notes above predate it), so web (Canvas2D) can be compared side by side with iOS/Android (Skia). They are in the `playwright-report` artifact of the `Playwright E2E` job, under `e2e/test-results/mahjong-demo/`. See [TESTING.md, "Mahjong web demo screenshots"](TESTING.md).

### Scoped runs on PRs

> **Live on both legs** (Android since #2400, iOS since #2347).
>
> **Weekly run and caches.** PR runs only restore the caches (Android: Gradle and Metro, `cache-read-only` on `pull_request`; iOS: CocoaPods, `actions/cache/restore`); the weekly `schedule` run on `dev`, the default branch, writes them, because GitHub only shares default-branch cache entries with every PR. Android runs Mondays 09:23 UTC, iOS Mondays 10:41 UTC. That run also gives a full-suite signal each week. It is attached to no PR and no `main` commit, so it never gates a merge or a Render deploy.

A shared `detect-maestro-scope.yml` reusable workflow (mirrors `detect-e2e-scope` in `ci.yml`, adapted to Maestro's directory-per-game layout) decides which flow directories actually run. Its path table is `.github/paths/game-paths.yml`, shared with Playwright. Each leg calls it with a `platform` input (`android`, the default, or `ios`). The rules, in order:

1. A **`workflow_dispatch` with `flows: cascade-demo` or `flows: mahjong-demo`** → only that game's demo flows (`cascade/` or `mahjong/` with `--include-tags=demo`), whatever changed. See [Cascade demo flows](#cascade-demo-flows-3705) and [Mahjong demo flows](#mahjong-demo-flows-3801). Every other run leaves the `demo`-tagged flows out.
2. **Push to `main`** (no push trigger today), a **manual `workflow_dispatch`** (`flows: full`, the default), the **weekly `schedule`**, or a **PR targeting `main`** → full suite on **both** legs. Every dev→main release PR runs the full suite on Android and iOS; that is the release gate.
3. **iOS leg, PR into `dev`** (#3547): runs only when the PR changes a `native_ios` path: `frontend/ios/**`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/app.json`, `frontend/app.config.*`, `.github/workflows/mobile-smoke-ios.yml` or `tools/ios_sim/**`. Otherwise `projects` is empty, the `Maestro iOS smoke` job is skipped (about 77 min saved), and the detect job's summary says `iOS skipped: no native/iOS change (runs on release PRs, native changes, weekly)`. JS-only game changes are covered by the Android leg. A native change that passes this gate continues with rules 4 and 5; if it matches no game (a pod or native dependency bump), iOS runs the full suite instead of nothing.
4. **A full-suite path** → full suite. Two keys in the path table (#3546):
   - `shared_app`: app-wide files (`frontend/App.tsx`, `frontend/app.json`, `frontend/src/theme/**`, `OfflineBanner`, `LanguageSwitcher`, `backend/main.py`). Playwright's `shared` includes it by YAML anchor.
   - `maestro_shared`: `frontend/src/game/_shared/**`, `e2e/maestro/**`, `tools/ios_sim/**`, the i18n runtime code (`frontend/src/i18n/*.ts`/`*.js`), Maestro's own workflows (`mobile-smoke-android.yml`, `mobile-smoke-ios.yml`, `detect-maestro-scope.yml`), the composite actions they use (`.github/actions/setup-frontend/**`, `.github/actions/maestro-install/**`), `.github/paths/**`, and the **English** locale files the flows assert text from (`locales/en/common.json` plus each game's `locales/en/<game>.json`, for its `game.title`; the comments in `game-paths.yml` list which flow needs each).
   - Not full-suite triggers any more: other workflow or action edits (Playwright-only, Render-only, policy), non-English locale files, and English namespaces no flow asserts on (`stats`, `profile`, `leaderboard`, …). Those run no Maestro flows. A new text assertion on another namespace must add its `en` file to `maestro_shared`.
5. **PR into `dev`** touching only specific games → only those games' flow directories run, plus `home` (always included — cheap, catches nav regressions). `offline/` only ever runs as part of the full suite.
6. A PR touching nothing Maestro-relevant (backend-only, docs-only) skips the job entirely — no emulator/simulator boot.

The job summary heading includes the resolved scope, e.g. `Maestro Android Smoke (selective: home solitaire freecell)`.

### Deterministic deals in test builds

Both mobile-smoke workflows build with `EXPO_PUBLIC_TEST_HOOKS=1` (same flag Playwright's web build uses). Solitaire and FreeCell read that flag to always deal a **fixed seed** instead of a random one — see `pickSeed()`/`isTestBuild()` in `frontend/src/game/solitaire/engine.ts` and `frontend/src/game/freecell/engine.ts`, and the layout comments at the top of `e2e/maestro/flows/{solitaire,freecell}/drag.yaml`. That lets those flows assert exact before/after board state instead of "either outcome is fine". Solitaire's draw-mode picker modal is also skipped in test builds (auto-deals draw-1) since Maestro has no reliable way to tap a locale-dependent modal button.

Mahjong does the same (#3803): under the flag `drawDealSeed()` in `frontend/src/game/mahjong/engine.ts` returns the one fixed seed `E2E_DEAL_SEED` for **every layout**, so Maestro and Playwright screenshots of a given layout always show the same tiles. The engine deals solvable boards by construction, so the fixed board always has free pairs. Store builds are unchanged (random seed). The seed is still the one recorded in `game_started`. Only the opening is fixed: a Shuffle press still draws from the engine's RNG, so a screenshot taken after a shuffle is not repeatable.

For draw-3, `solitaire/drag-draw3.yaml` taps the test-build-only button `solitaire-test-deal-draw3`, which deals the fixed draw-3 game (seed 3). The drag flows also assert the drag debug overlay's `drag-check: ok` after every swipe (#3532). Both are described in [`docs/TESTING.md`](TESTING.md#drag-invariant-flows-maestro-3532).

### Estimated cost

| Platform | Runner cost |
|---|---|
| Android | ~$0.52 / month |
| iOS | ~$6.40 / month |

iOS is ~12× more expensive due to the macOS runner rate (minutes are not billed while the repo is public). Keep iOS flows as lean smoke tests.

## Playwright / Maestro boundary

| Concern | Tool | Why |
|---|---|---|
| Game logic (scoring, state machines, edge cases) | Playwright | Runs in Expo Web; fast, deterministic, no device needed |
| UI component rendering, accessible labels | Playwright | DOM-queryable; fast CI on `ubuntu-latest` |
| Native touch, swipe, hold gestures | Maestro | Playwright cannot drive native gesture recognisers |
| Native navigation (tab bar, back gesture) | Maestro | React Navigation native driver not exercisable by Playwright |
| Offline mode (`toggleAirplaneMode`) | Maestro (Android) | Requires OS-level network control |
| App launch on real/simulated device | Maestro | Verifies the native bundle boots and renders the home screen |
| Backend API, scoring submission | Backend tests | FastAPI `TestClient`; no browser or device needed |

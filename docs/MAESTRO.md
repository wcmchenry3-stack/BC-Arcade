# Maestro

Maestro runs smoke tests against the **native** Android and iOS builds. It covers what Playwright structurally cannot: native rendering, touch input, device navigation, and offline mode. Game logic, scoring, and edge cases are covered by Playwright and backend unit tests.

> **Restarted 2026-11-03 (#3175).** The work paused on 2026-09-26 for v1.0 has resumed with the iOS leg (#2347) and the Android leg (#2400). The iOS leg runs on PRs into `dev`/`main`; see [CI behaviour](#ci-behaviour) for each leg's current triggers. Neither runs on push to `main`, so a red run never blocks a prod deploy. Native behaviour is still also checked by hand on TestFlight and Play builds.

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
| Trigger | manual `workflow_dispatch` only (full suite) — **not** PRs (#2400), **not** push to `main` (removed 2026-09-23: a red check blocked prod deploys) | PRs into `dev`/`main`, skipped while the PR is a draft (scoped by `detect-maestro-scope`); weekly `schedule` on `dev`, Mon 10:41 UTC (full suite; refreshes the CocoaPods cache that PR runs only read); manual `workflow_dispatch` (full suite) — **not** push to `main` (a red check blocks Render's prod deploy) |
| Timeout | 60 min | 90 min |
| Offline flow | ✅ included | ❌ excluded (requires `toggleAirplaneMode`, Android-only) |

Both jobs write a Markdown pass/fail table to the GitHub Actions job summary and upload a `maestro-{android,ios}-results` artifact (7-day retention). Failure screenshots are uploaded as a separate `maestro-{android,ios}-screenshots` artifact when any flow fails.

### Scoped runs on PRs

> **iOS only for now.** `mobile-smoke-ios.yml` runs on `pull_request` again (#2347); `mobile-smoke-android.yml` is still `workflow_dispatch` only until #2400 re-adds its trigger, so for Android only the full-suite rule below is live.

A shared `detect-maestro-scope.yml` reusable workflow (mirrors `detect-e2e-scope` in `ci.yml`, adapted to Maestro's directory-per-game layout) decides which flow directories actually run:

- **Push to `main`**, a **manual `workflow_dispatch`**, a **PR targeting `main`**, or a change to a shared/infra path (`frontend/src/theme/**`, `frontend/src/game/_shared/**`, `e2e/maestro/**`, `.github/workflows/**`, etc.) → full suite, same as before.
- **PR into `dev`** touching only specific games → only those games' flow directories run, plus `home` (always included — cheap, catches nav regressions). `offline/` only ever runs as part of the full suite.
- A PR touching nothing Maestro-relevant (backend-only, docs-only) skips the job entirely — no emulator/simulator boot.

The job summary heading includes the resolved scope, e.g. `Maestro Android Smoke (selective: home solitaire freecell)`.

### Deterministic deals in test builds

Both mobile-smoke workflows build with `EXPO_PUBLIC_TEST_HOOKS=1` (same flag Playwright's web build uses). Solitaire and FreeCell read that flag to always deal a **fixed seed** instead of a random one — see `pickSeed()`/`isTestBuild()` in `frontend/src/game/solitaire/engine.ts` and `frontend/src/game/freecell/engine.ts`, and the layout comments at the top of `e2e/maestro/flows/{solitaire,freecell}/drag.yaml`. That lets those flows assert exact before/after board state instead of "either outcome is fine". Solitaire's draw-mode picker modal is also skipped in test builds (auto-deals draw-1) since Maestro has no reliable way to tap a locale-dependent modal button.

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

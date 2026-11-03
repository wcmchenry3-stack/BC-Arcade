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
| Trigger | PRs into `dev`/`main` (scoped, see below; draft PRs skipped until marked ready), manual `workflow_dispatch` and a weekly `schedule` on `dev` (Mondays 09:23 UTC; both full suite) — **not** push to `main` (removed 2026-09-23: a red check blocked prod deploys) | PRs into `main` (full suite); PRs into `dev` **only when they change a native/iOS path** (see below, #3547); `workflow_dispatch` and a weekly `schedule` on `dev` (Mondays 10:41 UTC; both full suite) — **not** push to `main` |
| Timeout | 60 min | 90 min |
| Offline flow | ✅ included | ❌ excluded (requires `toggleAirplaneMode`, Android-only) |

Both jobs write a Markdown pass/fail table to the GitHub Actions job summary and upload a `maestro-{android,ios}-results` artifact (7-day retention). Failure screenshots are uploaded as a separate `maestro-{android,ios}-screenshots` artifact when any flow fails.

### Scoped runs on PRs

> **Live on both legs** (Android since #2400, iOS since #2347).
>
> **Weekly run and caches.** PR runs only restore the caches (Android: Gradle and Metro, `cache-read-only` on `pull_request`; iOS: CocoaPods, `actions/cache/restore`); the weekly `schedule` run on `dev`, the default branch, writes them, because GitHub only shares default-branch cache entries with every PR. Android runs Mondays 09:23 UTC, iOS Mondays 10:41 UTC. That run also gives a full-suite signal each week. It is attached to no PR and no `main` commit, so it never gates a merge or a Render deploy.

A shared `detect-maestro-scope.yml` reusable workflow (mirrors `detect-e2e-scope` in `ci.yml`, adapted to Maestro's directory-per-game layout) decides which flow directories actually run. Its path table is `.github/paths/game-paths.yml`, shared with Playwright. Each leg calls it with a `platform` input (`android`, the default, or `ios`). The rules, in order:

1. **Push to `main`** (no push trigger today), a **manual `workflow_dispatch`**, the **weekly `schedule`**, or a **PR targeting `main`** → full suite on **both** legs. Every dev→main release PR runs the full suite on Android and iOS; that is the release gate.
2. **iOS leg, PR into `dev`** (#3547): runs only when the PR changes a `native_ios` path: `frontend/ios/**`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/app.json`, `frontend/app.config.*`, `.github/workflows/mobile-smoke-ios.yml` or `tools/ios_sim/**`. Otherwise `projects` is empty, the `Maestro iOS smoke` job is skipped (about 77 min saved), and the detect job's summary says `iOS skipped: no native/iOS change (runs on release PRs, native changes, weekly)`. JS-only game changes are covered by the Android leg. A native change that passes this gate continues with rules 3 and 4; if it matches no game (a pod or native dependency bump), iOS runs the full suite instead of nothing.
3. **A full-suite path** → full suite. Two keys in the path table (#3546):
   - `shared_app`: app-wide files (`frontend/App.tsx`, `frontend/app.json`, `frontend/src/theme/**`, `OfflineBanner`, `LanguageSwitcher`, `backend/main.py`). Playwright's `shared` includes it by YAML anchor.
   - `maestro_shared`: `frontend/src/game/_shared/**`, `e2e/maestro/**`, `tools/ios_sim/**`, the i18n runtime code (`frontend/src/i18n/*.ts`/`*.js`), Maestro's own workflows (`mobile-smoke-android.yml`, `mobile-smoke-ios.yml`, `detect-maestro-scope.yml`), the composite actions they use (`.github/actions/setup-frontend/**`, `.github/actions/maestro-install/**`), `.github/paths/**`, and the **English** locale files the flows assert text from (`locales/en/common.json` plus each game's `locales/en/<game>.json`, for its `game.title`; the comments in `game-paths.yml` list which flow needs each).
   - Not full-suite triggers any more: other workflow or action edits (Playwright-only, Render-only, policy), non-English locale files, and English namespaces no flow asserts on (`stats`, `profile`, `leaderboard`, …). Those run no Maestro flows. A new text assertion on another namespace must add its `en` file to `maestro_shared`.
4. **PR into `dev`** touching only specific games → only those games' flow directories run, plus `home` (always included — cheap, catches nav regressions). `offline/` only ever runs as part of the full suite.
5. A PR touching nothing Maestro-relevant (backend-only, docs-only) skips the job entirely — no emulator/simulator boot.

The job summary heading includes the resolved scope, e.g. `Maestro Android Smoke (selective: home solitaire freecell)`.

### Deterministic deals in test builds

Both mobile-smoke workflows build with `EXPO_PUBLIC_TEST_HOOKS=1` (same flag Playwright's web build uses). Solitaire and FreeCell read that flag to always deal a **fixed seed** instead of a random one — see `pickSeed()`/`isTestBuild()` in `frontend/src/game/solitaire/engine.ts` and `frontend/src/game/freecell/engine.ts`, and the layout comments at the top of `e2e/maestro/flows/{solitaire,freecell}/drag.yaml`. That lets those flows assert exact before/after board state instead of "either outcome is fine". Solitaire's draw-mode picker modal is also skipped in test builds (auto-deals draw-1) since Maestro has no reliable way to tap a locale-dependent modal button.

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

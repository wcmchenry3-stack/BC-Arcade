# Maestro

Maestro runs smoke tests against the **native** Android and iOS builds. It covers what Playwright structurally cannot: native rendering, touch input, device navigation, and offline mode. Game logic, scoring, and edge cases are covered by Playwright and backend unit tests.

## Prerequisites

Install the Maestro CLI once. CI pins **v1.39.13** — match it locally to avoid behaviour differences:

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
| Runner | `ubuntu-latest` | `macos-15` |
| Device | API 34 emulator (Pixel 6, x86_64) | iPhone 16 simulator (iOS 18) |
| Trigger | push to `main`, manual `workflow_dispatch` (full suite) — **not** PRs, see #2400 | push to `main` — **not** PRs, see #2347 |
| Timeout | 60 min | 90 min |
| Offline flow | ✅ included | ❌ excluded (requires `toggleAirplaneMode`, Android-only) |

Both jobs write a Markdown pass/fail table to the GitHub Actions job summary and upload a `maestro-{android,ios}-results` artifact (7-day retention). Failure screenshots are uploaded as a separate `maestro-{android,ios}-screenshots` artifact when any flow fails.

### Scoped runs on PRs

> **Currently dormant.** Neither mobile-smoke workflow has a `pull_request` trigger right now (iOS: #2347; Android: #2400 — the job never passed when it actually executed), so only the full-suite rule below is live. The selective rules are kept in `detect-maestro-scope.yml` and take effect again as soon as `pull_request` is re-added.

A shared `detect-maestro-scope.yml` reusable workflow (mirrors `detect-e2e-scope` in `ci.yml`, adapted to Maestro's directory-per-game layout) decides which flow directories actually run:

- **Push to `main`**, a **manual `workflow_dispatch`**, a **PR targeting `main`**, or a change to a shared/infra path (`frontend/src/theme/**`, `frontend/src/game/_shared/**`, `e2e/maestro/**`, `.github/workflows/**`, etc.) → full suite, same as before.
- **PR into `dev`** touching only specific games → only those games' flow directories run, plus `home` (always included — cheap, catches nav regressions). `offline/` only ever runs as part of the full suite.
- `leaderboard/` (result submission, #2643) is also **full suite only** — it has no paths-filter category. It runs against the deployed dev API rather than the PR's backend, so a PR's changed paths can't tell whether it is relevant, and its full 13-turn Yacht game is too costly on the `macos-15` runner to repeat for every Yacht-UI PR. See [`e2e/maestro/README.md`](../e2e/maestro/README.md#result-submission-flow-leaderboard).
- A PR touching nothing Maestro-relevant (backend-only, docs-only) skips the job entirely — no emulator/simulator boot.

The job summary heading includes the resolved scope, e.g. `Maestro Android Smoke (selective: home solitaire freecell)`.

### Deterministic deals in test builds

Both mobile-smoke workflows build with `EXPO_PUBLIC_TEST_HOOKS=1` (same flag Playwright's web build uses). Solitaire and FreeCell read that flag to always deal a **fixed seed** instead of a random one — see `pickSeed()`/`isTestBuild()` in `frontend/src/game/solitaire/engine.ts` and `frontend/src/game/freecell/engine.ts`, and the layout comments at the top of `e2e/maestro/flows/{solitaire,freecell}/drag.yaml`. That lets those flows assert exact before/after board state instead of "either outcome is fine". Solitaire's draw-mode picker modal is also skipped in test builds (auto-deals draw-1) since Maestro has no reliable way to tap a locale-dependent modal button.

### Estimated cost

| Platform | Runner cost |
|---|---|
| Android | ~$0.52 / month |
| iOS | ~$6.40 / month |

iOS is ~12× more expensive due to the `macos-15` runner rate. Keep iOS flows as lean smoke tests.

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
| Result card → name prompt → rank → leaderboard → name removal, on a native build | Maestro (`leaderboard/result-submission.yaml`) | The one native end-to-end check of submission (#2643); runs against the real dev API, full suite only, see [`e2e/maestro/README.md`](../e2e/maestro/README.md#result-submission-flow-leaderboard) |

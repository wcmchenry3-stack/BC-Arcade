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

You also need a running device or simulator/emulator before executing any flow. Start your app on it first, then run the commands below.

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
| Trigger | push to `main` | push to `main` |
| Timeout | 60 min | 90 min |
| Offline flow | ✅ included | ❌ excluded (requires `toggleAirplaneMode`, Android-only) |

Both jobs write a Markdown pass/fail table to the GitHub Actions job summary and upload a `maestro-{android,ios}-results` artifact (7-day retention). Failure screenshots are uploaded as a separate `maestro-{android,ios}-screenshots` artifact when any flow fails.

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

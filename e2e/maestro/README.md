# Maestro E2E Flows

Smoke tests for native mobile (Android & iOS). These flows cover what Playwright structurally cannot: native rendering, touch input, navigation, and offline mode. Game logic and scoring are covered by Playwright.

## Prerequisites

Install the Maestro CLI (one-time). CI pins **v1.39.13** — match it locally to avoid behaviour differences:

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

## Running flows

Start the app on a connected device or simulator/emulator first, then:

```bash
# Single flow
maestro test e2e/maestro/flows/home/home-screen.yaml

# All flows in a directory (e.g. once yacht flows land)
maestro test e2e/maestro/flows/yacht/

# All game flows — exclude _shared/ as those subflows require env vars and
# are not standalone-runnable
maestro test $(find e2e/maestro/flows -name "*.yaml" ! -path "*/_shared/*")
```

## Directory structure

```
e2e/maestro/
├── README.md
└── flows/
    ├── _shared/
    │   ├── launch.yaml          # App launch + home screen assertion (imported by all flows)
    │   └── navigate-to.yaml    # Subflow: tap a tile, assert game screen loads
    ├── home/                    # Home screen & navigation smoke tests
    ├── blackjack/
    ├── yacht/
    ├── cascade/
    ├── freecell/
    ├── hearts/
    ├── solitaire/
    ├── twenty48/
    ├── sudoku/
    ├── daily-word/
    ├── starswarm/
    ├── mahjong/
    ├── sort/
    └── offline/                 # Offline mode: game logic without network
```

## Shared subflows

`launch.yaml` includes an `appId` header so it can also run standalone as a quick sanity check:

```bash
maestro test e2e/maestro/flows/_shared/launch.yaml
```

All game flows import it as their first step:

```yaml
- runFlow: ../_shared/launch.yaml
```

To navigate to a game, use `navigate-to.yaml`:

```yaml
- runFlow:
    file: ../_shared/navigate-to.yaml
    env:
      gameSlug: "yacht"
      screenLabel: "Yacht"
```

> **Note:** most slugs match the kebab-case convention (`yacht`, `solitaire`, etc.). The one exception is `daily_word` (underscore), which matches the typed `GameType` literal used across the codebase.

## Pre-game selectors

Several games show a selector before the game starts. Each smoke flow handles this automatically:

| Game | Selector | How the flow handles it |
|---|---|---|
| Yacht | Mode picker (Solo / VS Computer) | taps `yacht-mode-solo` |
| Hearts | Difficulty picker | taps `hearts-start-game` |
| Sort | Level select | taps `sort-level-1` |
| Mahjong | Layout select | taps `mahjong-layout-turtle` |
| Sudoku | Difficulty / variant | taps `sudoku-pregame-start` |
| StarSwarm | Difficulty picker | taps `starswarm-start-game` |

## Offline flow

`offline/smoke.yaml` uses `toggleAirplaneMode` (Android only). On iOS, put the device in Airplane Mode before running the flow. The flow navigates to Solitaire — a client-side game — taps the stock pile, and asserts the game responds without a network connection.

## Scope

Each game flow is a **smoke test only**: launch → navigate → one interaction → assert screen is stable. Detailed logic (scoring, edge cases, persistence) is covered by Playwright.

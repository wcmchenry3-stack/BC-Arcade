# Maestro E2E Flows

Smoke tests for native mobile (Android & iOS). These flows cover what Playwright structurally cannot: native rendering, touch input, navigation, and offline mode. Game logic and scoring are covered by Playwright.

## Prerequisites

Install the Maestro CLI (one-time):

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
```

Or via Homebrew:

```bash
brew tap mobile-dev-inc/tap
brew install maestro
```

Verify: `maestro --version`

## Running flows

Start the app on a connected device or simulator/emulator first, then:

```bash
# Single flow
maestro test e2e/maestro/flows/home/home-screen-ios.yaml

# All flows in a directory
maestro test e2e/maestro/flows/yacht/

# All flows
maestro test e2e/maestro/flows/
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

All game flows start with:

```yaml
- runFlow: ../_shared/launch.yaml
```

To navigate to a game, use `navigate-to.yaml`:

```yaml
- runFlow:
    file: ../_shared/navigate-to.yaml
    env:
      gameTitle: "Yacht"
      screenLabel: "Roll"
```

## Scope

Each game flow is a **smoke test only**: launch → navigate → one interaction → assert screen is stable. Detailed logic (scoring, edge cases, persistence) is covered by Playwright.

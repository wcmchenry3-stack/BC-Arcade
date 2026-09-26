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
    │   ├── navigate-to.yaml    # Subflow: tap a tile, assert game screen loads
    │   ├── yacht-turn.yaml     # Subflow: one solo Yacht turn (roll, score a category)
    │   └── remove-leaderboard-name.yaml  # Subflow: safety-net name cleanup (see below)
    ├── home/                    # Home screen & navigation smoke tests
    ├── leaderboard/             # Result submission against the real dev API (see below)
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

## Timeouts

`timeout:` is **not** a valid field on `assertVisible`, `assertNotVisible`, or
`tapOn` — confirmed against Maestro's source (`YamlElementSelector.kt`) at the
pinned CLI version; the strict Jackson deserializer rejects it outright
("Unrecognized field \"timeout\"" — see #2350). To wait longer than the
default ~7s find-timeout, use `extendedWaitUntil` instead:

```yaml
- extendedWaitUntil:
    visible:
      id: "some-id"
    timeout: 10000
```

`optional: true` on `tapOn` (for a pre-game button that may not appear) is a
valid selector field on its own — just don't pair it with `timeout`.

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

Solitaire also shows a pre-game modal (draw-1/draw-3 picker) on a clean save
slot, but no flow taps through it — instead, `EXPO_PUBLIC_TEST_HOOKS=1` (set
for every Maestro build) makes `SolitaireScreen` skip the modal and auto-deal
draw-1 on a clean slot, since Maestro has no reliable way to tap a
locale-dependent modal button by text. See `docs/MAESTRO.md` for the fixed
deterministic deals this same flag enables in Solitaire/FreeCell.

## Offline flow

`offline/smoke.yaml` uses `toggleAirplaneMode` (Android only). On iOS, put the device in Airplane Mode before running the flow. The flow navigates to Solitaire — a client-side game — taps the stock pile, and asserts the game responds without a network connection.

## Result submission flow (leaderboard/)

`leaderboard/result-submission.yaml` (#2643) is the one native end-to-end
check of finishing a game and landing on a leaderboard:

1. Plays a full **solo Yacht** game — 13 turns via `_shared/yacht-turn.yaml`.
   Yacht always ends after 13 roll+score turns whatever the dice, so no test
   hook is needed.
2. On the result card, answers the one-time display-name prompt with a
   unique-ish bot name (`Maestro<5 digits>`) and waits (up to 2 min) for the
   submission line: `yacht-result-submission-ranked` (saved with a `#N` /
   `Your best: #N` rank) or `-saved` (saved, outside the top 10, where the
   card shows no rank).
3. Taps **View leaderboard** and asserts the player's highlighted row
   (`leaderboard-row-me` in the list, or `leaderboard-row-pinned` under it).
4. Goes back to the card, then Home, and asserts exactly three bottom tabs
   (`tab-lobby`, `tab-profile`, `tab-settings`; no `tab-ranks`, #2634).
5. **Cleans up:** Profile → "Remove my name from leaderboards" → confirm, and
   asserts `profile-not-on-boards`, so the dev boards testers see don't keep
   a bot entry (#2637). If the flow fails after the name was typed and before
   this step, its `onFlowComplete` hook runs
   `_shared/remove-leaderboard-name.yaml`, which relaunches the app and
   removes the name.

**It needs the real dev API.** Unlike every other flow, it depends on the
backend: the game syncs through SyncWorker, the name through
`PUT /players/me`, and the rank comes from `GET /games/{id}/rank`. The
mobile-smoke builds point at `https://dev-games-api.buffingchi.com`
(`EXPO_PUBLIC_API_URL`), which must be up and reachable from the runner. A
local run needs a build with the same URL (and `EXPO_PUBLIC_TEST_HOOKS=1`).

## Scope

Each game flow is a **smoke test only**: launch → navigate → one interaction → assert screen is stable. Detailed logic (scoring, edge cases, persistence) is covered by Playwright. The exception is `leaderboard/` (above), which runs one full game through to the leaderboard.

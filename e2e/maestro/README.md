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
    │   ├── tap-game-tile.yaml   # Subflow: scroll a Home tile into view and tap it
    │   ├── navigate-to.yaml     # Subflow: tap-game-tile + assert the game screen title
    │   └── open-yacht.yaml      # Subflow: open Yacht, answer its mode picker, assert title
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
      gameSlug: "solitaire"
      screenLabel: "Solitaire"
```

`navigate-to.yaml` scrolls the tile into view first (`scrollUntilVisible`), so it
works for games below the fold on a phone (#2371). It also waits (up to 60 s) for a premium tile to
lose its "Locked, tap to unlock" label, since tiles stay locked until `/entitlements`
answers and a locked tile opens the paywall. Use `tap-game-tile.yaml` on its
own when the game opens a picker in a React Native `<Modal>` (Yacht, Star Swarm):
on Android a Modal is a separate window, and Maestro cannot see the screen title
behind it until it closes (#2373). Tap the picker's button, then wait for the
title. Yacht flows use `open-yacht.yaml` with `yachtMode: "yacht-mode-solo"` or
`"yacht-mode-vs"`.

`launch.yaml` taps Android's "Wait" button at most 3 times if a system "isn't
responding" dialog covers the app; a dialog that keeps coming back fails the flow
within seconds instead of burning the job timeout (#2400).

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
| Yacht | Mode picker (Solo / VS Computer), Android Modal | `open-yacht.yaml` taps `yacht-mode-solo` or `yacht-mode-vs`, then checks the title |
| Blackjack | Table select (fresh run) | taps `blackjack-table-beginner`, then chip `blackjack-chip-5` (chip testIDs are face values) |
| Hearts | None (one CPU, #3489) | none: the table is dealt on open |
| Sort | Level select | taps `sort-level-1` |
| Mahjong | Layout select | taps `mahjong-layout-turtle` |
| Sudoku | Difficulty / variant | taps `sudoku-pregame-start` |
| StarSwarm | Difficulty picker, Android Modal | taps `starswarm-start-game` before checking the title |

Solitaire also shows a pre-game modal (draw-1/draw-3 picker) on a clean save
slot, but no flow taps through it — instead, `EXPO_PUBLIC_TEST_HOOKS=1` (set
for every Maestro build) makes `SolitaireScreen` skip the modal and auto-deal
draw-1 on a clean slot, since Maestro has no reliable way to tap a
locale-dependent modal button by text. See `docs/MAESTRO.md` for the fixed
deterministic deals this same flag enables in Solitaire/FreeCell.

## Drag flows

Maestro's `swipe` (v1.39.13) cannot drag from one element to another: it takes a
`direction`, an element plus a `direction`, or `start`/`end` coordinates, and the
coordinates must be literal numbers when the file is parsed (#2366).
`solitaire/drag.yaml` and `freecell/drag.yaml` therefore swipe between screen
percentages derived from each board's layout on the CI emulator (pixel_6); the
derivation is in each file's header. Before each swipe the flow waits for the
source and target by id. When a flow fails, each mobile-smoke job's "Maestro failure
details" step (`e2e/maestro/diagnose.py`) prints the failed command, its error and
the bounds of the drag-relevant elements in the failure-time hierarchy, plus the
`maestro.log` tail; if a layout change moves the board, correct the percentages
from those bounds. The full debug output is in the `maestro-android-results`
artifact under `maestro-debug/`.

**Drag coordinates are per platform.** The iOS simulator (402x874 pt) has a taller
header than the pixel_6 (411x914 dp), so one percentage lands on different cards.
Each swipe is two `runFlow` blocks, `when: platform: Android` and
`when: platform: iOS`, each with its own `start`/`end`; the comment above each block
names the bounds it came from. To recalibrate one platform, take the bounds that
`diagnose.py` prints for that platform's failed run (iOS reports points, Android
reports pixels: divide by the screen size in the same unit), aim at the centre of
the card's _visible_ strip (fan offset, not full card height, for any card that
isn't the top one) and at the centre of the drop target, and round to an integer
percentage that still falls inside both. Leave the other platform's block as it is.

The Hearts pass button is tapped by id (`hearts-pass-confirm`), not by its "Confirm"
text: a Pressable with its own `accessibilityLabel` hides its child Text on iOS, so
`tapOn: text:` finds nothing there. Use a testID for any such button.

Outcome checks use card testIDs (`solitaire-tableau-<c>-card-<i>`,
`freecell-col-<c>-card-<i>`, `hearts-hand-card-<i>`) rather than the
"Tableau column N, M cards" / "Your hand, N cards" labels: on Android the column
label sits on a View that React Native's view flattening removes, and the hand
label is a 1x1 transparent Text, so Maestro sees neither.

To play a legal Hearts card, tap `hearts-hand-playable-<i>`: PlayerHand sets it only on
the Pressable of a card that can be played or selected now (during the pass phase every
card is selectable). The slot testID `hearts-hand-card-<i>`
is on an always-enabled wrapper, so `enabled: true` on it filters nothing.

## Offline flow

`offline/smoke.yaml` uses `toggleAirplaneMode` (Android only). On iOS, put the device in Airplane Mode before running the flow. The flow navigates to Solitaire — a client-side game — taps the stock pile, and asserts the game responds without a network connection.

## Scope

Each game flow is a **smoke test only**: launch → navigate → one interaction → assert screen is stable. Detailed logic (scoring, edge cases, persistence) is covered by Playwright.

# BC Arcade — Product Principles

## North Star

A calm, no-BS arcade of simple games designed for short moments — not long sessions.

## Product Rules (Non-Negotiable)

- Start playing in under 3 seconds
- No penalty for leaving mid-game
- No interruptions during gameplay
- No forced login — gameplay is never gated behind authentication
- Clean, minimal UI

## Never Build

- Countdown timers, time pressure, or cooldowns — informational elapsed displays (e.g. a stopwatch that pauses on background and stops on win, with no scoring impact) are allowed
- Grind loops
- Behavior manipulation (dark patterns)
- Forced ads to continue playing
- Complex user profiles
- Cross-game social leaderboards
- Advanced analytics beyond error reporting

## Game Roster

All games are in active development. Nothing is released yet.

| Game        | Category | Notes                                   |
| ----------- | -------- | --------------------------------------- |
| Yacht       | Dice     | Yahtzee variant, 3 AI difficulty levels |
| Hearts      | Card     | Trick-taking, avoid hearts + queen      |
| Blackjack   | Card     | 3 table tiers, chip progression         |
| Solitaire   | Card     | Klondike, draw-3 mode, undo             |
| Sudoku      | Puzzle   | 3000 puzzles, 3 difficulty tiers        |
| Cascade     | Arcade   | Physics fruit-drop, Matter.js + Skia    |
| 2048        | Puzzle   | Tile-merge puzzle, frontend-only engine |
| FreeCell    | Card     | Leaderboard by move count               |
| Mahjong     | Puzzle   | Tile-matching, deadlock detection       |
| Bottle Sort | Puzzle   | Level-based pour puzzle                 |
| Daily Word  | Word     | Daily puzzle, en/hi language support    |
| Starswarm   | Arcade   | In early development                    |

For individual game rules, scoring, and engine details see [`docs/games/`](games/).

## Monetization

BC Arcade launches with a premium tier — some games require purchase to access (exact free/premium split TBD). Premium access is controlled by a server-issued entitlement JWT; see [`docs/ARCHITECTURE.md §10`](ARCHITECTURE.md) for the technical model.

**Golden rules:**

- Never remove free functionality. Only add paid enhancements.
- Never block gameplay mid-session due to an entitlement change.
- Free games must always be playable with zero friction — no login, no payment prompt.

## Identity Tiers

| Tier | Description                 | Status             |
| ---- | --------------------------- | ------------------ |
| 0    | Anonymous (UUID session)    | Implemented        |
| 1    | Optional name input         | Planned            |
| 2    | Google/Apple SSO (optional) | Planned — see #144 |

Login is always optional. Never block gameplay behind it. Prompt only after the user has played:

- "Save your progress?" triggers optional login
- "Want to try new games early?" triggers optional login

## Beta Testing

- Use feature flags (#142) to gate beta games, not TestFlight
- TestFlight reserved for unstable features or major changes
- Initial beta testers: project owner + family

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
| Yacht       | Dice     | Dice scoring game, 3 AI difficulty levels |
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

BC Arcade offers complete free games and, when purchases launch, complete premium games. A premium purchase grants access to a game, not currency, lives, moves, retries, continued play, or a stronger version of a free game. This is a premium catalog, **not freemium gameplay**. Premium access is controlled by a server-issued entitlement JWT; see [`docs/ARCHITECTURE.md §10`](ARCHITECTURE.md#10-premium-entitlements) for the technical model. The purchase model — one non-consumable product per premium game, restore, refunds and the product catalog — is specified in [`docs/IAP.md`](IAP.md).

**Golden rules:**

- Once a game is offered free, keep its gameplay complete: no paid difficulty levels, modes, content inside that game, consumables, or pay-to-continue mechanics. New premium games can be added to the catalog.
- Never block gameplay mid-session due to an entitlement change.
- Free games must always be playable with zero friction — no login, no payment prompt.
- No prompts that exploit a loss, depleted resource, streak, countdown, or interrupted session to solicit a purchase.

### Advertising

The initial release has no ads. Ads may be considered later; an ad-supported release must still follow these product rules:

- Never interrupt an active game, hand, wave, puzzle, or natural replay flow. Do not require an ad to start, resume, finish, retry, or keep a result, reward, or streak.
- No deceptive controls, disguised ads, accidental-tap placement, forced engagement, or pressure based on loss or scarcity. An ad must be clearly identifiable and easy to dismiss when dismissal is offered.
- Do not make play deliberately slower or harder to sell an ad-free option. Do not give paid players a gameplay advantage over free players.
- Keep ads out of essential navigation and score/history views. Any future placement, frequency, format, privacy implications, and store disclosure require a separate product review before implementation.

Current no-ads statements in store and privacy materials describe the initial release; reassess those statements if ads are introduced.

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

# Blackjack

**Category:** Card
**Tier:** TBD
**Status:** In Development

## How to Play

Standard casino Blackjack. The player competes against the dealer (AI). The goal is to get a hand value as close to 21 as possible without going over ("busting"), and closer than the dealer.

### Card Values

- Number cards (2–10): face value
- Jack, Queen, King: 10
- Ace: 1 or 11 (whichever is more favorable)

### Actions

| Action      | When available                                                        |
| ----------- | --------------------------------------------------------------------- |
| Hit         | Take another card                                                     |
| Stand       | End your turn                                                         |
| Double Down | Double the bet, take exactly one more card                            |
| Split       | When dealt two cards of the same rank — split into two separate hands |

### Outcomes

- **Blackjack** (Ace + 10-value on first two cards): pays 3:2
- **Win**: player total > dealer total, or dealer busts: pays 1:1
- **Push**: equal totals — bet returned
- **Loss**: player total < dealer total, or player busts

### Table Tiers

Blackjack uses a chip-based progression system across three tables:

| Table        | Starting chips | Run goal | Min bet | Max bet |
| ------------ | -------------- | -------- | ------- | ------- |
| Beginner     | 100            | 250      | 5       | 25      |
| Intermediate | 250            | 750      | 10      | 50      |
| High Roller  | 500            | 1500     | 25      | 200     |

Reaching the run goal on one table unlocks the next. Tables also unlock cosmetics (table themes, card backs, chip styles) for milestone achievements — e.g. winning back from ≤25% chip stack.

## Scoring (Persistence)

`final_score` = chip total at end of session. The backend tracks `best_run_chips` (highest run-end chip total) and `current_chips` (most recent session's ending total) via the `BlackjackMetadata` fields.

## Client-Side Engine

- Location: `frontend/src/game/blackjack/engine.ts`
- Supporting files:
  - `frontend/src/game/blackjack/tables.ts` — table tier config
  - `frontend/src/game/blackjack/unlocks.ts` — cosmetic unlock logic
- Key exports: hand evaluation, dealer AI logic, bet validation, split/double-down rules

## Backend

- Module: `backend/blackjack/module.py`
- Endpoints: `backend/blackjack/router.py`
- Metadata model: `BlackjackMetadata`
  - `best_run_chips: int | None`
  - `total_runs: int | None`
  - `runs_completed: int | None`
  - `current_table: Literal["beginner","intermediate","high_roller"] | None`
- Scoring: `final_score` = chip count at session end; `stats_shape` maps `best → best_chips`, `latest_score → current_chips`

## Entitlement

Tier TBD. If free: no entitlement check. If premium: requires a valid entitlement JWT; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- Tracked in issue #893 (two rule engines — migration to single TS engine in progress)

# Blackjack

**Category:** Card
**Tier:** Premium (hidden in the v1.0 store build — simulated gambling; decision 2026-09-23)
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

Blackjack has **no leaderboard**: chips are a balance, not a score. Its board is declared disabled (`enabled=False`) and only describes the per-game "best" in Stats.

- **Metric and direction:** `final_score`, higher is better, labelled `chips` (`board` in `backend/blackjack/module.py`; `BOARDS.blackjack` in `frontend/src/api/vocab.ts`). The app sends no `final_score`, though: `endSession` in `frontend/src/game/blackjack/BlackjackGameContext.tsx` completes with `{ outcome, result }` only, so the column is `null` on every row current builds write. The chips go in the result block instead.
- **Tie-break:** none; the board is disabled.
- **Partitions:** none.
- **Recorded, not partitioned:** creation metadata (`BlackjackMetadata`): `best_run_chips`, `total_runs`, `runs_completed` and `current_table`, computed on the device from its run history. Result (`BlackjackResult`): `hands_won`, `hands_played`, `starting_chips`, `final_chips`.
- **Max value:** none (`max_value` unset).
- **Outcomes:** `has_winner = True`. A session is one run at a table. It records `win` when the run reached its goal, even if the player chose Keep Playing and later ran out of chips (a Cash Out is a win too). It records `loss` when the chips ran out before the goal. New Game before the goal is `abandoned`, and so is leaving the game before the goal (`useGameSync`'s unmount abandon, with the result block). A run that has already reached its goal records `win` however its session ends, even on an unmount or when the app is killed: the progress snapshot (`syncSetProgressSnapshot` in `BlackjackGameContext.tsx`) carries an `outcome: "win"` override, which the hook's own abandon uses and mirrors to the device on every action, so the killed-process sweep records `win` too (#2682). The override applies only once the session has played a hand or continues a killed one. A session with no hand played records no result: `close()` discards it, or abandons it if it was marked started. Builds before #2628 sent `completed`; the server stores one with `final_chips` > 0 as `win` (`backend/games/legacy_outcomes.py`), and the rest stay `completed`, a finish with no winner.
- **Duration:** `useGameSync`'s active-play window. Blackjack sends no duration of its own.
- **How it reaches the server:** the `useGameSync("blackjack")` session row. `SyncWorker` sends `POST /games` once the player has acted and `PATCH /games/{id}/complete` when the run ends. Blackjack has no router of its own. The result card asks for no rank: `GET /games/{id}/rank` would answer `board_disabled`.
- **Where the player sees it:** the table and Victory screens (`BlackjackTableScreen`, `BlackjackVictoryScreen`), and Stats (`GameStatsScreen`, #2635): sessions, wins, losses, win rate and streaks, time played, and a link to the on-device run history (`BlackjackStatsScreen`). The Stats "Best" reads the highest `final_score`, so it stays empty for rows current builds write. There is no Leaderboard entry point (`openableBoard` in `frontend/src/game/_shared/leaderboardAvailability.ts`). Store builds hide Blackjack entirely (`HIDDEN_GAMES`, `frontend/src/entitlements/gameVisibility.ts`).

## Client-Side Engine

- Location: `frontend/src/game/blackjack/engine.ts`
- Supporting files:
  - `frontend/src/game/blackjack/tables.ts` — table tier config
  - `frontend/src/game/blackjack/unlocks.ts` — cosmetic unlock logic
- Key exports: hand evaluation, dealer AI logic, bet validation, split/double-down rules

## Backend

- Module: `backend/blackjack/module.py`
- Endpoints: none of its own. Sessions use the generic `/games` routes.
- Metadata model: `BlackjackMetadata`
  - `best_run_chips: int | None`
  - `total_runs: int | None`
  - `runs_completed: int | None`
  - `current_table: Literal["beginner","intermediate","high_roller"] | None`
- Result model: `BlackjackResult`: `hands_won`, `hands_played`, `starting_chips`, `final_chips`
- Stats: `stats_shape` moves `best` to `extras.best_chips` and `latest_score` to `extras.current_chips`. Both are read from `final_score`, which current builds leave `null` (see [Scoring](#scoring-persistence))

## Entitlement

Tier TBD. If free: no entitlement check. If premium: requires a valid entitlement JWT; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- Tracked in issue #893 (two rule engines — migration to single TS engine in progress)
- #2745: the app sends no `final_score`, so Stats' "Best" (`best_chips`) and `current_chips` stay empty (see [Scoring](#scoring-persistence))

# Yacht

**Category:** Dice
**Tier:** Free (v1.0 store build; swapped with Blackjack 2026-09-23)
**Status:** In Development

## How to Play

Yacht is a classic dice scoring game. Each turn the player rolls 5 dice and may re-roll any subset up to two more times. After the third roll the player must assign the result to one of 13 scoring categories. Each category can only be scored once per game. The game ends when all 13 categories are filled.

BC Arcade's Yacht has two modes, picked at the start of each game: **solo**, and **vs the computer** at one of three AI difficulties. In vs mode both players alternate turns under the same rules.

### Scoring Categories

| Category        | How to score                | Points          |
| --------------- | --------------------------- | --------------- |
| Ones – Sixes    | Sum of matching face values | Variable        |
| Three of a Kind | At least 3 dice the same    | Sum of all dice |
| Four of a Kind  | At least 4 dice the same    | Sum of all dice |
| Full House      | 3 of one + 2 of another     | 25              |
| Small Straight  | 4 sequential faces          | 30              |
| Large Straight  | 5 sequential faces          | 40              |
| Yacht           | All 5 dice the same         | 50              |
| Chance          | Any combination             | Sum of all dice |

Upper section bonus: if the sum of Ones–Sixes ≥ 63, add 35 bonus points.
Scores range from 0 to 1575: the theoretical maximum is every category at its best, the upper bonus, and 12 extra Yachts at the Yacht bonus each (recomputed from `engine.ts` in `backend/tests/test_board_definitions.py`).

## AI Difficulty

Three levels available in vs mode, recorded at game start in `YachtMetadata.difficulty`:

| Level    | Behavior                                 |
| -------- | ---------------------------------------- |
| `easy`   | Makes frequent suboptimal holds          |
| `medium` | Balanced strategy                        |
| `hard`   | Near-optimal hold and category selection |

## Scoring (Persistence)

Yacht has **one leaderboard** (#2630): solo and vs-the-computer games share it, whatever the computer's difficulty.

- **Metric and direction:** `final_score`, higher is better, labelled `score` (`board` in `backend/yacht/module.py`; `BOARDS.yacht` in `frontend/src/api/vocab.ts`). It is the player's total at game end. The computer's score is recorded only in the vs result block.
- **Tie-break:** none declared. Equal scores go to the earlier `completed_at`, the last tie-break on every board.
- **Partitions:** none (#2519 decision 2).
- **Recorded, not partitioned:** creation metadata (`YachtMetadata`): `mode` (`solo` | `vs`) and, in vs mode, `difficulty`. Result (stored as sent: `result_model = None`; built by `endedPayload` in `frontend/src/screens/GameScreen.tsx`): `final_score`, `upper_bonus`, `yacht_bonus_total`, `outcome`, and for a finished vs game `opponent_score` and `vs_result`.
- **Max value:** 1575 with bonus Yachts (see [Scoring Categories](#scoring-categories)).
- **Outcomes:** `has_winner = True`. Every outcome except `abandoned` ranks:
  - solo: `completed`, a finish with no winner;
  - vs: `win`, `loss` or `push` (a tie), once the computer has finished. If the screen unmounts or the app goes to the background while the computer is still playing its last turn, the game records `completed` without a winner.
  - New Game during play records `abandoned` with the score so far in `final_score`; abandoned rows never rank or count toward "best". Leaving the screen mid-game also records `abandoned`, once the player has rolled.
- **Duration:** Yacht measures no play time of its own. `duration_ms` comes from `useGameSync`'s active-play window (#2684): foreground time on the game screen, with each idle gap between player actions capped at 10 minutes. A duration that isn't > 0 is never sent.
- **How it reaches the server:** the `useGameSync("yacht")` session row. `SyncWorker` sends `POST /games` after the first roll and `PATCH /games/{id}/complete`. Yacht has no routes of its own (the legacy `POST /yacht/score` and `GET /yacht/scores` were removed in #2630). If the player has a display name (`PUT /players/me`), the row ranks with no further step. The board shows each named player's best game once. Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **Where the player sees it:** the result card shows the game's rank through `sessionBoardAdapter` (`GET /games/{id}/rank`), or asks once for a display name. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen (#2633, `GET /games/leaderboard/yacht`). Stats (#2635) are in the ⋯ menu.

## Client-Side Engine

- Location: `frontend/src/game/yacht/engine.ts`
- Key exports: dice roll logic, hold validation, category scoring, AI strategy per difficulty level

## Backend

- Module: `backend/yacht/module.py`
- Endpoints: none of its own — the generic `/games` routes. The legacy `POST /yacht/score` and `GET /yacht/scores` were removed in #2630.
- Metadata model: `YachtMetadata` — `mode: Literal["solo","vs"] | None`, `difficulty: Literal["easy","medium","hard"] | None`. A `vs` game requires a difficulty and a `solo` game forbids one; metadata with no `mode` (builds before #2630) accepts either.
- Scoring: `final_score` = player's total points; see [Scoring](#scoring-persistence)

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT. Offline play continues within the 7-day grace period; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- Tracked in issue #893 (server-authoritative SP migration)
- AI difficulty tuning is ongoing

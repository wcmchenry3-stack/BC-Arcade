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

`final_score` = the player's total at game end (0–1575 with bonus Yachts). The session row goes through the generic `/games` pipeline; the computer's score is recorded only in the vs result block (`opponent_score`, `vs_result`).

Yacht has **one leaderboard** (`GET /games/leaderboard/yacht`, #2630): solo and vs-the-computer games share it, ranked by `final_score` descending, one entry per named player (their best game). Every outcome except `abandoned` ranks: solo `completed`, and vs `win` / `loss` / `push`. The session metadata records `mode` (`solo` | `vs`) and, in vs mode, `difficulty`, without partitioning the board. The result card shows the game's rank via the shared `sessionBoardAdapter`. `duration_ms` comes from the shared foreground-time clock in `useGameSync` (#2684); Yacht never sends 0.

## Client-Side Engine

- Location: `frontend/src/game/yacht/engine.ts`
- Key exports: dice roll logic, hold validation, category scoring, AI strategy per difficulty level

## Backend

- Module: `backend/yacht/module.py`
- Endpoints: none of its own — the generic `/games` routes. The legacy `POST /yacht/score` and `GET /yacht/scores` were removed in #2630.
- Metadata model: `YachtMetadata` — `mode: Literal["solo","vs"] | None`, `difficulty: Literal["easy","medium","hard"] | None`. A `vs` game requires a difficulty and a `solo` game forbids one; metadata with no `mode` (builds before #2630) accepts either.
- Scoring: `final_score` = player's total points

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT. Offline play continues within the 7-day grace period; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- Tracked in issue #893 (server-authoritative SP migration)
- AI difficulty tuning is ongoing

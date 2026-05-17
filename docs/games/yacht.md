# Yacht

**Category:** Dice
**Tier:** TBD
**Status:** In Development

## How to Play

Yacht is a Yahtzee-style dice game. Each turn the player rolls 5 dice and may re-roll any subset up to two more times. After the third roll the player must assign the result to one of 13 scoring categories. Each category can only be scored once per game. The game ends when all 13 categories are filled.

BC Arcade's Yacht mode is 1v1 against an AI opponent. Both players alternate turns under the same rules.

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
Maximum possible score: ~400 points (with bonus).

## AI Difficulty

Three levels available, set at game start via `YachtMetadata.difficulty`:

| Level    | Behavior                                 |
| -------- | ---------------------------------------- |
| `easy`   | Makes frequent suboptimal holds          |
| `medium` | Balanced strategy                        |
| `hard`   | Near-optimal hold and category selection |

## Scoring (Persistence)

`final_score` = the player's total at game end (0–400+). The AI score is not persisted — only the human player's score is submitted. Leaderboard ranks by `final_score` per difficulty level.

## Client-Side Engine

- Location: `frontend/src/game/yacht/engine.ts`
- Key exports: dice roll logic, hold validation, category scoring, AI strategy per difficulty level

## Backend

- Module: `backend/yacht/module.py`
- Endpoints: `backend/yacht/router.py`
- Metadata model: `YachtMetadata` — `difficulty: Literal["easy","medium","hard"] = "easy"`
- Scoring: `final_score` = player's total points

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT. Offline play continues within the 7-day grace period; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- Tracked in issue #893 (server-authoritative SP migration)
- AI difficulty tuning is ongoing

# Sudoku

**Category:** Puzzle
**Tier:** TBD
**Status:** In Development

## How to Play

Classic 9×9 Sudoku. Fill every cell so that each row, column, and 3×3 box contains the digits 1–9 exactly once. Pre-filled "clue" cells are fixed; the player fills the remaining empty cells.

A **mini** (6×6) variant is also available for shorter sessions, using digits 1–6 and 2×3 boxes.

### Difficulty Tiers

| Difficulty | Clue count (classic) | Strategy required       |
| ---------- | -------------------- | ----------------------- |
| Easy       | High                 | Single-candidate only   |
| Medium     | Moderate             | Some elimination chains |
| Hard       | Low                  | Advanced logic required |

All 3000 puzzles in the bank have been validated: every puzzle is solvable, has exactly one solution, and has a clue count within its tier's target range.

### Interaction

- Tap an empty cell to select it
- Tap a digit button to fill the selected cell
- Toggle notes mode to pencil in candidate digits
- Tap a filled cell + tap same digit to erase

## Scoring (Persistence)

`final_score` = derived from completion time and difficulty. A completed puzzle is `COMPLETED`; an abandoned one is `ABANDONED`. Leaderboard ranks by score per difficulty.

## Client-Side Engine

- Location: `frontend/src/game/sudoku/engine.ts`
- Key exports: validation (row/col/box uniqueness), candidate computation, completion check
- Puzzle data: 3000 pre-generated puzzles in `frontend/src/game/sudoku/puzzles/` (or served from backend — check implementation)

## Backend

- Module: `backend/sudoku/module.py`
- Endpoints: `backend/sudoku/router.py`
- Metadata model: `SudokuMetadata`
  - `player_name: str = ""` (max 64 chars)
  - `difficulty: Literal["easy","medium","hard"]` (required)
  - `variant: Literal["classic","mini"] = "classic"`
- Scoring: `final_score` = time/difficulty score at completion

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- None tracked at this time

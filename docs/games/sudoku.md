# Sudoku

**Category:** Puzzle
**Tier:** Free (v1.0 store build; moved from premium, owner decision 2026-09-25, no compensating swap)
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

- **Metric and direction:** `final_score`, higher is better, labelled `score` (`board` in `backend/sudoku/module.py`; `BOARDS.sudoku` in `frontend/src/api/vocab.ts`). Time plays no part: a solved puzzle scores its difficulty's base (easy 100, medium 200, hard 300) minus 10 per wrong digit entered, floored at 0 (`DIFFICULTY_BASE` and `computeScore` in `frontend/src/screens/SudokuScreen.tsx`). Undo restores the error count as it was before the move, so an undone error costs nothing.
- **Tie-break:** none declared. Equal scores go to the earlier `completed_at`, the last tie-break on every board.
- **Partitions:** `difficulty` × `variant`: six boards (`easy` / `medium` / `hard` × `classic` / `mini`). A row with no `variant` (from before #748) counts as `classic` (`partition_defaults`).
- **Recorded, not partitioned:** result (`SudokuResult`): `won` and `errors`.
- **Max value:** 300 overall, and per difficulty 100 (easy), 200 (medium) and 300 (hard) (`partition_max_values`). A completion above its difficulty's cap is rejected with 400.
- **Outcomes:** `has_winner = False`. A solved puzzle records `completed`; there is no loss. A new puzzle or a change of difficulty during play, or leaving the screen, records `abandoned` with `{ won: false, errors }` and no score, once a digit has been entered.
- **Duration:** Sudoku's own timer, from the first input, with backgrounded time taken out (`AppState` handling in `SudokuScreen.tsx`). It wins over `useGameSync`'s window. The elapsed time is not saved: a relaunch restarts it from 0 (intentional, per the comment in `SudokuScreen.tsx`), so time played before an app kill is not counted.
- **How it reaches the server:** the `useGameSync("sudoku")` session row, one per puzzle, with `difficulty` and `variant` as creation metadata. `SyncWorker` sends `POST /games` once the player enters a digit, and `PATCH /games/{id}/complete`. If the player has a display name (`PUT /players/me`), the row ranks with no further step. Each board shows each named player's best game on that board once. The legacy `PATCH /sudoku/score/{game_id}` was removed in #2644. Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **Where the player sees it:** the win card shows the rank on the puzzle's (difficulty, variant) board through `sessionBoardAdapter` (`GET /games/{id}/rank`), or asks once for a display name. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen (#2633). Stats (#2635) are in the ⋯ menu.

## Client-Side Engine

- Location: `frontend/src/game/sudoku/engine.ts`
- Key exports: validation (row/col/box uniqueness), candidate computation, completion check
- Puzzle data: 3000 pre-generated puzzles in `frontend/src/game/sudoku/puzzles/` (or served from backend — check implementation)

## Backend

- Module: `backend/sudoku/module.py`
- Endpoints: none of its own — the generic `/games` routes. The legacy `PATCH /sudoku/score/{game_id}` and `GET /sudoku/scores/{difficulty}` were removed in #2644.
- Metadata model: `SudokuMetadata`
  - `player_name: str = ""` (max 64 chars)
  - `difficulty: Literal["easy","medium","hard"]` (required)
  - `variant: Literal["classic","mini"] = "classic"`
- Result model: `SudokuResult` — `won: bool`, `errors: int`
- Scoring: `final_score` = difficulty base − 10 × errors; see [Scoring](#scoring-persistence)

## Entitlement

Free: no entitlement check.

## Known Issues / Limitations

- None tracked at this time

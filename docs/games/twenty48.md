# 2048

**Category:** Puzzle
**Tier:** TBD
**Status:** In Development

## How to Play

Classic 2048. Slide all tiles on a 4×4 grid in one of four directions (up, down, left, right). When two tiles with the same number collide, they merge into one tile with their combined value. The goal is to create a tile with the value **2048** (or beyond).

### Rules

- Every swipe slides **all** tiles as far as possible in the chosen direction
- After each swipe, a new tile (value 2 or 4) spawns in a random empty cell
- Two tiles can only merge once per swipe (a merged tile cannot merge again in the same move)
- The game ends when the grid is full and no legal moves remain

### Scoring

Each merge scores points equal to the value of the new (merged) tile. A 2+2 merge scores 4; a 1024+1024 merge scores 2048.

## Scoring (Persistence)

- **Metric and direction:** `final_score`, higher is better, labelled `score` (`board` in `backend/twenty48/module.py`; `BOARDS.twenty48` in `frontend/src/api/vocab.ts`). It is the score when the session closes: at the 2048 tile, or at game over.
- **Tie-break:** none declared. Equal scores go to the earlier `completed_at`, the last tie-break on every board.
- **Partitions:** none: one global board (#2519 decision 1).
- **Recorded, not partitioned:** result (`Twenty48Result`): `final_score`, `highest_tile`, `move_count`, `duration_ms`, `outcome`. The opening board is event data (`game_started`'s `initial_board`), not metadata. The daily challenge reads `final_score` and `highest_tile` from the result.
- **Max value:** none (#2519 decision 14).
- **Outcomes:** `has_winner = True` (#2631). One session per game, closed as:
  - `win` when the 2048 tile appears, with `final_score` = the score at that moment. Keep Playing after it is untracked, so later points are not ranked.
  - `loss` on a game over without 2048, with `final_score` = the score at game over.
  - `abandoned` on New Game during play, or on leaving the screen, with the result block (its `final_score` included, for the daily challenge) but no `final_score` column, so it never ranks.
  - Older builds sent `completed` (game over) and `kept_playing` (Keep Playing); those rows stay valid. The server stores one as `win` when it closed the session that first reached 2048, i.e. its `highest_tile` is 2048 or more and its `initial_board` is below 2048 (`backend/games/legacy_outcomes.py`, #2703). The rest stay as sent, a finish with no winner.
- **Duration:** 2048's own timer (`startedAt` / `accumulatedMs` on the game state, `computeDurationMs` in `Twenty48Screen.tsx`). It wins over `useGameSync`'s window. It runs from the session's first move and pauses while another screen covers the board (`pauseGame` / `resumeGame` on navigation `blur` / `focus`, #2743). It does **not** pause when the app goes to the background, so backgrounded time is counted. `accumulatedMs` is added to only on a pause or at game over, and a relaunch resets `startedAt` to the relaunch time (`Twenty48Screen.tsx`), so play since the last pause is lost when the app is killed (#2750).
- **How it reaches the server:** the `useGameSync("twenty48")` session row, validated by the backend module (see [Backend](#backend)). `SyncWorker` sends `POST /games` once the player has moved, and `PATCH /games/{id}/complete`. If the player has a display name (`PUT /players/me`), the row ranks with no further step. The board shows each named player's best game once. Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **Where the player sees it:** the win and game-over cards show the game's rank through `sessionBoardAdapter` (`GET /games/{id}/rank`), once per session, or ask once for a display name; never on an abandon. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen (#2633). Stats (#2635) are in the ⋯ menu.

## Client-Side Engine

- Location: `frontend/src/game/twenty48/engine.ts`
- Key exports: `applySwipe(state, direction) → GameState`, tile spawn logic, merge scoring, game-over detection
- Storage: `frontend/src/game/twenty48/storage.ts`
- Types: `frontend/src/game/twenty48/types.ts`

## Backend

Gameplay is fully client-side; sessions reach the server through the shared `SyncWorker` pipeline.

- Module: `backend/twenty48/module.py`, registered in `backend/games/registry.py` (#2623)
- Metadata model: `Twenty48Metadata` in `backend/twenty48/models.py` — empty (extra keys forbidden); the opening board is event data
- Result model: `Twenty48Result` — `final_score`, `highest_tile`, `move_count`, `duration_ms`, `outcome`, all optional; unknown keys are ignored. The daily challenge reads `final_score` and `highest_tile` from it
- Board: `final_score` desc, one global board, no cap, one entry per player. `has_winner = True` (#2631); an older build's `completed` / `kept_playing` completion is stored as `win` when it closed the session that first reached 2048 (its `game_started` event's `initial_board` is below 2048), otherwise it counts as a finish with no winner (#2703, `backend/games/legacy_outcomes.py`)
- Stats: default pass-through `stats_shape`

## Entitlement

Tier TBD. If free: no entitlement check — game is always accessible.

## Known Issues / Limitations

- #2750: the play timer counts backgrounded time and loses the time played before an app kill (see [Scoring](#scoring-persistence), Duration)

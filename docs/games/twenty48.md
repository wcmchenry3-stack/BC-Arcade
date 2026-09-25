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

Sessions are recorded through the shared `/games` pipeline (`useGameSync("twenty48")`) and validated by the backend module (see [Backend](#backend)). One session per game, closed as (#2631):

- `win` when the 2048 tile appears; `final_score` = the score at that moment. Keep Playing after it is untracked, so later points are not ranked.
- `loss` on a game over without 2048; `final_score` = the score at game over.

Older builds sent `completed` (game over) and `kept_playing` (Keep Playing); those rows stay valid. The result card shows the game's rank through the shared `sessionBoardAdapter` (`GET /games/{id}/rank`), once per session, never on an abandon.

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
- Board: `final_score` desc, one global board, no cap, one entry per player. `has_winner = True` (#2631); an older build's `kept_playing` completion counts like `completed`
- Stats: default pass-through `stats_shape`

## Entitlement

Tier TBD. If free: no entitlement check — game is always accessible.

## Known Issues / Limitations

- The result card shows the rank, but the app has no Twenty48 leaderboard view yet

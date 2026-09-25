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

`final_score` = cumulative merge score at game over. Sessions are recorded through the shared `/games` pipeline (`useGameSync("twenty48")`) and validated by the backend module (see [Backend](#backend)).

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
- Board: `final_score` desc, one global board, no cap. `has_winner = True` (reaching 2048 is a win)
- Stats: default pass-through `stats_shape`

## Entitlement

Tier TBD. If free: no entitlement check — game is always accessible.

## Known Issues / Limitations

- Board is declared, but no leaderboard submission or view yet

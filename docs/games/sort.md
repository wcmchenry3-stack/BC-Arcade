# Bottle Sort

**Category:** Puzzle
**Tier:** Free (v1.0 store build; swapped with Mahjong, owner decision 2026-09-24)
**Status:** In Development

## How to Play

Bottle Sort (also called Color Sort) is a logic puzzle. A set of bottles contains colored liquid layers. Pour liquid from one bottle into another to sort each bottle so it contains only one color.

### Rules

- Each bottle holds up to 4 layers of liquid
- You can only pour the top layer of one bottle into another if:
  - The destination bottle's top color matches the source's top color (or the destination is empty)
  - The destination bottle has enough empty space to receive the pour
- A pour transfers all contiguous matching-color layers from the source at once
- The puzzle is solved when every bottle is either empty or contains a single uniform color

### Level Progression

There are 23 levels, increasing in difficulty (3 to 14 colors). The app loads them from `GET /sort/levels`, which generates them on each request (`build_levels` in `backend/sort/generate_levels.py`, `LEVEL_SPECS`), so a level's color and bottle counts are fixed but its mixture is new each time. The app caches the last set for offline play. Completing a level unlocks the next.

## Scoring (Persistence)

Every level played is its own session row (#2625): progress is not carried in one session.

- **Metric and direction:** `level_reached` (a result key in `games.metadata`), higher is better, labelled `level` (`board` in `backend/sort/module.py`; `BOARDS.sort` in `frontend/src/api/vocab.ts`). It is the player's frontier after the solve: the highest level they have solved, capped at the last level. The same value goes in `final_score`.
- **Tie-break:** none of its own: players on the same level rank by the earlier `completed_at`, every board's final tie-break. There is no moves tie-break (#2746): levels are generated fresh on each `GET /sort/levels` (see [Level Progression](#level-progression)), so two players' moves on the same level number are moves on different puzzles. Fixed, seeded levels that would make a moves tie-break fair are filed separately for after launch.
- **Partitions:** none: one board.
- **Recorded, not partitioned:** result (`SortResult`): `level` (the level actually played), `moves`, `undos`, `won`, and `total_moves`, the sum of the player's best moves on levels 1 to `level_reached` (`@sort/best_moves` on the device; left out when one of those levels has no best on record). `total_moves` was the tie-break until #2746 and is no longer ranked.
- **Max value:** 23, the number of levels. `level_reached` and `total_moves` must be integers (`StrictInt`); `total_moves` is at most 2³¹−1.
- **Outcomes:** `has_winner = False`. Every solve, a replay included, records `completed` scored with the player's standing after it (`SortScreen.tsx`). The board keeps each player's best row: their first solve of their highest level. A replay never displaces it, even one that lowers a best move count. Leaving a level unsolved records `abandoned` with `{ won: false, level, moves }` and no score: going back to the level grid, resetting the level, or leaving the screen.
- **Duration:** `useGameSync`'s active-play window; Sort sends no duration of its own. Entering or restarting a level restarts the window (`resetPlayWindow`), so time on the level grid is not counted.
- **How it reaches the server:** the `useGameSync("sort")` session row, opened at the level's first pour. `SyncWorker` sends `POST /games` and `PATCH /games/{id}/complete`. If the player has a display name (`PUT /players/me`), the row ranks with no further step. The board shows each named player's best row once. The legacy `POST /sort/score` was removed in #2644, and the unattributable rows it wrote (`sort-anon`) were deleted (#2622). Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **Where the player sees it:** the level's win card shows the rank through `sessionBoardAdapter` (`GET /games/{id}/rank`), or asks once for a display name. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen (#2633). Stats (#2635) are in the ⋯ menu; "Best" there is the highest level reached.

## Client-Side Engine

- Location: `frontend/src/game/sort/engine.ts`
- Key exports: `validatePour(state, from, to) → boolean`, `applyPour(state, from, to) → GameState`, win detection
- Level data: fetched from `GET /sort/levels` and cached on the device for offline play (`frontend/src/game/sort/storage.ts`)

## Backend

- Module: `backend/sort/module.py`
- Endpoints: `backend/sort/router.py`. `GET /sort/levels` serves the levels. The legacy `POST /sort/score` and `GET /sort/scores` were removed in #2644.
- Level data: generated per request by `backend/sort/generate_levels.py` (`build_levels`); nothing is saved to disk. `python -m sort.verify_levels [--seed N] [--runs N]` (from `backend/`) BFS-checks freshly built sets for solvability.
- Metadata model: `SortMetadata` — `player_name: str = ""` (max 32 chars). Current builds send no metadata.
- Result model: `SortResult` — `level`, `moves`, `undos`, `level_reached`, `total_moves`, `won`, `outcome`, all optional
- Scoring: see [Scoring](#scoring-persistence)

## Entitlement

Free: no entitlement check.

## Known Issues / Limitations

- Levels are random per request, so players on the same level are not ranked by moves, only by who got there first (#2746; see [Scoring](#scoring-persistence), Tie-break)

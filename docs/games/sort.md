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

There are 23 levels, increasing in difficulty (3 to 14 colors). Completing a level unlocks the next.

**Current v1 behavior:** `GET /sort/levels` generates a fresh solvable set on each request. A level number fixes its size/difficulty specification, not the exact bottle arrangement. The app caches the last fetched set for offline play.

Every generated level is solver-verified before it is served. A candidate shuffle that is proven dead or cannot be proven solvable within the solver budget is discarded and regenerated; the API fails rather than knowingly serving an unproven board.

**Future product decision:** #2761 proposes fixed seeded levels so "Level N" becomes the same puzzle for every player and move counts can become comparable again. That is not current behavior.

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

## Hint, Undo, Reset, and Level Navigation

- **Hint:** runs the client-side solver asynchronously and returns the next suggested pour for the current board. A result computed for a board the player has already restarted or left is discarded rather than applied to stale state.
- **Undo:** restores the previous bottle state and tracks the undo in the result metadata. It is disabled when there is no history.
- **Reset/restart:** abandoning or resetting an in-progress level closes the active server session as abandoned once play has begun, then resets the active-play window for the new attempt.
- **Level grid:** time spent browsing/selecting levels is not part of a level's active-play duration.
- **Offline:** the cached level set remains playable when the level endpoint is unavailable.

## Client-Side Engine

- Location: `frontend/src/game/sort/engine.ts`
- Key exports: `validatePour(state, from, to) → boolean`, `applyPour(state, from, to) → GameState`, win detection
- Level data: fetched from `GET /sort/levels` and cached on the device for offline play (`frontend/src/game/sort/storage.ts`)

## Backend

- Module: `backend/sort/module.py`
- Endpoints: `backend/sort/router.py`. `GET /sort/levels` serves the levels. The legacy `POST /sort/score` and `GET /sort/scores` were removed in #2644.
- Level data: generated per request by `backend/sort/generate_levels.py` (`build_levels`); nothing is saved to disk. Every level is proven solvable before it is served (#2764). Each level is a uniform random shuffle, dealt again until `backend/sort/fast_solver.py` proves a solution exists. A deal it proves dead, or can't decide within `SOLVER_BUDGET` (200,000 states), is thrown away. If `MAX_ATTEMPTS` (5,000) deals of one level all fail, `build_levels` logs an error and raises `LevelGenerationError`, so the request fails with a 500 rather than serve an unproven level. With the measured solvable rates that can't practically happen: the rarest is about 1% of deals at 9 colors with one empty bottle, so the odds are about 1e-23. A request takes about 0.25 s on average (p95 about 0.5 s).
- Solver: `fast_solver.solve(bottles, budget)` returns a `Result`. Its verdict is `True`, `False` (proven: the whole reachable space was searched) or `None` (budget spent), and a `True` verdict comes with the solution's pours as indices into the level's bottles. It ignores bottle order, drops full single-colour bottles, and searches best-first. It decides every level in well under a second; the most states any deal has needed is about 40,000. `DEPTH` (units per bottle) is defined there once for the backend; the frontend's `BOTTLE_DEPTH` must match it.
- Checks: `python -m sort.verify_levels [--seed N] [--runs N]` (from `backend/`) runs the solver over freshly built sets and replays each solution. `verify_levels.py` also holds a reference pour simulator written independently of the solver. Its `is_solution` replays a solution pour by pour and checks that the level ends solved, so a "solvable" verdict is certified without trusting the solver's pruning.
  - In CI, `backend/tests/test_sort_levels_solvable.py` solves every level of 20 fixed-seed sets and replays each solution this way. It also checks the small levels with the reference BFS in the same module.
  - `test_sort_fast_solver.py` checks that the solver agrees with that BFS.
  - `python scripts/sort_solvability_survey.py` (from `backend/`) measures the unsolvable rate over many sets or raw shuffles.
- Metadata model: `SortMetadata` — `player_name: str = ""` (max 32 chars). Current builds send no metadata.
- Result model: `SortResult` — `level`, `moves`, `undos`, `level_reached`, `total_moves`, `won`, `outcome`, all optional
- Scoring: see [Scoring](#scoring-persistence)

## Entitlement

Free: no entitlement check.

## Progression / comparability decision still open

The current random-per-request model means two players at "Level 19" may have solved different arrangements. That is why v1 deliberately has **no move-count tie-break**; players tied on highest level fall through to the shared completion-time tie-break.

#2761 is the post-launch proposal to replace this with fixed seeded levels and restore a fair move-count comparison. Until that ships, documentation and leaderboard configuration must continue to describe levels as difficulty slots with fresh arrangements, not fixed puzzles.

Older devices can still hold a pre-#2764 cached set containing an unsolvable board until they refresh their level set; newly generated sets are solver-verified.

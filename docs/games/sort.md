# Bottle Sort

**Category:** Puzzle
**Tier:** Free (v1.0 store build; swapped with Mahjong, owner decision 2026-09-24)
**Status:** Shipping — free in the v1.0 store build

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

There are 120 levels in 6 chapters of 20, from 3 to 14 colours (#2761). Completing a level unlocks the next.

Every player gets the same level N: the levels are a fixed catalog shipped inside the app (`frontend/src/game/sort/levels.catalog.json`), so they work offline and nothing is generated or fetched per visit. Because level N is one puzzle for everyone, move counts compare, and the leaderboard breaks ties on fewest total moves again (see [Scoring](#scoring-persistence)). This settles #2738.

**The catalog.** `backend/scripts/sort_build_catalog.py` (run from `backend/`) builds it from a fixed seed; the same seed gives the same file byte for byte. For each `(colours, empty bottles)` spec it deals candidates with `deal_level` (uniform shuffles that `fast_solver` proves solvable, never already solved), drops deals that are the same puzzle up to colour names and bottle order (`canonical`: an exact canonical form up to 6 colours; above that a fingerprint built only from the deal's structure, so a duplicate is never missed and a different deal could at worst be dropped too), and measures each:

- **length:** the number of pours in `fast_solver`'s solution (best-first, not the shortest);
- **trap rate:** the share of 24 seeded random plays (12 random non-trivial pours each) that end on a board `fast_solver` proves dead;
- **openings:** the number of distinct first pours.

Within a spec's pool, difficulty is 60% the trap-rate percentile and 40% the length percentile (ties: fewer openings is harder). The _i_-th of the _n_ levels that use a spec takes the candidate at quantile `(i + 0.5) / n`, so each spec gets harder every time it comes back. A run takes about 9 s; the file is about 7 KB.

**The curve** (`CHAPTERS` in the script; one spec per level):

| Chapter | Levels  | Colours (empty bottles)                 | Par   |
| ------- | ------- | --------------------------------------- | ----- |
| 1       | 1–20    | 3–5 (2 or 1)                            | 7–20  |
| 2       | 21–40   | 5–7 (2 or 1)                            | 17–29 |
| 3       | 41–60   | 7–9 (2 or 1)                            | 22–37 |
| 4       | 61–80   | 9–11 (2), with 9-colour 1-empty spikes  | 29–46 |
| 5       | 81–100  | 11–13 (2), with 9-colour 1-empty spikes | 34–57 |
| 6       | 101–120 | 12–14 (2), with 9-colour 1-empty spikes | 35–63 |

One empty bottle makes a spec tight, two relaxed. One empty bottle stops at 9 colours: random 1-empty deals of 9 colours are about 99% dead, and 10 or more would take too many deals. Each chapter opens on easier specs than it ends on and drops back to an easier ("breather") spec now and then; mean par rises chapter on chapter and from the first half of each chapter to the second (`test_sort_catalog.py` checks both).

**Par.** Each level stores `par = ceil(1.15 × length)`, the move count a good solve meets; the per-level stars (#3687) read it. The solver's path isn't the shortest: on levels 1–60, where the shortest solution can be found by breadth-first search, it is 7% longer on average (25% at most). So par sits about 23% above the shortest solution: a careful solve makes par, a perfect one beats it by a few moves.

**Format.** `{ version, seed, legend, levels }`. `legend` lists the 14 colour names (letter `A` is `legend[0]`); a level is `[bottles, par]`, its bottles bottom first, one letter per unit, joined by `,` (an empty bottle is an empty string). `version` is the catalog version (now 1): raise it, in the script and in `backend/sort/catalog.py`, whenever the levels change. The app sends it with every scored solve and stores it with the player's progress.

**Moving a save onto the catalog.** Before the catalog, the levels were 23 random deals per visit. The first time a catalog build opens Sort, `catalogMigration.ts` moves the save over once:

- `unlockedLevel` maps by colour count: the old level the player had reached (the higher of their unlocked level and one past their highest solved level, at most 23) had some number of colours; they unlock up to the first catalog level with at least that many. Old level 10 (7 colours) unlocks up to level 30; a player who never got past old level 1 starts at 1.
- Best moves are dropped (stored as none): they were set on puzzles nobody else saw and can't be compared with the catalog's levels (they would also skew the moves tie-break).
- An unfinished board is dropped (it was an old random deal), and so is the old cache of server levels (`@sort/levels_cache`).
- Everything is read and computed first, then written in one batch (`setMany`): the migrated progress, the emptied bests and `@sort/catalog_version`. Until that write lands the old save is untouched, so a failure or a kill part-way just migrates again on the next load, from the same data. Only then is the old level cache removed (best-effort: nothing reads it). While a migration has failed, that session doesn't use the stored bests and offers no unfinished board.
- A save carrying a catalog version this build doesn't know (a newer build's, reachable only on a web rollback) is left untouched: the session plays from level 1 in memory and writes no progress.
- The unlock only lets the player play on. The leaderboard counts only levels solved on the catalog (see [Scoring](#scoring-persistence)).
- The level grid opens scrolled to the furthest unlocked level (`LockableGrid`'s `initialScrollIndex`), so a player unlocked to level 103 doesn't scroll 26 rows.

## File map

`frontend/src/screens/`

- `SortScreen.tsx`: the screen. Owns level flow, hint/undo/reset, the pour in flight, scoring and sync.

`frontend/src/components/sort/`

- `SortBoard.tsx`: the board. Lays out bottles in rows and draws the pour (tilt, stream, ghost liquid, win confetti).
- `BottleView.tsx`: one flask. Owns the flask shape and viewBox constants (`VB_W`, `VB_H`, `PAD_TOP`, `NECK_LEFT`, `NECK_RIGHT`, `BODY_BOTTOM`, `INNER_H`) that SortBoard imports.
- `gridGeometry.ts`: pure grid and bottle-size math, plus `BOARD_PADDING` / `BOARD_HORIZONTAL_PAD`, the one source for the board's padding.
- `LevelSelectScreen.tsx`: the level grid.

`frontend/src/game/sort/`

- `engine.ts`: pure rules (pour, undo, solved checks).
- `solver.ts`: solver used for hints.
- `types.ts`: state types and `BOTTLE_DEPTH`.
- `levels.catalog.json`: the 120 levels (generated; see [Level Progression](#level-progression)).
- `catalog.ts`: decodes the catalog (`SORT_LEVELS`, each level's `par`) and holds `SORT_CATALOG_VERSION`.
- `catalogMigration.ts`: moves a save from the random levels onto the catalog, once.
- `useSortLevels.ts`: the screen's view, the catalog's levels and the player's progress and bests (after the migration).
- `storage.ts`: local progress and best moves.
- `usePourAnimation.ts`: hook that sequences a pour in flight.
- `useSortAudio.ts` / `sounds.ts`: sound playback and the `sort.pour` / `sort.win` registry.

## Screen layout

Top to bottom (and the order a screen reader reads it), #3658:

1. **Header** (`GameShell` / `AppHeader`): back, the title, and the ⋯ menu. The menu holds New Game (restart the level), Level select, Leaderboard, Stats, **Colorblind Mode** (a checkable `menuToggle` item, test id `sort-colorblind-toggle`) and Feedback. Hint and Undo are no longer in the header, so the title has the room (it is not truncated at 390 pt, in es or fr-CA).
2. **HUD row** (`HudStatRow`): Level, Moves, Undos.
3. **Board** (`sort-board`, `flex: 1`): 16 pt side padding and 8 pt top and bottom padding (`BOARD_PADDING`, `BOARD_VERTICAL_PADDING`). `SortBoard` gets `availableHeight = boardHeight - 2 * 8`. The "No way to win" notice is an overlay in this container and never resizes the board.
4. **Action bar** (`sort-action-bar`, 56 pt, `SORT_ACTION_BAR_H`): the shared `GameActionBar` (also Mahjong's and 2048's), Hint (`sort-hint-button`, spinner while the solver runs) and Undo (`sort-undo-button`), each at least 44 x 44 pt. The gap under it is `GameShell`'s `GAME_SHELL_BOTTOM_GAP`, reserved once (#3624); the tab bar and home indicator sit below that.

**Hint** selects the source bottle and rings the destination (`hint-dst-ring`, drawn inside the destination's cell, in `colors.bonus`). The ring clears on any tap, a pour, an undo, a restart or a level change.

**Bottle size** (`computeBoardLayout` in `components/sort/gridGeometry.ts`): bottles fill the board. The 1:3 shape is kept; the size is the largest that fits the content height (rows share it, 8 pt `ROW_GAP`) and the content width (a cell per column, at least 12 pt between bottles), up to `MAX_BOTTLE_SCALE` (2x the 52x156 default, so at most 104x312). When a row has room to spare the gap grows to 0.2 of the bottle's width. The tap cell is never narrower than 48 pt and is the bottle's whole hit area (#2207). `BottleView` draws in a viewBox, so strokes, the ball symbols and the neck scale with it. The grid shape is still a function of the bottle count only (single row up to 4, at most 3 a row for 5-6, at most 4 for 7 and up). A wider grid (5 a row) was checked for 12 and 16 bottles: both are height-limited, so more columns only mean the same rows or more of them, and no bottle gets bigger; 4 a row stays.

Measured on a 390 x 844 phone. The board container was 639 tall before (31 pt of the screen was the Colorblind row, now gone); it is 614 now with the 56 pt bar, so the content box is 358 x 598 (it was 358 x 607):

| Bottles | Before (pt)  | After (pt)   | Tap cell after |
| ------- | ------------ | ------------ | -------------- |
| 4       | 52 x 156     | 77.5 x 232.5 | 89.5 wide      |
| 8       | 52 x 156     | 77.5 x 232.5 | 89.5 wide      |
| 12      | 52 x 156     | 64.7 x 194   | 77.6 wide      |
| 16      | 47.6 x 142.8 | 47.8 x 143.5 | 59.8 wide      |

The after numbers are pinned in `gridGeometry.test.ts` ("390x844 phone"). The 16-bottle level is height-limited, so the 8 pt row gap and 8 pt vertical padding are what pay for the 56 pt bar; it ends 0.2 pt wider than before.

## Motion

To be written by #3660.

## Scoring (Persistence)

Every level played is its own session row (#2625): progress is not carried in one session.

- **Metric and direction:** `level_reached` (a result key in `games.metadata`), higher is better, labelled `level` (`board` in `backend/sort/module.py`; `BOARDS.sort` in `frontend/src/api/vocab.ts`). It is the player's frontier after the solve: the highest level they have solved on the catalog (the level just solved, or the highest with a best on record), capped at the last level. It never comes from the unlocked level: a save moved from the random levels unlocks far ahead (say level 103) without having solved anything on the catalog, so its first solve of level 1 sends `level_reached` 1, not 102 (#2761). The same value goes in `final_score`.
- **Tie-break:** `total_moves` ascending: on the same level, fewer total moves ranks higher; then the earlier `received_at` (server receipt time), every board's final tie-break. The moves tie-break was dropped in #2746 while levels were random per request and came back with the catalog (#2761): level N is the same puzzle for everyone. A row with no `total_moves` ranks after every row with one on its level.
- **Board reset (#2761):** the board's `edition` is `("catalog_version", 1)`: only rows whose result carries `catalog_version: 1` rank, or count as a player's "Best" in stats. Rows from the random levels, including solves still sent by app builds from before the catalog, carry none: they stay stored (history, XP, stats totals) but never rank. No migration and no delete; nothing grows. A future catalog that changes the levels raises the version, which resets the board the same way.
- **When the reset takes effect: `SORT_CATALOG_EDITION_ENFORCED`** (env var, default off; the board's `edition_switch`, read by `backend/games/boards/editions.py`). The backend deploys on merge to `main`, long before the store builds that send `catalog_version` reach players. While the switch is off, the Sort board and Stats "Best" rank every row as before the reset (the 120 cap and the moves tie-break already apply). **Release step:** once the catalog builds are live on both stores, the owner sets `SORT_CATALOG_EDITION_ENFORCED=true` on `bc-arcade-api` and redeploys; from then on only catalog rows rank. No app release, no migration; unset it (and redeploy) to undo. See [RENDER.md](../RENDER.md#environment-variables). The metadata grows by `"catalog_version":1`, 20 bytes per completed level row, well inside the existing row.
- **Partitions:** none: one board.
- **Recorded, not partitioned:** result (`SortResult`): `level` (the level actually played), `moves`, `undos`, `won`, `catalog_version`, and `total_moves`, the sum of the player's best moves on levels 1 to `level_reached` (`@sort/best_moves` on the device; left out when one of those levels has no best on record, e.g. after a save moved onto the catalog).
- **Max value:** 120, the number of catalog levels (`LEVEL_COUNT` in `backend/sort/catalog.py`). `level_reached` and `catalog_version` must be integers (`StrictInt`), as must `total_moves` (at most 2³¹−1); `level_reached` and `level` are at most 120.
- **Outcomes:** `has_winner = False`. Every solve, a replay included, records `completed` scored with the player's standing after it (`SortScreen.tsx`). The board keeps each player's best row: their highest level, then their lowest total. A replay that lowers a best move count lowers the total and becomes the best row. Leaving a level unsolved records `abandoned` with `{ won: false, level, moves }` and no score: going back to the level grid, resetting the level, or leaving the screen.
- **Duration:** `useGameSync`'s active-play window; Sort sends no duration of its own. Entering or restarting a level restarts the window (`resetPlayWindow`), so time on the level grid is not counted.
- **How it reaches the server:** the `useGameSync("sort")` session row, opened at the level's first pour. `SyncWorker` sends `POST /games` and `PATCH /games/{id}/complete`. If the player has a display name (`PUT /players/me`), the row ranks with no further step. The board shows each named player's best row once. The legacy `POST /sort/score` was removed in #2644, and the unattributable rows it wrote (`sort-anon`) were deleted (#2622). Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **Where the player sees it:** the level's win card shows the rank through `lookupGameRank` (`GET /games/{id}/rank`), or asks once for a display name. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen (#2633). Stats (#2635) are in the ⋯ menu; "Best" there is the highest level reached.

## Hint, Undo, Reset, and Level Navigation

- **Hint:** runs the client-side solver (`frontend/src/game/sort/solver.ts`, the backend's `fast_solver` method; see [Client-Side Engine](#client-side-engine)) asynchronously, only when the player taps Hint (no background solving), via `solveBoardAsync`. A solvable board selects the first pour of a solution (it finds one on every level, including the two-empty-bottle levels from 11 up that the old plain BFS gave up on, #3686). An "unsolvable" verdict shows `HintNotice` (`components/sort/HintNotice.tsx`) between the HUD and the board: "No way to win from here" with **Back to last good move** and **Restart level**, dismissible, announced to screen readers (#2768). An "unknown" verdict (budget spent) shows "Couldn't find a hint". The same happens for a dead board restored with "Continue level N". A result computed for a board that has since changed (restart, level change, a pour or an undo after the tap, tracked by `levelGenRef`) is discarded, not applied.
- **Undo:** restores the previous bottle state and tracks the undo in the result metadata. It is disabled when there is no history.
- **Back to last good move** (from the dead-board notice): undoes the player's own moves, one undo per move (so `undosUsed` rises by the number of moves taken back), back to the most recent position that can still be won. After the tap it binary-searches the history (a dead board stays dead, so about log2 n solves, capped at 24 solves or 8 s) for the newest state the solver proves solvable, including the oldest one (a restored board has no level start behind it). Only "solvable" counts; "unknown" is treated as not winnable. Each step back is an undo, so `undosUsed` rises by the number of steps. If no history state is proven solvable the board is left alone and the notice offers Restart only. The notice is an overlay at the top of the board area, so it never resizes the board.
- **Reset/restart:** abandoning or resetting an in-progress level closes the active server session as abandoned once play has begun, then resets the active-play window for the new attempt. The notice's **Restart level** reuses this flow (`handleResetLevel`) and returns to the level's starting board; there is no new deal.
- **Level grid:** time spent browsing/selecting levels is not part of a level's active-play duration.
- **Offline:** the levels ship in the app (#2761), so every level is playable offline.

## Client-Side Engine

- Location: `frontend/src/game/sort/engine.ts`
- Key exports: `validatePour(state, from, to) → boolean`, `applyPour(state, from, to) → GameState`, win detection
- Screen: [`frontend/src/screens/SortScreen.tsx`](../../frontend/src/screens/SortScreen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- Solver: `frontend/src/game/sort/solver.ts` is a port of `backend/sort/fast_solver.py`: a state is keyed with its bottles sorted, full single-colour bottles are dropped, only the first empty bottle is tried (and no single-colour bottle is poured into an empty one), and the search is best-first on `runs - colours`, ties newest-first (a small binary min-heap, no dependency). A single generator drives both the sync and async paths; the async one yields to the event loop every 8 ms or 1,000 expanded states, whichever comes first. `solveBoard(state, budget?)` / `solveBoardAsync` return `{ verdict: "solvable", moves }` (pours as indices into the board as shown), `{ verdict: "unsolvable" }` (proven: the whole reachable space was searched) or `{ verdict: "unknown" }` (budget spent). `solve`, `solveAsync` and `getNextHintAsync` keep their `Move[] | null` / first-pour shape (null for unsolvable and unknown). The budget is 200,000 states, as in the generator. Measured worst case over 20 fixed-seed sets of all 23 levels: 7,894 states (seed 6, level 22). The old BFS (bottle order kept in its key, 200,000 cap) hit its cap and returned null on every two-empty level from 11 up (about 3 to 6 s each in a Python port of it, seed 7).
- Parity fixture: `frontend/src/game/sort/__tests__/fixtures/solverParity.json` holds 20 level sets, plus proven-dead boards and mid-game positions, each with `fast_solver`'s verdict and visited-state count (boards are one-letter-per-unit strings, `""` for an empty bottle). `solver.parity.test.ts` requires the same verdict, the same search (it solves with the backend's own state count as the budget), and replays each solution with `applyPour`. Regenerate it with `python scripts/sort_export_solver_fixture.py` (from `backend/`) whenever `fast_solver` or `build_levels` changes; `backend/tests/test_sort_solver_fixture.py` fails if the committed file is stale.
- Level data: the catalog shipped in the app (`frontend/src/game/sort/levels.catalog.json`, read by `catalog.ts`); nothing is fetched.

## Backend

- Module: `backend/sort/module.py`
- Endpoints: `backend/sort/router.py`. `GET /sort/levels` serves 23 random levels to app builds from before the catalog only; the current app never calls it (#2761), and it is to be removed once those builds are retired. The legacy `POST /sort/score` and `GET /sort/scores` were removed in #2644.
- Catalog: `backend/sort/catalog.py` holds what the server knows of the app's catalog: `CATALOG_VERSION` (the board's `edition`) and `LEVEL_COUNT` (the cap). `scripts/sort_build_catalog.py` builds the catalog (see [Level Progression](#level-progression)); `tests/test_sort_catalog.py` regenerates it in memory and fails if the committed file differs, checks it against those constants and the curve, and solves every level with `fast_solver`, replaying the pours with `is_solution` and checking each level's par.
- Legacy level data: generated per request by `backend/sort/generate_levels.py` (`build_levels`) for `GET /sort/levels`; nothing is saved to disk. Every level is proven solvable before it is served (#2764). Each level is a uniform random shuffle, dealt again until `backend/sort/fast_solver.py` proves a solution exists. A deal it proves dead, or can't decide within `SOLVER_BUDGET` (200,000 states), is thrown away. If `MAX_ATTEMPTS` (5,000) deals of one level all fail, `build_levels` logs an error and raises `LevelGenerationError`, so the request fails with a 500 rather than serve an unproven level. With the measured solvable rates that can't practically happen: the rarest is about 1% of deals at 9 colors with one empty bottle, so the odds are about 1e-23. A request takes about 0.25 s on average (p95 about 0.5 s).
- Solver: `fast_solver.solve(bottles, budget)` returns a `Result`. Its verdict is `True`, `False` (proven: the whole reachable space was searched) or `None` (budget spent), and a `True` verdict comes with the solution's pours as indices into the level's bottles. It ignores bottle order, drops full single-colour bottles, and searches best-first. It decides every level in well under a second; the most states any deal has needed is about 40,000. `DEPTH` (units per bottle) is defined there once for the backend; the frontend's `BOTTLE_DEPTH` must match it.
- Checks: `python scripts/sort_verify_levels.py [--seed N] [--runs N]` (from `backend/`) runs the solver over freshly built sets and replays each solution. `scripts/sort_verify_levels.py` also holds a reference pour simulator written independently of the solver. Its `is_solution` replays a solution pour by pour and checks that the level ends solved, so a "solvable" verdict is certified without trusting the solver's pruning.
  - In CI, `backend/tests/test_sort_levels_solvable.py` solves every level of 20 fixed-seed sets and replays each solution this way. It also checks the small levels with the reference BFS in the same module.
  - `test_sort_fast_solver.py` checks that the solver agrees with that BFS.
  - `python scripts/sort_solvability_survey.py` (from `backend/`) measures the unsolvable rate over many sets or raw shuffles.
- Metadata model: `SortMetadata` — `player_name: str = ""` (max 64 chars, `LegacyPlayerName`; 32 before #2995). Current builds send no metadata.
- Result model: `SortResult` — `level`, `moves`, `undos`, `level_reached`, `total_moves`, `catalog_version`, `won`, `outcome`, all optional
- Scoring: see [Scoring](#scoring-persistence)

## Colour palette

The 14 liquid colours live in `BOTTLE_LIQUID_COLORS` (`frontend/src/theme/theme.bottle.ts`), one set per theme. Each set must keep every colour at 3:1 contrast or better against its theme background and every pair at CIEDE2000 delta-E 20 or better. Whenever you change them, update the copy in `tools/assets/check_palette.py` and run `python tools/assets/check_palette.py` (needs `tools/assets/requirements.txt`). Nothing runs it automatically. What it checks, the exact output to expect and its limits are in [`tools/README.md`](../../tools/README.md#sort-palette-check-check_palettepy).

## Entitlement

Free: no entitlement check.

## Progression / comparability

Settled by #2761: every player gets the same fixed catalog of 120 levels, so "Level 19" is one puzzle for everyone and moves compare. The leaderboard was reset when the catalog shipped (only `catalog_version` 1 rows rank) and ranks fewest total moves on a tie again. Stars per level (#3687) build on each level's `par`.

## Sound

Registry: `frontend/src/game/sort/sounds.ts` (`SORT_SOUNDS`), played through the shared `useSound` hook, which honours the player's sound setting. The effects are being replaced with original synthesized sounds shared across the puzzle, tile and dice games (#3578); the reasoning behind each is in the [puzzle sound design log](puzzle-sound-design.md). Volume is `useSound`'s default (1.0) unless noted.

Triggers are in `frontend/src/screens/SortScreen.tsx` (via `frontend/src/game/sort/useSortAudio.ts`).

| Key         | File                                  | Plays when          | Volume |
| ----------- | ------------------------------------- | ------------------- | ------ |
| `sort.pour` | `cascade-fruit-merge.ogg` (Cascade's) | a pour starts       | 1.0    |
| `sort.win`  | `freecell-game-win.mp3` (FreeCell's)  | the level is solved | 1.0    |

A refused pour has no sound.

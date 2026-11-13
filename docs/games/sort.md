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
- The level grid opens scrolled to the furthest unlocked level (`LockableGrid`'s `initialScrollIndex`), so a player unlocked to level 103 doesn't scroll 26 rows. The scroll offset includes the chapter headers above the row.

### Stars (#3687)

A solve earns 1 to 3 stars against the level's `par`, by moves alone (undo costs nothing; undos are still recorded):

| Stars | Moves                      |
| ----- | -------------------------- |
| 3     | at most `par`              |
| 2     | at most `ceil(par × 1.25)` |
| 1     | more than that             |

The thresholds live in `frontend/src/game/sort/stars.ts` (`starsFor`, `twoStarMoves`) and nowhere else; `stars.test.ts` pins them at par, at `ceil(par × 1.25)` and one past each. `par` is already about 23% above the shortest solution (see [Par](#level-progression)), so 3 stars asks for a careful solve and 2 stars for a loose one.

**A level's best stars are derived, not stored.** `bestStarsFor(bests, level, par)` reads the level's best moves (`@sort/best_moves`) and its `par`, so there is one copy of the truth, nothing to keep in step, and a save from before stars needs no migration. (The best moves are the lowest, so they give the best stars.) A level with no best, or with no known par, has 0 stars.

**The result card** shows this solve's stars (`SolveStars`, passed through the card's `detail` slot, so no other game's card changes) and "Moves N · Target P". It keeps the NEW BEST pill. **The level grid** shows each unlocked tile's best stars under its number (`StarRow`): filled stars for what is earned and outlined stars for the rest, so an unsolved level shows three outlines (the goal, and a steady tile height). A locked tile is unchanged: no stars. The count is carried by shape (filled vs outlined), not colour alone. Colours are existing tokens (`celebration` for a filled star, `textMuted` for an outline), each at least 3:1 on `surfaceHigh` (`starsContrast.test.ts`). **Screen readers:** a tile reads "Level 5, 2 of 3 stars" (just "Level 5" while unsolved, "Level 5, locked" while locked); the result card's stars read "2 of 3 stars. Moves 6, target 7."; the star icons themselves are hidden from the accessibility tree. Tiles are at least 44 pt.

**Chapters.** The grid has six "Chapter N" headers (`CHAPTER_SIZE` = 20 levels each), accessible headings (`accessibilityRole="header"`). `LockableGrid` takes optional `sectionSize` / `sectionTitleOf` for this; without them (Mahjong's layout picker) it renders as before. It stays a plain `ScrollView`: 120 small tiles and 6 headers are about 500 views, which a mid-range phone lays out once, while a virtualised list would break the shared grid's `initialScrollIndex` scroll and its row padding. Not measured on a device; revisit if the catalog grows.

**Result metadata.** The completed level's result carries `stars` (an integer 1 to 3, on the row already sent): about 10 bytes (`,"stars":2`) per completed level row, no new rows or requests, no new storage. It doesn't change ranking.

## File map

`frontend/src/screens/`

- `SortScreen.tsx`: the screen. Owns level flow, hint/undo/reset, the pour in flight, scoring and sync.

`frontend/src/components/sort/`

- `SortBoard.tsx`: the board. Lays out bottles in rows and draws the pour (tilt, stream, ghost liquid, win cascade).
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
- `stars.ts`: the star thresholds and a level's derived best stars (see [Stars](#stars-3687)).
- `usePourAnimation.ts`: hook that sequences a pour in flight.
- `motion.ts`: every duration, ceiling and shape constant of [Motion](#motion-3660), and `pourTimeline(units)`. `haptics.ts`: the per-event haptics.
- `useSortAudio.ts` / `sounds.ts`: sound playback and the `sort.pour` / `sort.win` registry.

## Screen layout

Top to bottom (and the order a screen reader reads it), #3658:

1. **Header** (`GameShell` / `AppHeader`): back, the title, and the ⋯ menu. The menu holds New Game (restart the level), Level select, Leaderboard, Stats, **Colorblind Mode** (a checkable `menuToggle` item, test id `sort-colorblind-toggle`) and Feedback. Hint and Undo are no longer in the header, so the title has the room (it is not truncated at 390 pt, in es or fr-CA).
2. **HUD row** (`HudStatRow`): Level, Moves, Undos.
3. **Board** (`sort-board`, `flex: 1`): 16 pt side padding and 8 pt top and bottom padding (`BOARD_PADDING`, `BOARD_VERTICAL_PADDING`). `SortBoard` gets `availableHeight = boardHeight - 2 * 8`. The "No way to win" notice is an overlay in this container and never resizes the board.
4. **Action bar** (`sort-action-bar`, 54 pt, `SORT_ACTION_BAR_H`): the shared `GameActionBar` (also Mahjong's and 2048's), Hint (`sort-hint-button`, spinner while the solver runs) and Undo (`sort-undo-button`), each at least 44 x 44 pt. The gap under it is `GameShell`'s `GAME_SHELL_BOTTOM_GAP`, reserved once (#3624); the tab bar and home indicator sit below that.

**Hint** selects the source bottle and rings the destination (`hint-dst-ring`, drawn inside the destination's cell, in `colors.bonus`). The ring clears on any tap, a pour, an undo, a restart or a level change. The ring is hidden from screen readers, so the destination bottle's label gains ". Hint: pour here" (`a11y.hintDestination`) while it is the destination.

**Colorblind Mode symbols** (`COLORBLIND_SYMBOLS` in `BottleView.tsx`) are single plain text glyphs with no emoji property at all (so no presentation selector is needed inside SVG text on Android), one shape family per colour: ▲ ● ■ ★ ⬡ ◆ ✱ ✚ ↑ ✿ ♪ ∞ ☾ ✕. A test pins that none is emoji-capable and that all families differ. How the system fonts draw them was not checked on a device.

**Bottle size** (`computeBoardLayout` in `components/sort/gridGeometry.ts`): bottles fill the board. The 1:3 shape is kept; the size is the largest that fits the content height (rows share it, 8 pt `ROW_GAP`) and the content width (a cell per column, at least 12 pt between bottles), up to `MAX_BOTTLE_SCALE` (2x the 52x156 default, so at most 104x312). When a row has room to spare the gap grows to 0.2 of the bottle's width. The tap cell is never narrower than 48 pt and is the bottle's whole hit area (#2207). `BottleView` draws in a viewBox, so strokes, the ball symbols and the neck scale with it. The grid shape is still a function of the bottle count only (single row up to 4, at most 3 a row for 5-6, at most 4 for 7 and up). A wider grid (5 a row) was checked for 12 and 16 bottles: both are height-limited, so more columns only mean the same rows or more of them, and no bottle gets bigger; 4 a row stays.

Measured on a 390 x 844 phone. The board container was 639 tall before (31 pt of the screen was the Colorblind row, now gone); it is 616 now with the 54 pt bar, so the content box is 358 x 600 (it was 358 x 607):

| Bottles | Before (pt)  | After (pt)   | Tap cell after |
| ------- | ------------ | ------------ | -------------- |
| 4       | 52 x 156     | 77.5 x 232.5 | 89.5 wide      |
| 8       | 52 x 156     | 77.5 x 232.5 | 89.5 wide      |
| 12      | 52 x 156     | 64.9 x 194.7 | 77.9 wide      |
| 16      | 47.6 x 142.8 | 48 x 144     | 60 wide        |

The after numbers are pinned in `gridGeometry.test.ts` ("390x844 phone"). The 16-bottle level is height-limited, so the 8 pt row gap and 8 pt vertical padding are what pay for the 54 pt bar; it ends 0.4 pt wider than before.

Smaller phones (375 x 667 and 360 x 640; their old board heights are estimated from the 390 x 844 one minus the height and safe-area differences, not measured) were checked too: at every bottle count from 4 to 16, bottles are at least as wide as before (`gridGeometry.test.ts`, "never smaller than before"). With a 56 pt bar the 9 to 12 bottle levels came out 0.1 pt narrower there, so the bar is 54 pt (its buttons are 52 pt tall).

## Motion (#3660)

Every action has a short motion and, where it makes sense, a haptic. Every duration, ceiling and shape constant lives in one module, `frontend/src/game/sort/motion.ts`, so the sounds (#3661) can be timed to the same numbers; `motion.test.ts` holds each one to the owner's ceilings (2026-11-13). `BottleView`, `SortBoard`, `SortScreen` and `usePourAnimation` import from it. Haptics go through one helper, `frontend/src/game/sort/haptics.ts`.

| Event                               | Motion                                                                                                                                                                                                                                               | Duration (ceiling)                                                                                                   | Reduce Motion                                            | Haptic                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Select (a tap)                      | the bottle lifts once and holds (5% of its height, never more than the 8 pt row gap, so it never reaches the row above); the stroke changes. No bobbing                                                                                              | 160 ms (200)                                                                                                         | lifted at once                                           | light impact                                                                                           |
| Deselect                            | the bottle settles back                                                                                                                                                                                                                              | 120 ms                                                                                                               | at once                                                  | none                                                                                                   |
| Hint                                | the source is selected as above; the destination keeps its ring                                                                                                                                                                                      | as Select                                                                                                            | as Select                                                | none (a hint is not a tap)                                                                             |
| Pour                                | the bottle lifts to the destination's neck, tilts to 50 degrees, tilts on to 95 as it drains one unit at a time (stream, splash on each landing), then untilts and returns                                                                           | 780 ms of animation for 1 unit, 300 ms more per unit; with the 50 ms start and end budget, 830 ms from the tap (900) | no ghost, no tilt: the move lands at once                | medium impact when the move lands (not at the tap); success instead if it completed a bottle           |
| Refused pour (wrong colour or full) | the tapped destination shakes "no"; the selection clears, as before. No penalty                                                                                                                                                                      | 240 ms (250)                                                                                                         | no shake                                                 | warning notification                                                                                   |
| Bottle completed                    | the bottle pulses (scale 1.08) and its check badge pops in. Only when a pour completes it on screen: a bottle already solved on a fresh board, a restore, or by an undo only shows its badge                                                         | 420 ms (450), badge 300 ms                                                                                           | the badge appears at once                                | success notification, instead of the medium impact (not on the winning pour, see Win); none on an undo |
| Undo                                | the board changes at once and fades in from 40% opacity                                                                                                                                                                                              | 280 ms (300)                                                                                                         | at once                                                  | none                                                                                                   |
| Level in (a new level)              | the bottles drop in and fade in, one after another (60 ms apart at most); a tap on a bottle skips it. Not for a restored game, Restart or Play Again (neither remounts the board; `SortScreen` tells it `levelIn` only when it will mount)           | 560 ms total (600)                                                                                                   | none: there at once                                      | none                                                                                                   |
| Win                                 | six liquid-coloured pieces fall across the board, then the result card opens. A tap on the board skips the cascade; a screen reader skips it too (the card and its announcement at once). The score, the session and the unlock are recorded at once | 1.38 s (1.5 s)                                                                                                       | no cascade, the card at once (also with a screen reader) | success notification, from the result card when it opens (`GameResultModal`)                           |

Pour timings, from `pourTimeline(units)` (ms from the start of the pour animation; the tap, the render that starts it and the hop back to React when it ends add up to `POUR_START_LATENCY_BUDGET_MS`, 50 ms, which the one-unit design leaves room for: `pourTotalMs(1) + 50 <= 900`, tested):

| Units | Lift ends | Flow starts | Each unit leaves, lands | Flow ends | Move lands (end) |
| ----- | --------- | ----------- | ----------------------- | --------- | ---------------- |
| 1     | 170       | 300         | 480, 600                | 600       | 780              |
| 2     | 170       | 300         | 480, 600; 780, 900      | 900       | 1080             |
| 3     | 170       | 300         | ...; 1080, 1200         | 1200      | 1380             |
| 4     | 170       | 300         | ...; 1380, 1500         | 1500      | 1680             |

How it runs:

- **UI thread.** Every animation is a Reanimated shared value. A pour is one `withSequence`/`withDelay` timeline per value, built in one go, with one callback on its last segment (no finished-callback hand-offs between phases, which slipped a frame each). A bottle's lift, shake, pulse and drop-in are derived values read in its animated style (`selectLiftPx`, `shakeOffsetPx`, `pulseScale`, `levelInLook` in `motion.ts` are worklets); the check badge is `useAnimatedProps`. The pour's ghost is as before, but each unit's drain (the source's layers fade out) and landing (the destination's layers fade in, and the splash pulses through `useAnimatedReaction`) are now steps of two shared values (`unitsEmitted`, `unitsLanded`) on the pour's own timeline. They were a `setTimeout` and a React state update per unit (4 timers and 4 renders for a 2-unit pour); a pour now renders React twice (the ghost appears, the ghost goes), whatever its size. A new level runs one board-wide clock that each bottle reads its slice of. `SortBoard` still does no per-frame React work and keeps its memoised handlers.
- **Events, not frames.** `SortScreen` turns a tap into one event: a select, a refused pour (`refused` = `{ index, seq }`, which makes that bottle shake once per new `seq`), an undo (`undoSeq`), a new level (`levelIn`), a win (`winCascade`). A restored game carries none, so it replays nothing: a bottle that mounts selected is lifted at once, one that mounts solved shows its badge, a board that mounts with a `seq` plays nothing.
- **Input.** A tap during a pour is ignored, as before; the pour is just faster. `usePourAnimation` keeps its contract: `start` refuses a second pour, `cancel` drops a pour without landing it, and the move is committed when SortBoard reports the pour done (so the replay recorder, #3385, still records a pour on landing). A select, a refused pour, an undo animation and the level-in never block a tap. Undo and Hint are off while the win cascade plays.
- **Win.** `SortScreen` records the solve at once, but opens `GameResultModal` only when `SortBoard` reports the cascade over (`onWinCascadeDone`: its timer, `WIN_CASCADE_MS`; or a tap on the board). Under Reduce Motion the card opens at once. Leaving the board during the cascade drops it. Closing the card on a solved board does not play it again; Restart and Play Again make the next solve play it.
- **Pour geometry** still reads the `onLayout` positions kept in refs (#2297); the bottle count change reset is untouched.
- **Reduce Motion** is the shared `useReduceMotion` everywhere, `BottleView` included. A Reduce Motion pour has no ghost and no tilt (the old in-place 62 degree tilt is gone); it lands on the hook's timer, `REDUCE_MOTION_POUR_MS` (0).

### Haptics

Fired from the event that starts the motion, once, never per frame. Best-effort, as `GameResultModal`'s: a rejected promise or a thrown error is swallowed. None on web. Sort has no haptics setting, and the app has no shared haptics on/off setting yet; if one is added, `fireSortHaptic` is the one place to honour it. A cancelled pour (Restart, a level change, leaving) fires nothing, since nothing lands. A pour that completes a bottle fires the success only (not the medium impact too, in the same tick). The winning pour fires the medium impact only: the bottle-complete success is skipped for it, and the one success on a win is the result card's own (`useResultFeedback`), which now arrives after the cascade, so a win has exactly one.

### Hint destination ring

The ring (`hint-dst-ring`) is a 2 px border on the page background. `colors.bonus` is 2.7:1 on the light theme's cream, below the 3:1 non-text minimum (WCAG 1.4.11), so it uses its own token, `colors.hintRing` (`#1f7a3c` on light, 4.6:1; `#4ade80` on dark, 11.0:1). `theme/__tests__/hintRingContrast.test.ts` pins both.

## Scoring (Persistence)

Every level played is its own session row (#2625): progress is not carried in one session.

- **Metric and direction:** `level_reached` (a result key in `games.metadata`), higher is better, labelled `level` (`board` in `backend/sort/module.py`; `BOARDS.sort` in `frontend/src/api/vocab.ts`). It is the player's frontier after the solve: the highest level they have solved on the catalog (the level just solved, or the highest with a best on record), capped at the last level. It never comes from the unlocked level: a save moved from the random levels unlocks far ahead (say level 103) without having solved anything on the catalog, so its first solve of level 1 sends `level_reached` 1, not 102 (#2761). The same value goes in `final_score`.
- **Tie-break:** `total_moves` ascending: on the same level, fewer total moves ranks higher; then the earlier `received_at` (server receipt time), every board's final tie-break. The moves tie-break was dropped in #2746 while levels were random per request and came back with the catalog (#2761): level N is the same puzzle for everyone. A row with no `total_moves` ranks after every row with one on its level.
- **Board reset (#2761):** the board's `edition` is `("catalog_version", 1)`: only rows whose result carries `catalog_version: 1` rank, or count as a player's "Best" in stats. Rows from the random levels, including solves still sent by app builds from before the catalog, carry none: they stay stored (history, XP, stats totals) but never rank. No migration and no delete; nothing grows. A future catalog that changes the levels raises the version, which resets the board the same way.
- **When the reset takes effect: `SORT_CATALOG_EDITION_ENFORCED`** (env var, default off; the board's `edition_switch`, read by `backend/games/boards/editions.py`). The backend deploys on merge to `main`, long before the store builds that send `catalog_version` reach players. While the switch is off, the Sort board and Stats "Best" rank every row as before the reset (the 120 cap and the moves tie-break already apply). **Release step:** once the catalog builds are live on both stores, the owner sets `SORT_CATALOG_EDITION_ENFORCED=true` on `bc-arcade-api` and redeploys; from then on only catalog rows rank. The same flip also moves Sort's daily-challenge goals from reach level 3 / 8 / 15 to 10 / 30 / 60 (#3728; [DAILY-CHALLENGE.md](../DAILY-CHALLENGE.md#2-current-eligible-goal-pool)); days already frozen keep the thresholds they were frozen with. No app release, no migration; unset it (and redeploy) to undo. See [RENDER.md](../RENDER.md#environment-variables). The metadata grows by `"catalog_version":1`, 20 bytes per completed level row, well inside the existing row.
- **Partitions:** none: one board.
- **Recorded, not partitioned:** result (`SortResult`): `level` (the level actually played), `moves`, `undos`, `won`, `catalog_version`, `stars` (1 to 3, #3687; a strict integer, left out by older builds; about 10 bytes a completed row), and `total_moves`, the sum of the player's best moves on levels 1 to `level_reached` (`@sort/best_moves` on the device; left out when one of those levels has no best on record, e.g. after a save moved onto the catalog).
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

Settled by #2761: every player gets the same fixed catalog of 120 levels, so "Level 19" is one puzzle for everyone and moves compare. The leaderboard was reset when the catalog shipped (only `catalog_version` 1 rows rank) and ranks fewest total moves on a tie again. Stars per level (#3687) are judged against each level's `par` (see [Stars](#stars-3687)).

## Sound

Registry: `frontend/src/game/sort/sounds.ts` (`SORT_SOUNDS`). Sort's sounds are original, synthesized "glass and water" sounds (#3661, part of #3578) from `tools/assets/synth_puzzle_sfx.py`; the reasoning, the options and the picks are in the [puzzle sound design log](puzzle-sound-design.md). Levels are baked into the files, so every sound plays at `useSound`'s default volume (1.0); each plays through `useSound` (which honours the player's sound setting) or, for the three frequent ones, `useSoundVariants` (three variations, never the same twice in a row).

Triggers are in `frontend/src/screens/SortScreen.tsx` (via `frontend/src/game/sort/useSortAudio.ts`) and are timed to `frontend/src/game/sort/motion.ts`.

| Key                                          | File                            | Plays when                                                                                                                                                                                                  | Volume |
| -------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `sort.select`, `select2`, `select3`          | `sort-select-1/2/3.ogg`         | a tap selects a filled bottle (with the light haptic); not a deselect, and not the source a hint lifts                                                                                                      | 1.0    |
| `sort.pourLift`, `pourLift2`, `pourLift3`    | `sort-pour-lift-1/2/3.ogg`      | a pour starts (the tap)                                                                                                                                                                                     | 1.0    |
| `sort.pourStream1u` to `sort.pourStream4u` (each with `2`, `3` variations) | `sort-pour-stream-{1,2,3,4}u-{1,2,3}.ogg` | once per pour, at the stream's start (`flowStartMs` 300 ms after the pour starts, plus the 50 ms latency budget), the file for the pour's unit count (1 to 4; 0.48 to 1.38 s); cleared with a cancelled pour (reset, level change, leaving, backgrounding) | 1.0 |
| `sort.refused`                               | `sort-refused.ogg`              | a pour is refused (the destination's shake; with the warning haptic)                                                                                                                                        | 1.0    |
| `sort.complete`                              | `sort-complete.ogg`             | a pour that completes a bottle lands, as the badge pops (with the success haptic); not the winning pour, an undo or a restore                                                                               | 1.0    |
| `sort.undo`                                  | `sort-undo.ogg`                 | Undo, or "Back to last good move" (once per action, however many moves it undoes)                                                                                                                           | 1.0    |
| `sort.hint`                                  | `sort-hint.ogg`                 | a hint is shown (the source lifts, the destination rings); not for the "no way to win" notice                                                                                                               | 1.0    |
| `sort.win`                                   | `sort-win.ogg`                  | the level is solved: at the start of the win cascade, so its chord lands as the result card opens (`WIN_CASCADE_MS`, 1.38 s)                                                                                | 1.0    |

Notes:

- The stream is one file per pour, as long as the stream (0.3 s per unit) plus an 0.18 s tail: van den Doel bubble synthesis, the pitch rising as the bottle fills.
- Reduce Motion: the pour lands at once, so a pour plays the lift and the 1-unit stream together at the tap. Under Reduce Motion or a screen reader the result card opens at once and the win sound plays as it is.
- A restored (Continue) game, a cancelled pour and a level change play nothing. Going to the background mid-pour also drops the pour's pending stream (they would fire late, in a clump, on resume); the pour animation is unchanged.
- Sort no longer plays `cascade-fruit-merge.ogg` (Cascade's) or `freecell-game-win.mp3`.

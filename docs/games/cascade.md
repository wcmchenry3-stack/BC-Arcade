# Cascade

**Category:** Arcade
**Tier:** TBD
**Status:** Disabled pending rework (#3033); hidden in store builds by #3001

## How to Play

Cascade is a physics-based piece-drop game. Pieces fall from the top of the screen into a bin. When two pieces of the same tier collide they merge into a higher-tier piece, scoring points. The goal is to score as high as possible before the bin overflows.

### Piece Progression

Pieces evolve through **12 fixed tiers** (0-11). The lowest-tier pieces are droppable (tiers 0-4); higher tiers are only reachable via merging. Two pieces of tier n (n < 11) merge into tier n + 1; two tier-10 pieces make the **capstone** (tier 11, Pumpkin / Milky Way), which is never dropped and never merges (`MAX_TIER` = 11). The win itself is a separate story (#3699).

**One table.** `frontend/src/game/cascade/tiers.ts` is the only place a tier's radius, score, density, droppable flag and name keys are defined. The engine (`pieceDefs.ts`), the board renderer, the spawner and its lid ring, the next-piece preview, the theme selector, the dev panel and the i18n keys all read it. `theme/fruitSets.ts` keeps only per-set names, emoji, colours and sprite references. `tiers.test.ts` fails if any other module defines a per-tier radius, score or density.

| Tier | Fruits      | Cosmos    | Radius | Score | Droppable |
| ---- | ----------- | --------- | ------ | ----- | --------- |
| 0    | Cherry      | Moon      | 22     | 1     | yes       |
| 1    | Blueberry   | Pluto     | 25     | 2     | yes       |
| 2    | Lemon       | Mercury   | 29     | 4     | yes       |
| 3    | Grape       | Mars      | 33     | 8     | yes       |
| 4    | Orange      | Venus     | 38     | 16    | yes       |
| 5    | Apple       | Earth     | 44     | 32    | no        |
| 6    | Peach       | Neptune   | 51     | 64    | no        |
| 7    | Coconut     | Uranus    | 58     | 128   | no        |
| 8    | Dragonfruit | Saturn    | 67     | 256   | no        |
| 9    | Pineapple   | Jupiter   | 77     | 512   | no        |
| 10   | Watermelon  | Sun       | 88     | 1024  | no        |
| 11   | Pumpkin     | Milky Way | 101    | 2048  | no        |

- **Radii** are geometric: `radius(n) = round(22 * 4^(n / 10))` (r0 = 22, r10 = 88, ratio about 1.149), continued to the capstone (101). The bin is 400 wide with 20 px walls, so 360 px inside: two tier-10 pieces side by side need 352 px, so they fit and can touch; the 202 px capstone fits. Physics size = drawn size: the collider and the visible fruit both use this radius (a baked sprite is drawn into a square of half-size `bakedClipR * radius`, `spriteHalfSize`). The spawner ring shows the queued piece at most 24 px in radius so the ring fits above the lid. A first try with r0 = 15 (r10 = 85) made games twice as long (the spam bot needed 100-123 s to lose), so it was not used.
- **Droppable tiers** stay 0-4. The largest (Orange, r = 38) spawns with its top edge at y = -1, on the canvas.
- **Scores** double per tier: a merge into tier n scores `2^n`. These values are provisional: the final ones are set with the time-bonus story (#3700), so a win dominates a long losing run. There is no jackpot bonus.
- **Density** is a multiplier on Matter's default body density (0.001), 1 on every tier for now. The field lives in `tiers.ts` for the physics story (#3697) to tune.
- **Art.** Tiers 0-10 use the existing sprites (`theme/fruitSets.ts`); tier 11 has none yet and is drawn as a plain circle in its placeholder colour until the art story (#3698).
- **Names** are `cascade:pieces.<set>.<key>` in every locale (24 keys, English copy in locales still to be translated, tracked in `scripts/i18n-english-copies.json`).

### Gameplay

- The current piece and the next queued piece are shown at the top of the screen
- The player taps or swipes to aim, then releases to drop
- Pieces roll and stack after landing — physics are fully simulated at 60 Hz
- Merges can chain: a merge may cause the new piece to immediately contact another of the same tier, triggering another merge
- Game over when the pile stays over the bin's lid for 3 seconds, or reaches the top of the board: see [Game over: the lid](#game-over-the-lid)

### Game over: the lid

The lid is the line at `OVERFLOW_LINE_Y` (y = 80 of the 600-unit world). The rule is in `engine.ts` (#3694) and is built so that it always fires, however fast the player taps. Every count is in fixed physics steps (`FIXED_STEP_MS`, 60 per second), never frames or wall-clock time, so it runs equivalently at 60 Hz and 120 Hz (same simulated time to within one frame; the per-step restructure keeps 60 Hz behaviour equivalent to before, not bit-identical). Frames slower than 20 fps drop their backlog (`step` caps the accumulator at `MAX_SUBSTEPS` steps), so game time then runs slower than the wall clock instead of building a queue.

- **Overflow.** A piece counts when it is _settled_ (Matter's `body.speed` at most `OVERFLOW_SETTLED_SPEED` = 8 px per step) and its **top edge** (y − radius) is above the lid. A dropped piece still falling from the spawner never counts, until it first touches another piece or the floor. While at least one piece counts, a counter rises by one each step; a step with none resets it to 0. At `OVERFLOW_TICKS_THRESHOLD` (180 steps, 3 s) the game ends (`gameOver`, reason `overflow`).
- **Merge grace.** A merge involving a piece whose top edge is in the danger band (at or above `OVERFLOW_LINE_Y + DANGER_STACK_MARGIN`, y = 160) resets the counter and pauses it for `OVERFLOW_IGNORE_MERGE_TICKS` (60 steps, 1 s). A merge lower in the bin does nothing. There is no other grace or cooldown. (Before #3694 any merge anywhere reset the counter, so fast play never lost.)
- **Hard stop.** A settled piece whose top edge reaches the top of the board (y ≤ `HARD_STOP_Y` = 0) ends the game at once (reason `hardStop`), so the pile is never drawn off-screen. The last dropped piece gets a short grace: a large piece spawns with its top edge above the canvas (a tier-4 piece is at the edge, a dev-panel piece of tier 5 and up is clear above it) and can touch a pile that reaches just under the lid while still near spawn height, so it must stay settled with its top edge at or above y = 0 for `HARD_STOP_SETTLE_TICKS` (30 steps, 0.5 s) before the hard stop fires. If it really rests there, the game still ends (and the overflow count runs meanwhile).
- **Drop gating.** `canDrop()` is false from a drop until that piece is below the lid (its top edge at or under the line), or merges into a piece that is. The screen ignores taps until then (on top of its 200 ms tap debounce). It cannot deadlock: once the piece lands it counts like any other, so a piece that comes to rest over the lid ends the game through the overflow rule. `drop()` itself is not gated, so the dev panel and the `__cascade_*` test seams can still place pieces.
- **Restore.** A restored game gets the merge grace once (1 s while the pieces settle), then the counter runs as normal. It is one grace per restore: a later restore starts a fresh grace, but does not extend a count already running. The hard stop applies at once to restored pieces that are part of the pile. A saved piece whose top edge is over the lid and that touches no other piece was most likely mid-air (velocities are not saved), so it is treated as falling again (no hard stop or overflow count until its first contact); if exactly one such piece exists it is the last drop for `canDrop()` and the hard-stop settle run.
- **Danger state.** `getState().dangerRatio` is the counter over the threshold (0..1) and `getState().canDrop` the gate. The board draws them (`render/drawFrame.ts`, mappings in `lidVisuals.ts`, colours `CASCADE_LID_PALETTE` in `theme/theme.cascade.ts`): a solid lid line that reddens as the counter runs; a clock ring around the spawner piece (above the lid) that drains clockwise from cyan to red, with a glow from 0.7; a red wash and outline on pieces over the lid while the counter runs; and the spawner piece as a dashed, faded ghost while a drop is not allowed.
- **Regression.** `__tests__/engine.sim.test.ts` runs a bot tapping every 200–250 ms at random x on fixed seeds; it must lose within 120 simulated seconds at 60 and 120 Hz (it lost in 34–46 s when recorded).

## Client-Side Engine

All game logic is client-side and offline-capable. Each game reaches the backend as a session row with its events; see [Scoring](#scoring-persistence).

### Module Map

| File                     | Purpose                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `engine.ts`              | Core physics simulation (`CascadeEngine` class, Matter.js wrapper)          |
| `tiers.ts`               | The tier ladder: the one table of radius, score, density, droppable, names  |
| `pieceDefs.ts`           | Engine piece definitions built from `tiers.ts`: color, score, shape         |
| `constants.ts`           | All tunable physics & gameplay parameters                                   |
| `pieceQueue.ts`          | Current + next piece queue (preview UI data)                                |
| `spawnSelector.ts`       | Weighted random tier selection with drought correction & danger suppression |
| `storage.ts`             | AsyncStorage save/load — versioned `SavedState` (v4), discards v3           |
| `layout.ts`              | `calculateCascadeLayout()`: world-to-screen scale for the measured board    |
| `testHooks.ts`           | `__cascade_*` E2E hooks through the shared `registerTestHooks`              |
| `render/frame.ts`        | The per-frame board buffer, its packer and the publish gate (#2960)         |
| `render/drawFrame.ts`    | UI-thread worklet that draws a frame into the board's Skia Picture          |
| `render/boardStyle.ts`   | Per-tier sizes and placeholder colours handed to the renderer               |
| `scoreStore.ts`          | The live score outside React state; `ScoreDisplay` subscribes               |
| `useTieredMergeSound.ts` | The tier-scaled merge sound                                                 |

### Physics

- **Engine:** Matter.js (rigid-body simulation), rendered via `@shopify/react-native-skia`
- **Timestep:** Fixed 16.67 ms (60 Hz) with up to 3 substeps per frame to handle variable frame rates
- **Sleep system:** Pieces sleep after 10 frames below velocity threshold — eliminates micro-vibration
- **Guard rails:** Out-of-bounds bodies are clamped back inside and a `guardRailFired` event is emitted. `Matter.World.remove()` is only called during confirmed merges — no silent deletion
- **Angular damping:** Applied post-physics with a hard clamp on `MAX_ANGULAR_VELOCITY`. Damping and the guard rails skip a body that was already checked while asleep (#2960): Matter neither moves nor spins a sleeping body, so the pass cannot change it. A seeded 16-game state hash was identical before and after.

### Rendering (#2960)

Nothing per frame goes through React state. The screen's RAF loop steps the engine and reads it with `engine.getState(into)`, which writes into one reused state object (no allocation per frame). `render/frame.ts` packs what the board draws into a `Float64Array`: a header (piece count, `dangerRatio`, `canDrop`, the spawner's tier) and six numbers per piece (id, tier, x, y, angle, sleeping). The loop publishes a copy to a Reanimated shared value only when it differs from the last one published. `components/cascade/CascadeBoard.tsx` records a Skia `Picture` from that shared value in `useDerivedValue` (`createPicture`), on the UI thread, with `render/drawFrame.ts`; the Picture is drawn inside a `Group` scaled from world units to the board.

- **What is drawn.** The same primitives, in the same order and with the same paints, as the declarative `PieceRenderer` and the #3694 lid components it replaced: each piece (its baked sprite in a square of half-size radius x `bakedClipR`, or a placeholder circle at the ladder radius) with its over-lid wash, then the lid line, then the spawner (piece, waiting ghost, clock ring). Every lid decision comes from `lidVisuals.ts`, whose mappings are worklets. A headless CanvasKit comparison of the old and new renderers on real engine states (light and dark, sprites and placeholders, calm, waiting, danger 0.5 and 0.9) was pixel-identical.
- **Sleeping pieces** are drawn where they fell asleep (the #1746 freeze, kept in the packer). A settled board therefore packs the same frame every time and publishes nothing.
- **Score.** `scoreStore.ts` holds the live score; `ScoreDisplay` subscribes with `useSyncExternalStore` and re-renders only when the integer changes. `ScoreDisplay`, `ThemeSelector`, `NextFruitPreview` and `CascadeBoard` are `React.memo`; the screen's handlers and styles are hoisted.
- **Events.** Merges and game over still reach the screen through `onMergeRef` / `onGameOverRef`; a merge burst (`components/cascade/MergeBurst.tsx`) is the one React update a merge makes, besides the score.
- **Measured.** `CascadeScreen.frames.test.tsx` counts React commits with a `Profiler`: 60 frames commit 60 times before #2960 (settled or moving) and 0 times after; a score change commits once. The dev panel's _Frame_ line (Star Swarm's `render/frameStats.ts` ring buffer) shows frame time and commits per second on a device. Numbers are in [PERFORMANCE.md](../PERFORMANCE.md#cascade-renderer-2960).
- **Web.** Cascade does not render on web yet; Skia's web runtime for it is #2960 part (b).

### Piece Queue & Spawn Selection (`pieceQueue.ts`, `spawnSelector.ts`)

- Queue holds `{ current, next }` tiers; `advanceQueue()` shifts forward and generates a new `next`
- Tier selection uses a weighted random algorithm:
  1. Base weights favour lower tiers (`{0:5, 1:4, 2:3, 3:2, 4:1}`)
  2. Drought boost: tiers absent from the last 10 drops gain +3 weight
  3. Danger penalty: when the stack is near the overflow line, tiers ≥3 are reduced to 20% weight
  4. Streak hard-ban: if the last 4 picks are identical, that tier is banned for one turn
- RNG is injectable for deterministic testing and seeded replay

### Combo Detection (`engine.ts`)

A `cascadeCombo` event is emitted when ≥3 merges occur within `COMBO_WINDOW_TICKS` (120 ticks, ~2 s). The combo counter resets on each drop. The window is counted in fixed physics steps, so it is 2 s of simulated time at any frame rate (it used to be counted per frame: 2 s at 60 Hz, 1 s at 120 Hz).

### Persistence (`storage.ts`)

- Saved state is versioned (`SavedState` v4, key `cascade_game_v4`) — includes pieces, score, and queue state
- A v3 save (the old 10-tier ladder, key `cascade_game_v3`) is **discarded**, not migrated (#3695): the new radii are mostly larger than the old ones (Cherry 16 to 22, Strawberry 22 to 29, Grape 28 to 33, Pear 52 to 58, Melon 82 to 88; only Peach and Watermelon shrink) and three old names do not exist in the new ladder, so a restored full bin would overlap and be ejected or end the game. Cascade has not shipped, so only dev and test builds hold one. The old key is removed on load; a present but invalid v4 save is discarded and never falls back to it
- `looksValid()` type guard runs strict validation on load; corrupt saves are wiped cleanly
- Sentry is notified on any storage error

## Backend

- Module: `backend/cascade/module.py`
- Endpoints: none of its own — the generic `/games` routes. The legacy `PATCH /cascade/score/{game_id}` and `GET /cascade/scores` were removed in #2644.
- Metadata model: `CascadeMetadata` — `player_name: str = ""` (max 64 chars). Current builds send no metadata.
- Result model: none (`result_model = None`): the result block is stored as sent.
- Scoring: see [Scoring](#scoring-persistence)

## Scoring (Persistence)

- **Metric and direction:** `final_score`, higher is better, labelled `score` (`board` in `backend/cascade/module.py`; `BOARDS.cascade` in `frontend/src/api/vocab.ts`). It is the points at game over: for each merge the engine (`engine.ts`) adds the new piece's `score` from `tiers.ts`.
- **Tie-break:** none declared. Equal scores go to the entry the server received first (`received_at`), the last tie-break on every board.
- **Partitions:** none: one board.
- **Recorded, not partitioned:** the result block from `progressResult` in `frontend/src/screens/CascadeScreen.tsx`: `final_score`, `duration_ms`, `theme`, `total_drops`, `total_merges`, and `outcome` on a finish. The fruit set is in the `game_started` event (`fruit_set`, `theme`), not in metadata.
- **Max value:** none (#2519 decision 14). Any integer up to 2³¹−1 is accepted.
- **Outcomes:** `has_winner = False`. Game over records `completed`. Restart during play records `abandoned` (`handleRestart`), and so does switching the fruit set mid-game (the fruit-set effect in `CascadeScreen.tsx` calls `endInstrumentedSession("abandoned")` and starts a new game). Leaving the screen records `abandoned` too (`useGameSync`'s unmount abandon), once a piece has been dropped. The Restart and fruit-set abandons carry the score so far in `final_score`, but abandoned rows never rank or count toward "best".
- **Duration:** Cascade's own `duration_ms` (`playedMs` in `CascadeScreen.tsx`): time since the session opened, less the time the player was away. Being away is another screen covering the board (navigation `blur`, #2743) or the app in the background (`AppState`, #2750): `usePauseWhileAway` stops the physics loop and the clock, a `PlayClock` (`startedAt` / `accumulatedMs`, `frontend/src/game/_shared/playClock.ts`) kept in a ref. Each animation frame carries the loop's generation, so a frame the OS delivers late after a trip to the background can't start a second loop. Because the value is > 0 it wins over `useGameSync`'s active-play window. The saved board carries `playedMs` (`SavedState` in `frontend/src/game/cascade/storage.ts`), and the pause saves the board, so a game continued after an app kill keeps the play before it and doesn't count the time the app was closed. A save from a build before #2750 has no `playedMs`: its earlier play is unknown, so the game counts from the relaunch.
- **How it reaches the server:** the `useGameSync("cascade")` session row. `SyncWorker` sends `POST /games` after the first drop (`markStarted`) and `PATCH /games/{id}/complete` at game over. If the player has a display name (`PUT /players/me`), the row ranks with no further step. The board shows each named player's best game once. Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **Where the player sees it:** the result card shows the rank through `lookupGameRank` (`GET /games/{id}/rank`), or asks once for a display name. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen (#2633). Stats (#2635) are in the ⋯ menu. Store builds hide Cascade (`HIDDEN_GAMES`, `frontend/src/entitlements/gameVisibility.ts`), so there it has no leaderboard or stats entry point.

## Accessibility

Cascade uses a Skia canvas for rendering. The native accessibility tree does not include canvas content. Requirements:

- Current score must be displayed in a native `Text` element outside the canvas
- Game-over state must be announced via an accessible modal or live region
- Canvas element marked `accessible={false}`

See [`docs/ACCESSIBILITY.md §4`](../ACCESSIBILITY.md#4-screen-readers) for the full canvas accessibility contract.

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- None tracked at this time

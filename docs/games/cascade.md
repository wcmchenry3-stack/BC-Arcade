# Cascade

**Category:** Arcade
**Tier:** TBD
**Status:** Disabled pending rework (#3033); hidden in store builds by #3001

## How to Play

Cascade is a physics-based piece-drop game. Pieces fall from the top of the screen into a bin. When two pieces of the same tier collide they merge into a higher-tier piece, scoring points. The goal is to score as high as possible before the bin overflows.

### Piece Progression

Pieces evolve through **12 fixed tiers** (0-11). The lowest-tier pieces are droppable (tiers 0-5); higher tiers are only reachable via merging. Two pieces of tier n (n < 11) merge into tier n + 1; two tier-10 pieces make the **capstone** (tier 11, Pumpkin / Milky Way), which is never dropped and never merges (`MAX_TIER` = 11). Making it emits the engine's `win` event (#3697); the celebration and the result are #3699.

**One table.** `frontend/src/game/cascade/tiers.ts` is the only place a tier's radius, score, density, droppable flag and name keys are defined. The engine (`pieceDefs.ts`), the board renderer, the spawner and its lid ring, the next-piece preview, the theme selector, the dev panel and the i18n keys all read it. `theme/fruitSets.ts` keeps only per-set names, emoji, colours and sprite references. `tiers.test.ts` fails if any other module defines a per-tier radius, score or density.

| Tier | Fruits      | Cosmos    | Radius | Density | Score | Droppable |
| ---- | ----------- | --------- | ------ | ------- | ----- | --------- |
| 0    | Cherry      | Moon      | 18     | 1.00    | 1     | yes       |
| 1    | Blueberry   | Pluto     | 20     | 0.95    | 2     | yes       |
| 2    | Lemon       | Mercury   | 23     | 0.88    | 4     | yes       |
| 3    | Grape       | Mars      | 25     | 0.85    | 8     | yes       |
| 4    | Orange      | Venus     | 28     | 0.80    | 16    | yes       |
| 5    | Apple       | Earth     | 32     | 0.75    | 32    | yes       |
| 6    | Peach       | Neptune   | 36     | 0.71    | 64    | no        |
| 7    | Coconut     | Uranus    | 40     | 0.67    | 128   | no        |
| 8    | Dragonfruit | Saturn    | 45     | 0.63    | 256   | no        |
| 9    | Pineapple   | Jupiter   | 50     | 0.60    | 512   | no        |
| 10   | Watermelon  | Sun       | 56     | 0.57    | 1024  | no        |
| 11   | Pumpkin     | Milky Way | 63     | 0.53    | 2048  | no        |

- **Radii** (#3697, the owner's "3 lively" choice) are geometric: `radius(n) = round(18 * (56 / 18)^(n / 10))` (r0 = 18, r10 = 56, ratio about 1.12), continued to the capstone (63). They were 22 / 88 / 101 (#3695): on that ladder holding a tier 10 while the second one is built (one piece of each tier 0-10) covered 53 % of the bin under the lid and no bot ever reached tier 10; on this one it is about 25 %. The bin is 400 wide with 20 px walls, so 360 px inside: two tier-10 pieces side by side need 224 px, and the 126 px capstone fits. Physics size = drawn size: the collider and the visible fruit both use this radius (a baked sprite is drawn into a square of half-size `bakedClipR * radius`, `spriteHalfSize`), including while a merged piece grows in (the frame carries its scale). The spawner ring shows the queued piece at most 24 px in radius so the ring fits above the lid. Why 18 / 56 and not the other proposals' 16 / 52: on lively's low-friction, bouncy physics the spam bot outlived the lid's 120 s bound in 6-10 % of games on 16 / 52 ([`CASCADE_FEEL_PROPOSALS.md`](../research/CASCADE_FEEL_PROPOSALS.md)).
- **Droppable tiers** are 0-5 (#3697: tier 5 joined). The largest (Apple, r = 32) spawns with its top edge at y = 11, on the canvas.
- **Scores** double per tier: a merge into tier n scores `2^n`. These values are provisional: the final ones are set with the time-bonus story (#3700), so a win dominates a long losing run. There is no jackpot bonus.
- **Density** is planck.js's fixture density, `(r0 / r)^0.5` (#3697): mass grows as r^1.5 instead of r^2, so the heaviest piece on the board (the capstone) is 6.5 times a Cherry, not 12 times, and a big piece no longer drives small ones through each other. Only the ratios matter.
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

- **Overflow.** A piece counts when it is _settled_ (its speed at most `OVERFLOW_SETTLED_SPEED` = 8 px per step) and its **top edge** (y − radius) is above the lid. A dropped piece still falling from the spawner never counts, until it first touches another piece or the floor. While at least one piece counts, a counter rises by one each step; a step with none resets it to 0. At `OVERFLOW_TICKS_THRESHOLD` (180 steps, 3 s) the game ends (`gameOver`, reason `overflow`).
- **Merge grace.** A merge involving a piece whose top edge is in the danger band (at or above `OVERFLOW_LINE_Y + DANGER_STACK_MARGIN`, y = 160) resets the counter and pauses it for `OVERFLOW_IGNORE_MERGE_TICKS` (60 steps, 1 s). A merge lower in the bin does nothing. There is no other grace or cooldown. (Before #3694 any merge anywhere reset the counter, so fast play never lost.)
- **Hard stop.** A settled piece whose top edge reaches the top of the board (y ≤ `HARD_STOP_Y` = 0) ends the game at once (reason `hardStop`), so the pile is never drawn off-screen. The last dropped piece gets a short grace: a large piece spawns with its top edge above the canvas (since #3697 droppable pieces spawn on it: the Apple's top edge is at y = 11; a dev-panel piece of tier 7 and up spawns above it) and can touch a pile that reaches just under the lid while still near spawn height, so it must stay settled with its top edge at or above y = 0 for `HARD_STOP_SETTLE_TICKS` (30 steps, 0.5 s) before the hard stop fires. If it really rests there, the game still ends (and the overflow count runs meanwhile).
- **Drop gating.** `canDrop()` is false from a drop until that piece is below the lid (its top edge at or under the line), or merges into a piece that is. The screen ignores taps until then (on top of its 200 ms tap debounce). It cannot deadlock: once the piece lands it counts like any other, so a piece that comes to rest over the lid ends the game through the overflow rule. `drop()` itself is not gated, so the dev panel and the `__cascade_*` test seams can still place pieces.
- **Restore.** A restored game gets the merge grace once (1 s while the pieces settle), then the counter runs as normal. It is one grace per restore: a later restore starts a fresh grace, but does not extend a count already running. The hard stop applies at once to restored pieces that are part of the pile. A saved piece whose top edge is over the lid and that touches no other piece was most likely mid-air (velocities are not saved), so it is treated as falling again (no hard stop or overflow count until its first contact); if exactly one such piece exists it is the last drop for `canDrop()` and the hard-stop settle run.
- **Danger state.** `getState().dangerRatio` is the counter over the threshold (0..1) and `getState().canDrop` the gate. The board draws them (`render/drawFrame.ts`, mappings in `lidVisuals.ts`, colours `CASCADE_LID_PALETTE` in `theme/theme.cascade.ts`): a solid lid line that reddens as the counter runs; a clock ring around the spawner piece (above the lid) that drains clockwise from cyan to red, with a glow from 0.7; a red wash and outline on pieces over the lid while the counter runs; and the spawner piece as a dashed, faded ghost while a drop is not allowed.
- **Regression.** `__tests__/engine.sim.test.ts` runs a bot tapping every 200–250 ms at random x on fixed seeds; it must lose within 120 simulated seconds at 60 and 120 Hz. On lively (#3697) it loses in 40–105 s; seed 3 at 120 Hz (105.2 s) is also the longest of the 100-seed suite, so the bound has about 14 % headroom (it was 1.6x on Matter.js).

## Client-Side Engine

All game logic is client-side and offline-capable. Each game reaches the backend as a session row with its events; see [Scoring](#scoring-persistence).

### Module Map

| File                      | Purpose                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine.ts`               | The game rules (`CascadeEngine`): merges, grow-in, chain reach, the win event, the lid, combos                                                                          |
| `physicsWorld.ts`         | The planck.js world, the bin and the unit conversions (px and fixed steps to metres and seconds)                                                                        |
| `stepBench.ts`            | The dev panel's step-cost bench (90 pieces, mean / p95), for the device check                                                                                           |
| `tiers.ts`                | The tier ladder: the one table of radius, score, density, droppable, names                                                                                              |
| `pieceDefs.ts`            | Engine piece definitions built from `tiers.ts`: color, score, shape                                                                                                     |
| `constants.ts`            | All tunable physics & gameplay parameters                                                                                                                               |
| `pieceQueue.ts`           | Current + next piece queue (preview UI data)                                                                                                                            |
| `spawnSelector.ts`        | Weighted random tier selection with drought correction & danger suppression                                                                                             |
| `storage.ts`              | AsyncStorage save/load — versioned `SavedState` (v5), discards v4 and v3                                                                                                |
| `layout.ts`               | `calculateCascadeLayout()`: world-to-screen scale for the measured board                                                                                                |
| `testHooks.ts`            | `__cascade_*` E2E hooks through the shared `registerTestHooks`; `cascadeSetup(id)` demo set-ups (chain, near-lid, fill-bin) shared with the test-build controls (#3719) |
| `render/frame.ts`         | The per-frame board buffer, its packer and the publish gate (#2960)                                                                                                     |
| `render/drawFrame.ts`     | UI-thread worklet that draws a frame into the board's Skia Picture                                                                                                      |
| `render/boardStyle.ts`    | Per-tier sizes and placeholder colours handed to the renderer                                                                                                           |
| `render/loadCanvasKit.ts` | Web only: loads Skia's web runtime (CanvasKit) from our origin (#2960)                                                                                                  |
| `scoreStore.ts`           | The live score outside React state; `ScoreDisplay` subscribes                                                                                                           |
| `useTieredMergeSound.ts`  | The tier-scaled merge sound                                                                                                                                             |

### Physics

The owner chose **"3 lively"** of the three planck.js proposals (#3697; the spike #3696 and the proposals: [`CASCADE_PHYSICS_SPIKE.md`](../research/CASCADE_PHYSICS_SPIKE.md), [`CASCADE_FEEL_PROPOSALS.md`](../research/CASCADE_FEEL_PROPOSALS.md)). It replaced Matter.js, which teleported pieces back out of the walls about 1,900 times a minute and sank resting pieces 2-3 px into each other.

- **Engine:** planck.js (Box2D in JavaScript), pinned at exactly `1.4.2` in `frontend/package.json`; rendered via `@shopify/react-native-skia`. `physicsWorld.ts` owns the planck `World` and converts at its boundary: 50 px per metre (radii 0.36-1.26 m, Box2D's sweet spot), velocities in px per fixed step, angles in radians. Pieces are true circles. planck 1.4.2's polygon mass bug (a dynamic polygon's centre of mass; fixed in 1.5) does not apply: Cascade has only dynamic circles and static boxes. 1.4.2 and 1.5.1 played the spike's 600 games bit for bit the same.
- **Tuning (lively):** friction 0.2 (pieces, walls and floor), restitution 0.2, today's gravity (2500 px/s²), air friction 0.01 per step as Box2D linear damping, no rolling damping (`PIECE_ANGULAR_DAMPING` = 0) with spin clamped at `MAX_ANGULAR_VELOCITY`, 10 velocity / 8 position iterations, density `(r0 / r)^0.5` (`tiers.ts`). All in `constants.ts`.
- **Timestep:** fixed 16.67 ms (60 Hz) with up to 3 substeps per frame; every rule runs once per fixed step, so 60 and 120 Hz play the same rules over the same simulated time.
- **Walls:** 200 px thick, grown outward from the bin's inner faces, and 600 px above the canvas, so nothing tunnels out. **No guard rail in normal play**: nothing is teleported. The only safety left catches a piece that escaped the bin outright (its centre a radius past a wall's or the floor's inner face, or a non-finite position): it is put back and stopped, `guardRailFired` (`escaped`) is emitted, and the screen logs it in dev builds. The sim gate requires 0. Bodies are only removed by a merge.
- **Merges:** two same-tier pieces merge when a planck contact begins between them, or when their circles are within `MERGE_GAP_PX` (1.5 px) at the end of a step (Box2D rests pieces a fraction of a pixel apart, which looks like touching). The scan runs per tier over the same-tier pieces only and does not allocate. The merged piece is made at the parents' midpoint, **clamped so its full-size circle is inside the walls and above the floor**, with the parents' mean velocity (capped at `MAX_SPAWN_VELOCITY`) and a `MERGE_POP_IMPULSE` (0.4 px per step) kick upward.
- **Grow-in:** the merged piece starts at its parents' radius and grows to its own over `GROW_IN_STEPS` (8 steps, 133 ms); each step keeps the grown circle inside the bin (a shift of at most one grow step, never a velocity change). Box2D resolves the overlap with a neighbour by position, so a neighbour is moved aside, not shot out (`engine.physics.test.ts` checks no neighbour passes 1.5 px per step). The snapshot carries the piece's `scale` (current / full radius), and the renderer draws it at that size. The lid, the merge grace and the drop gate always use the full radius.
- **Chain reach:** a piece still growing in also merges with a same-tier piece its full radius would touch (`CHAIN_REACH_PX` = 2), without waiting to grow into it, so a chain runs one step per link.
- **The win:** making the capstone emits `{ type: "win", x, y, id }` right after its `merge` and `score` events. The engine does not end the game; #3699 builds the celebration and the result on the event.
- **Sleep:** planck's own (a body at rest for 0.5 s sleeps). The post-physics pass (reading positions, the spin clamp, the safety) skips a body already checked while asleep (#2960): planck neither moves nor spins it.
- **Drop nudge.** `drop(tier, x)` moves the piece by a seeded amount in +-0.4 px (`DROP_NUDGE_PX`) before the wall clamp, so a piece dropped at the same x as the one below it does not land dead centre and stack into a column that never topples. The engine owns the RNG (`EngineConfig.seed` / `seed(n)`; the screen seeds it from the clock, `__cascade_setSeed` reseeds it), one draw per drop. `bench.noDropNudge` switches it off for the lid tests, which land a drop on a restored column.
- **Determinism:** no unseeded randomness anywhere in the engine or planck's solver (the drop nudge is a seeded draw), and piece ids count from 1 per engine, so the same frame deltas replay the same board, bit for bit, at 60 and at 120 Hz (each rate against itself; replays, #3858). 60 and 120 Hz are not bit-identical to each other: they play the same fixed steps and match within a frame (the lid tests). Bit-exact replay holds on one JS engine only: planck calls `Math.sin`, `Math.cos` and `Math.atan2`, which can differ in the last bit between Hermes, JavaScriptCore and V8, so a replay on another device, or on a server, of a chaotic pile can diverge. Do not build anything that needs the same board across engines on it.
- **Allocation:** the engine's own step path (the merge scan, grow-in, chain reach, the post-physics pass and `getState(into)`) allocates nothing per piece. planck's internals do allocate: about 0.4 KB per frame with the pile settled and about 2 KB per frame with 90 awake pieces (measured in review of #3863). The device bench (`Step bench` in the dev panel) is the check, not this note.
- **Events:** `merge` (now with the new piece's `id` and its `parentIds`), `score`, `cascadeCombo`, `gameOver`, `win`, and the dev-only `guardRailFired`.

### Rendering (#2960)

Nothing per frame goes through React state. The screen's RAF loop steps the engine and reads it with `engine.getState(into)`, which writes into one reused state object (the read allocates nothing per frame; planck's step does allocate a little, see Allocation under Physics). `render/frame.ts` packs what the board draws into a `Float64Array`: a header (piece count, `dangerRatio`, `canDrop`, the spawner's tier) and seven numbers per piece (id, tier, x, y, angle, sleeping, and since #3697 scale: a merged piece's size while it grows in). The loop publishes a copy to a Reanimated shared value only when it differs from the last one published. `components/cascade/CascadeBoard.tsx` records a Skia `Picture` from that shared value in `useDerivedValue` (`createPicture`), on the UI thread, with `render/drawFrame.ts`; the Picture is drawn inside a `Group` scaled from world units to the board.

- **What is drawn.** The same primitives, in the same order and with the same paints, as the declarative `PieceRenderer` and the #3694 lid components it replaced: each piece (its baked sprite in a square of half-size radius x `bakedClipR`, or a placeholder circle at the ladder radius) with its over-lid wash, then the lid line, then the spawner (piece, waiting ghost, clock ring). Every lid decision comes from `lidVisuals.ts`, whose mappings are worklets. A headless CanvasKit comparison of the old and new renderers on real engine states (light and dark, sprites and placeholders, calm, waiting, danger 0.5 and 0.9) was pixel-identical. That comparison ran headless, on one thread (CanvasKit, with the Picture recorded and drawn on the JS thread); it has not been verified on a device, where the Picture is recorded on the UI thread. Checking the board on iOS and Android is an owner follow-up (the Maestro screenshots of #3705, or a device session). `render/__tests__/worklets.test.ts` runs the real worklets Babel plugin to check that every function the UI-thread recording reaches is a worklet, which the Jest Reanimated stub cannot.
- **Sleeping pieces** are drawn where they fell asleep (the #1746 freeze, kept in the packer). A settled board therefore packs the same frame every time and publishes nothing.
- **Score.** `scoreStore.ts` holds the live score; `ScoreDisplay` subscribes with `useSyncExternalStore` and re-renders only when the integer changes. `ScoreDisplay`, `ThemeSelector`, `NextFruitPreview` and `CascadeBoard` are `React.memo`; the screen's handlers and styles are hoisted.
- **Events.** Merges and game over still reach the screen through `onMergeRef` / `onGameOverRef`; a merge burst (`components/cascade/MergeBurst.tsx`) is the one React update a merge makes, besides the score.
- **Measured.** `CascadeScreen.frames.test.tsx` counts React commits with a `Profiler`: 60 frames commit 60 times before #2960 (settled or moving) and 0 times after; a score change commits once. The dev panel's _Frame_ line (Star Swarm's `render/frameStats.ts` ring buffer, dev builds only) shows frame time and commits per second on a device; commits are counted by a `Profiler` around the screen, so a commit of `ScoreDisplay` alone counts. Numbers are in [PERFORMANCE.md](../PERFORMANCE.md#cascade-renderer-2960).
- **Web (CanvasKit, #2960 part b).** On web the same Skia code draws the board, through Skia's web runtime: CanvasKit, Skia compiled to WebAssembly. Owner decision 2026-11-11 on #2960: one drawing path on every platform, so web demos (the only demos a cloud session can record itself) show what the phones show; a separate Canvas 2D board like Mahjong's would draw everything twice and drift. How it loads:
  - `lazyScreens.ts` routes Cascade to `screens/CascadeRoute`. On iOS and Android `CascadeRoute.tsx` is the screen itself. On web Metro picks `CascadeRoute.web.tsx`, which shows a loading state, calls `loadCascadeScreen.web.ts` (CanvasKit first, then `import("./CascadeScreen")` in its own chunk) and renders the screen. The order matters: `react-native-skia`'s web module builds its `Skia` API from `global.CanvasKit` when it is first evaluated, so nothing that imports Skia may be evaluated earlier. This is the pattern of Skia's `WithSkiaWeb`, written out so a failure can be retried.
  - `game/cascade/render/loadCanvasKit.ts` mirrors Skia's `LoadSkiaWeb`, with two changes: the `.wasm` comes from Metro's asset pipeline (`require` of `canvaskit-wasm/bin/full/canvaskit.wasm`; `.wasm` is in `metro.config.js` `assetExts`), so the web export writes it to `dist/assets/node_modules/canvaskit-wasm/bin/full/canvaskit.<hash>.wasm` and it is served from our own origin, never a CDN; and a failed load is forgotten, so Retry tries again (`LoadSkiaWeb` keeps a rejected promise). `canvaskit-wasm` is a direct dependency pinned to the version `@shopify/react-native-skia` depends on (0.41.0 for Skia 2.14.0); `render/__tests__/canvasKitWeb.test.ts` fails if they drift, or if a non-web file imports the loader.
  - A load that fails or takes longer than 60 s (`CANVASKIT_LOAD_TIMEOUT_MS`) shows a readable error with Try again inside the game shell (`cascade-web-error`), never an endless spinner (#2539). Only the first failure in a page session reports a Sentry event (`subsystem: cascade.canvaskit`); later ones leave a breadcrumb. Retry after a timeout starts a fresh download. A browser that blocks WebAssembly under its Content-Security-Policy gets the same error: the deployed dev site's CSP allows `'wasm-unsafe-eval'` for this (`render.yaml`; prod gets it when Cascade ships there, #3703).
  - Nothing else loads CanvasKit: the lobby and the other web games never request the `.wasm`, and Mahjong and Star Swarm keep their Canvas 2D `GameCanvas.web.tsx` (the Playwright spec checks both). The iOS and Android bundles hold neither the loader nor the `.wasm` (checked on an Android export, #2960 part b). Download cost: [PERFORMANCE.md](../PERFORMANCE.md#cascade-on-web-canvaskit-2960).
  - Board accessibility: the board's role and label sit on a `View` around the Skia `Canvas`, because Skia's web `Canvas` drops accessibility props.
  - Skia features the renderer uses, checked on web (Chromium, WebGL): `createPicture` / `Picture` inside a scaled `Group`, `drawCircle`, `drawLine`, `drawImageRectOptions` with images from `useImage`, `Path.MakeFromSVGString` + `drawPath`, `PathEffect.MakeDash` (the waiting ghost) and `MaskFilter.MakeBlur` (the clock ring's glow). All draw on web; the Picture is recorded on the JS thread there (Reanimated runs worklets on the JS thread on web). No gradients or runtime shaders are used yet: the code-drawn art (#3698) and motion (#3701) must check any they add on web and on a phone. Not yet compared side by side with a phone screenshot (the Maestro screenshots of #3705).
  - E2E: `e2e/tests/cascade-smoke.spec.ts` (Playwright project `cascade`).

### Piece Queue & Spawn Selection (`pieceQueue.ts`, `spawnSelector.ts`)

- Queue holds `{ current, next }` tiers; `advanceQueue()` shifts forward and generates a new `next`
- Tier selection uses a weighted random algorithm:
  1. Base weights over tiers 0-5 (`{0:2, 1:3, 2:3, 3:3, 4:3, 5:2}`, #3697): a drop carries about 9.75 Cherries' worth of material (3.8 on the old `{0:5, 1:4, 2:3, 3:2, 4:1}`), so the capstone (2048 Cherries) is about 210 perfect drops away
  2. Drought boost: tiers absent from the last 10 drops gain +3 weight
  3. Danger mode: when the stack is near the overflow line, tiers ≥3 are reduced to 20% weight (at least 1) and tiers 0-2 are multiplied by 1.5
  4. Streak hard-ban: if the last 4 picks are identical, that tier is banned for one turn
- RNG is injectable for deterministic testing and seeded replay

### Combo Detection (`engine.ts`)

A `cascadeCombo` event is emitted when ≥3 merges occur within `COMBO_WINDOW_TICKS` (120 ticks, ~2 s). The combo counter resets on each drop. The window is counted in fixed physics steps, so it is 2 s of simulated time at any frame rate (it used to be counted per frame: 2 s at 60 Hz, 1 s at 120 Hz).

### Sim harness (`sim/`, #2893)

A seeded, headless sim in `frontend/src/game/cascade/sim/` plays the real `CascadeEngine`, spawn selector and queue (`createPieceQueue` / `advanceQueue`, fed by the shared seeded RNG) the way `CascadeScreen` does: taps are gated by `canDrop()`, `isInDanger` comes from the pile height. It is the measuring tool for the physics spike (#3696), the physics story (#3697), the lid (#3694) and the tier ladder (#3695). Same seed, bot, frame rate and engine give the same metrics (step cost aside).

- **Bots** (`bots.ts`): `heuristic` (waits for a calm board, drops where it lands on a same-tier piece, else lowest), `random` (600-1200 ms, random x), `spam` (200-250 ms, random x; the lid test's bot), `skilled` (#3697: the heuristic's timing, but it keeps the pile graded, big pieces left and small right, sets up merges next to a piece one tier away and avoids burying small pieces; the capstone runs' bot).
- **Frame rates:** every run is done at 60 and 120 Hz frame deltas.
- **Metrics** (`runGame.ts`, `suite.ts`): piece frequency per tier; drought (longest run of drops without a tier); game length (simulated s), score, score by tier, top-tier reached rate; win rate and time to win (the engine's `win` event, #3697), the time to the capstone (p25 / median / p75 of the games that won) and to tier 10; physics feel: packing density, visible gap between touching neighbours (drawn radius), settle time after a drop and after a 3+ merge chain, jitter of settled pieces (px/s), guard-rail events per game (`guardRailFired`, counted, never acted on: #1716); wall penetration (deepest, and pieces more than 1 px in per minute, read every frame at each piece's current size); chain merge latency (a merge product touching a same-tier piece at full size when made, timed until it merges again, from the merge events' `id` / `parentIds`); step cost (wall clock, printed but not in the baseline). Hard gates (not bands): the spam bot always reaches game over inside 120 simulated seconds, no guard rail fires, chain-merge latency p90 is under 150 ms, and the mean step with 20+ pieces is under 16 ms.
- **1 px-contact spawn helper** (`contactSpawn.ts`): `contactPair(tier, x)` places two same-tier pieces overlapped by 1 px, for merge tests (planck's circles are exact; on Matter it added a polygon-facet allowance). Deep overlaps can separate before `collisionStart` fires and the merge silently fails (#1296, #1302, #1418).
- **Comparing a candidate** (#3696): `runGame` / `runSuite` take a `SimConfig`: `createEngine` (a factory for any engine with the `SimEngine` surface) and `constants` (overrides for what the sim and its metrics read: world size, lid y, physics and drawn radius per tier, score per tier, droppable tiers). The real engine reads its tuning from `constants.ts` at import time, so a candidate engine brings its own numbers and the same numbers go in `constants`.
- **Run it:** `cd frontend && npm run sim:cascade` (smoke, 3 seeds, about 10 s) or `npm run sim:cascade -- --full` (100 seeds x 3 bots x 60/120 Hz plus the capstone runs, 100 skilled games at 60 Hz of up to 10 simulated minutes each that stop at the win; about 12 min; `--no-capstone` skips them). `--gate` checks `sim/baseline.json` and exits 1 on a violation; `--update-baseline` rewrites the baseline for that suite (then `npx prettier --write` the file); `--md PATH` / `--json PATH` write the table / raw result.
- **Baseline and bands:** `sim/baseline.json` holds today's deterministic metrics with a band per metric (relative plus an absolute floor per unit; rates never tighter than one game of n). Bands are drift guards around today's physics, not targets; #3695 / #3697 re-baselined. The smoke suite is a coarse guard: it bands only game length, score and guard-rail rate with wide tolerances (checked with the seed set shifted), and the lid and step budget are hard gates; per-tier rates, shares, droughts and settle are banded in the full suite only, which assumes 100 seeds (a run with another seed count prints the table and skips the bands).
- **Settle time is survivor-biased.** A drop that arrives before the board calms cuts that episode off, and it never reaches the mean. The table prints the cut-off fraction next to it (`settle episodes cut off by the next drop`): about 0.5 for the heuristic and random bots, 0.99 for spam. So the **spam bot's settle numbers are not comparable** (they come from a few unusual episodes) and are never banded; the heuristic and random settle means are banded only when 20 or more episodes finished. Compare settle between engines for the same bot and read it with its cut-off fraction. Speed thresholds (calm 18 px/s, settled 30 px/s) are per second, so 60 and 120 Hz compare.
- **CI:** the smoke runs in every PR's Jest run (`sim/__tests__/sim.test.ts`, about 8 s); the long run is `.github/workflows/cascade-sim-gate.yml` (nightly, on demand, and on PRs that touch the engine, its constants, the queue or the sim). PR runs play 50 capstone seeds (about 7 min) instead of 100, with the capstone bands widened by sqrt(100 / 50) (`--capstone-seeds`, `baselineForCapstoneSeeds`); nightly and manual runs play 100.

Baseline today (planck.js, lively, #3697; 100 seeds; suite games capped at 180 s, spam at 120 s; the capstone runs at 600 s). Every heuristic game reaches the 180 s cap and about 20 % of random games do, so their game length and score are cap-limited. In brackets: the #3695 baseline on Matter.js, and the proposal's lively ([`CASCADE_FEEL_PROPOSALS.md`](../research/CASCADE_FEEL_PROPOSALS.md)) where it was measured.

| metric                                     | heuristic 60 / 120 Hz                    | random 60 / 120 Hz                  | spam 60 / 120 Hz                      |
| ------------------------------------------ | ---------------------------------------- | ----------------------------------- | ------------------------------------- |
| game length (s)                            | 180 / 180 (180; lively 180)              | 155 / 151 (160; lively 151 / 154)   | 66 / 68 (59; lively 66 / 65)          |
| longest spam game (s), lid bound 120       |                                          |                                     | 94 / 105 (98 / 100; lively 107 / 109) |
| score (mean)                               | 5993 / 5972 (3386)                       | 4097 / 3891 (2590)                  | 4248 / 4641 (2313)                    |
| visible gap between touching neighbours px | -0.17 / -0.16 (-2.23; lively -0.17)      | -0.17 / -0.16 (-2.98; lively -0.16) | -0.17 / -0.17                         |
| deepest overlap px (mean of games)         | 4.4 / 4.6 (22.5; lively 5.4)             | 3.0 / 3.2 (24.4; lively 4.4)        | 0.9 / 0.9                             |
| jitter of settled pieces px/s              | 1.32 / 1.32 (3.54; lively 1.31)          | 1.46 / 1.48 (3.67; lively 1.49)     | 3.46 / 3.49                           |
| packing density                            | 0.66 / 0.66 (0.68; lively 0.66)          | 0.69 / 0.69 (0.71; lively 0.69)     | 0.71 / 0.72                           |
| settle after a drop (ms)                   | 935 / 914 (760; lively 931 / 907)        | 632 / 631 (642; lively 636 / 632)   | not comparable (cut off)              |
| settle after a 3+ chain (ms)               | 512 / 496 (273; lively 510 / 507)        | 239 / 237 (170; lively 250 / 252)   | not comparable (cut off)              |
| guard-rail events per minute               | 0 / 0 (1855)                             | 0 / 0 (2119)                        | 0 / 0 (4717)                          |
| deepest wall penetration px                | 0.31 (48-59 before the rail; lively 0.3) | 0.31                                | 0.31                                  |
| chain merge latency median / p90 (ms)      | 17 / 17 (lively 17 / 17)                 | 17 / 17                             | 17 / 17                               |

**The capstone (600 s cap, the run stops at the win):** the skilled bot (in the gate) makes it in **44 %** of games (proposal's lively: 50 %), in 374 / 433 / 500 s (p25 / median / p75 of the games that did; lively 370 / 402 / 440), and reaches tier 10 in 93 % (median 237 s). The heuristic bot (measured once, not in the gate): 19 % (lively 21 %), 360 / 381 / 431 s, tier 10 in 75 %. On Matter.js with the #3695 ladder no bot reached the capstone, and tier 10 in 0-7 % of games.

### Persistence (`storage.ts`)

- Saved state is versioned (`SavedState` v5, key `cascade_game_v5`) — includes pieces, score, and queue state
- A v4 save (#3695's ladder on Matter.js, key `cascade_game_v4`) is **discarded**, not migrated (#3697): every radius changed (Cherry 22 to 18, Watermelon 88 to 56, the capstone 101 to 63), so its saved positions would leave gaps the pile falls into, a different board from the one saved, built on the old physics. Like a v3 save it only exists in dev and test builds; its key is removed on load and on clear
- A v3 save (the old 10-tier ladder, key `cascade_game_v3`) is **discarded**, not migrated (#3695): the new radii are mostly larger than the old ones (Cherry 16 to 22, Strawberry 22 to 29, Grape 28 to 33, Pear 52 to 58, Melon 82 to 88; only Peach and Watermelon shrink) and three old names do not exist in the new ladder, so a restored full bin would overlap and be ejected or end the game. Cascade has not shipped, so only dev and test builds hold one. The old key is removed on load; a present but invalid v5 save is discarded and never falls back to either
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

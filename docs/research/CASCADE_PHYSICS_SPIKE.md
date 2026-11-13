> **Spike record (#3696), not the current contract.** Current Cascade behaviour lives in [`docs/games/cascade.md`](../games/cascade.md); the physics change is carried out in #3697. Follow-up: [`CASCADE_FEEL_PROPOSALS.md`](CASCADE_FEEL_PROPOSALS.md) (#3697 phase 1) pins planck at 1.4.2 (bit-identical to 1.5.1 here) and shows that most of B's wall penetration below was measured at a growing piece's full radius rather than its collider's.

> **Where the code is.** The sim code these numbers come from (`frontend/src/game/cascade/sim/candidates/`, `sim/proposals/`, `tools/sim/cascade-physics-spike.ts`, `tools/sim/cascade-feel-proposals.ts`) lives on the branches `spike/3696-cascade-physics-engines` and `proposals/3697-cascade-feel` and was not merged. The owner chose **3 lively** on planck.js 1.4.2; #3697 phase 2 ported it into the production engine (`engine.ts`, `physicsWorld.ts`, `tiers.ts`, `spawnSelector.ts`) and the sim harness now plays that engine. Its baseline: [`docs/games/cascade.md`](../games/cascade.md#physics).

# Cascade physics spike: tuned Matter.js vs planck.js

**Issue:** #3696 (epic #3033). **Date:** 2026-11-12. **Scope:** measurement and a recommendation. Nothing here ships: the decision is carried out in #3697.

**Question.** Fruit don't pack snugly and the board never feels calm. Which is better: **(A)** Matter.js tuned (per-tier density, merge grow-in, no restitution, more solver iterations, smaller slop, no guard-rail teleports), or **(B)** planck.js (a pure-JS Box2D port) with the same game rules?

**Answer.** **B, planck.js**, with three conditions for #3697: (1) re-tune game length and difficulty, because a calm board makes fewer accidental merges and random play loses about 30 % sooner; (2) measure step cost on a real mid-range Android under Hermes before merging (the interpreter proxy here puts B at 6.3 ms a frame with 64 pieces, against 2.3 ms for today's Matter); (3) accept about 210 KB more Hermes bytecode (about 30 KB gzip). A gets about two-thirds of the way on overlap but does not make the board calmer, and its pieces sink into the walls and floor more often than today's (the guard rail is what hides this today). The reasoning is in [Recommendation](#recommendation).

## Method

### Candidates

All three run behind the sim harness's engine seam (`SimConfig.createEngine`, `frontend/src/game/cascade/sim/config.ts`, #3724). No change to the seam was needed.

- **Rules.** `sim/candidates/candidateEngine.ts` is a line-for-line port of `CascadeEngine` (`engine.ts`) onto a small physics interface (`sim/candidates/backend.ts`): the fixed-step accumulator (`FIXED_STEP_MS`, `MAX_SUBSTEPS`), the contact merge rule and merge pop, the lid (overflow count, merge grace, hard stop, `HARD_STOP_SETTLE_TICKS` for the dropped piece), `canDrop`, `dangerRatio`, combos and restore. On today's Matter physics it reproduces `CascadeEngine` **bit for bit** over whole sim games (a test checks heuristic, random and spam games), so the differences below are physics, not a rules drift. The production lid tests are rerun on every candidate (`sim/candidates/__tests__/candidates.test.ts`): the column fixture ends the game at exactly the same step, the hard stop and its settle run, merge grace, drop gating at 60 and 120 Hz.
- **current**: the production physics on the port. Matter.js 0.20, position / velocity iterations 6 / 4, slop 0.05, restitution 0.2, density 1 on every tier (largest mass ratio 21:1), 20 px walls, guard rail that clamps and stops a piece.
- **A, Matter tuned** (`sim/candidates/matterBackend.ts`, `MATTER_A`): density `(r0 / r)^0.5` per tier, so mass grows as r^1.5 and the largest mass ratio (capstone : cherry) is **9.8:1**; merge grow-in over **8 fixed steps** (the new piece starts at its parents' radius); restitution 0; iterations **20 / 12**; slop **0.01**; walls and floor 200 px thick (grown outward, the inner faces unchanged) and 600 px above the canvas, so nothing needs a rail to stay in; **no guard-rail teleports** (the rail only observes; a piece that really leaves the bin would be caught and counted as an escape).
- **B, planck.js 1.5.1** (`sim/candidates/planckBackend.ts`, `PLANCK_B`; pinned exactly as a devDependency): the same density, grow-in, restitution 0, thick walls and observing rail as A. Box2D works in metres, so the world is scaled at 50 px/m (radii 0.44-2.02 m). Gravity, air friction (as linear damping), friction 0.5 and the fixed step are matched to today's (a test checks the free fall is within 2 %). Velocity / position iterations 10 / 8. Circles are true circles. planck's global `Settings` stay at defaults (linear slop 0.25 px).

The spike tuning was chosen with short ablations (6 seeds per bot, 120 s) before the full run; see [Ablations](#ablations).

### Runs

`npx --prefix frontend tsx tools/sim/cascade-physics-spike.ts --seeds 100` runs the harness's full suite for each candidate: **100 seeds x heuristic, random, spam x 60 and 120 Hz**, the same seeds and queue for every candidate (the queue and bot RNG streams are seeded per seed; `isInDanger` and `canDrop` come from the candidate's own board, as on the screen). Heuristic and random games are capped at 180 s, spam at 120 s (the lid gate's bound). It took about 4 / 5 / 6 minutes for current / A / B.

Extra counters come from the candidate engine (`CandidateEngine.stats`), not the harness:

- **rail (today's predicate)**: steps x pieces where today's guard rail would fire. It fires on any floor penetration, so it counts resting contact as much as real escapes. Under current it is also how often the rail moved a piece.
- **penetration past rail > 1 px / > 3 px, deepest**: how far a piece's centre went past today's rail (into a wall or the floor). This is the honest "would we need a rail" number.
- **escapes**: a piece whose centre went past a wall's or the floor's inner face by more than its radius, i.e. it passed through. Only A and B count them (current's rail catches a piece first).
- **same-tier near misses**: same-tier pairs at rest 0-2 px apart (they look as if they touch but do not merge), as pair-steps per minute.

Step cost has two sources: the harness's per-frame wall clock in real games (frames with 20+ pieces), and a bench with **64 pieces** (merges and lid off, 64 Cherries and Blueberries dropped every 250 ms, timed from the 60th piece to 3 s after the last, best of 5). The bench was also run under `node --jitless` (V8's bytecode interpreter, no JIT) as a rough stand-in for Hermes, which has no JIT either. All wall-clock numbers come from a shared 4-core Linux container and are only good for ratios.

## Results

### Physics feel (100 seeds, 60 Hz; 120 Hz in brackets where it differs)

| metric                                                                  | bot                       |            current |      A (Matter tuned) |          B (planck) |
| ----------------------------------------------------------------------- | ------------------------- | -----------------: | --------------------: | ------------------: |
| visible gap between touching neighbours, mean px (negative = overlap)   | heuristic                 |              -2.23 |                 -0.73 |           **-0.22** |
|                                                                         | random                    |              -2.98 |                 -0.97 |           **-0.19** |
|                                                                         | spam                      |              -3.21 |                 -1.06 |           **-0.18** |
| deepest overlap px (mean of games' worst)                               | heuristic                 |               22.5 |                  14.6 |            **13.5** |
|                                                                         | random                    |               24.4 |                  13.7 |             **8.9** |
|                                                                         | spam                      |               16.2 |                   5.8 |             **1.4** |
| jitter of settled pieces, px/s                                          | heuristic                 |               3.54 |                  3.49 |            **1.75** |
|                                                                         | random                    |               3.67 |                  3.84 |            **1.69** |
|                                                                         | spam                      |               7.03 |                  6.85 |            **3.59** |
| packing density (drawn area / bin under pile top)                       | heuristic                 |          **0.684** |                 0.671 |               0.664 |
|                                                                         | random                    |          **0.707** |                 0.684 |               0.653 |
|                                                                         | spam                      |          **0.734** |                 0.697 |               0.682 |
| settle after a drop, ms                                                 | heuristic                 |      **760** (739) |             799 (762) |           835 (799) |
|                                                                         | random                    |          642 (640) |             654 (651) |       **631** (624) |
| settle after a 3+ chain, ms                                             | heuristic                 |      **273** (268) |             315 (315) |           451 (422) |
|                                                                         | random                    |      **170** (165) |             201 (200) |           292 (265) |
| penetration > 1 px past the rail, per min                               | heuristic                 |               1325 |                  4077 |              **28** |
|                                                                         | random                    |               1695 |                  8497 |              **29** |
|                                                                         | spam                      |               3691 |                  8500 |              **89** |
| penetration > 3 px past the rail, per min                               | heuristic                 |                630 |                   265 |               **8** |
|                                                                         | random                    |                830 |                   550 |               **8** |
|                                                                         | spam                      |               1677 |                   629 |              **22** |
| deepest penetration past the rail, px (any game)                        | all                       |              52-59 |                 43-51 |            **7-10** |
| today's rail predicate, per min (current: rail fired and moved a piece) | heuristic / random / spam | 1855 / 2115 / 4702 | 16572 / 20777 / 20179 | **426 / 382 / 900** |
| escapes (passed through a wall or the floor), total over 600 games      | all                       |         n/a (rail) |                     5 |               **0** |

Settle-time caveats are the harness's: about half of heuristic and random episodes are cut off by the next drop (0.47-0.69 for every candidate) and spam's settle numbers are not comparable (0.99 cut off). Chain-settle means rest on 523-654 heuristic episodes per candidate, but only 60 random episodes for B (B makes far fewer chains: see below).

Reading it:

- **Overlap and gap.** B removes the visible overlap: touching pieces sit 0.2 px into each other (Box2D's linear slop), against 2-3 px today. A goes about two-thirds of the way. Neither removes every deep transient: the deepest overlap is a fast piece landing on another, visible for 2-4 frames while the position solver pushes it out (Box2D has no CCD between two moving bodies unless a body is flagged `bullet`).
- **Calm.** B halves the jitter of settled pieces in every bot. A does not change it: Matter's resting contacts keep buzzing whatever the iterations.
- **Walls and floor.** Today's guard rail fires about 1.9-4.7 k times a minute and pulls pieces back by up to 52 px. Without the rail, A's pieces press into the walls and floor much more often (4-8.5 k times a minute past 1 px, though fewer past 3 px than today) and 5 pieces in 600 games passed straight through a 200 px thick wall or floor. B keeps pieces within 1 px of the walls almost always (28-89 / min past 1 px, deepest 10 px) with no rail and no escapes.
- **Packing density is lower in B**, but that is mostly the overlap going away: drawn circles that do not overlap cannot pack as densely. With B's colliders 1.5 px smaller than the drawn pieces (a probe, 12 seeds) the density came back to today's (0.71 / 0.76 / 0.71) and so did the -2.9 px visible overlap, i.e. today's density is partly overlap.
- **Settle** is about the same after a single drop (within 10 %, random slightly better in B, heuristic slightly worse). After a 3+ chain B takes 120-180 ms longer to calm down. A is in between.

### Game length, score and the top tiers (100 seeds; reached rate = share of games in which the tier existed)

| metric                               | bot       | current 60 / 120 Hz |        A 60 / 120 Hz | B 60 / 120 Hz |
| ------------------------------------ | --------- | ------------------: | -------------------: | ------------: |
| game length, s                       | heuristic |           180 / 180 |            180 / 180 |     178 / 179 |
|                                      | random    |           160 / 160 |            147 / 146 |     110 / 106 |
|                                      | spam      |         58.5 / 58.9 |          54.1 / 55.5 |   41.2 / 41.2 |
| score (mean)                         | heuristic |         3386 / 3392 |          3204 / 3210 |   2966 / 3061 |
|                                      | random    |         2590 / 2581 |          2197 / 2251 |   1231 / 1157 |
|                                      | spam      |         2313 / 2281 |          1933 / 2002 |   1193 / 1139 |
| 3+ chains, total                     | heuristic |           553 / 654 |            542 / 627 |     523 / 582 |
|                                      | random    |           294 / 286 |            228 / 182 |       60 / 58 |
| top tier (mean)                      | heuristic |         8.14 / 8.14 |          8.09 / 8.07 |   7.91 / 8.00 |
|                                      | random    |         7.75 / 7.77 |          7.51 / 7.55 |   6.72 / 6.64 |
|                                      | spam      |         7.54 / 7.55 |          7.28 / 7.35 |   6.55 / 6.50 |
| reached tier 8                       | heuristic |         0.95 / 0.95 |          0.95 / 0.94 |   0.84 / 0.85 |
|                                      | random    |         0.67 / 0.73 |          0.52 / 0.47 |   0.11 / 0.10 |
|                                      | spam      |         0.49 / 0.53 |          0.33 / 0.36 |   0.09 / 0.07 |
| reached tier 9                       | heuristic |         0.19 / 0.19 |          0.14 / 0.13 |   0.08 / 0.15 |
|                                      | random    |         0.11 / 0.04 |          0.04 / 0.09 |   0.00 / 0.00 |
|                                      | spam      |         0.06 / 0.04 |          0.01 / 0.02 |   0.00 / 0.00 |
| reached tier 10 or the capstone (11) | all       |                   0 |                    0 |             0 |
| ended by hard stop                   | all       |                   0 | 0.01 (one spam game) |             0 |

**Top-tier distribution (for #3697 / #3700).** Neither candidate makes tier 10 or the capstone reachable in 180 s: no bot reached tier 10 in any of the 1800 games across the three engines. Both candidates move the distribution **down**: A a little, B a lot for undirected play (random: tier 8 in 11 % of B's games against 67-73 % today). The aiming heuristic bot is hardly affected (tier 8 in 84 % against 95 %; tier 9 in 8-15 % against 19 %). The win-reachability decision in #3697 / #3700 therefore cannot lean on the physics change; if anything, a calm, honest board makes the capstone harder.

**Why B's undirected games are shorter.** Merges per drop fall from 0.80 (current) to 0.76 (A) and 0.67 (B) for the random bot (6 seeds, 120 s). It is not missed contacts: a check for same-tier pairs that overlap and do not merge found only one-step transients (the merge runs the next step) in all three. It is not packing either: B with colliders 1.5 px smaller (today's overlap and density, 12 seeds) still lost at 116 s against 158 s. Today's board keeps shuffling (twice B's jitter), and the bounces (restitution 0.2) and the shuffling bring same-tier pieces together by accident. B's piles stay where they land, so a random drop has to be aimed to merge. Neither lower (0.2-0.3) nor higher (0.8-1.0) friction changed this. B does leave somewhat more same-tier pairs resting 0-2 px apart, unmerged (pair-steps per minute at 60 Hz, heuristic / random / spam: current 58 / 107 / 129, A 47 / 58 / 98, B 74 / 117 / 190), but merging pairs within 1 px of touching (`mergeGapPx`) did not lengthen B's games (8 seeds: random 94-106 s). This is a difficulty change that #3697 has to tune for (for example the queue, the bin width or the radii), not a defect of the solver.

### Step cost

| measurement                                                                 |               current |                     A |                     B |
| --------------------------------------------------------------------------- | --------------------: | --------------------: | --------------------: |
| real games, 20+ pieces, mean ms per 60 Hz frame (heuristic / random / spam) | 0.040 / 0.058 / 0.102 | 0.055 / 0.073 / 0.124 | 0.099 / 0.130 / 0.150 |
| real games, worst game's p95 ms (heuristic / random / spam)                 |    0.17 / 0.27 / 0.29 |    0.22 / 0.27 / 0.35 |    0.17 / 0.31 / 0.34 |
| bench, 64 pieces, V8 with JIT (run alone): mean / p95 / max ms              | 0.132 / 0.496 / 0.990 | 0.112 / 0.332 / 0.582 | 0.250 / 0.333 / 0.839 |
| bench, 64 pieces, `node --jitless`: mean / p95 / max ms                     |   2.34 / 8.62 / 10.97 |    1.66 / 5.24 / 7.19 |   6.34 / 8.34 / 10.70 |

B costs about 2-2.5x today's mean step with JIT and 2.7x without, but its cost is flatter: its p95 and max are no worse than today's, because Matter's cost spikes when a pile wakes up. Every number is far inside the harness's 16 ms budget on this machine; the interpreter row is the one to worry about (see risks).

### Bundle cost

Measured with esbuild 0.28 (minify) and `gzip -9`, and compiled to Hermes bytecode with the app's own `hermesc` (`-O`):

| what                                                                                | minified |  gzip | Hermes bytecode |
| ----------------------------------------------------------------------------------- | -------: | ----: | --------------: |
| planck.js 1.5.1, whole (`dist/planck.min.js`; Metro does not tree-shake by default) |   297 KB | 55 KB |          341 KB |
| planck.js, only `World`, `Circle`, `Box`, `Vec2` (esbuild tree-shaken)              |   210 KB | 46 KB |          330 KB |
| matter-js 0.20 (for reference; B would replace it)                                  |    87 KB | 27 KB |          132 KB |
| A (tuning only)                                                                     |       +0 |    +0 |              +0 |

So B adds about **+210 KB of Hermes bytecode** to the app if it replaces Matter (about +29 KB gzip on web), and about +340 KB if both are kept during a migration. Tree-shaking barely helps (Box2D's solver is the bulk). The spike itself adds nothing to the app bundle: the candidates live under `sim/` (excluded from the app and from `knip --production`) and planck is a devDependency.

### Ablations

6 seeds x 3 bots, 60 Hz, 120 s (12 seeds, 180 s for the friction and collider-inset probes). Means over bots unless a bot is named.

| variant                                                  | visible gap px | jitter px/s | penetration > 1 px / min | note                                                                                                     |
| -------------------------------------------------------- | -------------: | ----------: | -----------------------: | -------------------------------------------------------------------------------------------------------- |
| current, rail off, thick walls                           |   -1.6 to -3.2 |     4.1-8.7 |               9.7-23.6 k | without its rail, today's Matter sinks pieces into the floor constantly and one piece passed through     |
| A                                                        |   -0.6 to -1.0 |     3.7-6.6 |                2.2-7.7 k |                                                                                                          |
| A, iterations 6 / 4                                      |   -1.6 to -4.0 |     4.0-9.5 |                   9-24 k | the iterations do almost all of A's work                                                                 |
| A, iterations 10 / 8                                     |   -1.0 to -2.1 |     3.8-7.6 |                   6-17 k |                                                                                                          |
| A, slop 0.05 / density 1 / no grow-in / 40-sided circles |        about A |     about A |                  about A | each changes little on its own                                                                           |
| B                                                        |           -0.2 |     1.8-3.4 |                   24-124 |                                                                                                          |
| B, iterations 8 / 3 (Box2D defaults)                     |   -0.2 to -0.3 |     1.9-3.7 |                   27-104 | 10 % cheaper, nearly as good                                                                             |
| B, density 1                                             |           -0.2 |     1.9-3.9 |                    23-95 | density matters little in Box2D                                                                          |
| B, no grow-in                                            |           -0.2 |     1.6-3.6 |                    **0** | grow-in is what pushes pieces into the walls (a growing piece next to a wall); A's grow-in does the same |
| B, friction 0.8 / 1.0 / 0.3 / 0.2                        |           -0.2 |     about B |                  about B | no change to settle or game length                                                                       |
| B, colliders 1.5 px / 3 px under the drawn radius        |    -2.9 / -5.6 |   1.7 / 1.5 |                          | today's density and overlap; random games still 116 / 137 s against 158 s                                |

## Risks

- **Hermes performance (biggest unknown).** Hermes has no JIT. Under V8's interpreter B's 64-piece step averages 6.3 ms against 2.3 ms today (p95 8.3 vs 8.6 ms). A mid-range Android CPU can be 2-3x slower than this container, which would put B's mean near or over a 60 Hz frame's 16.7 ms with 60+ pieces; a 120 Hz device has half that budget, though it runs a physics step only every other frame. Real games rarely pass 50 pieces (the most here was 50), and B's cost is flat (its p95 is no worse than Matter's), but this must be measured on a device before #3697 merges. Cheaper knobs exist: iterations 8 / 3 cost about 10 % less with nearly the same feel.
- **Determinism.** Both engines are deterministic for the same inputs on the same JS engine: the same seed replays the same game (tested for A and B). Neither is bit-identical across JS engines (V8 vs Hermes vs JavaScriptCore can differ in `Math.sin` / `Math.cos`), the same as today. Nothing depends on cross-platform replay: live games use `Math.random` and scoring is server-side. planck keeps global state in `Settings` (left at defaults) and Matter in `Sleeping._motionSleepThreshold` (tested unchanged).
- **Native / web parity.** Both are pure JS, so iOS, Android and web run the same code. B's stability margin (no rail needed, no escapes) makes frame-rate differences less visible; the lid tests pass at 60 and 120 Hz on all three.
- **Migration effort (B).** `engine.ts` would swap its Matter calls for planck through about the surface in `planckBackend.ts` (about 180 lines here, units included). Merges, the lid and restore need no change (the port shows that). To redo: `contactSpawn.ts` (built around Matter's 25-sided circles; Box2D circles are exact), the engine and sim tests that spy on `Matter.Engine.update`, the sim baseline (`baseline.json`, a re-baseline in #3697), the dev panel's convex shapes (`pieceDefs` still allows them; Box2D polygons are capped at `Settings.maxPolygonVertices`, 12), and the debug overlays. planck 1.5's `engines` field says Node >= 24 (CI uses 22; npm only warns, and the library ran on Node 22 throughout this spike). Estimate: one story of about the size of #3693.
- **Migration effort (A).** A is mostly constants, but taking the guard rail away needs thick walls, and A's pieces then press into the walls 4-8.5 k times a minute and 5 escaped in 600 games, so A would keep needing some rail.
- **Grow-in pushes into walls** in both candidates. #3697 can grow away from the wall (shift the centre while growing) or grow faster near a wall.

## Recommendation

**Go with B (planck.js), conditional on a device step-cost check.**

- B is the only candidate that fixes both complaints in the issue. Fruit pack snugly: the visible gap between touching neighbours goes from -2.2..-3.2 px (overlap) to -0.2 px in every bot. The board is calmer: settled-piece jitter halves, and pieces stay inside the walls without a guard rail (28-89 penetrations a minute past 1 px against 1.3-3.7 k today, deepest 10 px against 52 px, no escapes).
- A is a real improvement on overlap (about two-thirds of the way) at no bundle cost, but it does not make the board calmer, and it shows that today's look depends on the guard rail: without the rail, Matter's pieces press into the walls and floor thousands of times a minute and a few pass straight through. Keeping a rail means keeping the teleports the issue wants gone.
- B costs about 2-2.7x the step time of today's Matter and about +210 KB of Hermes bytecode. Both are acceptable if a mid-range Android under Hermes stays inside its frame budget with 60 pieces. If it does not, fall back to A with iterations 20 / 12 and keep a softened rail.
- Either way #3697 must re-tune difficulty: an honest, calm board makes fewer accidental merges, so undirected play loses sooner and reaches lower tiers (B: random games 110 s against 160 s, tier 8 in 11 % of games against 67-73 %). Tier 10 and the capstone stay out of reach in 180 s for every engine and bot, so the win-reachability decision (#3697 / #3700) does not get easier from the physics change.

## Not measured here (owner follow-ups)

- **Real-device step cost** on a mid-range Android (and an older iPhone) under Hermes with 60+ pieces, for current, A and B. Only a V8 interpreter proxy was run here.
- **Hermes bytecode load time and memory** for planck (+330 KB of bytecode).
- **Feel on a device** at 120 Hz (ProMotion): the clips below are rendered from the sim, not recorded from the app.
- **Web (Expo Web) parity in a browser**: the sim runs on Node only.
- **Drawn vs physics radius** with real sprite art (#3697 may draw sprites slightly larger than the collider; the harness already measures the visible gap with a separate drawn radius).

## Clips and stills

Rendered headlessly from the sim (CanvasKit, encoded with ffmpeg): the same seed (4), the same queue and bot RNG, under current, A and B side by side, 24-26 s of play then 3 s without drops so the pile settles. Translucent fills make overlaps show as darker lens shapes. They are not in the repo; the files were handed to the owner with the spike's report: `cascade-{random,spam,heuristic}-seed4-side-by-side.mp4` and, per bot, a mid-game still, the settled pile and a 2x zoom of its bottom-left corner.

## Reproduce

```sh
cd frontend
npx jest src/game/cascade/sim/candidates        # rules parity, lid on every candidate, A/B switches
cd ..
npx --prefix frontend tsx tools/sim/cascade-physics-spike.ts --seeds 100 --md out.md --json out.json   # about 15 min
node --jitless --import ./frontend/node_modules/tsx/dist/loader.mjs tools/sim/cascade-physics-spike.ts --bench-only
```

## Appendix: full tables (100 seeds)

As printed by `tools/sim/cascade-physics-spike.ts --seeds 100` (step-cost rows are wall clock on a shared container, measured while other work ran).

#### heuristic

| metric                                                            |      current 60 Hz |            A 60 Hz |            B 60 Hz |     current 120 Hz |           A 120 Hz |           B 120 Hz |
| ----------------------------------------------------------------- | -----------------: | -----------------: | -----------------: | -----------------: | -----------------: | -----------------: |
| games                                                             |                100 |                100 |                100 |                100 |                100 |                100 |
| game length s (mean)                                              |              180.0 |              179.6 |              178.2 |              180.0 |              179.6 |              179.3 |
| score (mean)                                                      |               3386 |               3204 |               2966 |               3392 |               3210 |               3061 |
| packing density                                                   |              0.684 |              0.671 |              0.664 |              0.684 |              0.671 |              0.665 |
| visible gap mean px                                               |              -2.23 |              -0.73 |              -0.22 |              -2.24 |              -0.73 |              -0.22 |
| deepest overlap px (mean of games)                                |              22.46 |              14.59 |              13.52 |              23.05 |              14.76 |              13.27 |
| settle after drop ms                                              |                760 |                799 |                835 |                739 |                762 |                799 |
| settle after 3+ chain ms                                          |                273 |                315 |                451 |                268 |                315 |                422 |
| chain episodes (total)                                            |                553 |                542 |                523 |                654 |                627 |                582 |
| settle cut off by next drop                                       |               0.51 |               0.52 |               0.51 |               0.48 |               0.47 |               0.48 |
| same-tier pairs resting 0-2 px apart, unmerged (pair-steps / min) |                 58 |                 47 |                 74 |                 58 |                 48 |                 72 |
| jitter px/s                                                       |               3.54 |               3.49 |               1.75 |               3.58 |               3.49 |               1.74 |
| rail (today's predicate) / min                                    |               1855 |              16572 |                426 |               1865 |              16538 |                409 |
| penetration > 1 px past rail / min                                |               1325 |               4077 |                 28 |               1334 |               4027 |                 27 |
| penetration > 3 px past rail / min                                |                630 |                265 |                  8 |                634 |                258 |                  8 |
| deepest penetration past rail px (any game)                       |               52.4 |               44.5 |                8.8 |               52.4 |               44.5 |                9.8 |
| escapes (tunnelled out), total                                    |                  0 |                  1 |                  0 |                  0 |                  1 |                  0 |
| most pieces on board                                              |                 37 |                 37 |                 35 |                 37 |                 37 |                 35 |
| step ms, 20+ pieces (mean)                                        |              0.053 |              0.071 |              0.119 |              0.026 |              0.033 |              0.059 |
| step ms, worst game p95                                           |              0.178 |              0.234 |              0.252 |              0.124 |              0.178 |              0.173 |
| ended by overflow / hard stop / cap                               | 0.00 / 0.00 / 1.00 | 0.03 / 0.00 / 0.97 | 0.08 / 0.00 / 0.92 | 0.00 / 0.00 / 1.00 | 0.03 / 0.00 / 0.97 | 0.06 / 0.00 / 0.94 |
| top tier (mean)                                                   |               8.14 |               8.09 |               7.91 |               8.14 |               8.07 |               8.00 |
| reached tier 6                                                    |               1.00 |               1.00 |               1.00 |               1.00 |               1.00 |               1.00 |
| reached tier 7                                                    |               1.00 |               1.00 |               0.99 |               1.00 |               1.00 |               1.00 |
| reached tier 8                                                    |               0.95 |               0.95 |               0.84 |               0.95 |               0.94 |               0.85 |
| reached tier 9                                                    |               0.19 |               0.14 |               0.08 |               0.19 |               0.13 |               0.15 |
| reached tier 10                                                   |               0.00 |               0.00 |               0.00 |               0.00 |               0.00 |               0.00 |
| reached tier 11                                                   |               0.00 |               0.00 |               0.00 |               0.00 |               0.00 |               0.00 |

#### random

| metric                                                            |      current 60 Hz |            A 60 Hz |            B 60 Hz |     current 120 Hz |           A 120 Hz |           B 120 Hz |
| ----------------------------------------------------------------- | -----------------: | -----------------: | -----------------: | -----------------: | -----------------: | -----------------: |
| games                                                             |                100 |                100 |                100 |                100 |                100 |                100 |
| game length s (mean)                                              |              160.3 |              146.7 |              109.7 |              160.2 |              146.3 |              106.3 |
| score (mean)                                                      |               2590 |               2197 |               1231 |               2581 |               2251 |               1157 |
| packing density                                                   |              0.707 |              0.684 |              0.653 |              0.704 |              0.680 |              0.648 |
| visible gap mean px                                               |              -2.98 |              -0.97 |              -0.19 |              -2.95 |              -0.96 |              -0.19 |
| deepest overlap px (mean of games)                                |              24.42 |              13.73 |               8.88 |              23.27 |              12.36 |               8.67 |
| settle after drop ms                                              |                642 |                654 |                631 |                640 |                651 |                624 |
| settle after 3+ chain ms                                          |                170 |                201 |                292 |                165 |                200 |                265 |
| chain episodes (total)                                            |                294 |                228 |                 60 |                286 |                182 |                 58 |
| settle cut off by next drop                                       |               0.61 |               0.65 |               0.68 |               0.62 |               0.67 |               0.69 |
| same-tier pairs resting 0-2 px apart, unmerged (pair-steps / min) |                107 |                 58 |                117 |                103 |                 63 |                142 |
| jitter px/s                                                       |               3.67 |               3.84 |               1.69 |               3.61 |               3.88 |               1.68 |
| rail (today's predicate) / min                                    |               2115 |              20777 |                382 |               2124 |              20533 |                325 |
| penetration > 1 px past rail / min                                |               1695 |               8497 |                 29 |               1698 |               8398 |                 27 |
| penetration > 3 px past rail / min                                |                830 |                550 |                  8 |                829 |                642 |                  7 |
| deepest penetration past rail px (any game)                       |               52.5 |               45.8 |                7.2 |               58.8 |               50.7 |                7.2 |
| escapes (tunnelled out), total                                    |                  0 |                  0 |                  0 |                  0 |                  1 |                  0 |
| most pieces on board                                              |                 45 |                 45 |                 44 |                 50 |                 46 |                 46 |
| step ms, 20+ pieces (mean)                                        |              0.071 |              0.091 |              0.153 |              0.036 |              0.048 |              0.081 |
| step ms, worst game p95                                           |              0.237 |              0.298 |              0.416 |              0.173 |              0.269 |              0.298 |
| ended by overflow / hard stop / cap                               | 0.67 / 0.00 / 0.33 | 0.89 / 0.00 / 0.11 | 1.00 / 0.00 / 0.00 | 0.72 / 0.00 / 0.28 | 0.85 / 0.00 / 0.15 | 1.00 / 0.00 / 0.00 |
| top tier (mean)                                                   |               7.75 |               7.51 |               6.72 |               7.77 |               7.55 |               6.64 |
| reached tier 6                                                    |               1.00 |               1.00 |               0.98 |               1.00 |               1.00 |               0.95 |
| reached tier 7                                                    |               0.97 |               0.95 |               0.63 |               1.00 |               0.99 |               0.59 |
| reached tier 8                                                    |               0.67 |               0.52 |               0.11 |               0.73 |               0.47 |               0.10 |
| reached tier 9                                                    |               0.11 |               0.04 |               0.00 |               0.04 |               0.09 |               0.00 |
| reached tier 10                                                   |               0.00 |               0.00 |               0.00 |               0.00 |               0.00 |               0.00 |
| reached tier 11                                                   |               0.00 |               0.00 |               0.00 |               0.00 |               0.00 |               0.00 |

#### spam

| metric                                                            |      current 60 Hz |            A 60 Hz |            B 60 Hz |     current 120 Hz |           A 120 Hz |           B 120 Hz |
| ----------------------------------------------------------------- | -----------------: | -----------------: | -----------------: | -----------------: | -----------------: | -----------------: |
| games                                                             |                100 |                100 |                100 |                100 |                100 |                100 |
| game length s (mean)                                              |               58.5 |               54.1 |               41.2 |               58.9 |               55.5 |               41.2 |
| score (mean)                                                      |               2313 |               1933 |               1193 |               2281 |               2002 |               1139 |
| packing density                                                   |              0.734 |              0.697 |              0.682 |              0.730 |              0.696 |              0.677 |
| visible gap mean px                                               |              -3.21 |              -1.06 |              -0.18 |              -3.20 |              -1.04 |              -0.19 |
| deepest overlap px (mean of games)                                |              16.23 |               5.77 |               1.38 |              16.26 |               5.70 |               1.55 |
| settle after drop ms                                              |                492 |                491 |                555 |                414 |                457 |                621 |
| settle after 3+ chain ms                                          |                237 |                289 |                n/a |                204 |                427 |                472 |
| chain episodes (total)                                            |                  5 |                  3 |                  0 |                  8 |                  5 |                  3 |
| settle cut off by next drop                                       |               0.99 |               0.99 |               0.99 |               0.99 |               0.99 |               0.99 |
| same-tier pairs resting 0-2 px apart, unmerged (pair-steps / min) |                129 |                 98 |                190 |                139 |                 93 |                187 |
| jitter px/s                                                       |               7.03 |               6.85 |               3.59 |               7.03 |               6.83 |               3.54 |
| rail (today's predicate) / min                                    |               4702 |              20179 |                900 |               4656 |              20329 |                948 |
| penetration > 1 px past rail / min                                |               3691 |               8500 |                 89 |               3649 |               8347 |                 78 |
| penetration > 3 px past rail / min                                |               1677 |                629 |                 22 |               1663 |                598 |                 19 |
| deepest penetration past rail px (any game)                       |               53.9 |               47.7 |                6.8 |               48.3 |               43.3 |                6.8 |
| escapes (tunnelled out), total                                    |                  0 |                  2 |                  0 |                  0 |                  0 |                  0 |
| most pieces on board                                              |                 48 |                 45 |                 47 |                 49 |                 46 |                 47 |
| step ms, 20+ pieces (mean)                                        |              0.120 |              0.146 |              0.188 |              0.059 |              0.074 |              0.092 |
| step ms, worst game p95                                           |              0.445 |              0.390 |              0.532 |              0.256 |              0.347 |              0.380 |
| ended by overflow / hard stop / cap                               | 1.00 / 0.00 / 0.00 | 0.99 / 0.01 / 0.00 | 1.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 |
| top tier (mean)                                                   |               7.54 |               7.28 |               6.55 |               7.55 |               7.35 |               6.50 |
| reached tier 6                                                    |               1.00 |               1.00 |               0.95 |               1.00 |               1.00 |               0.96 |
| reached tier 7                                                    |               0.99 |               0.94 |               0.51 |               0.98 |               0.97 |               0.47 |
| reached tier 8                                                    |               0.49 |               0.33 |               0.09 |               0.53 |               0.36 |               0.07 |
| reached tier 9                                                    |               0.06 |               0.01 |               0.00 |               0.04 |               0.02 |               0.00 |
| reached tier 10                                                   |               0.00 |               0.00 |               0.00 |               0.00 |               0.00 |               0.00 |
| reached tier 11                                                   |               0.00 |               0.00 |               0.00 |               0.00 |               0.00 |               0.00 |

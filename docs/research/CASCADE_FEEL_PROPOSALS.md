> **Proposals record (#3697, phase 1), not the current contract.** Current Cascade behaviour lives in [`docs/games/cascade.md`](../games/cascade.md). Nothing here ships until the owner picks a proposal and #3697 phase 2 carries it into `engine.ts`.

# Cascade physics feel: three planck.js proposals

**Issue:** #3697 (epic #3033), after the spike #3696 ([`CASCADE_PHYSICS_SPIKE.md`](CASCADE_PHYSICS_SPIKE.md)). **Date:** 2026-11-12. **Owner decisions in force:** engine B (planck.js), pinned at **1.4.2**; difficulty is re-tuned here; the owner runs the device step-cost check later.

**What this is.** Three planck.js tunings, each with a difficulty setting meant to make the capstone (tier 11, #3699) reachable, measured with the sim harness on the same seeds as today's engine and the spike's B. All of it is sim code under `frontend/src/game/cascade/sim/` (excluded from the app bundle and `knip --production`).

**Recommendation.** **2 balanced.** It has the best capstone numbers (25 % of heuristic games and 62 % of skilled-bot games make it within 10 minutes, a median of about 6.5 minutes in the games that do), the calmest settled pile of the three (jitter 1.37 px/s, 2.6x calmer than today), chain merges in one step, and no wall penetration. Tight settles fastest but is the least forgiving; lively looks the most alive but settles slowest after a chain and had to be made harder to keep the lid's spam bound. Details in [Trade-offs](#trade-offs-and-recommendation).

## planck.js 1.4.2 vs 1.5.1

Run first, as asked. **Same behaviour, bit for bit:** the spike's B (`candidateConfig("B")`) over 100 seeds x heuristic / random / spam x 60 / 120 Hz (600 games) gives identical per-game metrics and engine counters under both versions (every field of every game, compared as JSON lines).

The source diff (`dist/planck.js`) explains why. Apart from the build wrapper and serialization, 1.5.x changes:

- `PolygonShape.computeMass`: 1.4.2's `addVec2` writes `out.y = v.x + w.y` (a typo; 1.5 has `v.y`), so a **dynamic polygon's** centre of mass is wrong in 1.4.2. Cascade has only circles and static walls, so nothing here touches it. It matters only if the dev panel's convex shapes (`pieceDefs` still allows them) are ever simulated on planck: they would need 1.5, or a workaround.
- A guard in time of impact for non-finite sweeps (`Sweep.isValid`): 1.5 fails the TOI instead of propagating NaN. Only reached with NaN positions.
- `ContactID.key` packs wider indices; for circle-circle and circle-box contacts the keys are unique either way.
- `DistanceProxy.getSupport` starts at index 0 (was -1) and edge-polygon contact features: polygons only.
- 1.5's `engines` field asks for Node >= 24; 1.4.2 asks for >= 14 (CI runs 22).

`frontend/package.json` now pins `planck` at exactly `1.4.2` (still a devDependency: it reaches the app only in phase 2).

## What the proposals change

### Engine changes common to all three (sim's candidate engine)

- **Grow-in kept inside the bin.** The spike's finding (4) was that a merge's grow-in pushed pieces into the walls. Two parts:
  - Half of it was **measurement**: the spike's penetration counters measured a growing piece at its full radius while its collider was still smaller. The counters now use the collider's current radius (`candidateEngine.ts`; identical for today's engine, which has no grow-in). With that alone, the spike's B shows **0 penetrations past 1 px a minute** (the spike reported 27-89) and at most 1.0-1.4 px deep.
  - The rest is real and is fixed with `growInClamp`: the merged piece is made where its full-size circle is inside the walls and on the floor (the parents' midpoint, clamped), and each grow-in step keeps the grown circle inside (a shift of at most one grow step, no velocity change). Deepest penetration in every proposal: **0.3 px** (Box2D's slop), in every bot and frame rate.
- **Chain reach.** A merge product that is still growing also merges with a same-tier piece its full radius would touch (gap at full size up to 1-2 px), instead of waiting to grow into it. Measured as **chain merge latency**: for each merge product that touches a same-tier piece when it is made (at full size, 1 px tolerance), the time until it merges again. Every proposal: median and p90 **17 ms (one step)**, 99-100 % under 150 ms, 0-1 % never (within 1 s). The spike's B: p90 50-67 ms; today: 17 / 17 (no grow-in).
- **Win event.** Making the capstone emits `{ type: "win" }` (the harness already picks it up for #3699). Long runs stop there.
- **Physics knobs** (all optional, default = the spike): per-step angular damping, merge pop, Box2D angular damping, linear damping, gravity scale, a settle assist (`restDamping`, tried and not used), radius per tier.

### The three tunings

All: planck 1.4.2, velocity / position iterations 10 / 8, density `(r0 / r)^0.5` on the proposal's own radii, today's linear damping (air friction 0.01 per step), 200 px walls, an observing guard rail (no teleports), grow-in clamp, win event.

| knob                                       |     B (spike) |                   1 tight |                  2 balanced |                    3 lively |
| ------------------------------------------ | ------------: | ------------------------: | --------------------------: | --------------------------: |
| friction                                   |           0.5 |                   **0.8** |                         0.5 |                     **0.2** |
| restitution                                |             0 |                         0 |                           0 |                     **0.2** |
| gravity (x today's 2500 px/s^2)            |             1 |                   **1.5** |                    **1.25** |                           1 |
| rolling damping: per step / Box2D 1/s      |       0.3 / 0 |               0.3 / **2** |                 **0.2** / 0 |                   **0** / 0 |
| merge pop (px per step)                    |           0.4 |                     **0** |                     **0.2** |                         0.4 |
| grow-in (fixed steps)                      |             8 |                     **4** |                       **6** |                           8 |
| chain reach (px)                           |             - |                         1 |                           1 |                       **2** |
| merge gap (same tier closer than px)       |             - |                         - |                     **0.5** |                     **1.5** |
| radii r0 / r10 / r11 (today 22 / 88 / 101) | 22 / 88 / 101 |              16 / 52 / 59 |                16 / 52 / 59 |                18 / 56 / 63 |
| droppable tiers                            |           0-4 |                   **0-5** |                     **0-5** |                     **0-5** |
| queue weights by tier                      |     5 4 3 2 1 |               2 3 3 3 3 2 |                 2 3 3 3 3 2 |                 2 3 3 3 3 2 |
| danger mode                                | tiers 3+ x0.2 | **tiers 2+ x0.2, 0-1 x2** | tiers 3+ x0.2, **0-2 x1.5** | tiers 3+ x0.2, **0-2 x1.5** |

### Difficulty: why these numbers

**Room.** Building the capstone means holding a Watermelon while the second one is built: about one piece of each tier 0-10 on the board at once. Today those cover **53 %** of the bin under the lid (sum of the circles' areas / 360 x 500), and a calm pile packs at about 0.65, so there is no room left for the junk in between. That is why no bot reached tier 10 in the spike. The proposals use a smaller, flatter ladder (`round(r0 * (r10 / r0)^(n / 10))`): r0 16, r10 52 (ratio 3.25 against 4) brings the staircase to **21 %** of the bin (lively's 18 / 56: 25 %). Two Watermelons side by side (208 px) still fit in 360 px; tier 5 (r 29) spawns with its top edge at y = 17 (lively's r 32: y = 11), on the canvas.

**Material.** The capstone is 2^11 = 2048 Cherries. Today a drop carries 3.8 Cherries on average (weights 5 4 3 2 1 on tiers 0-4), so even a perfect player needs about 540 drops, and the bots drop about once a second. Adding tier 5 to the drops and moving the weights up the ladder (2 3 3 3 3 2) makes it **9.75 Cherries a drop** (about 210 drops at best).

**The sweep** (balanced physics unless named; 600 s cap; 12-24 seeds, so +/- 10 points; heuristic bot unless named): today's difficulty: no capstone, tier 10 in 1 % of games (B, 100 seeds, below); radii 20 / 75 with weights 4 4 3 2 2: tier 10 in 8 %, no capstone. Smaller radii alone (18 / 66 down to 16 / 56): tier 10 in 50-83 % but no capstone, games run into the 10-minute cap (pace-limited). Tier 5 droppable with today's radii class (18-20 / 60-66): games end by overflow sooner (more material, no room). Both together (16 / 52, tier 5): 13-50 % capstone for the heuristic bot, 42-79 % for the skilled bot, depending on the tuning and the weights. Danger-mode boosts help the tight tuning, which fills up first. Lively first ran on the shared radii (36 % / 74 % capstone) but then the spam bot outlived the lid's 120 s bound in 6-10 % of games, which #3694's gate forbids; 18 / 56 puts its longest spam game at 107-109 s (today's: 98-100 s).

**A second bot.** The harness's heuristic bot drops on a same-tier piece if it can, else at the lowest point, so it buries small pieces under big ones and loses to clutter. To stand in for a "skilled player" it is joined here by a **skilled bot** (`sim/proposals/skilledBot.ts`, not in the harness's `BOTS`): the same timing, but it keeps the pile graded (big pieces left, small right), sets up merges next to a piece one tier away, and avoids burying a smaller piece. It is a proxy too; a practised human probably plays better than either.

## Results (100 seeds)

60 Hz; 120 Hz in brackets where it differs by more than noise. Heuristic and random suite games are capped at 180 s, spam at 120 s (as in the spike); the long runs are capped at 600 s and stop at the capstone. Full tables: [Appendix](#appendix-full-tables-100-seeds).

### Physics feel

| metric                                                    | bot       |       current |  B (spike) |       1 tight | 2 balanced |  3 lively |
| --------------------------------------------------------- | --------- | ------------: | ---------: | ------------: | ---------: | --------: |
| visible gap between touching neighbours, mean px          | heuristic |         -2.23 |      -0.22 |         -0.15 |      -0.15 |     -0.17 |
|                                                           | random    |         -2.98 |      -0.19 |         -0.15 |      -0.15 |     -0.16 |
| deepest overlap px (mean of games' worst)                 | heuristic |          22.5 |       13.5 |          15.3 |       11.4 |   **5.4** |
|                                                           | random    |          24.4 |        8.9 |           9.9 |        6.5 |   **4.4** |
| jitter of settled pieces, px/s                            | heuristic |          3.54 |       1.75 |          1.61 |   **1.37** |  **1.31** |
|                                                           | random    |          3.67 |       1.69 |          1.41 |   **1.35** |      1.49 |
| packing density                                           | heuristic |         0.684 |      0.664 |         0.651 |      0.650 |     0.658 |
|                                                           | random    |         0.707 |      0.653 |         0.664 |      0.671 |     0.692 |
| settle after a drop, ms                                   | heuristic |     760 (739) |  835 (799) | **725** (713) |  762 (752) | 931 (907) |
|                                                           | random    |     642 (640) |  631 (624) | **569** (569) |  594 (588) | 636 (632) |
| settle after a 3+ chain, ms                               | heuristic | **273** (268) |  451 (422) |     366 (384) |  406 (403) | 510 (507) |
|                                                           | random    | **170** (165) |  292 (265) |     236 (224) |  234 (237) | 250 (252) |
| chain merge latency, median / p90 ms                      | all       |       17 / 17 | 17 / 50-67 |       17 / 17 |    17 / 17 |   17 / 17 |
| touching products merged < 150 ms                         | all       |     0.96-0.99 |  0.97-0.99 |     0.99-1.00 |  0.99-1.00 | 0.99-1.00 |
| wall penetration > 1 px per min (current: rail teleports) | all bots  |   1325 - 3691 |          0 |             0 |          0 |         0 |
| deepest wall penetration, px                              | all bots  |         48-59 |    1.0-1.4 |       **0.3** |    **0.3** |   **0.3** |
| escapes (through a wall or the floor)                     | all       |    n/a (rail) |          0 |             0 |          0 |         0 |
| guard-rail events per min                                 | heuristic |          1855 |          0 |             0 |          0 |         0 |
| merges per drop                                           | heuristic |          0.88 |       0.88 |          0.86 |       0.86 |      0.86 |
|                                                           | random    |          0.79 |       0.68 |          0.62 |       0.63 |      0.67 |
|                                                           | spam      |          0.79 |       0.71 |          0.65 |       0.75 |      0.76 |

Reading it:

- **Packing and calm.** All three keep B's flush packing (touching neighbours 0.15 px into each other; Box2D's slop) and are calmer than B: balanced and lively settle to 1.3-1.4 px/s of jitter, a fifth less than B and 2.6x calmer than today. Lively's bounce and free rolling take the deep landing overlaps away (5 px against B's 13): pieces roll off instead of being driven in.
- **Settle.** Tight settles fastest: after a drop 725 ms (today 760, B 835) and after a 3+ chain 366 ms against B's 451. None gets back to today's 273 ms after a chain: today's Matter pieces sink into each other and stop, Box2D's fall into the space the merge left. Gravity is the lever that moves this (it shortens every fall); damping and the settle assist did not (see [Ablations](#ablations)). Lively is the slowest to settle (it bounces and rolls).
- **Accidental merges.** Merges per drop for the random bot are lower than B's in every proposal, because six droppable tiers match less often than five. Within the three, lively makes the most (0.67 random, 0.76 spam) and tight the fewest. The game lengths below matter more: the room the smaller radii give lets undirected play last as long as today's.
- **Walls.** No proposal needs a guard rail: nothing goes more than 0.3 px into a wall or the floor and nothing escapes, at 60 and 120 Hz.

### Game length and the top tiers

| metric                                        | bot       |     current |   B (spike) |     1 tight |  2 balanced |    3 lively |
| --------------------------------------------- | --------- | ----------: | ----------: | ----------: | ----------: | ----------: |
| game length s (180 s cap; spam 120 s)         | heuristic |         180 |         178 |         180 |         180 |         180 |
|                                               | random    |   160 (160) |   110 (106) |   164 (165) |   167 (168) |   151 (154) |
|                                               | spam      |     59 (59) |     41 (41) |     54 (54) |     72 (72) |     66 (65) |
| longest spam game, s (the lid's bound is 120) | spam      |    98 (100) |     67 (66) |     86 (81) |    98 (104) |   107 (109) |
| reached tier 9 / 10 in 180 s                  | heuristic | 0.19 / 0.00 | 0.08 / 0.00 | 0.94 / 0.11 | 0.88 / 0.13 | 0.89 / 0.06 |
|                                               | random    | 0.11 / 0.00 | 0.00 / 0.00 | 0.13 / 0.00 | 0.19 / 0.02 | 0.24 / 0.01 |

**Time to the capstone (600 s cap, the run stops at the capstone):**

| metric                                             | bot              |   current | B (spike) |               1 tight |            2 balanced |            3 lively |
| -------------------------------------------------- | ---------------- | --------: | --------: | --------------------: | --------------------: | ------------------: |
| made the capstone within 10 min                    | heuristic 60 Hz  |         0 |         0 |                  0.17 |              **0.25** |                0.21 |
|                                                    | heuristic 120 Hz |         0 |         0 |                  0.14 |              **0.22** |                0.14 |
|                                                    | skilled 60 Hz    |         0 |         0 |                  0.53 |              **0.62** |                0.50 |
| time to capstone s, p25 / median / p75 (all games) | heuristic 60 Hz  |     never |     never |    never (under 50 %) |    never (under 50 %) |  never (under 50 %) |
|                                                    | skilled 60 Hz    |     never |     never | 377 / **531** / never | 364 / **487** / never | 402 / never / never |
| ... in the games that made it: p25 / median / p75  | heuristic 60 Hz  |         - |         - |       333 / 393 / 450 |       363 / 393 / 468 |     344 / 409 / 479 |
|                                                    | heuristic 120 Hz |         - |         - |       336 / 374 / 459 |       357 / 427 / 452 |     335 / 395 / 476 |
|                                                    | skilled 60 Hz    |         - |         - |       321 / 379 / 456 |       322 / 393 / 472 |     370 / 402 / 440 |
| reached tier 10 within 10 min                      | heuristic 60 Hz  |      0.07 |      0.01 |                  0.81 |                  0.88 |                0.79 |
|                                                    | skilled 60 Hz    |      0.07 |      0.03 |                  0.97 |                  1.00 |                0.96 |
| time to tier 10, median s                          | heuristic 60 Hz  |     never |     never |                   259 |                   262 |                 274 |
|                                                    | skilled 60 Hz    |     never |     never |                   198 |                   209 |                 252 |
| how the run ended: overflow / cap / capstone       | heuristic 60 Hz  | 1 / 0 / 0 | 1 / 0 / 0 |       0.83 / 0 / 0.17 |    0.72 / 0.03 / 0.25 |  0.77 / 0.02 / 0.21 |
|                                                    | skilled 60 Hz    | 1 / 0 / 0 | 1 / 0 / 0 |    0.45 / 0.02 / 0.53 |    0.32 / 0.06 / 0.62 |  0.45 / 0.05 / 0.50 |

So with any proposal the capstone is reachable in a session: a skilled player who gets there takes about 6.5 minutes (the middle half: 5.4-7.9), and half or more of the skilled bot's games get there within 10 minutes; the heuristic bot, which does not plan, gets there in a fifth to a quarter of its games. Tier 10 (Watermelon / Sun) arrives at about 3.5-4.5 minutes. With today's difficulty no bot gets there on either engine, even with 10 minutes. No bot reached the capstone in a 180 s suite game in any configuration.

### Step cost

64 pieces (the spike's bench: merges and lid off, tier 0 / 1 pieces dropped every 250 ms, best of 5), and 90 pieces because the smaller radii hold more pieces (random and spam games reached 82-89 on tight and balanced, 64-73 on lively, against 45-50 today). `node --jitless` (V8's interpreter, a rough stand-in for Hermes); shared 4-core container, ratios only.

| measurement                                                                 |            current |                  B |            1 tight |         2 balanced |           3 lively |
| --------------------------------------------------------------------------- | -----------------: | -----------------: | -----------------: | -----------------: | -----------------: |
| 64 pieces, jitless: mean / p95 ms                                           |        2.46 / 8.99 |        6.63 / 9.11 |        7.15 / 9.73 |        7.63 / 9.56 |        7.25 / 9.41 |
| 90 pieces, jitless: mean / p95 ms                                           |       3.08 / 15.31 |       9.92 / 13.78 |       9.97 / 12.96 |      10.98 / 15.67 |      10.90 / 14.04 |
| 64 pieces, with JIT: mean / p95 ms                                          |        0.14 / 0.48 |        0.29 / 0.41 |        0.31 / 0.41 |        0.39 / 0.51 |        0.41 / 0.56 |
| real games, 20+ pieces, mean ms per 60 Hz frame (heuristic / random / spam) | 0.05 / 0.06 / 0.12 | 0.11 / 0.14 / 0.17 | 0.18 / 0.29 / 0.31 | 0.13 / 0.27 / 0.35 | 0.12 / 0.24 / 0.29 |

The tunings cost about what B costs per piece; balanced and lively pay about 1 ms more at 64 pieces for the merge-gap scan (an O(n^2) pass over same-tier pairs each step; phase 2 can read the pairs from planck's broad-phase contact list instead, whose fattened boxes already cover 1.5 px). The real difference is that **the board holds more pieces**: at 90 pieces the interpreter proxy is at 10-11 ms a step against 6.6 at 64. This is the number for the owner's device check: a mid-range Android under Hermes with 90 pieces.

### Ablations

12 seeds, 60 Hz, 180 s, today's difficulty unless named (so the physics is compared alone).

| variant                                                                 | settle after chain ms (heuristic / random) |    jitter | random merges / drop, length s | note                                              |
| ----------------------------------------------------------------------- | -----------------------------------------: | --------: | -----------------------------: | ------------------------------------------------- |
| B                                                                       |                                  460 / 336 |      1.78 |                      0.69, 112 |                                                   |
| tight without gravity (friction 0.8, Box2D angular 2, pop 0, grow-in 5) |                                  448 / 213 |      1.58 |                      0.66, 102 | damping alone barely moves the chain settle       |
| ... + linear damping 1.5 / s                                            |                                  417 / 179 |      1.57 |                       0.65, 97 | drops fall about 30 % slower: floaty, not used    |
| ... + gravity 1.3 / 1.6                                                 |                       384 / 257, 376 / 179 | 1.85-1.98 |                      0.64-0.67 | gravity is the lever; jitter rises a little       |
| ... + settle assist (slow pieces lose 15-20 % a step)                   |                          441-516 / 196-235 |      1.78 |                      0.63-0.65 | no gain: not used                                 |
| lively (friction 0.3, restitution 0.1, rolling 0.05)                    |                                  448 / 258 |      1.72 |                      0.73, 122 | more accidental merges, longer random games       |
| ... friction 0.2, restitution 0.2, rolling 0                            |                                  451 / 274 |      1.68 |                      0.73, 127 |                                                   |
| ... + merge gap 1.5 px                                                  |                                  561 / 342 |      1.51 |                      0.77, 139 | the most accidental merges (today's: 0.80, 160 s) |

## Trade-offs and recommendation

- **1 tight**: the quickest settle (725 ms after a drop, 366 ms after a chain) and the heaviest, most planted feel (1.5x gravity, no merge pop), but the fewest accidental merges and the least forgiving board: the lowest capstone rates (17 % / 53 %) even with the strongest danger-mode help.
- **2 balanced**: the calmest settled pile, the best capstone rates (25 % heuristic, 62 % skilled, median about 6.5 min when it happens), today's settle after a drop; chain settle 406 ms (B 451, today 273).
- **3 lively**: the most "alive" (bounce, rolling, a 1.5 px merge gap) and the least overlap on landing (5 px), the most accidental merges; but the slowest settle (931 ms after a drop, 510 ms after a chain), a jittery-looking board in motion, and its forgiving physics made it outlive the lid's spam bound until its radii were made larger, which costs it capstone rate (21 % / 50 %).

**Recommendation: 2 balanced**, with tight's gravity as the knob to turn if a device test finds the board slow to settle (gravity 1.25 -> 1.5 took tight's chain settle from 406 to 366 ms with little else changed).

## Open questions for the owner

1. **Target win rate and session length.** Balanced puts the capstone at about 6.5 minutes for a player who gets there, with a quarter of heuristic games and three fifths of skilled-bot games making it in 10 minutes. Is that the target, or should it be easier (more material: weights further up the ladder) or harder (r10 56-60)?
2. **Does the run end at the capstone?** The long runs stop there (time to the first capstone). #3699 decides whether play continues (and #3700 the time bonus).
3. **Ladder and droppable tiers.** The proposals change `tiers.ts` (radii 16-59 instead of 22-101, the cherry a third smaller on screen) and make tier 5 (Apple / Earth) droppable. Both are visible changes: art scale, the next-piece preview, i18n is unaffected. OK?
4. **Step cost with more pieces.** The smaller radii let random and spam play reach 80-90 pieces (today 45-50). The device check should use 90 pieces (interpreter proxy: 10-11 ms a step).
5. **Settle after a chain.** No planck tuning gets back to today's 273 ms (Matter's pieces sink and stop rather than fall); 366-406 ms is the best measured without floaty drops. Acceptable?
6. **The polygon fix in 1.5.** 1.4.2's polygon mass bug is irrelevant to circles. If the dev panel's convex shapes must run on planck, that needs 1.5 (or no polygons).
7. **Lid gate headroom.** Balanced's longest spam game is 98-104 s against the 120 s bound (today's 98-100 s). Fine as is, or should the gate bound move with the re-baseline?

## Media (not in the repo)

Rendered headlessly from the sim (CanvasKit + ffmpeg) with the proposals' own radii, tier colours and the lid line; tier numbers are printed on the pieces. The clip renderer runs its own frame loop (the bot sees the calm state every frame), so a clip's game is not exactly the harness's game for that seed. Handed to the owner with this report: side-by-side clips of B and the three tunings (heuristic and random bots, seed 4, 25 s of play then 3 s of settling, with a settled still and a close-up), a 20x time-lapse of up to 10 minutes per panel (heuristic seed 4, skilled seed 27), and the first 3+ chain after 20 s of a heuristic game in each tuning at half speed.

## Reproduce

```sh
cd frontend
npx jest src/game/cascade/sim                    # proposals: levers, lid on every proposal, merge rules
cd ..
# one shard; the doc's numbers are 90 shards run 4 at a time (about 70 min)
npx --prefix frontend tsx tools/sim/cascade-feel-proposals.ts run --config balanced --part suite:random@60 --seeds 100 --out out/balanced-random60.json
npx --prefix frontend tsx tools/sim/cascade-feel-proposals.ts run --config balanced --part long:skilled@60 --seeds 25 --seed-offset 0 --out out/balanced-skilled-0.json
npx --prefix frontend tsx tools/sim/cascade-feel-proposals.ts report --dir out --md out.md
node --jitless --import ./frontend/node_modules/tsx/dist/loader.mjs tools/sim/cascade-feel-proposals.ts bench --pieces 90
```

Configs: `current`, `B`, `tight`, `balanced`, `lively`. Parts: `suite:<bot>@<hz>` (180 s; spam 120 s) and `long:<bot>@<hz>` (`--cap`, default 600 s; stops at the capstone); bots `heuristic`, `random`, `spam`, `skilled`. `--override '{"planck":{...},"engine":{...},"difficulty":{...}}'` for an ablation.

## Appendix: full tables (100 seeds)

As printed by `tools/sim/cascade-feel-proposals.ts report` (step-cost rows are wall clock on a shared container, measured while other shards ran).

#### long:heuristic@120 (cap 600 s, stops at the capstone)

| metric                                              |          current (Matter) |                 B (spike) |                   1 tight |                2 balanced |                  3 lively |
| --------------------------------------------------- | ------------------------: | ------------------------: | ------------------------: | ------------------------: | ------------------------: |
| games                                               |                       100 |                       100 |                       100 |                       100 |                       100 |
| reached the capstone (tier 11) within the cap       |                      0.00 |                      0.00 |                      0.14 |                      0.22 |                      0.14 |
| time to capstone s, p25 / median / p75              |     never / never / never |     never / never / never |     never / never / never |     never / never / never |     never / never / never |
| ...among the games that made it: p25 / median / p75 |                       n/a |                       n/a |           336 / 374 / 459 |           357 / 427 / 452 |           335 / 395 / 476 |
| time to tier 10 s, p25 / median / p75               |     never / never / never |     never / never / never |           233 / 272 / 406 |           226 / 260 / 317 |           236 / 280 / 351 |
| reached tier 9 / 10                                 |               0.58 / 0.06 |               0.35 / 0.00 |               0.99 / 0.77 |               1.00 / 0.88 |               1.00 / 0.85 |
| ended by overflow / hard stop / cap / capstone      | 1.00 / 0.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 / 0.00 | 0.85 / 0.00 / 0.01 / 0.14 | 0.74 / 0.00 / 0.04 / 0.22 | 0.86 / 0.00 / 0.00 / 0.14 |
| game length s (mean; a capstone ends the run)       |                       280 |                       246 |                       425 |                       466 |                       427 |
| merges per drop                                     |                      0.90 |                      0.89 |                      0.90 |                      0.91 |                      0.90 |
| drops (mean)                                        |                       306 |                       249 |                       504 |                       533 |                       426 |

#### long:heuristic@60 (cap 600 s, stops at the capstone)

| metric                                              |          current (Matter) |                 B (spike) |                   1 tight |                2 balanced |                  3 lively |
| --------------------------------------------------- | ------------------------: | ------------------------: | ------------------------: | ------------------------: | ------------------------: |
| games                                               |                       100 |                       100 |                       100 |                       100 |                       100 |
| reached the capstone (tier 11) within the cap       |                      0.00 |                      0.00 |                      0.17 |                      0.25 |                      0.21 |
| time to capstone s, p25 / median / p75              |     never / never / never |     never / never / never |     never / never / never |     never / never / never |     never / never / never |
| ...among the games that made it: p25 / median / p75 |                       n/a |                       n/a |           333 / 393 / 450 |           363 / 393 / 468 |           344 / 409 / 479 |
| time to tier 10 s, p25 / median / p75               |     never / never / never |     never / never / never |           214 / 259 / 348 |           210 / 262 / 331 |           221 / 274 / 326 |
| reached tier 9 / 10                                 |               0.61 / 0.07 |               0.32 / 0.01 |               1.00 / 0.81 |               1.00 / 0.88 |               1.00 / 0.79 |
| ended by overflow / hard stop / cap / capstone      | 1.00 / 0.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 / 0.00 | 0.83 / 0.00 / 0.00 / 0.17 | 0.72 / 0.00 / 0.03 / 0.25 | 0.77 / 0.00 / 0.02 / 0.21 |
| game length s (mean; a capstone ends the run)       |                       283 |                       249 |                       439 |                       447 |                       423 |
| merges per drop                                     |                      0.90 |                      0.89 |                      0.90 |                      0.90 |                      0.90 |
| drops (mean)                                        |                       308 |                       250 |                       522 |                       514 |                       418 |

#### long:skilled@60 (cap 600 s, stops at the capstone)

| metric                                              |          current (Matter) |                 B (spike) |                   1 tight |                2 balanced |                  3 lively |
| --------------------------------------------------- | ------------------------: | ------------------------: | ------------------------: | ------------------------: | ------------------------: |
| games                                               |                       100 |                       100 |                       100 |                       100 |                       100 |
| reached the capstone (tier 11) within the cap       |                      0.00 |                      0.00 |                      0.53 |                      0.62 |                      0.50 |
| time to capstone s, p25 / median / p75              |     never / never / never |     never / never / never |         377 / 531 / never |         364 / 487 / never |       402 / never / never |
| ...among the games that made it: p25 / median / p75 |                       n/a |                       n/a |           321 / 379 / 456 |           322 / 393 / 472 |           370 / 402 / 440 |
| time to tier 10 s, p25 / median / p75               |     never / never / never |     never / never / never |           168 / 198 / 240 |           186 / 209 / 249 |           220 / 252 / 291 |
| reached tier 9 / 10                                 |               0.67 / 0.07 |               0.50 / 0.03 |               1.00 / 0.97 |               1.00 / 1.00 |               1.00 / 0.96 |
| ended by overflow / hard stop / cap / capstone      | 1.00 / 0.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 / 0.00 | 0.45 / 0.00 / 0.02 / 0.53 | 0.32 / 0.00 / 0.06 / 0.62 | 0.45 / 0.00 / 0.05 / 0.50 |
| game length s (mean; a capstone ends the run)       |                       298 |                       273 |                       442 |                       456 |                       459 |
| merges per drop                                     |                      0.91 |                      0.90 |                      0.92 |                      0.93 |                      0.93 |
| drops (mean)                                        |                       321 |                       273 |                       507 |                       502 |                       431 |

#### suite:heuristic@120

| metric                                                   |          current (Matter) |                 B (spike) |                   1 tight |                2 balanced |                  3 lively |
| -------------------------------------------------------- | ------------------------: | ------------------------: | ------------------------: | ------------------------: | ------------------------: |
| games                                                    |                       100 |                       100 |                       100 |                       100 |                       100 |
| game length s (mean)                                     |                     180.0 |                     179.3 |                     180.0 |                     180.0 |                     180.0 |
| score (mean)                                             |                      3392 |                      3061 |                      7408 |                      7300 |                      5994 |
| merges per drop                                          |                      0.88 |                      0.88 |                      0.86 |                      0.87 |                      0.85 |
| visible gap mean px                                      |                     -2.24 |                     -0.22 |                     -0.15 |                     -0.14 |                     -0.16 |
| deepest overlap px (mean of games)                       |                     23.05 |                     13.27 |                     15.40 |                     10.76 |                      5.53 |
| jitter px/s                                              |                      3.58 |                      1.74 |                      1.60 |                      1.37 |                      1.32 |
| packing density                                          |                     0.684 |                     0.665 |                     0.654 |                     0.648 |                     0.660 |
| settle after drop ms                                     |                       739 |                       799 |                       713 |                       752 |                       907 |
| settle after 3+ chain ms                                 |                       268 |                       422 |                       384 |                       403 |                       507 |
| chain episodes (total)                                   |                       654 |                       582 |                       541 |                       544 |                       444 |
| chain merge latency ms, median / p90 (touching products) |                   17 / 17 |                   17 / 50 |                   17 / 17 |                   17 / 17 |                   17 / 17 |
| touching products merged < 150 ms / never (1 s)          |      0.96 / 0.02 (n=2314) |      0.99 / 0.01 (n=2316) |      1.00 / 0.00 (n=2103) |      1.00 / 0.00 (n=2057) |      1.00 / 0.00 (n=1620) |
| guard-rail events / min                                  |                      1865 |                         0 |                         0 |                         0 |                         0 |
| wall penetration > 1 px / > 3 px, per min                |                1334 / 634 |                     0 / 0 |                     0 / 0 |                     0 / 0 |                     0 / 0 |
| deepest wall penetration px                              |                      52.4 |                       1.4 |                       0.3 |                       0.3 |                       0.3 |
| escapes (total)                                          |                         0 |                         0 |                         0 |                         0 |                         0 |
| most pieces on board                                     |                        37 |                        35 |                        46 |                        38 |                        39 |
| ended by overflow / hard stop / cap / win                | 0.00 / 0.00 / 1.00 / 0.00 | 0.06 / 0.00 / 0.94 / 0.00 | 0.00 / 0.00 / 1.00 / 0.00 | 0.00 / 0.00 / 1.00 / 0.00 | 0.00 / 0.00 / 1.00 / 0.00 |
| top tier (mean)                                          |                      8.14 |                      8.00 |                      9.00 |                      9.06 |                      8.97 |
| reached tier 7                                           |                      1.00 |                      1.00 |                      1.00 |                      1.00 |                      1.00 |
| reached tier 8                                           |                      0.95 |                      0.85 |                      1.00 |                      1.00 |                      1.00 |
| reached tier 9                                           |                      0.19 |                      0.15 |                      0.95 |                      0.96 |                      0.88 |
| reached tier 10                                          |                      0.00 |                      0.00 |                      0.05 |                      0.10 |                      0.09 |
| reached tier 11                                          |                      0.00 |                      0.00 |                      0.00 |                      0.00 |                      0.00 |
| step ms, 20+ pieces (mean)                               |                     0.023 |                     0.054 |                     0.094 |                     0.063 |                     0.063 |

#### suite:heuristic@60

| metric                                                   |          current (Matter) |                 B (spike) |                   1 tight |                2 balanced |                  3 lively |
| -------------------------------------------------------- | ------------------------: | ------------------------: | ------------------------: | ------------------------: | ------------------------: |
| games                                                    |                       100 |                       100 |                       100 |                       100 |                       100 |
| game length s (mean)                                     |                     180.0 |                     178.2 |                     180.0 |                     180.0 |                     180.0 |
| score (mean)                                             |                      3386 |                      2966 |                      7443 |                      7126 |                      5988 |
| merges per drop                                          |                      0.88 |                      0.88 |                      0.86 |                      0.86 |                      0.86 |
| visible gap mean px                                      |                     -2.23 |                     -0.22 |                     -0.15 |                     -0.15 |                     -0.17 |
| deepest overlap px (mean of games)                       |                     22.46 |                     13.52 |                     15.27 |                     11.39 |                      5.43 |
| jitter px/s                                              |                      3.54 |                      1.75 |                      1.61 |                      1.37 |                      1.31 |
| packing density                                          |                     0.684 |                     0.664 |                     0.651 |                     0.650 |                     0.658 |
| settle after drop ms                                     |                       760 |                       835 |                       725 |                       762 |                       931 |
| settle after 3+ chain ms                                 |                       273 |                       451 |                       366 |                       406 |                       510 |
| chain episodes (total)                                   |                       553 |                       523 |                       498 |                       474 |                       404 |
| chain merge latency ms, median / p90 (touching products) |                   17 / 17 |                   17 / 50 |                   17 / 17 |                   17 / 17 |                   17 / 17 |
| touching products merged < 150 ms / never (1 s)          |      0.96 / 0.02 (n=2313) |      0.99 / 0.01 (n=2282) |      1.00 / 0.00 (n=2077) |      1.00 / 0.00 (n=2001) |      1.00 / 0.00 (n=1623) |
| guard-rail events / min                                  |                      1855 |                         0 |                         0 |                         0 |                         0 |
| wall penetration > 1 px / > 3 px, per min                |                1325 / 630 |                     0 / 0 |                     0 / 0 |                     0 / 0 |                     0 / 0 |
| deepest wall penetration px                              |                      52.4 |                       1.3 |                       0.3 |                       0.3 |                       0.3 |
| escapes (total)                                          |                         0 |                         0 |                         0 |                         0 |                         0 |
| most pieces on board                                     |                        37 |                        35 |                        43 |                        43 |                        40 |
| ended by overflow / hard stop / cap / win                | 0.00 / 0.00 / 1.00 / 0.00 | 0.08 / 0.00 / 0.92 / 0.00 | 0.00 / 0.00 / 1.00 / 0.00 | 0.00 / 0.00 / 1.00 / 0.00 | 0.00 / 0.00 / 1.00 / 0.00 |
| top tier (mean)                                          |                      8.14 |                      7.91 |                      9.05 |                      9.01 |                      8.95 |
| reached tier 7                                           |                      1.00 |                      0.99 |                      1.00 |                      1.00 |                      1.00 |
| reached tier 8                                           |                      0.95 |                      0.84 |                      1.00 |                      1.00 |                      1.00 |
| reached tier 9                                           |                      0.19 |                      0.08 |                      0.94 |                      0.88 |                      0.89 |
| reached tier 10                                          |                      0.00 |                      0.00 |                      0.11 |                      0.13 |                      0.06 |
| reached tier 11                                          |                      0.00 |                      0.00 |                      0.00 |                      0.00 |                      0.00 |
| step ms, 20+ pieces (mean)                               |                     0.047 |                     0.106 |                     0.180 |                     0.128 |                     0.124 |

#### suite:random@120

| metric                                                   |          current (Matter) |                 B (spike) |                   1 tight |                2 balanced |                  3 lively |
| -------------------------------------------------------- | ------------------------: | ------------------------: | ------------------------: | ------------------------: | ------------------------: |
| games                                                    |                       100 |                       100 |                       100 |                       100 |                       100 |
| game length s (mean)                                     |                     160.2 |                     106.3 |                     164.6 |                     168.0 |                     154.2 |
| score (mean)                                             |                      2581 |                      1157 |                      3835 |                      4047 |                      4140 |
| merges per drop                                          |                      0.80 |                      0.67 |                      0.62 |                      0.64 |                      0.67 |
| visible gap mean px                                      |                     -2.95 |                     -0.19 |                     -0.15 |                     -0.15 |                     -0.17 |
| deepest overlap px (mean of games)                       |                     23.27 |                      8.67 |                     10.79 |                      6.78 |                      4.47 |
| jitter px/s                                              |                      3.61 |                      1.68 |                      1.43 |                      1.35 |                      1.48 |
| packing density                                          |                     0.704 |                     0.648 |                     0.659 |                     0.667 |                     0.692 |
| settle after drop ms                                     |                       640 |                       624 |                       569 |                       588 |                       632 |
| settle after 3+ chain ms                                 |                       165 |                       265 |                       224 |                       237 |                       252 |
| chain episodes (total)                                   |                       286 |                        58 |                       158 |                       128 |                        62 |
| chain merge latency ms, median / p90 (touching products) |                   17 / 17 |                   17 / 50 |                   17 / 17 |                   17 / 17 |                   17 / 17 |
| touching products merged < 150 ms / never (1 s)          |      0.98 / 0.01 (n=2083) |      0.97 / 0.02 (n=1176) |      0.99 / 0.00 (n=1562) |      1.00 / 0.00 (n=1615) |      1.00 / 0.00 (n=1441) |
| guard-rail events / min                                  |                      2128 |                         0 |                         0 |                         0 |                         0 |
| wall penetration > 1 px / > 3 px, per min                |                1698 / 829 |                     0 / 0 |                     0 / 0 |                     0 / 0 |                     0 / 0 |
| deepest wall penetration px                              |                      58.8 |                       1.2 |                       0.3 |                       0.3 |                       0.3 |
| escapes (total)                                          |                         0 |                         0 |                         0 |                         0 |                         0 |
| most pieces on board                                     |                        50 |                        46 |                        82 |                        85 |                        66 |
| ended by overflow / hard stop / cap / win                | 0.72 / 0.00 / 0.28 / 0.00 | 1.00 / 0.00 / 0.00 / 0.00 | 0.61 / 0.00 / 0.39 / 0.00 | 0.61 / 0.00 / 0.39 / 0.00 | 0.79 / 0.00 / 0.21 / 0.00 |
| top tier (mean)                                          |                      7.77 |                      6.64 |                      7.96 |                      7.94 |                      8.20 |
| reached tier 7                                           |                      1.00 |                      0.59 |                      1.00 |                      1.00 |                      1.00 |
| reached tier 8                                           |                      0.73 |                      0.10 |                      0.80 |                      0.79 |                      0.89 |
| reached tier 9                                           |                      0.04 |                      0.00 |                      0.16 |                      0.15 |                      0.29 |
| reached tier 10                                          |                      0.00 |                      0.00 |                      0.00 |                      0.00 |                      0.02 |
| reached tier 11                                          |                      0.00 |                      0.00 |                      0.00 |                      0.00 |                      0.00 |
| step ms, 20+ pieces (mean)                               |                     0.032 |                     0.073 |                     0.147 |                     0.136 |                     0.114 |

#### suite:random@60

| metric                                                   |          current (Matter) |                 B (spike) |                   1 tight |                2 balanced |                  3 lively |
| -------------------------------------------------------- | ------------------------: | ------------------------: | ------------------------: | ------------------------: | ------------------------: |
| games                                                    |                       100 |                       100 |                       100 |                       100 |                       100 |
| game length s (mean)                                     |                     160.3 |                     109.7 |                     164.0 |                     167.2 |                     151.4 |
| score (mean)                                             |                      2590 |                      1231 |                      3789 |                      4063 |                      3981 |
| merges per drop                                          |                      0.79 |                      0.68 |                      0.62 |                      0.63 |                      0.67 |
| visible gap mean px                                      |                     -2.98 |                     -0.19 |                     -0.15 |                     -0.15 |                     -0.16 |
| deepest overlap px (mean of games)                       |                     24.42 |                      8.88 |                      9.88 |                      6.47 |                      4.39 |
| jitter px/s                                              |                      3.67 |                      1.69 |                      1.41 |                      1.35 |                      1.49 |
| packing density                                          |                     0.707 |                     0.653 |                     0.664 |                     0.671 |                     0.692 |
| settle after drop ms                                     |                       642 |                       631 |                       569 |                       594 |                       636 |
| settle after 3+ chain ms                                 |                       170 |                       292 |                       236 |                       234 |                       250 |
| chain episodes (total)                                   |                       294 |                        60 |                       176 |                       159 |                        71 |
| chain merge latency ms, median / p90 (touching products) |                   17 / 17 |                   17 / 67 |                   17 / 17 |                   17 / 17 |                   17 / 17 |
| touching products merged < 150 ms / never (1 s)          |      0.98 / 0.01 (n=2082) |      0.97 / 0.02 (n=1189) |      0.99 / 0.00 (n=1567) |      1.00 / 0.00 (n=1569) |      1.00 / 0.00 (n=1281) |
| guard-rail events / min                                  |                      2119 |                         0 |                         0 |                         0 |                         0 |
| wall penetration > 1 px / > 3 px, per min                |                1695 / 830 |                     0 / 0 |                     0 / 0 |                     0 / 0 |                     0 / 0 |
| deepest wall penetration px                              |                      52.5 |                       1.0 |                       0.3 |                       0.3 |                       0.3 |
| escapes (total)                                          |                         0 |                         0 |                         0 |                         0 |                         0 |
| most pieces on board                                     |                        45 |                        44 |                        82 |                        85 |                        64 |
| ended by overflow / hard stop / cap / win                | 0.67 / 0.00 / 0.33 / 0.00 | 1.00 / 0.00 / 0.00 / 0.00 | 0.68 / 0.00 / 0.32 / 0.00 | 0.54 / 0.00 / 0.46 / 0.00 | 0.75 / 0.00 / 0.25 / 0.00 |
| top tier (mean)                                          |                      7.75 |                      6.72 |                      7.97 |                      8.02 |                      8.12 |
| reached tier 7                                           |                      0.97 |                      0.63 |                      1.00 |                      1.00 |                      1.00 |
| reached tier 8                                           |                      0.67 |                      0.11 |                      0.84 |                      0.81 |                      0.87 |
| reached tier 9                                           |                      0.11 |                      0.00 |                      0.13 |                      0.19 |                      0.24 |
| reached tier 10                                          |                      0.00 |                      0.00 |                      0.00 |                      0.02 |                      0.01 |
| reached tier 11                                          |                      0.00 |                      0.00 |                      0.00 |                      0.00 |                      0.00 |
| step ms, 20+ pieces (mean)                               |                     0.062 |                     0.143 |                     0.291 |                     0.268 |                     0.235 |

#### suite:spam@120

| metric                                                   |          current (Matter) |                 B (spike) |                   1 tight |                2 balanced |                  3 lively |
| -------------------------------------------------------- | ------------------------: | ------------------------: | ------------------------: | ------------------------: | ------------------------: |
| games                                                    |                       100 |                       100 |                       100 |                       100 |                       100 |
| game length s (mean)                                     |                      58.9 |                      41.2 |                      53.5 |                      71.7 |                      65.4 |
| score (mean)                                             |                      2281 |                      1139 |                      3379 |                      4502 |                      4259 |
| merges per drop                                          |                      0.79 |                      0.70 |                      0.66 |                      0.75 |                      0.76 |
| visible gap mean px                                      |                     -3.20 |                     -0.19 |                     -0.16 |                     -0.15 |                     -0.18 |
| deepest overlap px (mean of games)                       |                     16.26 |                      1.55 |                      1.35 |                      1.01 |                      1.08 |
| jitter px/s                                              |                      7.03 |                      3.54 |                      3.59 |                      3.44 |                      3.48 |
| packing density                                          |                     0.730 |                     0.677 |                     0.705 |                     0.710 |                     0.711 |
| settle after drop ms                                     |                       414 |                       621 |                       490 |                       453 |                       545 |
| settle after 3+ chain ms                                 |                       204 |                       472 |                       482 |                       415 |                       767 |
| chain episodes (total)                                   |                         8 |                         3 |                         6 |                         5 |                         5 |
| chain merge latency ms, median / p90 (touching products) |                   17 / 17 |                   17 / 67 |                   17 / 17 |                   17 / 17 |                   17 / 17 |
| touching products merged < 150 ms / never (1 s)          |      0.99 / 0.01 (n=2143) |      0.97 / 0.02 (n=1355) |      1.00 / 0.00 (n=1997) |      0.99 / 0.01 (n=3258) |      1.00 / 0.00 (n=2607) |
| guard-rail events / min                                  |                      4683 |                         0 |                         0 |                         0 |                         0 |
| wall penetration > 1 px / > 3 px, per min                |               3649 / 1663 |                     0 / 0 |                     0 / 0 |                     0 / 0 |                     0 / 0 |
| deepest wall penetration px                              |                      48.3 |                       1.1 |                       0.3 |                       0.3 |                       0.3 |
| escapes (total)                                          |                         0 |                         0 |                         0 |                         0 |                         0 |
| most pieces on board                                     |                        49 |                        47 |                        89 |                        86 |                        69 |
| ended by overflow / hard stop / cap / win                | 1.00 / 0.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 / 0.00 |
| top tier (mean)                                          |                      7.55 |                      6.50 |                      7.70 |                      7.89 |                      7.99 |
| reached tier 7                                           |                      0.98 |                      0.47 |                      1.00 |                      1.00 |                      1.00 |
| reached tier 8                                           |                      0.53 |                      0.07 |                      0.60 |                      0.77 |                      0.80 |
| reached tier 9                                           |                      0.04 |                      0.00 |                      0.10 |                      0.12 |                      0.19 |
| reached tier 10                                          |                      0.00 |                      0.00 |                      0.00 |                      0.00 |                      0.00 |
| reached tier 11                                          |                      0.00 |                      0.00 |                      0.00 |                      0.00 |                      0.00 |
| step ms, 20+ pieces (mean)                               |                     0.056 |                     0.085 |                     0.167 |                     0.176 |                     0.138 |

#### suite:spam@60

| metric                                                   |          current (Matter) |                 B (spike) |                   1 tight |                2 balanced |                  3 lively |
| -------------------------------------------------------- | ------------------------: | ------------------------: | ------------------------: | ------------------------: | ------------------------: |
| games                                                    |                       100 |                       100 |                       100 |                       100 |                       100 |
| game length s (mean)                                     |                      58.5 |                      41.2 |                      53.7 |                      71.6 |                      66.2 |
| score (mean)                                             |                      2313 |                      1193 |                      3445 |                      4293 |                      4247 |
| merges per drop                                          |                      0.79 |                      0.71 |                      0.65 |                      0.75 |                      0.76 |
| visible gap mean px                                      |                     -3.21 |                     -0.18 |                     -0.15 |                     -0.16 |                     -0.18 |
| deepest overlap px (mean of games)                       |                     16.23 |                      1.38 |                      1.17 |                      1.06 |                      1.08 |
| jitter px/s                                              |                      7.03 |                      3.59 |                      3.55 |                      3.31 |                      3.45 |
| packing density                                          |                     0.734 |                     0.682 |                     0.709 |                     0.707 |                     0.716 |
| settle after drop ms                                     |                       492 |                       555 |                       488 |                       420 |                       570 |
| settle after 3+ chain ms                                 |                       237 |                       n/a |                       389 |                       211 |                       383 |
| chain episodes (total)                                   |                         5 |                         0 |                         3 |                         3 |                         4 |
| chain merge latency ms, median / p90 (touching products) |                   17 / 17 |                   17 / 67 |                   17 / 17 |                   17 / 17 |                   17 / 17 |
| touching products merged < 150 ms / never (1 s)          |      0.98 / 0.01 (n=2127) |      0.97 / 0.01 (n=1324) |      0.99 / 0.00 (n=1917) |      0.99 / 0.00 (n=3089) |      0.99 / 0.00 (n=2611) |
| guard-rail events / min                                  |                      4717 |                         0 |                         0 |                         0 |                         0 |
| wall penetration > 1 px / > 3 px, per min                |               3691 / 1677 |                     0 / 0 |                     0 / 0 |                     0 / 0 |                     0 / 0 |
| deepest wall penetration px                              |                      53.9 |                       1.2 |                       0.3 |                       0.3 |                       0.3 |
| escapes (total)                                          |                         0 |                         0 |                         0 |                         0 |                         0 |
| most pieces on board                                     |                        48 |                        47 |                        88 |                        87 |                        73 |
| ended by overflow / hard stop / cap / win                | 1.00 / 0.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 / 0.00 | 1.00 / 0.00 / 0.00 / 0.00 |
| top tier (mean)                                          |                      7.54 |                      6.55 |                      7.69 |                      7.76 |                      7.97 |
| reached tier 7                                           |                      0.99 |                      0.51 |                      1.00 |                      1.00 |                      1.00 |
| reached tier 8                                           |                      0.49 |                      0.09 |                      0.63 |                      0.66 |                      0.76 |
| reached tier 9                                           |                      0.06 |                      0.00 |                      0.06 |                      0.10 |                      0.19 |
| reached tier 10                                          |                      0.00 |                      0.00 |                      0.00 |                      0.00 |                      0.02 |
| reached tier 11                                          |                      0.00 |                      0.00 |                      0.00 |                      0.00 |                      0.00 |
| step ms, 20+ pieces (mean)                               |                     0.115 |                     0.171 |                     0.314 |                     0.351 |                     0.290 |

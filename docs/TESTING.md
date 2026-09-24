# Testing Guide

See [~/.claude/standards/testing.md](~/.claude/standards/testing.md) for universal conventions (coverage thresholds, what not to test, accessible query priority).

## Project-specific test cases

## Backend

### Setup

```bash
cd backend && python -m pip install -r requirements.txt
```

### Running

```bash
# All tests
python -m pytest tests/ -v

# By file
python -m pytest tests/test_game.py -v       # Yacht game logic
python -m pytest tests/test_api.py -v        # Yacht API endpoints
python -m pytest tests/test_cascade_api.py -v  # Cascade leaderboard API

# With coverage
python -m pytest tests/ -v --cov=. --cov-report=term-missing
```

### Structure

```
backend/tests/
├── __init__.py
├── test_game.py              # YachtGame unit tests — all 13 scoring categories
├── test_api.py               # Yacht FastAPI endpoints via TestClient
└── test_cascade_api.py   # Cascade leaderboard endpoints via TestClient
```

### What's Tested

**test_game.py**

- All 13 scoring categories (hit and miss cases)
- Upper section bonus (triggers at ≥63)
- Roll logic, roll count enforcement (max 3), held dice
- Scoring validation: must roll first, no duplicates, unknown category
- Round advancement, game-over after round 13
- `possible_scores()` only returns unfilled categories

**test_api.py**

- `POST /yacht/new`, `GET /yacht/state`, `POST /yacht/roll`, `POST /yacht/score`, `GET /yacht/possible-scores`

**test_cascade_api.py**

- `POST /cascade/score` — valid submission (201), invalid payloads (422)
- `GET /cascade/scores` — empty initially, sorted descending, capped at 10

### Notes

- API tests use FastAPI's `TestClient` (no running server needed).
- Each test file has an `autouse` fixture that resets in-memory state before/after each test.
- Game logic tests set `game.dice` and `game.rolls_used` directly to avoid randomness.

---

## Frontend

### Setup

```bash
cd frontend && npm install
```

### Running

```bash
npm test
```

### Structure

```
frontend/src/
├── game/cascade/__tests__/
│   ├── scoring.test.ts     # scoreForMerge() pure function
│   └── fruitQueue.test.ts  # FruitQueue peek/consume/bounds
└── theme/__tests__/
    └── fruitSets.test.ts   # All fruit set structural invariants
```

### What's Tested

**scoring.test.ts**

- `scoreForMerge(tier)` returns correct points per tier
- Values double each tier (tiers 0–9)
- Tier 10 (Watermelon) returns the disappear bonus (256)
- Cumulative scoring adds correctly

**fruitQueue.test.ts**

- `peek()` and `peekNext()` return tiers within `[0, MAX_SPAWN_TIER]`
- `consume()` returns the current peek value
- Queue advances correctly after consume
- Never spawns above `MAX_SPAWN_TIER` across 200 samples

**fruitSets.test.ts**

- All 3 sets (fruits, gems, planets) define exactly 11 tiers
- No duplicate tiers within a set; all tiers 0–10 covered
- Every fruit has non-empty name, emoji, and color
- Radii increase monotonically with tier
- Radii are identical across all sets for the same tier (physics skin-agnostic)

### Notes

- Physics engine (Matter.js) is not unit-tested — third-party, no jest DOM available.
- Only pure logic modules are tested (no React components, no canvas).

### Yacht AI simulation — two-layer model (#2245)

All Yacht AI simulation runs on one harness, `frontend/src/game/yacht/sim/`:

- `streams.ts` gives each player their own seeded dice and AI-noise streams.
  Dice for roll _k_ of round _r_ come from a per-(stream, round) table, so one
  player's rerolls never shift the other player's dice. The old simulators
  shared one LCG seeded with `seed + i`; adjacent seeds of that LCG produce the
  same first die ~99.8% of the time, so their games weren't independent.
- `harness.ts` plays matchups in **blocks of four games**: A first and B first,
  each with the two dice streams mirrored between the players. Every matchup
  is therefore always order-swapped.
- `stats.ts` reports both players symmetrically: win rate (ties count half),
  win rate moving first and second, the order effect, the first-mover win
  rate, and per-player score, bonus rate, upper subtotal, below-par fills and
  per-category mean/hit rate. Every value has a 95% CI computed **over blocks**
  (games in a block share dice, so blocks are the independent unit).
- `gate.ts` holds the calibration gate: matchups, game counts and bands. It is
  the only place bands are defined.

**Layer 1: PR smoke test.** `__tests__/ai.simulate.test.ts` runs in every PR
(about 1s per game under Jest, 5 blocks per matchup). It catches total breakage:
the AI throwing, invalid scores, a harder tier no longer beating Easy, or
mirroring broken (paired self-play must come out at exactly 50%). It is far too
small to see balance drift.

**Layer 2: scheduled calibration gate.** `.github/workflows/yacht-sim-gate.yml`
runs nightly, on demand (`workflow_dispatch`, with an optional games
override), and on PRs that touch the AI, engine, oracle or gate. Its
`bands` job runs the three `GATE_GROUPS` in parallel; its `regret` job runs
`ai.calibrate.test.ts` (#2244, below). Run it locally from the repo root:

```bash
npx tsx scripts/simulate-yacht.ts --gate                       # everything (~40 min)
npx tsx scripts/simulate-yacht.ts --gate --group self-play     # one CI group
npx tsx scripts/simulate-yacht.ts --gate --group hard-vs-easy --games 400  # quick look
npx tsx scripts/simulate-yacht.ts --a hard --b medium --blocks 250         # ad-hoc matchup
npx tsx scripts/simulate-yacht.ts --a hard --b medium --mode independent   # unpaired dice
```

A failing band prints the band, the observed value and its CI, e.g.
`FAIL hard-vs-easy:win-rate: observed 55.1% [52.9%, 57.3%] (95% CI), band ≥ 57.0% and ≤ 67.0% — …`.
`[CI crosses the bound: inconclusive …]` means the run can't separate pass from
fail at that sample size; rerun that group with more `--games` before acting.

**Reading order-swap output.** For an A-vs-B matchup: `A moving first` and
`A moving second` are A's win rates in each seat; `order effect` is their
difference, paired within blocks. `First-mover win rate` is the result for
whoever moved first, so 50% means turn order doesn't matter. A #2200-style
artifact shows up as a large order effect. In self-play A's win rate is 50%
by construction, so the first-mover rate is the number to read.

**Bands are regression bands.** They are centred on the current AI as
measured on 2026-09-24 (values in `gate.ts` comments), not on the #2157 design
targets. The current AI misses those targets: Hard and Medium are close to even
(51.9%), and Hard's bonus rate is 46.6%, not ≥ 65%. The old
`ai.calibrate.test.ts` bands asserted the targets and would have failed if they
had ever run. #2246 reshapes the tiers and should re-centre the bands.

**Sample size and power** (measured, 4 CPU cores, ~0.33s/game under `tsx`):

| Quantity                   | Per-block SD | Blocks (games) | 95% CI half-width | Band half-width |
| -------------------------- | ------------ | -------------- | ----------------- | --------------- |
| Win rate (A vs B)          | 0.245        | 500 (2,000)    | ±2.2pp            | ±5pp            |
| Order effect               | 0.247        | 500 (2,000)    | ±2.2pp            | ±5pp            |
| Self-play first-mover rate | ~0.18        | 250 (1,000)    | ±2.2pp            | ±5pp            |
| Mean score (one player)    | ~30          | 500 (2,000)    | ±2.6–3.0          | floor 7–8 below |

With a CI half-width under half the band's half-width, a run whose true value
is at the band centre fails less than once in 10⁵ runs (z ≈ 4.5). A real shift
of 7.5pp is detected ~99% of the time; a shift of exactly 5pp is detected
50% of the time. Because the seeds are fixed, the gate is deterministic: the
same code gives the same numbers. It only changes result when the AI changes.

Wall-clock at these sizes: 2,000 games is ~11 min per matchup group and the
self-play group (3,000 games) is ~17 min on a 4-core dev box. The jobs run in
parallel, so the whole gate finishes in under ~20 min. Each job has a 90-min
timeout to absorb slower runners.

**What pairing buys.** It isn't free variance reduction everywhere. Mirrored
pairs are negatively correlated (r ≈ −0.35), which cuts the variance of the
A−B score difference ~23% and halves the order-effect CI versus independent
dice (per-block SD 0.25 vs 0.51). But the order-swapped games in a block
replay the same dice, so for a plain win rate paired and independent CIs come
out about equal at the same game count. For one player's absolute score,
paired is slightly wider. `--mode independent` is there for unpaired runs.

**#2200 check.** Hard-vs-Hard over 4,000 paired games (seeds 15, 21–23) gives
a first-mover win rate of 48.8% ± 1.1: no first-mover handicap remains after
#2317. The old shared-LCG method on the same code gives 50.8% ± 3.1 over 1,000
games. The 57.3/42.7 split reported on #2317 came from 150 games per side, where
the CI is about ±8pp.

`scripts/simulate-yacht.ts` (#2213) is now a thin CLI over this harness. Its
old bands table (stale since the utility-AI rewrite) and the separate
`ai.baseline.test.ts` metrics printer were retired; `--gate` and the ad-hoc
report replace both.

### Yacht AI regret metric — EV-loss vs the optimal oracle (#2244)

Win rate says who won; it says nothing about *how well* either side played — a
bot can win a dice game on luck while playing badly, or lose while playing
perfectly. The regret metric grades individual decisions instead: for each
hold or category choice the AI makes, "EV-loss" is `optimalEV - chosenEV`,
computed against the exact ground-truth oracle (`frontend/src/game/yacht/oracle/`,
[`docs/YACHT_ORACLE.md`](YACHT_ORACLE.md)) — the Yacht analogue of chess's
average centipawn loss. Implementation: `oracle/regret.ts` (per-decision
EV-loss + blunder banding) and `oracle/regretAggregate.ts` (summaries,
worst-decision tail, and a Welch's-t-test significance check), unit-tested in
`oracle/__tests__/regret.test.ts`, `regretAggregate.test.ts`, and (against the
real committed table) `regretOracle.test.ts`.

**Blunder bands** (`DEFAULT_EV_LOSS_BANDS`, adjustable — pass a custom
`EvLossBands` to any of `regret.ts`'s functions):

| Band       | EV-loss           |
| ---------- | ------------------ |
| `optimal`  | `<= 0` (exact — chosen and optimal EV come from the same computed array) |
| `minor`    | `0 < loss < 1`      |
| `mistake`  | `1 <= loss <= 5`    |
| `blunder`  | `> 5`               |

**Run it** — lives in `ai.calibrate.test.ts`, gated behind `YACHT_SIM_FULL`,
and runs nightly as the `regret` job of `yacht-sim-gate.yml`. Its games use
the harness's per-player streams (`sim/streams.ts`):

```bash
YACHT_SIM_FULL=3000 npx jest --testPathPattern="ai.calibrate" -t "regret" --silent=false
```

Each decision requires an **awaited** oracle query — mean ~2.5ms for hold EVs
in isolation on dev hardware (`docs/YACHT_ORACLE.md` §7), but end-to-end
through this test file (oracle query + simulation overhead) that measures at
**~20-26ms/decision** across two real runs: 19.75ms/decision at N=30 (6,941
decisions, 137s), 25.59ms/decision at N=150 (34,628 decisions, 886s). At that
rate, full `YACHT_SIM_FULL` coverage (e.g. N=3000) would take on the order of
an hour for the hold-EV path alone, so the regret tests sample
`min(YACHT_SIM_FULL, 50)` games per difficulty by default (`REGRET_SAMPLE_CAP`
in the test file — already enough for the Easy-vs-Hard significance assertion
below at N=30, per the measurement above); override independently with
`YACHT_REGRET_SIM=<N>` for full or custom coverage. This is the documented
sampling fallback called for by #2244's acceptance criteria — full
non-sampled 3,000-game coverage was measured and found impractical for
routine runs, not assumed.

**Timeout caveat if you raise `YACHT_REGRET_SIM`**: the test's own
`it()` timeout (1,800,000ms) is not a reliable backstop for a large run. Once
the oracle table is loaded (one-time per process), every `await` in the hot
loop resolves an already-settled promise — a microtask, not a macrotask — so
a long chain of them can starve Node's timer queue (where Jest's timeout
callback lives) for the batch's entire real duration. Observed directly: a
600,000ms-timeout run that took 886s of real wall-clock time ran to
completion (failing on an assertion, not a timeout) rather than being
aborted at the 600s mark. Budget wall-clock time from the measured
ms/decision rate above, not from the configured timeout.

The gate asserts:

- Mean EV-loss orders Easy > Medium > Hard, with Easy-vs-Hard significant at
  the run's sample size (the largest, most reliable gap — combines both
  tiers' noise-rate *and* weight differences). Medium sits directionally
  between the two, but per `aiWeights.ts`'s own calibration target (Hard wins
  only ~47–53% vs Medium), Medium-vs-Hard is not asserted significant — that
  gap being small or noisy is itself a real epic finding (#2246), not a test
  bug.
- A noise-disabled diagnostic (`bestHoldMask`, bypassing `holdStrategy`'s
  cognitive-noise injection) confirms Easy's and Medium's hold decisions are
  *identical* under the same seed — `EASY_HOLD_WEIGHTS` and
  `MEDIUM_HOLD_WEIGHTS` are equal-valued today, so with noise removed there's
  nothing left to separate them. This demonstrates the metric measures
  decision *structure*, not just how often noise fires.

Console output (only shown with `--silent=false` or on failure) reports a
per-difficulty table (mean EV-loss, hold/category split, blunders per 1,000
decisions), a band histogram, and the worst 5 decisions across all three
difficulties by EV-loss — e.g. an AI scoring a second Yacht roll into "fours"
instead of "yacht" (missing the +100 joker bonus) shows up as a ~90-point
blunder, which is exactly the kind of catastrophic single-decision failure
aggregate win-rate can't surface.

---

## Manual repros

### Hearts: tab-switch state preservation (#745)

Verifies that `scoreHistory` and full game state survive a top-tab switch
(which unmounts the Lobby HomeStack).

1. Start a Hearts game; play through at least 2 hands so `cumulativeScores`
   are non-zero and the round table has 2+ rows.
2. Mid-game, tap the **Ranks**, **Profile**, or **Settings** bottom-tab.
3. Tap **Lobby** to return; resume Hearts.
4. Open the ⋯ menu → **Scoreboard**. Expected:
   - Round table shows the same number of rows as before the switch.
   - Each row sums to 26 (or `[0,26,26,26]` for moon shots).
   - Totals row equals the sum of every round row, per player.
5. Continue play. **Game Over must not fire spuriously** on re-entry —
   it should only trigger when a player legitimately reaches ≥ 100.

### Hearts: Sentry integrity validators (#745)

Verifies the validators emit warnings when state is impossible. Run with
the Sentry dashboard open and filtered to `subsystem:hearts.integrity`.

1. From a dev build, manually corrupt `AsyncStorage["hearts_game"]` so
   `cumulativeScores[1]` exceeds the sum of `scoreHistory[*][1]` (e.g. via
   React Native Debugger). Re-mount the Hearts screen.
2. Confirm a warning event appears in Sentry tagged
   `subsystem=hearts.integrity, check=totals_vs_rounds_mismatch`.
3. Repeat-mount the screen with the same payload. Confirm Sentry receives
   **at most one** event per check per mount (per-mount dedupe).

### Hearts: hearts-broken sound + animation (#774)

Verifies the crack sound and burst animation fire exactly once when hearts break.

1. Start a Hearts game. Pass phase may occur first — complete it.
2. Play non-heart cards until someone is void in the led suit and must discard a heart.
   (Alternatively: reach trick 2+ where hearts can be led if broken, then lead a heart.)
3. The moment the **first** heart is played into any trick:
   - Confirm the crack sound plays once (audible pop/crack).
   - Confirm a red ♥ icon springs up at the trick center, cracks radiate outward, and a red tint flashes on the trick area.
   - Confirm the icon lingers at reduced opacity (~3 s total), then fades out over 0.5 s.
   - Confirm play is **not blocked** — other cards remain tappable while the animation runs.
4. Play a second heart into a subsequent trick. Confirm the animation and sound do **not** fire again.
5. **Reduced-motion fallback:** Enable Reduce Motion in device accessibility settings, repeat steps 2–3.
   Confirm only an instant red tint flash (~0.3 s) occurs, no spring or crack-line motion.

### Hearts: shoot-the-moon sound + animation (#773)

Verifies the fanfare sound and full-screen moon overlay fire exactly once when someone shoots the moon.

1. Start a Hearts game and engineer a moon shot (one player takes all 13 hearts and Q♠). The easiest way in a local dev build is to seed the engine state via the console so that one AI player holds all 26 point cards after trick 13.
2. Once all 13 tricks resolve, confirm:
   - A triumphant fanfare (hearts-moon-shot.mp3) plays once.
   - A dark semi-transparent full-screen overlay appears with a 🌙 moon icon spring-scaling from 0 → 1.
   - Six ★ stars stagger in around the moon (each 120 ms apart).
   - The shooter label appears below the moon (e.g. "You shot the moon!" or "{Name} shot the moon!").
   - The overlay auto-dismisses after ~2.2 s. Play is **not blocked** — the hand-end modal (or game-over modal) appears after the animation.
3. Re-mount the Hearts screen mid-game (e.g. navigate away and back). Confirm the moon shot animation does **not** replay on re-render.
4. **Mute toggle:** Enable the global mute, trigger a moon shot. Confirm the animation still shows but the sound is suppressed.
5. **Reduced-motion fallback:** Enable Reduce Motion in device accessibility settings, trigger a moon shot. Confirm the moon icon and stars appear instantly (no spring motion) and the label is visible immediately; overlay still auto-dismisses after 2.2 s.

### Hearts: Queen of Spades sound + animation (#775)

Verifies the dark sting sound and card animation fire exactly once when the Queen of Spades is taken.

1. Start a Hearts game and play until a trick containing Q♠ is resolved.
2. The moment the trick resolves (four cards played):
   - Confirm a dark ominous sting (hearts-queen-of-spades.mp3) plays once.
   - Confirm a Q♠ card (white card face with "Q" and "♠") springs up at scale 0 → 1.4×.
   - Confirm the card executes 4 left-right shake iterations (translateX ±8 px).
   - Confirm the card fades to opacity 0 after the shakes.
   - Confirm a full-screen red flash overlay (rgba(220,38,38,0.25)) fades in and out over the ~1.0 s duration.
   - Confirm the taker's label is correctly identified (check the player who took the trick).
3. Confirm play is **not blocked** — the animation runs in parallel with normal game flow.
4. **Reduced-motion fallback:** Enable Reduce Motion in device accessibility settings, trigger a Q♠ trick. Confirm only a red flash (~0.8 s) occurs, no zoom or shake.

### Star Swarm: ship hidden on Game Over freeze frame (#2334)

Verifies the player ship (and any shield/lightning overlay) disappears the instant the
game freezes on death, instead of the frozen frame looking like the ship is still flying
and firing. `engine.ts` clears `playerBullets` on the GameOver transition (unit-tested);
this repro covers the render-only half in `GameCanvas.tsx`, which this repo does not unit
test (see "What's Tested" note above — no React/canvas coverage).

1. Start a Star Swarm run and take the last hit while enemy bullets or diving enemies are
   still on screen (any wave). Bonus: collect Lightning first so bullets are in flight at
   the moment of death, matching the original report.
2. The instant "GAME OVER" appears:
   - Confirm the player ship sprite is **not** visible anywhere on the frozen frame.
   - Confirm no stray player bullet is rendered floating near where the ship was.
   - Confirm the shield ring / lightning tint overlay (if a power-up was active) also
     disappears along with the ship.
   - The rest of the frame (enemies, enemy bullets, starfield) still freezes as expected —
     only the player's own ship/bullets should be gone.

---

## E2E Test Conventions

Guidelines for writing Playwright specs in `e2e/tests/`. These rules exist because each item below caused a real flaky-run incident.

### 1. Storage key versioning

When a game's `localStorage` key changes (e.g. `blackjack_game_v1` → `v2`), search `e2e/` for the old key and update **all** references atomically in the same PR. Partial updates leave some specs clearing the wrong key, leaking state between tests.

```bash
grep -r "blackjack_game_v" e2e/
```

### 2. `data-testid` for i18n-coupled labels

Any element whose accessible label comes from a translation string must also carry a `testID` prop so specs can target it without coupling to translated copy. Elements that currently need this:

- Deal button (`/deal cards with/i`)
- Clear Bet button
- 2048 overlay New Game button
- Cascade Play Again button

### 3. No branching on `isVisible()` without a prior settled wait

Never call `isVisible()` in an `if` branch unless the immediately preceding `await` is `expect(...).toBeVisible()` or `locator.waitFor()` on the **same** locator with no intervening awaits. The snapshot can go stale between the wait and the branch check.

```typescript
// Bad — race window between toBeVisible() and isVisible()
await expect(page.getByText("Hit").or(page.getByText("Next Hand"))).toBeVisible();
const hitVisible = await page.getByText("Hit").isVisible(); // stale snapshot

// Good — isVisible() is inside the same await chain
const hitOrResult = page.getByText("Hit").or(page.getByText("Next Hand"));
await expect(hitOrResult).toBeVisible({ timeout: 5000 });
if (await page.getByText("Hit").isVisible()) { ... }
```

### 4. No `waitForTimeout`

Replace all hard sleeps with assertion-driven waits. Hard sleeps add wall time on fast runners and silently under-budget on slow ones.

```typescript
// Bad
await page.waitForTimeout(2000);
await expect(page.getByText("Score")).toBeVisible();

// Good
await expect(page.getByText("Score")).toBeVisible({ timeout: 8000 });
```

### 5. Non-deterministic outcomes

Tests that exercise live RNG must use the `.or()` pattern for assertions rather than asserting a specific outcome. Tests that need deterministic assertions must use `injectEngineState()` to pre-seed the engine state.

```typescript
// Live RNG — assert either outcome
await expect(
  page.getByText("Hit").or(page.getByText("Next Hand")),
).toBeVisible();

// Deterministic — inject known state
await injectEngineState(page, playerPhaseState());
await expect(page.getByText("Hit")).toBeVisible();
```

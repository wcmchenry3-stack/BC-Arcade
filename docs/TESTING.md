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
npm run typecheck
```

### Type-checking (#2211)

`npm run typecheck` runs `tsc --noEmit -p tsconfig.typecheck.json` and must report zero errors.
CI runs it in the dedicated `typecheck-frontend` job on every PR and fails on any error.

`tsconfig.typecheck.json` extends the main `tsconfig.json` but covers **production sources
only**: test files (`__tests__/`, `*.test.ts(x)`), jest setup files, `scripts/`, `e2e/` and
`eslint.config.js` are excluded. Editors keep using `tsconfig.json`, so tests still get
in-editor type hints; they just aren't gated in CI yet.

Don't suppress new errors with `@ts-ignore`/`@ts-expect-error` to get the job green. If one
genuinely needs a larger refactor, suppress that single line with a comment linking a tracking
issue.

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
(about 140 games, ~15s under Jest with the #2246 tiers). It catches total breakage:
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

**What the bands encode.** Since #2246 the bands describe the tier design:
each tier's mean score sits in a ±10-point band around its #2157 target (Easy
~160, Medium ~215, Hard ~250), the ladder is strictly ordered on score,
upper-bonus rate and below-par fills, and win-rate and bonus bands are
centred on the values measured on 2026-09-24 (in `gate.ts` comments). The
tiers ignore the opponent, so each player's game depends only on their own
streams: the order effect is exactly 0 and the self-play first-mover rate
exactly 50%. Those bands stay as a guard against an opponent-aware layer
reintroducing a #2200-class artifact.

**Sample size and power** (measured, 4 CPU cores, ~0.06s/game under `tsx`
for the #2246 tiers; the first measurements below were taken on the older
utility AI at ~0.33s/game):

| Quantity                   | Per-block SD | Blocks (games) | 95% CI half-width | Band half-width |
| -------------------------- | ------------ | -------------- | ----------------- | --------------- |
| Win rate (A vs B)          | ≤ 0.245      | 500 (2,000)    | ±1.6–2.4pp        | ±5pp            |
| Order effect               | 0.247        | 500 (2,000)    | ±2.2pp            | ±5pp            |
| Self-play first-mover rate | ~0.18        | 250 (1,000)    | ±2.2pp            | ±5pp            |
| Mean score (one tier)      | ~30–40       | 250–500        | ±2.4–4.9          | ±10             |

With a CI half-width under half the band's half-width, a run whose true value
is at the band centre fails less than once in 10⁵ runs (z ≈ 4.5). A real shift
of 7.5pp is detected ~99% of the time; a shift of exactly 5pp is detected
50% of the time. Because the seeds are fixed, the gate is deterministic: the
same code gives the same numbers. It only changes result when the AI changes.

Wall-clock at these sizes: 2,000 games is ~2 min per matchup group and the
self-play group (3,000 games) is ~3 min on a 4-core dev box with the #2246
tiers (the older utility AI took ~11 and ~17 min). The jobs run in parallel;
each has a 90-min timeout to absorb slower runners.

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
routine runs, not assumed. With the #2246 tiers the AI itself is much
cheaper: the default run measures ~4ms/decision (11,550 decisions in 46s),
so raising `YACHT_REGRET_SIM` is now affordable when needed.

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

- Mean EV-loss orders Easy > Medium > Hard, and every adjacent gap is
  significant (measured 2026-09-24: 2.40 / 1.01 / 0.14, Welch's t = 22.8,
  31.0 and 40.9). Hard makes no blunder-band (> 5 EV) decisions: its slips
  are capped at 3 points below the oracle's best.
- A noise-free diagnostic plays each tier at temperature 0 on the same dice:
  the order still holds (0.97 / 0.48 / 0.00), so the ladder comes from each
  tier's foresight, not from how much noise it adds. Noise-free Hard *is*
  the oracle, so its EV-loss is ~0. (Before #2246 the equivalent diagnostic
  showed Easy and Medium making *identical* decisions with noise removed —
  the problem #2246 fixed.)

Console output (only shown with `--silent=false` or on failure) reports a
per-difficulty table (mean EV-loss, hold/category split, blunders per 1,000
decisions), a band histogram, and the worst 5 decisions across all three
difficulties by EV-loss — e.g. an AI scoring a second Yacht roll into "fours"
instead of "yacht" (missing the +100 joker bonus) shows up as a ~90-point
blunder, which is exactly the kind of catastrophic single-decision failure
aggregate win-rate can't surface.

---

### Hearts AI sim gate v2 — duplicate deals, SPRT, conditional metrics (#2238)

All Hearts AI simulation runs on `frontend/src/game/hearts/sim/`;
`scripts/simulate-hearts.ts` is the CLI around it.

- `harness.ts` — **duplicate-deal replay.** A _block_ replays one sequence
  of deals once per line-up of a matchup. Hand _h_ of block _b_ is always
  dealt from its own (seed, block, h) stream, whatever happened earlier, and
  each seat's AI noise comes from its own (seed, block, hand, seat) stream,
  so play never shifts the deals and one seat's noise never moves another's.
  Seat 0 always holds the **human stand-in** (Schemer): the AI treats seat 0
  as the human (Daring aims its passes and Q♠ dumps there, and `ai.ts` turns
  that targeting off for an AI in seat 0), so AIs under test only ever sit
  in seats 1–3.
  - _Preset matchups_ are the tables the app deals (all-Cautious,
    all-Schemer, all-Daring, mixed), with the AIs rotated across seats 1–3.
  - The _field matchup_ is the duplicate-bridge comparison: one test seat
    takes each persona in turn, in each of seats 1–3, against an
    all-Schemer field on the same deals.
- `metrics.ts` — **every metric is `numerator | denominator`**, a ratio of
  two per-seat counters, and every report prints both counts. No metric can
  be declared without its denominator (the type requires one):

  | Metric             | Numerator \| denominator                                  |
  | ------------------ | --------------------------------------------------------- |
  | `win_share`        | games won (ties split) \| games played                    |
  | `points_per_hand`  | points taken (moon-adjusted) \| hands played              |
  | `qs_taken`         | hands taking Q♠ \| hands played                           |
  | `moon_attempt`     | hands the moon-attempt trigger fired \| hands played      |
  | `moon_success`     | moons shot in attempted hands \| hands attempted (paired) |
  | `moon_shot`        | moons shot \| hands played                                |
  | `qs_dump_on_human` | Q♠ dumps won by the human seat \| Q♠ dumps                |
  | `void_created`     | passes that emptied a suit \| passes that could have      |

  Estimates are ratio estimators over blocks (Σ numerators ÷ Σ
  denominators, delta-method SE), so games sharing deals are never counted
  as independent. A rate whose denominator never occurred is reported as
  `n/a`, never as 0.

- `sprt.ts` — Wald sequential probability ratio tests on per-block series
  (Gaussian, plug-in variance, as chess-engine CI does for game pairs).
- `gate.ts` — the matchups, the checks, and the pre-registered hypotheses;
  `baseline.json` holds the last-known-good values.

**Two kinds of check**, all sequential:

- **Regression checks** (14) hold a metric at its `baseline.json` value:
  H0 "equals the baseline" against H1 "moved by δ" (3pp for win shares,
  2–4pp for behaviour rates), both directions, each side at α/2.
- **Separation checks** (6) are signed hypotheses written into `gate.ts`
  _before_ a run, with the measurements behind them: "left − right ≈ +m"
  (H0) against "no difference" (H1). `m` is the lower 95% bound of the
  baseline measurement (mean − 2·SE, enforced by `gate.test.ts`): the
  smallest separation the evidence supports. A point estimate overshoots
  the truth half the time and turns noise into failures (#2235). A reversed
  or vanished separation fails; a larger one passes. The report prints the
  difference with its CI.

All 20 checks are one family, **Bonferroni-corrected**: each runs at
α = 0.05/20 = 0.0025 with β = 0.05, so a behaviour-neutral change fails the
gate with probability ≤ 5%, and each check misses a real move of its δ ≤ 5%
of the time. CIs in the report use the same adjusted level (99.75%).

**How a run proceeds.** Each group adds 200 blocks to every matchup, then
evaluates its undecided checks. A check's decision is final the first time
it crosses an SPRT boundary: it is not tested again at later looks (doing
so would inflate both error rates), and the report says
`(decided at N blocks)`. The group stops once every check has decided, so a
clear pass or fail stops early, unlike a fixed-N run. A check still
undecided at the block cap is **truncated**: it takes the side its
likelihood ratio favours, i.e. it fails exactly when the estimate is past
the midpoint between H0 and H1. The report marks it
`(truncated at the block cap)`. `--max-blocks` must be at least 1.

```bash
npx tsx scripts/simulate-hearts.ts --gate                     # both groups
npx tsx scripts/simulate-hearts.ts --gate --group field       # one CI group
npx tsx scripts/simulate-hearts.ts --gate --max-blocks 1000   # quick look (truncates)
npx tsx scripts/simulate-hearts.ts --count 3000               # descriptive report, no verdicts
```

**Reading a failure.**

- `FAIL table-daring/daring/moon_success: 3.10% [2.2%, 4.0%] vs baseline
7.23% ± δ 2.50% — moons shot in attempted hands | hands attempted =
402/12967 — LLR low/high 6.21 / -40.3` — a regression check accepted H1:
  the rate moved by about δ or more from the baseline, with the stated
  error rates. The logged counts show what the rate was computed from.
  Unlike a fixed-N band failure, this is a decision, not a borderline
  sample: the SPRT only stops when the evidence reaches its boundary. If
  the change was intended, update the baseline (below); if not, it is a
  regression.
- A **separation** `FAIL` means the pre-registered ordering reversed or
  collapsed (e.g. the human now does as well at the Cautious table as at
  the Schemer table). If a deliberate re-tune changed the ladder, update the
  expectation in `gate.ts` in the same PR, citing the new measurement.
- `(truncated at the block cap)` means the effect sits between H0 and H1 —
  smaller than δ, but not clearly zero. Treat a truncated fail as "moved by
  about half of δ": look at the CI, and rerun with `--max-blocks` raised or
  another `--seed` before acting.
- `denominator is 0 — the conditioning event never occurred` fails a check
  outright: the behaviour the rate is conditioned on (e.g. Daring moon
  attempts) disappeared.

**Updating the baseline.** Only a PR that deliberately changes Hearts AI
behaviour updates `baseline.json`, and it does so in the same PR as the
change:

```bash
npx tsx scripts/simulate-hearts.ts --update-baseline --reason "#1234: rank-aware moon attempts"
```

This re-measures every regression metric at a fixed sample size on a seed
disjoint from the gate's (`BASELINE_SEED`), and records the reason, date,
logged counts and SEs. Then set each separation's `expected` in `gate.ts` to
its new `separations` mean − 2·SE (`gate.test.ts` fails until you do). The PR
description must say which metrics moved and why; reviewers read the JSON
diff. Never regenerate the baseline to make an
unexplained failure go away.

**CI wiring and runtime budget.** `.github/workflows/hearts-sim-gate.yml`
runs the two groups as parallel matrix jobs on every PR that touches
`frontend/src/game/hearts/ai*.ts` (which covers `aiConsiderations.ts`,
`aiWeights.ts` and `aiInfoSet.ts`), `engine.ts`, `types.ts`, the sim
directory or the script, plus nightly and on demand. Measured on a 4-core
dev box (7–14 ms per game under `tsx`), the full gate on unchanged code
(seed 2238) decided every check early:

| Group     | Games per block | Stopped at (cap)      | Wall-clock |
| --------- | --------------- | --------------------- | ---------- |
| `presets` | 6               | 3,000 blocks (12,000) | ~2.5 min   |
| `field`   | 9               | 400 blocks (6,000)    | ~0.5 min   |

Worst case, with every check running to its cap (presets 12,000 blocks ×
6 games, field 6,000 × 9), is about 8.5–17 min per group at 7–14 ms a game
(a full field-group baseline run measured ~14 ms); the job timeout is
45 min. That is cheap enough to gate per PR, so there is no reduced-N PR
variant — the smoke layer below only proves the pipeline runs.

**Per-PR smoke layer.** `frontend/src/game/hearts/__tests__/ai.calibrate.test.ts`
(run by `ci.yml` with the rest of Jest, ~5 s) runs every group at a 12-block
cap: each check must evaluate, find its denominator and produce finite
estimates. Its verdicts at that size mean nothing. Unit tests for the SPRT
on synthetic sequences (including its error rates over 300 runs), the
duplicate-deal invariants and the gate config are in
`frontend/src/game/hearts/sim/__tests__/`.

**What duplicate deals buy.** Measured on 1,500 blocks:

| Comparison                                    | Variance vs unpaired blocks |
| --------------------------------------------- | --------------------------- |
| Field: persona win-share difference           | 0.80–0.88×                  |
| Field: persona points-per-hand difference     | 0.52–0.65×                  |
| Presets: stand-in win share, table vs table   | 0.76–0.82×                  |
| Mixed table: two personas at the _same_ table | 1.26–1.29× (worse)          |

Hearts diverges fast (a different pass changes every later trick), so the
reduction is modest. Comparing personas that sit at the same table
_increases_ variance, because they compete in the same zero-sum games —
which is why persona-vs-persona separations come from the field matchup,
not the mixed table.

**What the gate measured (2026-09-24, after #2555, #2234, #2235, #2236 and the #2283 retune).** Baseline
(`BASELINE_SEED`, presets 12,000 blocks, field 6,000; the full numbers with
counts are in `baseline.json`):

- The difficulty ladder holds at every step, on the targets the owner set
  (#2283): the human stand-in wins 40.0% at the all-Cautious table, 25.3% at
  all-Schemer and 16.3% at all-Daring (25.1% at the mixed table). At the
  mixed table Daring wins 40.0%, Schemer 23.5%, Cautious 11.3%. In the field
  matchup, Daring beats Schemer by +10.5pp and Schemer beats Cautious by
  +11.9pp. All six steps are separation checks.
- **Plausible mistakes (#2283).** A noise hit used to play a uniformly
  random card. It now plays a near-best one: each other card is weighted
  exp(−(best − score) / 0.1), in utility-score units (`MISTAKE_SPREAD`). A
  sloppy pass draws its 3 cards the same way.
  - Near-best mistakes cost fewer games, so the rates rose to hold the
    ladder: Cautious 55%, Schemer 19%, Daring 0% (previously 38 / 10 / 0).
  - Measured by the regret report on the same deals (60 blocks), a mistake
    costs 1.27 points instead of 1.51 (Cautious) and 1.21 instead of 1.49
    (Schemer). Blunders, Q♠-sized or worse, fell from 3.4% of mistakes to
    2.6% (Cautious) and from 3.8% to 2.0% (Schemer).
  - The per-play gain is modest because the AI's own scores rank the
    alternatives only roughly. Better rankings are #2587's job (the strong
    engine).
  - Before this, #2236's tactics had widened the ladder to 43.4 / 26.0 /
    16.5%: better deliberate play made random noise cost more.
- Before #2555 (Cautious noise 25%) the bottom of the ladder was inverted:
  Cautious was the strongest persona (+2.75pp over Schemer in the field) and
  the all-Cautious table the hardest for the human (21.9%). Changing
  Cautious's play weights barely moved that; its noise rate did (30% → still
  level with Schemer, 35% → a correct ladder). #2235's moon defense helped
  Cautious slightly more than Schemer and thinned that step, so Cautious
  noise went to 38% (and to 55% with #2283's plausible mistakes).
- Before #2234 Daring's moon trigger cost it games (field +1.5pp over
  Schemer; the human won 23.9% at its table). The new trigger (`moonHand.ts`)
  attempts rarely from the opening hand and commits once Daring holds every
  point taken and at least 13 of them. Moons completed rose from 0.77% to
  ~1.4% of Daring's hands. (`moon_attempt` now also counts hands where
  Daring commits mid-hand, so its attempt and paired-success rates — 14.4%
  and 10.3% after, 9.2% and 7.2% before — measure different populations and
  aren't directly comparable.)
- #2235 made moon defense shooter-aware: a point card is scored by where
  the trick's points will land — on the would-be shooter (feeding the moon)
  or on someone else (breaking it) — using who still has to play, the cards
  already in the trick, pass memory and known voids; the threat is graded
  from 2 points instead of switching on at 4. Against a Schemer field,
  Daring's paired moon success fell from 10.1% to 5.3% (moons per hand
  1.47% → 0.76%).
- #2236 added engine-level tactics (`rateTactics`), validated one at a time
  head to head (a seat with the tactic against the same seat without it,
  same cards, Schemer field): duck high (play the highest card that already
  loses — #1500's rule) +30.5pp win share with its moon guard; forced/free
  win with the highest card +4.1pp; low-spade flush leads +3.0pp. Keeping
  low "exit" cards for the endgame cost 1.2-2.2pp in every variant and was
  left out. Duck-high stands aside while a lone opponent holds every
  point taken, and at least 2 of them: unguarded, defenders shed their
  stoppers and Daring's moon success rose from 5% to 21%. At the
  all-Daring table paired moon success is now 9.2%.
- 35% of Daring's Q♠ dumps land on the human (Schemer: 33%). Passes that
  could void a suit do so 23% (Cautious), 69% (Schemer), 84% (Daring) of
  the time.

**Relation to #2204.** The v2 gate keeps #2204's HRT-1 fix: `moon_success`
is the paired rate (completions in attempted hands ÷ attempted hands, never
÷ a narrower trigger count), pinned by `sim/__tests__/metrics.test.ts`.
HRT-3 corrected the old Cautious-vs-Schemer check to "the human does better
against Schemers" — true only because the ladder was inverted. #2555 fixed
the ladder, so the gate now pre-registers the opposite direction (the human
does better against Cautious players), pinned by `gate.test.ts`. The old six
fixed-N batches and their ✓/✗ threshold checks are retired; `--count` keeps
#2204's meaning (games per matchup), and `--log-games` (used by
`hearts-analysis`) is unchanged.

### Hearts AI regret metric — points lost vs a perfect-information reference (#2239)

Win share mixes a persona's own play with its opponents'. The regret metric
grades each card play instead, like chess's average centipawn loss: how many
points worse the chosen card was than the best card, by a reference that
sees all four hands. The AI only ever sees its own hand; the harness deals
every hand, so it can grade a decision afterwards without giving the AI
anything it didn't have.

- **Reference (`sim/oracle.ts`).** For each graded play, every legal card is
  tried on the true state and the hand is finished by a perfect-information
  rollout for all four seats. The rollout is greedy and moon-aware: a lone
  point-holder with 10+ points plays the moon out and the others try to take
  a point off it. Each card's value is the average of 16 rollouts, one greedy
  and 15 with ε = 0.2 random plays. Every card sees the same random streams,
  and the seed comes from the cards in play, so results are repeatable.
  - A card's cost is the acting seat's moon-adjusted hand score minus the
    table mean. Without a moon, that is its own points − 6.5, so regret is in
    plain points: Q♠ is 13, a heart 1. A moon counts −19.5 for the shooter
    and +6.5 for everyone else.
  - `oracle.ts` imports only the engine's rules, never `ai.ts`,
    `aiConsiderations.ts` or `aiWeights.ts`, so it shares no heuristic or bug
    with what it grades. A test pins this.
- **Is it stronger than the AI?** A player that cheats with this reference
  (`oraclePolicy`) wins 73% of games against a Schemer field, against
  Daring's 34% on the same cards. A single greedy rollout managed only 49%,
  and 8 rollouts at ε = 0.15 72.5%.
- **What regret includes.** It is measured against a player that can see
  every hand, so its absolute level (~10 points per hand) is mostly the value
  of hidden information. Read the differences between personas on the same
  cards, not the level. Each value is a sampled rollout average, so a single
  decision's regret is an estimate; the report averages tens of thousands.
- **Blunder bands** (`DEFAULT_REGRET_BANDS`, adjustable):

  | Band      | Regret (points) | Roughly                   |
  | --------- | --------------- | ------------------------- |
  | `optimal` | `0`             | the reference's best card |
  | `minor`   | `0 < r < 3`     | a stray heart or two      |
  | `mistake` | `3 <= r < 10`   | several hearts            |
  | `blunder` | `r >= 10`       | Q♠-sized, or a moon       |

- **Noise split.** ai.ts's noise is one `rng() < NOISE_RATE` draw per play.
  `sim/regret.ts` tags each graded play as noise or deliberate from that
  draw, passing the RNG through unchanged; a test pins that grading and
  tagging leave every game identical.

**Run it.** It is a report, not a gate, and always exits 0:

```bash
npx tsx scripts/simulate-hearts.ts --regret                                  # 100 blocks, every play graded
npx tsx scripts/simulate-hearts.ts --regret --blocks 40 --sample-every 4     # quicker
npx tsx scripts/simulate-hearts.ts --regret --oracle-player                  # also run the cheating reference player
```

Each persona takes the test seat against a Schemer field on the same deals,
so per-block differences are paired as in the gate.

- **Cost:** grading takes ~3.5 ms per play. 100 blocks grade ~130,000 plays
  (~7.5 min), or ~10 min with `--oracle-player`, which runs the reference for
  its own plays too.
- **Sampling:** `--sample-every K` grades about one play in K, picked
  pseudo-randomly per play so a K that divides 13 can't lock onto one trick
  of every hand, and scales points lost back up by K.

Unit tests: `sim/__tests__/oracle.test.ts` covers a known four-hand endgame
where the reference must find the 13-point difference, rollout rules, hand
cost and bands. `regret.test.ts` covers the tallies, the noise split, win
share reported independently of regret, and the ladder check.

**What it measured (2026-09-24, seed 2238, 100 blocks, every play graded — with the old uniform-random noise, before #2283):**

| Persona         | Points lost / 100 hands | Per noise play | Per deliberate play | Blunders | Win share |
| --------------- | ----------------------- | -------------- | ------------------- | -------- | --------- |
| Cautious        | 1,095                   | 1.33           | 0.636               | 1.5%     | 10.7%     |
| Schemer         | 966                     | 1.30           | 0.696               | 1.2%     | 24.8%     |
| Daring          | 1,010                   | —              | 0.777               | 1.3%     | 33.8%     |
| Oracle (cheats) | 0                       | —              | 0                   | 0%       | 73.0%     |

- **The noise ladder holds.** On noise plays alone, Cautious loses 384 more
  points per 100 hands than Schemer [359, 410], and Schemer 131 more than
  Daring [120, 142].
- **Noise varies in how often it fires, not in how bad each mistake is.** A
  noise play costs ~1.3 points for both Cautious and Schemer, because it is a
  uniform random card either way.
- **Win share and regret disagree, as the metric allows.** In total,
  Cautious loses more than Schemer (+131 [90, 171]). But Daring loses _more_
  than Schemer (+55 [14, 95]) while winning 34% of games to Schemer's 25%.
  Daring's deliberate plays are the least reference-like of the three
  (0.777 points per play). Its moon attempts and aggressive dumps cost
  expected hand points, and they pay off in games won. Cautious's deliberate
  play is actually the closest to the reference; its weakness is almost all
  noise.

**After #2283's plausible mistakes** (same run settings; Cautious 55%,
Schemer 19%):

| Persona  | Points lost / 100 hands | Per noise play (blunders) | Per deliberate play | Win share |
| -------- | ----------------------- | ------------------------- | ------------------- | --------- |
| Cautious | 1,099                   | 1.28 (2.5%)               | 0.524               | 15.3%     |
| Schemer  | 999                     | 1.20 (2.2%)               | 0.693               | 23.8%     |
| Daring   | 1,018                   | —                         | 0.783               | 33.3%     |

The noise ladder still holds on noise plays: Cautious − Schemer is +476
[450, 503] and Schemer − Daring +232 [217, 246]. Each mistake is cheaper and
less often a blunder; the personas simply make more of them.

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

### Star Swarm: tuning with the run-stats dev panel (#2491)

The question the panel answers is "does the collision rate match the enemy's skill?" — the
per-tier dodge odds are configuration; the panel shows what actually happened next to them. Dev
builds only (the `DEV` button in the corner of the canvas; the whole panel is behind `__DEV__`, so
store builds never carry it).

1. Start a run at the difficulty you are tuning (the _Difficulty_ section applies on New Game).
2. Open the panel. Under _Run stats_ the tier table has one row per tier:
   `base` (configured dodge chance), `eff` (base × difficulty, capped at 97%), `rolls`, `dodge`,
   `rate` (dodged ÷ rolls), `struck` (rocks that hit a ship of that tier) and `flak` (shots fired
   at rocks). Below it are the run counters: reinforcements launched, armor deflections, beam hits
   on the player, rocks spawned and rocks broken by each side.
3. To get a sample quickly, press _Throw asteroid_ repeatedly (two rocks on screen at most) instead
   of waiting for timed spawns. `rate` should converge on `eff` for each tier; if it doesn't, the
   threat check or the path nudge is not giving that tier its roll.
4. _Dodge off_ removes every roll so `struck` becomes the no-skill baseline for comparison;
   _Flak off_ removes the enemy's other defence so only dodging is in play. _Enemy missiles off_
   silences flak too (it is an enemy bullet), so leave it on when measuring flak.
5. _Kill escorts_ destroys every non-Carrier ship at once, which is the fastest way to reach the
   Carrier's exposed state, its lone twin lasers and the plating drop.
6. The panel refreshes 4× a second from a timer; the game keeps running underneath, so pause
   (header button) when you want a still reading.

The same numbers reach Sentry as one `starswarm.run_stats` breadcrumb per finished run (counts,
wave, difficulty, score) — look at the breadcrumbs on any Star Swarm event to compare real play
against the panel. Unit coverage: `engine.test.ts` ("Run stats (#2491)") and `telemetry.test.ts`.

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

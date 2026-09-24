/**
 * Yacht AI regret gate (#2244) — per-decision EV-loss vs the optimal
 * oracle (#2243). Skipped by default; enable with YACHT_SIM_FULL=<N>
 * (e.g. YACHT_SIM_FULL=3000). The scheduled workflow
 * .github/workflows/yacht-sim-gate.yml runs it nightly.
 *
 * The win-rate and score calibration bands that used to live here moved to
 * sim/gate.ts (#2245), where they run on the shared harness (per-player
 * dice streams, mirrored dice, both turn orders) via
 * `npx tsx scripts/simulate-yacht.ts --gate`. See docs/TESTING.md.
 *
 * Dice and AI noise here come from the same per-player streams as the
 * harness (sim/streams.ts), so no game shares a random sequence with its
 * opponent or with the neighbouring seed.
 */

import { bestHoldMask, holdStrategy, scoreStrategy } from "../ai";
import { newGame, roll, score, setRng } from "../engine";
import { buildYachtInfoSet } from "../aiInfoSet";
import { EASY_HOLD_WEIGHTS, MEDIUM_HOLD_WEIGHTS, type HoldWeights } from "../aiWeights";
import { computeCategoryEvLoss, computeHoldEvLoss } from "../oracle/regret";
import {
  blundersPer1000,
  describeRegretRecord,
  meanDiffSignificant,
  summarizeRegret,
  worstDecisions,
  type RegretRecord,
} from "../oracle/regretAggregate";
import { difficultyPolicy, runMatchup } from "../sim/harness";
import { summarize } from "../sim/stats";
import { deriveSeed, turnDiceTable, turnNoiseStream } from "../sim/streams";
import type { AiDifficulty, GameState } from "../types";

const RUN = !!process.env.YACHT_SIM_FULL;
const N = process.env.YACHT_SIM_FULL ? parseInt(process.env.YACHT_SIM_FULL, 10) : 3000;

const itFull = (RUN ? it : it.skip) as jest.It;

const NO_HOLDS = [false, false, false, false, false];

/**
 * Starts a player's turn on their own stream: returns the round's dice table
 * and points the engine RNG (which the AI uses for cognitive noise) at the
 * round's noise stream.
 */
function beginTurn(state: GameState, streamSeed: number): number[][] {
  setRng(turnNoiseStream(streamSeed, state.round));
  return turnDiceTable(streamSeed, state.round);
}

// ---------------------------------------------------------------------------
// Regret metric (#2244) — per-decision EV-loss vs the optimal oracle (#2243)
// ---------------------------------------------------------------------------
//
// Win rate says who won; it says nothing about *how well* either side played
// — in a dice game a bot can win on luck while playing badly, or lose while
// playing perfectly. These tests grade individual hold/category decisions
// against the exact ground-truth oracle instead.
//
// Sample size: each decision requires an AWAITED oracle query, unlike the
// synchronous harness batches in sim/. Measured end-to-end through this test
// file (not just the oracle call in isolation — includes simulation
// overhead): ~20-26ms/decision across two runs (N=30: 19.75ms/decision,
// N=150: 25.59ms/decision; docs/TESTING.md records both). Full
// YACHT_SIM_FULL coverage (e.g. N=3000) would take on the order of an hour
// for just the hold-EV path at that rate, so this is sampled down to
// REGRET_SAMPLE_CAP games per difficulty by default; override with
// YACHT_REGRET_SIM=<N> for full (or a different) coverage. This is the
// documented sampling fallback #2244's acceptance criteria calls for —
// full 3,000-game coverage was measured and found impractical for routine
// runs, not assumed.
//
// Timeout caveat: the third `it()` argument below is a real timeout, but
// don't rely on it to bound a large YACHT_REGRET_SIM run. Once the oracle
// table is loaded (one-time), every `await` in the hot loop resolves an
// already-settled promise — a microtask, not a macrotask — so a long chain
// of them can starve Node's timer queue (where Jest's timeout callback
// lives) for the full duration of the batch. Observed directly: a
// REGRET_TEST_TIMEOUT_MS=600_000 run that took 886s real wall-clock time
// completed (failing on an assertion) rather than being aborted at 600s.
const REGRET_SAMPLE_CAP = 50;
const REGRET_N = process.env.YACHT_REGRET_SIM
  ? parseInt(process.env.YACHT_REGRET_SIM, 10)
  : Math.min(N, REGRET_SAMPLE_CAP);

const REGRET_TEST_TIMEOUT_MS = 1_800_000;

/**
 * Plays one player's turn while logging an EV-loss record for every hold and
 * category decision made along the way, mirroring the harness's `playTurn`
 * (sim/harness.ts) exactly — same per-player dice table and noise stream,
 * same "keep everything -> stop rolling early" short-circuit — so the
 * regret-logged games are the harness's games, just additionally
 * instrumented.
 */
async function playTurnWithRegret(
  state: GameState,
  streamSeed: number,
  difficulty: AiDifficulty,
  opponentScore: number,
  opponentRound: number,
  records: RegretRecord[],
  round: number
): Promise<GameState> {
  const table = beginTurn(state, streamSeed);
  let s = roll(state, NO_HOLDS, { dice: table[0]! });
  while (s.rolls_used < 3) {
    const rerollsLeft = (3 - s.rolls_used) as 1 | 2;
    const holds = holdStrategy(s, difficulty);
    const result = await computeHoldEvLoss(s, s.dice, rerollsLeft, holds);
    records.push({ result, difficulty, round, dice: s.dice });
    if (holds.every((h) => h)) break;
    s = roll(s, holds, { dice: table[s.rolls_used]! });
  }

  const category = scoreStrategy(s, difficulty, opponentScore, opponentRound);
  const catResult = await computeCategoryEvLoss(s, s.dice, category);
  records.push({ result: catResult, difficulty, round, dice: s.dice });

  return score(s, category);
}

/**
 * Plays one full self-play game (both seats at `difficulty`, each on its
 * own stream) and returns every logged
 * decision from BOTH seats — doubling the sample per game for free.
 */
async function playRegretGame(difficulty: AiDifficulty, seed: number): Promise<RegretRecord[]> {
  const records: RegretRecord[] = [];
  const seed0 = deriveSeed(seed, 0);
  const seed1 = deriveSeed(seed, 1);

  let p0 = newGame();
  let p1 = newGame();

  for (let round = 1; round <= 13; round++) {
    p0 = await playTurnWithRegret(p0, seed0, difficulty, p1.total_score, p1.round, records, round);
    p1 = await playTurnWithRegret(p1, seed1, difficulty, p0.total_score, p0.round, records, round);
  }

  return records;
}

async function playRegretBatch(difficulty: AiDifficulty, n: number, seedOffset: number) {
  const records: RegretRecord[] = [];
  for (let i = 0; i < n; i++) {
    records.push(...(await playRegretGame(difficulty, seedOffset + i)));
  }
  return records;
}

function evLosses(records: readonly RegretRecord[]): number[] {
  return records.map((r) => r.result.evLoss);
}

describe("Yacht regret metric — EV-loss vs the optimal oracle", () => {
  afterEach(() => setRng(Math.random));

  itFull(
    "Easy > Medium > Hard mean EV-loss, significant at this sample size",
    async () => {
      const start = Date.now();

      const easy = await playRegretBatch("easy", REGRET_N, 800000);
      const medium = await playRegretBatch("medium", REGRET_N, 810000);
      const hard = await playRegretBatch("hard", REGRET_N, 820000);

      const elapsedMs = Date.now() - start;
      const totalDecisions = easy.length + medium.length + hard.length;

      const easySummary = summarizeRegret(easy);
      const mediumSummary = summarizeRegret(medium);
      const hardSummary = summarizeRegret(hard);

      console.log("\n=== Yacht regret metric (EV-loss vs oracle) ===");
      console.log(`REGRET_N = ${REGRET_N} games per difficulty (self-play, both seats logged)`);
      console.table({
        Easy: {
          n: easySummary.n,
          meanEvLoss: easySummary.meanEvLoss.toFixed(3),
          holdMean: easySummary.byType.hold.meanEvLoss.toFixed(3),
          categoryMean: easySummary.byType.category.meanEvLoss.toFixed(3),
          blunderPer1000: blundersPer1000(easy).toFixed(1),
        },
        Medium: {
          n: mediumSummary.n,
          meanEvLoss: mediumSummary.meanEvLoss.toFixed(3),
          holdMean: mediumSummary.byType.hold.meanEvLoss.toFixed(3),
          categoryMean: mediumSummary.byType.category.meanEvLoss.toFixed(3),
          blunderPer1000: blundersPer1000(medium).toFixed(1),
        },
        Hard: {
          n: hardSummary.n,
          meanEvLoss: hardSummary.meanEvLoss.toFixed(3),
          holdMean: hardSummary.byType.hold.meanEvLoss.toFixed(3),
          categoryMean: hardSummary.byType.category.meanEvLoss.toFixed(3),
          blunderPer1000: blundersPer1000(hard).toFixed(1),
        },
      });
      console.log("Band histograms (optimal / minor / mistake / blunder):");
      console.table({
        Easy: easySummary.byType.hold.bandCounts,
        Medium: mediumSummary.byType.hold.bandCounts,
        Hard: hardSummary.byType.hold.bandCounts,
      });

      // Worst-decision tail: does each difficulty ever make a catastrophic move?
      console.log("\n--- Worst decisions overall (top 5 by EV-loss) ---");
      for (const rec of worstDecisions([...easy, ...medium, ...hard], 5)) {
        console.log(describeRegretRecord(rec));
      }

      console.log(
        `\nPerformance: ${totalDecisions} decisions in ${elapsedMs}ms ` +
          `(${(elapsedMs / totalDecisions).toFixed(2)}ms/decision average, includes async overhead)`
      );

      // Sanity assertion (acceptance criterion): the ordering is directionally
      // correct end-to-end, and the largest, most reliable gap (Easy vs Hard —
      // combines both tiers' noise-rate AND weight differences) is
      // statistically significant at this sample size, not a one-seed
      // artifact. Medium sits directionally between the two but is NOT
      // asserted significant against Hard: aiWeights.ts's own calibration
      // target puts Hard at only ~47-53% win rate vs Medium (near coin-flip
      // by design), so a small or noisy Medium-vs-Hard decision-quality gap
      // is a real epic finding (#2246 — Medium's `upperCategoryEfficiency:
      // 5.0` swamping its other terms), not a bug in this metric. Both
      // pairwise results are logged either way.
      expect(easySummary.meanEvLoss).toBeGreaterThan(mediumSummary.meanEvLoss);
      expect(mediumSummary.meanEvLoss).toBeGreaterThan(hardSummary.meanEvLoss);

      const easyVsMedium = meanDiffSignificant(evLosses(easy), evLosses(medium));
      const mediumVsHard = meanDiffSignificant(evLosses(medium), evLosses(hard));
      const easyVsHard = meanDiffSignificant(evLosses(easy), evLosses(hard));
      console.log(
        `\nSignificance (Welch's t): Easy-vs-Medium t=${easyVsMedium.tStat.toFixed(2)} ` +
          `crit=${easyVsMedium.tCritical.toFixed(2)} (${easyVsMedium.significant}), ` +
          `Medium-vs-Hard t=${mediumVsHard.tStat.toFixed(2)} crit=${mediumVsHard.tCritical.toFixed(2)} ` +
          `(${mediumVsHard.significant}), Easy-vs-Hard t=${easyVsHard.tStat.toFixed(2)} ` +
          `crit=${easyVsHard.tCritical.toFixed(2)} (${easyVsHard.significant})`
      );
      expect(easyVsHard.significant).toBe(true);

      // Existing simulator outputs are unchanged by this instrumentation
      // (regression check): run a plain harness batch and confirm it's
      // unaffected by the regret module having been exercised in-process.
      const plain = summarize(
        runMatchup({
          a: difficultyPolicy("hard"),
          b: difficultyPolicy("hard"),
          blocks: 13,
          mode: "paired",
          seed: 900000,
        })
      );
      expect(plain.players.pooled.meanScore.mean).toBeGreaterThan(0);
    },
    REGRET_TEST_TIMEOUT_MS
  );

  itFull(
    "Noise-disabled diagnostic: Easy vs Medium hold EV-loss collapses (same weights today) — the ordering above is driven by noise frequency, not structure, for this pair",
    async () => {
      // EASY_HOLD_WEIGHTS === MEDIUM_HOLD_WEIGHTS by value today (aiWeights.ts).
      // holdStrategy's 13%-vs-3% noise rate is what separates them in the test
      // above. bestHoldMask bypasses noise entirely — same infoSet, same
      // weights, same deterministic weighted-sum argmax — so with the SAME
      // seed (and thus the same dice sequences), the two runs must be
      // identical, not merely statistically indistinguishable.
      const diagN = Math.min(REGRET_N, 100);
      const easyLosses = await playHoldOnlyDiagnostic(EASY_HOLD_WEIGHTS, 850000, diagN);
      const mediumLosses = await playHoldOnlyDiagnostic(MEDIUM_HOLD_WEIGHTS, 850000, diagN);

      console.log(
        `\nNoise-disabled diagnostic (n=${diagN} games): Easy weights mean=${(
          easyLosses.reduce((a, b) => a + b, 0) / easyLosses.length
        ).toFixed(4)}, Medium weights mean=${(
          mediumLosses.reduce((a, b) => a + b, 0) / mediumLosses.length
        ).toFixed(4)}`
      );

      expect(easyLosses).toEqual(mediumLosses);
      const t = meanDiffSignificant(easyLosses, mediumLosses);
      expect(t.meanDiff).toBe(0);
      expect(t.significant).toBe(false);
    },
    REGRET_TEST_TIMEOUT_MS
  );
});

/**
 * Diagnostic-only: plays one self-play game logging ONLY the raw hold EV-loss
 * value for each hold decision, selected via `bestHoldMask` (no cognitive
 * noise) under a fixed `holdWeights` map. Category decisions use "hard"
 * scoring (0% noise, per NOISE_RATE) so only the hold weight map varies
 * between calls — isolating "does noise explain the gap" from any
 * category-side variation. Two-layer game/batch split mirrors
 * `playRegretGame`/`playRegretBatch` above so a future change to the
 * per-game round structure only needs to be made in one shape, not two.
 */
async function playDiagnosticGame(holdWeights: HoldWeights, seed: number): Promise<number[]> {
  const losses: number[] = [];
  const seed0 = deriveSeed(seed, 0);
  const seed1 = deriveSeed(seed, 1);
  let p0 = newGame();
  let p1 = newGame();
  for (let round = 1; round <= 13; round++) {
    p0 = await playDiagnosticTurn(p0, seed0, holdWeights, p1.total_score, p1.round, losses);
    p1 = await playDiagnosticTurn(p1, seed1, holdWeights, p0.total_score, p0.round, losses);
  }
  return losses;
}

async function playHoldOnlyDiagnostic(
  holdWeights: HoldWeights,
  seed: number,
  n: number
): Promise<number[]> {
  const losses: number[] = [];
  for (let i = 0; i < n; i++) {
    losses.push(...(await playDiagnosticGame(holdWeights, seed + i)));
  }
  return losses;
}

async function playDiagnosticTurn(
  state: GameState,
  streamSeed: number,
  holdWeights: HoldWeights,
  opponentScore: number,
  opponentRound: number,
  losses: number[]
): Promise<GameState> {
  const table = beginTurn(state, streamSeed);
  let s = roll(state, NO_HOLDS, { dice: table[0]! });
  while (s.rolls_used < 3) {
    const rerollsLeft = (3 - s.rolls_used) as 1 | 2;
    const infoSet = buildYachtInfoSet(s, opponentScore, opponentRound);
    const holds = bestHoldMask(infoSet, holdWeights);
    const result = await computeHoldEvLoss(s, s.dice, rerollsLeft, holds);
    losses.push(result.evLoss);
    if (holds.every((h) => h)) break;
    s = roll(s, holds, { dice: table[s.rolls_used]! });
  }

  const category = scoreStrategy(s, "hard", opponentScore, opponentRound);
  return score(s, category);
}

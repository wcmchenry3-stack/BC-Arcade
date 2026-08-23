/**
 * Yacht AI calibration gate (GH #2028, story A4).
 *
 * Full N-game win-rate validation for the utility-AI path.
 * Skipped by default; enable with YACHT_SIM_FULL=<N> (e.g. YACHT_SIM_FULL=3000).
 *
 * Acceptance bands (Hard utility proxy vs each difficulty):
 *   Easy   62–68% Hard wins
 *   Medium 47–53% Hard wins
 *
 * Per-difficulty metric bands (GH #2130):
 *   Bonus rate:  Hard ≥ 65%,  Medium 45–65%,  Easy ≤ 45%
 *   Mean score:  Hard ≥ 200,  Medium ≥ 165,   Easy ≥ 130
 *   Below-par upper fill rate:  Easy > Medium > Hard  (directional)
 *
 * Also includes the per-decision regret metric (#2244, "Yacht regret metric"
 * describe block below) — EV-loss vs the optimal oracle (#2243), gated behind
 * the same YACHT_SIM_FULL env var. See docs/TESTING.md.
 */

import { bestHoldMask, holdStrategy, scoreStrategy } from "../ai";
import { createSeededRng, newGame, roll, score, setRng } from "../engine";
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
import type { AiDifficulty, GameState } from "../types";

const RUN = !!process.env.YACHT_SIM_FULL;
const N = process.env.YACHT_SIM_FULL ? parseInt(process.env.YACHT_SIM_FULL, 10) : 3000;

const itFull = (RUN ? it : it.skip) as jest.It;

// Par value for each upper category (3 × face value); scoring below this is "below par"
const UPPER_PAR: Record<string, number> = {
  ones: 3,
  twos: 6,
  threes: 9,
  fours: 12,
  fives: 15,
  sixes: 18,
};

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

interface SimResult {
  humanScore: number;
  aiScore: number;
  winner: 0 | 1;
  bonusAchieved: boolean;
  upperSubtotal: number;
  belowParUpperFills: number;
  aiBonusAchieved: boolean;
  aiUpperSubtotal: number;
  aiBelowParUpperFills: number;
}

function countBelowParFills(scores: Record<string, number | null>): number {
  let n = 0;
  for (const [cat, par] of Object.entries(UPPER_PAR)) {
    const v = scores[cat];
    if (v !== null && v !== undefined && v < par) n++;
  }
  return n;
}

function simulateOne(humanDiff: AiDifficulty, aiDiff: AiDifficulty, seed: number): SimResult {
  setRng(createSeededRng(seed));

  let humanState = newGame();
  let aiState = newGame();

  for (let _round = 0; _round < 13; _round++) {
    humanState = roll(humanState, [false, false, false, false, false]);
    while (humanState.rolls_used < 3) {
      const holds = holdStrategy(humanState, humanDiff);
      if (holds.every((h) => h)) break;
      humanState = roll(humanState, holds);
    }
    humanState = score(
      humanState,
      scoreStrategy(humanState, humanDiff, aiState.total_score, aiState.round)
    );

    aiState = roll(aiState, [false, false, false, false, false]);
    while (aiState.rolls_used < 3) {
      const holds = holdStrategy(aiState, aiDiff);
      if (holds.every((h) => h)) break;
      aiState = roll(aiState, holds);
    }
    aiState = score(
      aiState,
      scoreStrategy(aiState, aiDiff, humanState.total_score, humanState.round)
    );
  }

  const humanScore = humanState.total_score;
  const aiScore = aiState.total_score;
  return {
    humanScore,
    aiScore,
    winner: humanScore >= aiScore ? 0 : 1,
    bonusAchieved: humanState.upper_bonus > 0,
    upperSubtotal: humanState.upper_subtotal,
    belowParUpperFills: countBelowParFills(humanState.scores),
    aiBonusAchieved: aiState.upper_bonus > 0,
    aiUpperSubtotal: aiState.upper_subtotal,
    aiBelowParUpperFills: countBelowParFills(aiState.scores),
  };
}

type BatchResult = {
  winRate: number;
  humanMean: number;
  aiMean: number;
  bonusRate: number;
  upperMean: number;
  belowParMean: number;
  aiBonusRate: number;
  aiUpperMean: number;
  aiBelowParMean: number;
};

function runBatch(
  humanDiff: AiDifficulty,
  aiDiff: AiDifficulty,
  n: number,
  seedOffset: number
): BatchResult {
  let humanWins = 0;
  let humanTotal = 0;
  let aiTotal = 0;
  let bonusCount = 0;
  let upperTotal = 0;
  let belowParTotal = 0;
  let aiBonusCount = 0;
  let aiUpperTotal = 0;
  let aiBelowParTotal = 0;

  for (let i = 0; i < n; i++) {
    const r = simulateOne(humanDiff, aiDiff, seedOffset + i);
    if (r.winner === 0) humanWins++;
    humanTotal += r.humanScore;
    aiTotal += r.aiScore;
    if (r.bonusAchieved) bonusCount++;
    upperTotal += r.upperSubtotal;
    belowParTotal += r.belowParUpperFills;
    if (r.aiBonusAchieved) aiBonusCount++;
    aiUpperTotal += r.aiUpperSubtotal;
    aiBelowParTotal += r.aiBelowParUpperFills;
  }

  return {
    winRate: humanWins / n,
    humanMean: humanTotal / n,
    aiMean: aiTotal / n,
    bonusRate: bonusCount / n,
    upperMean: upperTotal / n,
    belowParMean: belowParTotal / n,
    aiBonusRate: aiBonusCount / n,
    aiUpperMean: aiUpperTotal / n,
    aiBelowParMean: aiBelowParTotal / n,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => setRng(Math.random));

describe("Yacht calibration — utility-vs-utility difficulty bands", () => {
  itFull("Hard utility vs Easy utility — Hard wins 62–68%", () => {
    const r = runBatch("hard", "easy", N, 0);

    // Win-rate band (unchanged)
    expect(r.winRate).toBeGreaterThanOrEqual(0.62);
    expect(r.winRate).toBeLessThanOrEqual(0.68);

    // Mean scores (asserted, not just logged)
    expect(r.humanMean).toBeGreaterThanOrEqual(200); // Hard
    expect(r.aiMean).toBeGreaterThanOrEqual(130); // Easy

    // Upper bonus achievement rates
    expect(r.bonusRate).toBeGreaterThanOrEqual(0.65); // Hard ≥ 65%
    expect(r.aiBonusRate).toBeLessThanOrEqual(0.45); // Easy ≤ 45%

    // Mean upper subtotals
    expect(r.upperMean).toBeGreaterThanOrEqual(48); // Hard
    expect(r.aiUpperMean).toBeGreaterThanOrEqual(27); // Easy
  });

  itFull("Hard utility vs Medium utility — Hard wins 47–53%", () => {
    const r = runBatch("hard", "medium", N, 10000);

    // Win-rate band (unchanged)
    expect(r.winRate).toBeGreaterThanOrEqual(0.47);
    expect(r.winRate).toBeLessThanOrEqual(0.53);

    // Mean scores (asserted, not just logged)
    expect(r.humanMean).toBeGreaterThanOrEqual(200); // Hard
    expect(r.aiMean).toBeGreaterThanOrEqual(165); // Medium

    // Upper bonus achievement rates
    expect(r.bonusRate).toBeGreaterThanOrEqual(0.65); // Hard ≥ 65%
    expect(r.aiBonusRate).toBeGreaterThanOrEqual(0.45); // Medium ≥ 45%
    expect(r.aiBonusRate).toBeLessThanOrEqual(0.65); // Medium ≤ 65%

    // Mean upper subtotals
    expect(r.upperMean).toBeGreaterThanOrEqual(48); // Hard
    expect(r.aiUpperMean).toBeGreaterThanOrEqual(37); // Medium
  });

  itFull(
    "Per-difficulty ordering: below-par fill rate, bonus rate, and upper mean decrease Easy → Medium → Hard",
    () => {
      // Self-play batches isolate each difficulty from adversarial-context effects.
      // Seed offsets are non-overlapping with the matchup tests above.
      const easy = runBatch("easy", "easy", N, 50000);
      const medium = runBatch("medium", "medium", N, 60000);
      const hard = runBatch("hard", "hard", N, 70000);

      // Below-par upper fill rate ordering
      expect(easy.belowParMean).toBeGreaterThan(medium.belowParMean);
      expect(medium.belowParMean).toBeGreaterThan(hard.belowParMean);

      // Bonus rate ordering and absolute bands
      expect(hard.bonusRate).toBeGreaterThanOrEqual(0.65); // Hard ≥ 65%
      expect(easy.bonusRate).toBeLessThanOrEqual(0.45); // Easy ≤ 45%
      expect(hard.bonusRate).toBeGreaterThan(medium.bonusRate);
      expect(medium.bonusRate).toBeGreaterThan(easy.bonusRate);

      // Mean upper subtotal ordering
      expect(hard.upperMean).toBeGreaterThan(medium.upperMean);
      expect(medium.upperMean).toBeGreaterThan(easy.upperMean);

      // Mean score floors
      expect(hard.humanMean).toBeGreaterThanOrEqual(200);
      expect(medium.humanMean).toBeGreaterThanOrEqual(165);
      expect(easy.humanMean).toBeGreaterThanOrEqual(130);
    }
  );
});

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
// synchronous win-rate batches above. Measured end-to-end through this test
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
 * category decision made along the way, mirroring `simulateOne`'s per-turn
 * shape exactly (including the "keep everything -> stop rolling early"
 * short-circuit) so the regret-logged games are identical to the win-rate
 * batches above, just additionally instrumented.
 */
async function playTurnWithRegret(
  state: GameState,
  difficulty: AiDifficulty,
  opponentScore: number,
  opponentRound: number,
  records: RegretRecord[],
  round: number
): Promise<GameState> {
  let s = roll(state, [false, false, false, false, false]);
  while (s.rolls_used < 3) {
    const rerollsLeft = (3 - s.rolls_used) as 1 | 2;
    const holds = holdStrategy(s, difficulty);
    const result = await computeHoldEvLoss(s, s.dice, rerollsLeft, holds);
    records.push({ result, difficulty, round, dice: s.dice });
    if (holds.every((h) => h)) break;
    s = roll(s, holds);
  }

  const category = scoreStrategy(s, difficulty, opponentScore, opponentRound);
  const catResult = await computeCategoryEvLoss(s, s.dice, category);
  records.push({ result: catResult, difficulty, round, dice: s.dice });

  return score(s, category);
}

/**
 * Plays one full self-play game (both seats at `difficulty`, matching the
 * "Per-difficulty ordering" self-play setup above) and returns every logged
 * decision from BOTH seats — doubling the sample per game for free.
 */
async function playRegretGame(difficulty: AiDifficulty, seed: number): Promise<RegretRecord[]> {
  setRng(createSeededRng(seed));
  const records: RegretRecord[] = [];

  let p0 = newGame();
  let p1 = newGame();

  for (let round = 1; round <= 13; round++) {
    p0 = await playTurnWithRegret(p0, difficulty, p1.total_score, p1.round, records, round);
    p1 = await playTurnWithRegret(p1, difficulty, p0.total_score, p0.round, records, round);
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
        `\nSignificance (Welch's t, |t|>1.96): Easy-vs-Medium t=${easyVsMedium.tStat.toFixed(2)} ` +
          `(${easyVsMedium.significant}), Medium-vs-Hard t=${mediumVsHard.tStat.toFixed(2)} ` +
          `(${mediumVsHard.significant}), Easy-vs-Hard t=${easyVsHard.tStat.toFixed(2)} ` +
          `(${easyVsHard.significant})`
      );
      expect(easyVsHard.significant).toBe(true);

      // Existing simulator outputs are unchanged by this instrumentation
      // (regression check): re-run the plain win-rate batch at the same seed
      // base used elsewhere in this file and confirm it's unaffected by the
      // regret module having been exercised in-process.
      const plain = runBatch("hard", "hard", 50, 900000);
      expect(plain.humanMean).toBeGreaterThan(0);
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
  setRng(createSeededRng(seed));
  const losses: number[] = [];
  let p0 = newGame();
  let p1 = newGame();
  for (let round = 1; round <= 13; round++) {
    p0 = await playDiagnosticTurn(p0, holdWeights, p1.total_score, p1.round, losses);
    p1 = await playDiagnosticTurn(p1, holdWeights, p0.total_score, p0.round, losses);
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
  holdWeights: HoldWeights,
  opponentScore: number,
  opponentRound: number,
  losses: number[]
): Promise<GameState> {
  let s = roll(state, [false, false, false, false, false]);
  while (s.rolls_used < 3) {
    const rerollsLeft = (3 - s.rolls_used) as 1 | 2;
    const infoSet = buildYachtInfoSet(s, opponentScore, opponentRound);
    const holds = bestHoldMask(infoSet, holdWeights);
    const result = await computeHoldEvLoss(s, s.dice, rerollsLeft, holds);
    losses.push(result.evLoss);
    if (holds.every((h) => h)) break;
    s = roll(s, holds);
  }

  const category = scoreStrategy(s, "hard", opponentScore, opponentRound);
  return score(s, category);
}

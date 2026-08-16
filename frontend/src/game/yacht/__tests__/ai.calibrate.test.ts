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
 */

import { holdStrategy, scoreStrategy } from "../ai";
import { createSeededRng, newGame, roll, score, setRng } from "../engine";
import type { AiDifficulty } from "../types";

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

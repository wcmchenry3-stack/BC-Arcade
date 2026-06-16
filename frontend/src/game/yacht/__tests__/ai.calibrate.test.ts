/**
 * Yacht AI calibration gate (GH #2028, story A4).
 *
 * Full N-game win-rate validation for the utility-AI path.
 * Skipped by default; enable with YACHT_SIM_FULL=<N> (e.g. YACHT_SIM_FULL=3000).
 *
 * Acceptance bands (Hard utility proxy vs each difficulty):
 *   Easy   62–68% Hard wins
 *   Medium 47–53% Hard wins
 */

import { holdStrategy, scoreStrategy } from "../ai";
import { createSeededRng, newGame, roll, score, setRng } from "../engine";
import type { AiDifficulty } from "../types";

const RUN = !!process.env.YACHT_SIM_FULL;
const N = process.env.YACHT_SIM_FULL ? parseInt(process.env.YACHT_SIM_FULL, 10) : 3000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const itFull = (RUN ? it : it.skip) as jest.It;

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

interface SimResult {
  humanScore: number;
  aiScore: number;
  winner: 0 | 1;
}

function simulateOne(
  humanDiff: AiDifficulty,
  aiDiff: AiDifficulty,
  seed: number
): SimResult {
  setRng(createSeededRng(seed));

  let humanState = newGame();
  let aiState = newGame();

  for (let _round = 0; _round < 13; _round++) {
    humanState = roll(humanState, [false, false, false, false, false]);
    while (humanState.rolls_used < 3) {
      humanState = roll(humanState, holdStrategy(humanState, humanDiff));
    }
    humanState = score(
      humanState,
      scoreStrategy(humanState, humanDiff, aiState.total_score)
    );

    aiState = roll(aiState, [false, false, false, false, false]);
    while (aiState.rolls_used < 3) {
      aiState = roll(aiState, holdStrategy(aiState, aiDiff));
    }
    aiState = score(aiState, scoreStrategy(aiState, aiDiff, humanState.total_score));
  }

  const humanScore = humanState.total_score;
  const aiScore = aiState.total_score;
  return { humanScore, aiScore, winner: humanScore >= aiScore ? 0 : 1 };
}

function runBatch(
  humanDiff: AiDifficulty,
  aiDiff: AiDifficulty,
  n: number,
  seedOffset: number
): { winRate: number; humanMean: number; aiMean: number } {
  let humanWins = 0;
  let humanTotal = 0;
  let aiTotal = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateOne(humanDiff, aiDiff, seedOffset + i);
    if (r.winner === 0) humanWins++;
    humanTotal += r.humanScore;
    aiTotal += r.aiScore;
  }
  return {
    winRate: humanWins / n,
    humanMean: humanTotal / n,
    aiMean: aiTotal / n,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => setRng(Math.random));

describe("Yacht calibration — utility-vs-utility difficulty bands", () => {
  itFull(
    "Hard utility vs Easy utility — Hard wins 62–68%",
    () => {
      const r = runBatch("hard", "easy", N, 0);
      console.log(
        `[band:easy] Hard vs Easy: hard_win=${(r.winRate * 100).toFixed(1)}% ` +
          `hard_mean=${r.humanMean.toFixed(1)} easy_mean=${r.aiMean.toFixed(1)}`
      );
      expect(r.winRate).toBeGreaterThanOrEqual(0.62);
      expect(r.winRate).toBeLessThanOrEqual(0.68);
    }
  );

  itFull(
    "Hard utility vs Medium utility — Hard wins 47–53%",
    () => {
      const r = runBatch("hard", "medium", N, 10000);
      console.log(
        `[band:medium] Hard vs Medium: hard_win=${(r.winRate * 100).toFixed(1)}% ` +
          `hard_mean=${r.humanMean.toFixed(1)} medium_mean=${r.aiMean.toFixed(1)}`
      );
      expect(r.winRate).toBeGreaterThanOrEqual(0.47);
      expect(r.winRate).toBeLessThanOrEqual(0.53);
    }
  );
});

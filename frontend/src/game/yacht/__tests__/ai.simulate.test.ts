/**
 * Smoke tests for the Yacht AI simulator (#1601).
 *
 * Runs a small number of games per matchup to verify:
 * - No exceptions are thrown
 * - Difficulty separation goes in the right direction
 * - Easy vs Easy is approximately symmetric
 *
 * Full batch runs (3,000 games) live in scripts/simulate-yacht.ts.
 */

import { createSeededRng, newGame, roll, score, setRng } from "../engine";
import { holdStrategy, scoreStrategy } from "../ai";
import type { AiDifficulty } from "../types";

// ---------------------------------------------------------------------------
// Minimal simulator (mirrors scripts/simulate-yacht.ts)
// ---------------------------------------------------------------------------

function simulateGame(
  humanDiff: AiDifficulty,
  aiDiff: AiDifficulty,
  seed: number
): { humanScore: number; aiScore: number; winner: 0 | 1 } {
  setRng(createSeededRng(seed));

  let humanState = newGame();
  let aiState = newGame();

  for (let _round = 0; _round < 13; _round++) {
    humanState = roll(humanState, [false, false, false, false, false]);
    while (humanState.rolls_used < 3) {
      humanState = roll(humanState, holdStrategy(humanState, humanDiff));
    }
    humanState = score(humanState, scoreStrategy(humanState, humanDiff, aiState.total_score));

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

function runBatch(humanDiff: AiDifficulty, aiDiff: AiDifficulty, n: number, seedOffset: number) {
  let humanWins = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateGame(humanDiff, aiDiff, seedOffset + i);
    if (r.winner === 0) humanWins++;
  }
  return humanWins / n;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const SMOKE_GAMES = 200;

afterEach(() => {
  setRng(Math.random);
});

describe("Yacht AI simulator smoke tests", () => {
  it("completes 200 Easy vs Easy games without throwing", () => {
    expect(() => runBatch("easy", "easy", SMOKE_GAMES, 0)).not.toThrow();
  });

  it("completes 200 Hard vs Hard games without throwing", () => {
    expect(() => runBatch("hard", "hard", SMOKE_GAMES, 10000)).not.toThrow();
  });

  it("Easy vs Easy win rate is near 50%", () => {
    const wr = runBatch("easy", "easy", SMOKE_GAMES, 0);
    expect(wr).toBeGreaterThan(0.35);
    expect(wr).toBeLessThan(0.65);
  });

  it("Medium beats Easy more than half the time", () => {
    // Assert against a fixed 0.50 baseline rather than a second noisy sample.
    const medVsEasy = runBatch("medium", "easy", SMOKE_GAMES, 20000);
    expect(medVsEasy).toBeGreaterThan(0.5);
  });

  it("Hard beats Easy more than Medium beats Easy", () => {
    // ~0.80 vs ~0.65 — a ~15-point gap is stable at 200 games each.
    const hardVsEasy = runBatch("hard", "easy", SMOKE_GAMES, 30000);
    const medVsEasy = runBatch("medium", "easy", SMOKE_GAMES, 20000);
    expect(hardVsEasy).toBeGreaterThan(medVsEasy);
  });

  it("Hard vs Hard win rate is near 50%", () => {
    const wr = runBatch("hard", "hard", SMOKE_GAMES, 40000);
    expect(wr).toBeGreaterThan(0.35);
    expect(wr).toBeLessThan(0.65);
  });

  it("produces valid final scores (non-negative, plausible ceiling)", () => {
    for (let i = 0; i < 20; i++) {
      const r = simulateGame("hard", "hard", i * 777);
      expect(r.humanScore).toBeGreaterThanOrEqual(0);
      expect(r.aiScore).toBeGreaterThanOrEqual(0);
      // Theoretical max: 13*50 (yacht every round) + 35 bonus + 12*100 joker bonus = 1935.
      // Realistically < 700 for a strong game.
      expect(r.humanScore).toBeLessThan(2000);
      expect(r.aiScore).toBeLessThan(2000);
    }
  });
});

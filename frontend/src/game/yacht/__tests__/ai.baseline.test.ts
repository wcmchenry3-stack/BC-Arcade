/**
 * Yacht AI baseline metrics collector (GH #2129).
 *
 * Runs a simulation and prints a human-readable metrics table.
 * No assertions — always passes. Designed for one-off baseline snapshots.
 *
 * Enable:  YACHT_BASELINE=<N> npx jest --testPathPattern="ai.baseline" --testTimeout=600000
 * Example: YACHT_BASELINE=200 npx jest --testPathPattern="ai.baseline" --testTimeout=600000
 */

import { holdStrategy, scoreStrategy } from "../ai";
import { createSeededRng, newGame, roll, score, setRng } from "../engine";
import type { AiDifficulty } from "../types";

const RUN = !!process.env.YACHT_BASELINE;
const N = process.env.YACHT_BASELINE ? parseInt(process.env.YACHT_BASELINE, 10) : 0;

const itBaseline = (RUN ? it : it.skip) as jest.It;

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const UPPER_PAR: Record<string, number> = {
  ones: 3,
  twos: 6,
  threes: 9,
  fours: 12,
  fives: 15,
  sixes: 18,
};

const LOWER_CATS = [
  "three_of_a_kind",
  "four_of_a_kind",
  "full_house",
  "small_straight",
  "large_straight",
  "yacht",
  "chance",
] as const;

interface GameMetrics {
  score: number;
  bonusAchieved: boolean;
  upperSubtotal: number;
  lowerSubtotal: number;
  belowParFills: number;
}

function simulateGame(
  diff: AiDifficulty,
  opponentDiff: AiDifficulty,
  seed: number
): { player: GameMetrics; opp: GameMetrics } {
  setRng(createSeededRng(seed));

  let pState = newGame();
  let oState = newGame();

  for (let _r = 0; _r < 13; _r++) {
    // Player turn
    pState = roll(pState, [false, false, false, false, false]);
    while (pState.rolls_used < 3) {
      const holds = holdStrategy(pState, diff);
      if (holds.every((h) => h)) break;
      pState = roll(pState, holds);
    }
    pState = score(pState, scoreStrategy(pState, diff, oState.total_score));

    // Opponent turn
    oState = roll(oState, [false, false, false, false, false]);
    while (oState.rolls_used < 3) {
      const holds = holdStrategy(oState, opponentDiff);
      if (holds.every((h) => h)) break;
      oState = roll(oState, holds);
    }
    oState = score(oState, scoreStrategy(oState, opponentDiff, pState.total_score));
  }

  function metrics(state: ReturnType<typeof newGame>): GameMetrics {
    let belowPar = 0;
    for (const [cat, par] of Object.entries(UPPER_PAR)) {
      const v = state.scores[cat];
      if (v !== null && v !== undefined && v < par) belowPar++;
    }
    let lowerSubtotal = 0;
    for (const cat of LOWER_CATS) {
      const v = state.scores[cat];
      if (v !== null && v !== undefined) lowerSubtotal += v;
    }
    return {
      score: state.total_score,
      bonusAchieved: state.upper_bonus > 0,
      upperSubtotal: state.upper_subtotal,
      lowerSubtotal,
      belowParFills: belowPar,
    };
  }

  return { player: metrics(pState), opp: metrics(oState) };
}

interface BatchMetrics {
  meanScore: number;
  bonusRate: number;
  upperMean: number;
  lowerMean: number;
  belowParMean: number;
  winRateVsOpp?: number;
}

function runSelfPlay(diff: AiDifficulty, n: number, seedOffset: number): BatchMetrics {
  let totalScore = 0,
    bonusCount = 0,
    upperTotal = 0,
    lowerTotal = 0,
    belowParTotal = 0;

  for (let i = 0; i < n; i++) {
    const g = simulateGame(diff, diff, seedOffset + i);
    totalScore += g.player.score;
    if (g.player.bonusAchieved) bonusCount++;
    upperTotal += g.player.upperSubtotal;
    lowerTotal += g.player.lowerSubtotal;
    belowParTotal += g.player.belowParFills;
  }

  return {
    meanScore: totalScore / n,
    bonusRate: bonusCount / n,
    upperMean: upperTotal / n,
    lowerMean: lowerTotal / n,
    belowParMean: belowParTotal / n,
  };
}

function runMatchup(
  playerDiff: AiDifficulty,
  oppDiff: AiDifficulty,
  n: number,
  seedOffset: number
): BatchMetrics {
  let playerWins = 0,
    totalScore = 0,
    bonusCount = 0,
    upperTotal = 0,
    lowerTotal = 0,
    belowParTotal = 0;

  for (let i = 0; i < n; i++) {
    const g = simulateGame(playerDiff, oppDiff, seedOffset + i);
    if (g.player.score > g.opp.score) playerWins++;
    totalScore += g.player.score;
    if (g.player.bonusAchieved) bonusCount++;
    upperTotal += g.player.upperSubtotal;
    lowerTotal += g.player.lowerSubtotal;
    belowParTotal += g.player.belowParFills;
  }

  return {
    meanScore: totalScore / n,
    bonusRate: bonusCount / n,
    upperMean: upperTotal / n,
    lowerMean: lowerTotal / n,
    belowParMean: belowParTotal / n,
    winRateVsOpp: playerWins / n,
  };
}

// ---------------------------------------------------------------------------
// Baseline test
// ---------------------------------------------------------------------------

afterEach(() => setRng(Math.random));

describe("Yacht AI — baseline metrics (GH #2129)", () => {
  itBaseline(
    `Self-play metrics: Easy / Medium / Hard (N=${N} games each)`,
    () => {
      const easy = runSelfPlay("easy", N, 100000);
      const medium = runSelfPlay("medium", N, 200000);
      const hard = runSelfPlay("hard", N, 300000);

      const hardVsEasy = runMatchup("hard", "easy", N, 400000);
      const hardVsMedium = runMatchup("hard", "medium", N, 500000);

      console.log("\n=== Yacht AI Baseline Metrics ===");
      console.log(`N = ${N} games per batch\n`);

      console.log("--- Self-play per difficulty ---");
      console.table({
        Easy: {
          meanScore: easy.meanScore.toFixed(1),
          bonusRate: pct(easy.bonusRate),
          upperMean: easy.upperMean.toFixed(1),
          lowerMean: easy.lowerMean.toFixed(1),
          belowParMean: easy.belowParMean.toFixed(2),
        },
        Medium: {
          meanScore: medium.meanScore.toFixed(1),
          bonusRate: pct(medium.bonusRate),
          upperMean: medium.upperMean.toFixed(1),
          lowerMean: medium.lowerMean.toFixed(1),
          belowParMean: medium.belowParMean.toFixed(2),
        },
        Hard: {
          meanScore: hard.meanScore.toFixed(1),
          bonusRate: pct(hard.bonusRate),
          upperMean: hard.upperMean.toFixed(1),
          lowerMean: hard.lowerMean.toFixed(1),
          belowParMean: hard.belowParMean.toFixed(2),
        },
      });

      console.log("\n--- Matchup win rates (Hard as player) ---");
      console.table({
        "Hard vs Easy": {
          hardWinRate: pct(hardVsEasy.winRateVsOpp!),
          hardMeanScore: hardVsEasy.meanScore.toFixed(1),
          easyMeanScore: "n/a",
        },
        "Hard vs Medium": {
          hardWinRate: pct(hardVsMedium.winRateVsOpp!),
          hardMeanScore: hardVsMedium.meanScore.toFixed(1),
          medMeanScore: "n/a",
        },
      });

      console.log("\n--- Raw numbers ---");
      console.log(
        JSON.stringify(
          {
            n: N,
            easy: {
              meanScore: r(easy.meanScore),
              bonusRate: r(easy.bonusRate),
              upperMean: r(easy.upperMean),
              lowerMean: r(easy.lowerMean),
              belowParMean: r(easy.belowParMean),
            },
            medium: {
              meanScore: r(medium.meanScore),
              bonusRate: r(medium.bonusRate),
              upperMean: r(medium.upperMean),
              lowerMean: r(medium.lowerMean),
              belowParMean: r(medium.belowParMean),
            },
            hard: {
              meanScore: r(hard.meanScore),
              bonusRate: r(hard.bonusRate),
              upperMean: r(hard.upperMean),
              lowerMean: r(hard.lowerMean),
              belowParMean: r(hard.belowParMean),
            },
            hardVsEasy: { winRate: r(hardVsEasy.winRateVsOpp!) },
            hardVsMedium: { winRate: r(hardVsMedium.winRateVsOpp!) },
          },
          null,
          2
        )
      );

      // Always passes — this is a metrics collector, not a gated test.
      expect(true).toBe(true);
    },
    600_000
  );
});

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
function r(v: number): number {
  return Math.round(v * 1000) / 1000;
}

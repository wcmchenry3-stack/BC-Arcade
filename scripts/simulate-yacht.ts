/**
 * Yacht AI difficulty simulation (#1601).
 *
 * Runs batches of 3,000 games per matchup. Two players (human-equivalent and
 * AI) alternate rounds using independent GameState instances. Player 0's stats
 * are tracked and reported.
 *
 * Usage:
 *   npx tsx scripts/simulate-yacht.ts                       # aggregate stats
 *   npx tsx scripts/simulate-yacht.ts --count 500           # 500 games per batch
 *   npx tsx scripts/simulate-yacht.ts --ai-difficulty hard  # only Hard-AI matchups
 *   npx tsx scripts/simulate-yacht.ts --log-games 10        # 10 NDJSON game logs (medium vs medium)
 *   npx tsx scripts/simulate-yacht.ts --log-games 10 --difficulty hard  # hard vs hard logs
 */

import {
  createSeededRng,
  newGame,
  roll,
  score,
  setRng,
} from "../frontend/src/game/yacht/engine";
import { holdStrategy, scoreStrategy } from "../frontend/src/game/yacht/ai";
import type { AiDifficulty } from "../frontend/src/game/yacht/types";
import type { GameState } from "../frontend/src/game/yacht/types";

// ---------------------------------------------------------------------------
// Core game runner
// ---------------------------------------------------------------------------

interface TwoPlayerStates {
  humanState: GameState;
  aiState: GameState;
}

/**
 * Play one complete 13-round game between two AI-driven players.
 *
 * Both players draw from a single shared RNG seeded at `seed`. Outcomes are
 * fully deterministic for a given seed, but the two players' rolls are not
 * statistically independent — a favorable roll for the human consumes RNG
 * state that shifts the AI's rolls. This is acceptable for a validation tool
 * where we only care about aggregate win rates across many seeds.
 */
function playGame(
  humanDiff: AiDifficulty,
  aiDiff: AiDifficulty,
  seed: number,
): TwoPlayerStates {
  setRng(createSeededRng(seed));

  let humanState = newGame();
  let aiState = newGame();

  // Human goes first each round so Hard AI can see the updated human score
  // when making adversarial high-variance play decisions.
  for (let _round = 0; _round < 13; _round++) {
    humanState = roll(humanState, [false, false, false, false, false]);
    while (humanState.rolls_used < 3) {
      humanState = roll(humanState, holdStrategy(humanState, humanDiff));
    }
    humanState = score(
      humanState,
      scoreStrategy(humanState, humanDiff, aiState.total_score),
    );

    aiState = roll(aiState, [false, false, false, false, false]);
    while (aiState.rolls_used < 3) {
      aiState = roll(aiState, holdStrategy(aiState, aiDiff));
    }
    aiState = score(
      aiState,
      scoreStrategy(aiState, aiDiff, humanState.total_score),
    );
  }

  return { humanState, aiState };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

interface GameResult {
  humanScore: number;
  aiScore: number;
  winner: 0 | 1;
  upperBonusHuman: boolean;
  upperBonusAi: boolean;
  yahtzeeCountHuman: number;
  yahtzeeCountAi: number;
  chanceHuman: number;
}

function simulateGame(
  humanDiff: AiDifficulty,
  aiDiff: AiDifficulty,
  seed: number,
): GameResult {
  const { humanState, aiState } = playGame(humanDiff, aiDiff, seed);

  const humanScore = humanState.total_score;
  const aiScore = aiState.total_score;

  return {
    humanScore,
    aiScore,
    winner: humanScore >= aiScore ? 0 : 1,
    upperBonusHuman: humanState.upper_bonus === 35,
    upperBonusAi: aiState.upper_bonus === 35,
    // yacht_bonus_count counts bonus Yahtzees only (2nd, 3rd, …).
    // Adding 1 when scores["yacht"] === 50 includes the first Yahtzee.
    yahtzeeCountHuman:
      humanState.yacht_bonus_count +
      (humanState.scores["yacht"] === 50 ? 1 : 0),
    yahtzeeCountAi:
      aiState.yacht_bonus_count + (aiState.scores["yacht"] === 50 ? 1 : 0),
    chanceHuman: humanState.scores["chance"] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// NDJSON game logging
// ---------------------------------------------------------------------------

interface GameLog {
  seed: number;
  humanDifficulty: AiDifficulty;
  aiDifficulty: AiDifficulty;
  humanScore: number;
  aiScore: number;
  winner: 0 | 1;
  upperBonusHuman: boolean;
  upperBonusAi: boolean;
  humanScorecard: Record<string, number | null>;
  aiScorecard: Record<string, number | null>;
}

function simulateGameLogged(
  humanDiff: AiDifficulty,
  aiDiff: AiDifficulty,
  seed: number,
): GameLog {
  const { humanState, aiState } = playGame(humanDiff, aiDiff, seed);

  return {
    seed,
    humanDifficulty: humanDiff,
    aiDifficulty: aiDiff,
    humanScore: humanState.total_score,
    aiScore: aiState.total_score,
    winner: humanState.total_score >= aiState.total_score ? 0 : 1,
    upperBonusHuman: humanState.upper_bonus === 35,
    upperBonusAi: aiState.upper_bonus === 35,
    humanScorecard: humanState.scores,
    aiScorecard: aiState.scores,
  };
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  const variance =
    values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function binomialCI(p: number, n: number): [number, number] {
  const margin = 1.96 * Math.sqrt((p * (1 - p)) / n);
  return [Math.max(0, p - margin), Math.min(1, p + margin)];
}

function zTest(p1: number, p2: number, n: number): number {
  const p = (p1 + p2) / 2;
  return Math.abs(p1 - p2) / Math.sqrt((2 * p * (1 - p)) / n);
}

function sigLabel(z: number): string {
  if (z > 3.29) return "p < 0.001";
  if (z > 2.58) return "p < 0.01";
  if (z > 1.96) return "p < 0.05";
  return "n.s.";
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

const VALID_DIFFICULTIES = new Set<AiDifficulty>(["easy", "medium", "hard"]);

function parseCount(args: string[], flag: string): number | null {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const n = parseInt(args[idx + 1] ?? "", 10);
  return isNaN(n) ? null : n;
}

function parseDifficulty(args: string[], flag: string): AiDifficulty | null {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const val = args[idx + 1] ?? "";
  if (!VALID_DIFFICULTIES.has(val as AiDifficulty)) return null;
  return val as AiDifficulty;
}

// --log-games N: emit N NDJSON game logs and exit.
// --difficulty sets both players to the same tier (default: medium).
const logCount = parseCount(process.argv, "--log-games");
if (logCount !== null) {
  if (logCount < 1) {
    process.stderr.write(
      "Error: --log-games count must be a positive integer\n",
    );
    process.exit(1);
  }
  const diff = parseDifficulty(process.argv, "--difficulty") ?? "medium";
  for (let i = 0; i < logCount; i++) {
    const log = simulateGameLogged(diff, diff, i);
    process.stdout.write(JSON.stringify(log) + "\n");
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Batch definitions
// ---------------------------------------------------------------------------

const GAMES_PER_BATCH = parseCount(process.argv, "--count") ?? 3000;

if (GAMES_PER_BATCH < 1) {
  process.stderr.write("Error: --count must be a positive integer\n");
  process.exit(1);
}

// --ai-difficulty filters which matchups to run (by the AI player's tier).
const filterAiDiff = parseDifficulty(process.argv, "--ai-difficulty");

interface Batch {
  label: string;
  humanDiff: AiDifficulty;
  aiDiff: AiDifficulty;
  /** Expected human win rate band [lo, hi] for acceptance check */
  expectedBand: [number, number];
}

const ALL_BATCHES: Batch[] = [
  {
    label: "Easy (human) vs Easy (AI) — baseline",
    humanDiff: "easy",
    aiDiff: "easy",
    expectedBand: [0.45, 0.55],
  },
  {
    label: "Medium (human) vs Easy (AI)",
    humanDiff: "medium",
    aiDiff: "easy",
    expectedBand: [0.58, 0.72],
  },
  {
    label: "Hard (human) vs Easy (AI)",
    humanDiff: "hard",
    aiDiff: "easy",
    expectedBand: [0.72, 0.88],
  },
  {
    label: "Medium (human) vs Medium (AI) — baseline",
    humanDiff: "medium",
    aiDiff: "medium",
    expectedBand: [0.45, 0.55],
  },
  {
    label: "Hard (human) vs Medium (AI)",
    humanDiff: "hard",
    aiDiff: "medium",
    expectedBand: [0.58, 0.72],
  },
  {
    label: "Hard (human) vs Hard (AI) — baseline",
    humanDiff: "hard",
    aiDiff: "hard",
    expectedBand: [0.45, 0.55],
  },
];

const batches = filterAiDiff
  ? ALL_BATCHES.filter((b) => b.aiDiff === filterAiDiff)
  : ALL_BATCHES;

// ---------------------------------------------------------------------------
// Run batches
// ---------------------------------------------------------------------------

console.log("Yacht AI Difficulty Simulation Results");
console.log("======================================\n");
console.log(`Games per batch: ${GAMES_PER_BATCH}`);
if (filterAiDiff) console.log(`Filtering to AI difficulty: ${filterAiDiff}`);
console.log();

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const check = (cond: boolean) => (cond ? "✓" : "✗");

const batchResults: Array<{
  batch: Batch;
  winRate: number;
  avgHumanScore: number;
  avgAiScore: number;
  upperBonusRateHuman: number;
  upperBonusRateAi: number;
  avgYahtzeeHuman: number;
  avgYahtzeeAi: number;
  avgChanceHuman: number;
}> = [];

for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
  const batch = batches[batchIndex]!;
  const results: GameResult[] = [];

  for (let gameIndex = 0; gameIndex < GAMES_PER_BATCH; gameIndex++) {
    results.push(
      simulateGame(
        batch.humanDiff,
        batch.aiDiff,
        batchIndex * 100000 + gameIndex,
      ),
    );
  }

  const n = results.length;
  const wins = results.map((r) => (r.winner === 0 ? 1 : 0));
  const humanScores = results.map((r) => r.humanScore);
  const aiScores = results.map((r) => r.aiScore);
  const upperHuman = results.map((r) => (r.upperBonusHuman ? 1 : 0));
  const upperAi = results.map((r) => (r.upperBonusAi ? 1 : 0));
  const yahtzeeHuman = results.map((r) => r.yahtzeeCountHuman);
  const yahtzeeAi = results.map((r) => r.yahtzeeCountAi);
  const chanceHuman = results.map((r) => r.chanceHuman);

  const winRate = mean(wins);
  const [ciLow, ciHigh] = binomialCI(winRate, n);
  const avgHumanScore = mean(humanScores);
  const sdHumanScore = stdDev(humanScores, avgHumanScore);
  const avgAiScore = mean(aiScores);
  const sdAiScore = stdDev(aiScores, avgAiScore);
  const upperBonusRateHuman = mean(upperHuman);
  const upperBonusRateAi = mean(upperAi);
  const avgYahtzeeHuman = mean(yahtzeeHuman);
  const avgYahtzeeAi = mean(yahtzeeAi);
  const avgChanceHuman = mean(chanceHuman);

  batchResults.push({
    batch,
    winRate,
    avgHumanScore,
    avgAiScore,
    upperBonusRateHuman,
    upperBonusRateAi,
    avgYahtzeeHuman,
    avgYahtzeeAi,
    avgChanceHuman,
  });

  const inBand =
    winRate >= batch.expectedBand[0] && winRate <= batch.expectedBand[1];

  console.log(batch.label);
  console.log(`  Games: ${n}`);
  console.log(
    `  Human Win Rate: ${pct(winRate)} (95% CI: [${pct(ciLow)}, ${pct(ciHigh)}])  ${check(inBand)} expected [${pct(batch.expectedBand[0])}, ${pct(batch.expectedBand[1])}]`,
  );
  console.log(
    `  Avg Human Score: ${avgHumanScore.toFixed(1)} ± ${sdHumanScore.toFixed(1)}`,
  );
  console.log(
    `  Avg AI Score:    ${avgAiScore.toFixed(1)} ± ${sdAiScore.toFixed(1)}`,
  );
  console.log(
    `  Upper Bonus Rate: human ${pct(upperBonusRateHuman)}, AI ${pct(upperBonusRateAi)}`,
  );
  console.log(
    `  Avg Yahtzees/game: human ${avgYahtzeeHuman.toFixed(2)}, AI ${avgYahtzeeAi.toFixed(2)}`,
  );
  console.log(`  Avg Chance score (human): ${avgChanceHuman.toFixed(1)}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Interpretation
// ---------------------------------------------------------------------------

console.log("Interpretation:");

for (const r of batchResults) {
  const inBand =
    r.winRate >= r.batch.expectedBand[0] &&
    r.winRate <= r.batch.expectedBand[1];
  console.log(
    `  ${check(inBand)} ${r.batch.label}: human win rate ${pct(r.winRate)}`,
  );
}

// Verify difficulty separation: higher-skill player should win more
const easyVsEasy = batchResults.find(
  (r) => r.batch.humanDiff === "easy" && r.batch.aiDiff === "easy",
);
const medVsEasy = batchResults.find(
  (r) => r.batch.humanDiff === "medium" && r.batch.aiDiff === "easy",
);
const hardVsEasy = batchResults.find(
  (r) => r.batch.humanDiff === "hard" && r.batch.aiDiff === "easy",
);
const medVsMed = batchResults.find(
  (r) => r.batch.humanDiff === "medium" && r.batch.aiDiff === "medium",
);
const hardVsMed = batchResults.find(
  (r) => r.batch.humanDiff === "hard" && r.batch.aiDiff === "medium",
);

if (easyVsEasy && medVsEasy) {
  const z = zTest(medVsEasy.winRate, easyVsEasy.winRate, GAMES_PER_BATCH);
  console.log(
    `  ${check(medVsEasy.winRate > easyVsEasy.winRate)} Medium beats Easy more than Easy beats Easy (${sigLabel(z)})`,
  );
}
if (medVsEasy && hardVsEasy) {
  const z = zTest(hardVsEasy.winRate, medVsEasy.winRate, GAMES_PER_BATCH);
  console.log(
    `  ${check(hardVsEasy.winRate > medVsEasy.winRate)} Hard beats Easy more than Medium beats Easy (${sigLabel(z)})`,
  );
}
if (medVsMed && hardVsMed) {
  const z = zTest(hardVsMed.winRate, medVsMed.winRate, GAMES_PER_BATCH);
  console.log(
    `  ${check(hardVsMed.winRate > medVsMed.winRate)} Hard beats Medium more than Medium beats Medium (${sigLabel(z)})`,
  );
}

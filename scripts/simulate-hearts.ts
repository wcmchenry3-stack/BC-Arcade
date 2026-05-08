/**
 * Hearts AI difficulty simulation (#1273).
 *
 * Runs batches of 3,000 games. Each batch specifies all 4 player difficulties
 * individually. Player 0's stats are tracked and reported.
 *
 * Usage: npx tsx scripts/simulate-hearts.ts
 */

import {
  commitPass,
  createSeededRng,
  dealGame,
  dealNextHand,
  playCard,
  selectPassCard,
  setRng,
} from "../frontend/src/game/hearts/engine";
import { selectCardToPlay, selectCardsToPass } from "../frontend/src/game/hearts/ai";
import type { AiDifficulty, HeartsState } from "../frontend/src/game/hearts/types";

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

type Difficulties = [AiDifficulty, AiDifficulty, AiDifficulty, AiDifficulty];

interface GameResult {
  win: number;
  player0Score: number;
  handsPlayed: number;
  moonShots: number;
  player0HasMoon: number;
  qSpadeOnHuman: number;
}

function simulateGame(difficulties: Difficulties, seed: number): GameResult {
  setRng(createSeededRng(seed));
  let state: HeartsState = dealGame(difficulties[1]); // aiDifficulty field is informational

  while (state.phase !== "game_over") {
    if (state.phase === "passing") {
      for (let i = 0; i < 4; i++) {
        const diff = difficulties[i]!;
        const hand = [...(state.playerHands[i] ?? [])];
        const cards = selectCardsToPass(hand, state.passDirection, diff);
        for (const card of cards) {
          state = selectPassCard(state, i, card);
        }
      }
      state = commitPass(state);
    } else if (state.phase === "playing") {
      const playerIndex = state.currentPlayerIndex;
      const diff = difficulties[playerIndex]!;
      const hand = [...(state.playerHands[playerIndex] ?? [])];
      const trick = [...state.currentTrick];
      const card = selectCardToPlay(hand, trick, state, playerIndex, diff);
      state = playCard(state, playerIndex, card);
    } else if (state.phase === "dealing") {
      state = dealNextHand(state);
    }
  }

  const events = state.events ?? [];
  const moonShots = events.filter((e) => e.type === "moonShot").length;
  const player0HasMoon = events.some((e) => e.type === "moonShot" && e.shooter === 0) ? 1 : 0;
  const qSpadeOnHuman = events.some((e) => e.type === "queenOfSpades" && e.takerSeat === 0) ? 1 : 0;

  return {
    win: state.winnerIndex === 0 ? 1 : 0,
    player0Score: state.cumulativeScores[0] ?? 0,
    handsPlayed: state.handNumber,
    moonShots,
    player0HasMoon,
    qSpadeOnHuman,
  };
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
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
// Batches
// ---------------------------------------------------------------------------

const GAMES_PER_BATCH = 3000;

const batches: Array<{ label: string; difficulties: Difficulties }> = [
  {
    label: "Easy vs Easy vs Easy (baseline)",
    difficulties: ["easy", "easy", "easy", "easy"],
  },
  {
    label: "Easy vs Medium vs Medium vs Medium",
    difficulties: ["easy", "medium", "medium", "medium"],
  },
  {
    label: "Easy vs Hard vs Hard vs Hard",
    difficulties: ["easy", "hard", "hard", "hard"],
  },
  {
    label: "Medium vs Hard vs Hard vs Hard",
    difficulties: ["medium", "hard", "hard", "hard"],
  },
  {
    // Hard vs Medium, with 2 Easy neutrals to reduce field noise.
    // If Hard beats Medium, player 0 (Hard) should win > player 1 (Medium).
    label: "Hard vs Medium + 2 Easy neutrals (player 0 = Hard)",
    difficulties: ["hard", "medium", "easy", "easy"],
  },
  {
    // Mirror of the above — player 0 is now Medium.
    // Comparing batch 5 win rate vs batch 6 win rate isolates Hard vs Medium.
    label: "Medium vs Hard + 2 Easy neutrals (player 0 = Medium)",
    difficulties: ["medium", "hard", "easy", "easy"],
  },
];

console.log("Hearts AI Difficulty Simulation Results");
console.log("=======================================\n");

const batchWinRates: number[] = [];

for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
  const { label, difficulties } = batches[batchIndex]!;
  const results: GameResult[] = [];

  for (let gameIndex = 0; gameIndex < GAMES_PER_BATCH; gameIndex++) {
    results.push(simulateGame(difficulties, batchIndex * 100000 + gameIndex));
  }

  const n = results.length;
  const wins = results.map((r) => r.win);
  const scores = results.map((r) => r.player0Score);
  const hands = results.map((r) => r.handsPlayed);
  const moonShotsAll = results.map((r) => r.moonShots);
  const qOnHuman = results.map((r) => r.qSpadeOnHuman);

  const winRate = mean(wins);
  batchWinRates.push(winRate);

  const [ciLow, ciHigh] = binomialCI(winRate, n);
  const avgScore = mean(scores);
  const sdScore = stdDev(scores, avgScore);
  const avgHands = mean(hands);
  const sdHands = stdDev(hands, avgHands);
  const moonPct = (mean(moonShotsAll) * 100).toFixed(1);
  const qPct = (mean(qOnHuman) * 100).toFixed(1);

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  console.log(label);
  console.log(`  Games: ${n}`);
  console.log(`  Player 0 Win Rate: ${pct(winRate)} (95% CI: [${pct(ciLow)}, ${pct(ciHigh)}])`);
  console.log(`  Player 0 Avg Score: ${avgScore.toFixed(1)} ± ${sdScore.toFixed(1)} (std dev)`);
  console.log(`  Hands per Game: ${avgHands.toFixed(1)} ± ${sdHands.toFixed(1)}`);
  console.log(`  Moon Shots (any player): ${moonPct}%`);
  console.log(`  Q♠ on Human: ${qPct}%`);
  console.log();
}

// ---------------------------------------------------------------------------
// Interpretation
// ---------------------------------------------------------------------------

const [easyWr, easyVsMedWr, easyVsHardWr, medVs3HardWr, hardVsMedNeutralWr, medVsHardNeutralWr] =
  batchWinRates as [number, number, number, number, number, number];

const zEM = zTest(easyWr, easyVsMedWr, GAMES_PER_BATCH);
const zEH = zTest(easyWr, easyVsHardWr, GAMES_PER_BATCH);
const zMH_full = zTest(easyVsMedWr, easyVsHardWr, GAMES_PER_BATCH);
// Direct Hard vs Medium comparison: Hard (batch 5) vs Medium (batch 6) — same game, seat swapped.
const zHvM_direct = zTest(hardVsMedNeutralWr, medVsHardNeutralWr, GAMES_PER_BATCH);
const check = (cond: boolean) => (cond ? "✓" : "✗");

console.log("Interpretation:");
console.log(
  `  ${check(easyWr > 0.2 && easyWr < 0.3)} Easy baseline win rate near 25% (got ${(easyWr * 100).toFixed(1)}%)`
);
console.log(`  ${check(easyVsMedWr < easyWr)} Easy vs Medium: win rate drops (${sigLabel(zEM)})`);
console.log(
  `  ${check(easyVsHardWr < easyVsMedWr)} Easy vs Hard: win rate drops further (${sigLabel(zEH)})`
);
console.log(
  `  ${check(medVs3HardWr < 0.25)} Medium vs 3 Hard: Medium below 25% (got ${(medVs3HardWr * 100).toFixed(1)}%, ${sigLabel(zMH_full)} vs Easy batches)`
);
console.log(
  `  ${check(hardVsMedNeutralWr > medVsHardNeutralWr)} Hard vs Medium (neutral field): Hard ${(hardVsMedNeutralWr * 100).toFixed(1)}% vs Medium ${(medVsHardNeutralWr * 100).toFixed(1)}% (${sigLabel(zHvM_direct)})`
);

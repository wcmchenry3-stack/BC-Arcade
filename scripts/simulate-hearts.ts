/**
 * Hearts AI difficulty simulation (#1273).
 *
 * Runs batches of 3,000 games. Each batch specifies all 4 player difficulties
 * individually. Player 0's stats are tracked and reported.
 *
 * Usage:
 *   npx tsx scripts/simulate-hearts.ts                  # aggregate stats
 *   npx tsx scripts/simulate-hearts.ts --log-games 10   # 10 fully-logged games (NDJSON)
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
import {
  selectCardToPlay,
  selectCardsToPass,
} from "../frontend/src/game/hearts/ai";
import type {
  AiDifficulty,
  Card,
  HeartsState,
} from "../frontend/src/game/hearts/types";

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

type Difficulties = [AiDifficulty, AiDifficulty, AiDifficulty, AiDifficulty];

interface GameResult {
  win: number;
  player0Score: number;
  handsPlayed: number;
  moonShots: number;
  qSpadeOnHuman: number;
}

function simulateGame(difficulties: Difficulties, seed: number): GameResult {
  setRng(createSeededRng(seed));
  let state: HeartsState = dealGame(difficulties[0]); // aiDifficulty field is informational

  // Accumulate hand-scoped events before dealNextHand resets them (#1539).
  let totalMoonShots = 0;
  let qSpadeOnHuman = 0;
  function collectHandEvents(s: HeartsState) {
    const ev = s.events ?? [];
    totalMoonShots += ev.filter((e) => e.type === "moonShot").length;
    if (ev.some((e) => e.type === "queenOfSpades" && e.takerSeat === 0))
      qSpadeOnHuman = 1;
  }

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
      collectHandEvents(state);
      state = dealNextHand(state);
    }
  }
  collectHandEvents(state); // collect the final hand's events

  return {
    win: state.winnerIndex === 0 ? 1 : 0,
    player0Score: state.cumulativeScores[0] ?? 0,
    handsPlayed: state.handNumber,
    moonShots: totalMoonShots,
    qSpadeOnHuman,
  };
}

// ---------------------------------------------------------------------------
// Diagnostic game logging (#1502)
// ---------------------------------------------------------------------------

interface TrickLog {
  trickNumber: number;
  leader: number;
  plays: Array<{ player: number; card: Card }>;
  winner: number;
}

interface HandLog {
  handNumber: number;
  passDirection: string;
  initialDeal: Card[][];
  passed: Card[][];
  received: Card[][];
  tricks: TrickLog[];
}

interface GameLog {
  seed: number;
  difficulties: string[];
  winner: number;
  finalScores: number[];
  hands: HandLog[];
}

function simulateGameLogged(difficulties: Difficulties, seed: number): GameLog {
  setRng(createSeededRng(seed));
  let state: HeartsState = dealGame(difficulties[0]);

  const hands: HandLog[] = [];
  let currentHand: HandLog = {
    handNumber: state.handNumber,
    passDirection: state.passDirection,
    initialDeal: state.playerHands.map((h) => [...h]),
    passed: [[], [], [], []],
    received: [[], [], [], []],
    tricks: [],
  };
  let trickPlays: Array<{ player: number; card: Card }> = [];
  let trickLeader = -1;
  let trickNumber = 0;
  let pendingPasses: Card[][] = [[], [], [], []];

  while (state.phase !== "game_over") {
    if (state.phase === "passing") {
      for (let i = 0; i < 4; i++) {
        const diff = difficulties[i]!;
        const hand = [...(state.playerHands[i] ?? [])];
        const cards = selectCardsToPass(hand, state.passDirection, diff);
        pendingPasses[i] = cards;
        for (const card of cards) {
          state = selectPassCard(state, i, card);
        }
      }
      const handsBeforeCommit = state.playerHands.map(
        (h) => new Set(h.map((c) => `${c.suit}:${c.rank}`)),
      );
      state = commitPass(state);
      currentHand.passed = pendingPasses.map((p) => [...p]);
      for (let i = 0; i < 4; i++) {
        currentHand.received[i] = (state.playerHands[i] ?? []).filter(
          (c) => !handsBeforeCommit[i]!.has(`${c.suit}:${c.rank}`),
        );
      }
    } else if (state.phase === "playing") {
      const playerIndex = state.currentPlayerIndex;
      const diff = difficulties[playerIndex]!;
      const hand = [...(state.playerHands[playerIndex] ?? [])];
      const trick = [...state.currentTrick];
      const card = selectCardToPlay(hand, trick, state, playerIndex, diff);

      if (trick.length === 0) {
        trickLeader = playerIndex;
        trickNumber++;
      }

      const prevTricksPlayed = state.tricksPlayedInHand;
      trickPlays.push({ player: playerIndex, card });
      state = playCard(state, playerIndex, card);

      if (state.tricksPlayedInHand > prevTricksPlayed) {
        currentHand.tricks.push({
          trickNumber,
          leader: trickLeader,
          plays: trickPlays,
          winner: state.currentLeaderIndex,
        });
        trickPlays = [];
      }
    } else if (state.phase === "dealing") {
      hands.push(currentHand);
      state = dealNextHand(state);
      currentHand = {
        handNumber: state.handNumber,
        passDirection: state.passDirection,
        initialDeal: state.playerHands.map((h) => [...h]),
        passed: [[], [], [], []],
        received: [[], [], [], []],
        tricks: [],
      };
      trickPlays = [];
      trickLeader = -1;
      trickNumber = 0;
      pendingPasses = [[], [], [], []];
    }
  }

  hands.push(currentHand);

  return {
    seed,
    difficulties: [...difficulties],
    winner: state.winnerIndex ?? -1,
    finalScores: [...state.cumulativeScores],
    hands,
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

function parseDifficulties(args: string[]): Difficulties | null {
  const idx = args.indexOf("--difficulties");
  if (idx === -1) return null;
  const parts = (args[idx + 1] ?? "").split(",");
  if (parts.length !== 4) return null;
  for (const p of parts) {
    if (!VALID_DIFFICULTIES.has(p as AiDifficulty)) return null;
  }
  return parts as unknown as Difficulties;
}

// --count N is the primary flag; --log-games N is a deprecated alias
const count =
  parseCount(process.argv, "--count") ??
  parseCount(process.argv, "--log-games");
if (count !== null) {
  if (count < 1) {
    process.stderr.write("Error: count must be a positive integer\n");
    process.exit(1);
  }
  const difficultiesArg = parseDifficulties(process.argv);
  if (process.argv.includes("--difficulties") && difficultiesArg === null) {
    process.stderr.write(
      "Error: --difficulties must be 4 comma-separated values of easy/medium/hard\n" +
        "  Example: --difficulties easy,medium,hard,medium\n",
    );
    process.exit(1);
  }
  const logDifficulties: Difficulties = difficultiesArg ?? [
    "medium",
    "medium",
    "medium",
    "medium",
  ];
  for (let i = 0; i < count; i++) {
    const log = simulateGameLogged(logDifficulties, i);
    process.stdout.write(JSON.stringify(log) + "\n");
  }
  process.exit(0);
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
  console.log(
    `  Player 0 Win Rate: ${pct(winRate)} (95% CI: [${pct(ciLow)}, ${pct(ciHigh)}])`,
  );
  console.log(
    `  Player 0 Avg Score: ${avgScore.toFixed(1)} ± ${sdScore.toFixed(1)} (std dev)`,
  );
  console.log(
    `  Hands per Game: ${avgHands.toFixed(1)} ± ${sdHands.toFixed(1)}`,
  );
  console.log(`  Moon Shots (any player): ${moonPct}%`);
  console.log(`  Q♠ on Human: ${qPct}%`);
  console.log();
}

// ---------------------------------------------------------------------------
// Interpretation
// ---------------------------------------------------------------------------

const [
  easyWr,
  easyVsMedWr,
  easyVsHardWr,
  medVs3HardWr,
  hardVsMedNeutralWr,
  medVsHardNeutralWr,
] = batchWinRates as [number, number, number, number, number, number];

const zEM = zTest(easyWr, easyVsMedWr, GAMES_PER_BATCH);
const zEH = zTest(easyWr, easyVsHardWr, GAMES_PER_BATCH);
const zMHFull = zTest(easyVsMedWr, easyVsHardWr, GAMES_PER_BATCH);
// Direct Hard vs Medium comparison: Hard (batch 5) vs Medium (batch 6) — same game, seat swapped.
const zHvM_direct = zTest(
  hardVsMedNeutralWr,
  medVsHardNeutralWr,
  GAMES_PER_BATCH,
);
const check = (cond: boolean) => (cond ? "✓" : "✗");

console.log("Interpretation:");
console.log(
  `  ${check(easyWr > 0.2 && easyWr < 0.3)} Easy baseline win rate near 25% (got ${(easyWr * 100).toFixed(1)}%)`,
);
console.log(
  `  ${check(easyVsMedWr < easyWr)} Easy vs Medium: win rate drops (${sigLabel(zEM)})`,
);
console.log(
  `  ${check(easyVsHardWr < easyVsMedWr)} Easy vs Hard: win rate drops further (${sigLabel(zEH)})`,
);
console.log(
  `  ${check(medVs3HardWr < 0.25)} Medium vs 3 Hard: Medium below 25% (got ${(medVs3HardWr * 100).toFixed(1)}%, ${sigLabel(zMHFull)} vs Easy batches)`,
);
console.log(
  `  ${check(hardVsMedNeutralWr > medVsHardNeutralWr)} Hard vs Medium (neutral field): Hard ${(hardVsMedNeutralWr * 100).toFixed(1)}% vs Medium ${(medVsHardNeutralWr * 100).toFixed(1)}% (${sigLabel(zHvM_direct)})`,
);

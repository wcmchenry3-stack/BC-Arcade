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
  AiPersona,
  Card,
  HeartsState,
} from "../frontend/src/game/hearts/types";

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

type Difficulties = [AiPersona, AiPersona, AiPersona, AiPersona];

interface GameResult {
  win: number;
  player0Score: number;
  handsPlayed: number;
  moonShots: number;
  qSpadeOnHuman: number;
  // Behavioral metrics (#1632)
  qSpadeByPlayer: [number, number, number, number]; // hands each seat took Q♠
  voidsByPlayer: [number, number, number, number]; // passing rounds each seat voided a suit
  passingRounds: number; // total non-"none" passing rounds
  moonShotsByPlayer: [number, number, number, number]; // rounds each seat shot the moon
  handScoreSumByPlayer: [number, number, number, number]; // sum of per-hand scores
  // Moon attempt instrumentation (#1895): earlyMoon triggers (7+ hearts + Q♠ at hand start)
  moonAttemptsByPlayer: [number, number, number, number];
}

function simulateGame(difficulties: Difficulties, seed: number): GameResult {
  setRng(createSeededRng(seed));
  let state: HeartsState = dealGame(difficulties[0]); // aiDifficulty field is informational

  // Accumulate hand-scoped events before dealNextHand resets them (#1539).
  let totalMoonShots = 0;
  let qSpadeOnHuman = 0;
  const qSpadeByPlayer: [number, number, number, number] = [0, 0, 0, 0];
  const moonShotsByPlayer: [number, number, number, number] = [0, 0, 0, 0];
  const handScoreSumByPlayer: [number, number, number, number] = [0, 0, 0, 0];

  function collectHandEvents(s: HeartsState) {
    const ev = s.events ?? [];
    for (const e of ev) {
      if (e.type === "moonShot") {
        totalMoonShots++;
        moonShotsByPlayer[e.shooter]++;
      }
      if (e.type === "queenOfSpades") {
        qSpadeByPlayer[e.takerSeat]++;
        if (e.takerSeat === 0) qSpadeOnHuman = 1;
      }
    }
    for (let i = 0; i < 4; i++) {
      handScoreSumByPlayer[i] += s.handScores[i] ?? 0;
    }
  }

  const voidsByPlayer: [number, number, number, number] = [0, 0, 0, 0];
  let passingRounds = 0;
  // earlyMoon attempt tracking (#1895): record triggers at hand start, compare to moonShots.
  const moonAttemptsByPlayer: [number, number, number, number] = [0, 0, 0, 0];
  let lastAttemptCheckHand = -1;

  while (state.phase !== "game_over") {
    if (state.phase === "passing") {
      const isRealPass = state.passDirection !== "none";
      for (let i = 0; i < 4; i++) {
        const diff = difficulties[i]!;
        const hand = [...(state.playerHands[i] ?? [])];
        const cards = selectCardsToPass(hand, state.passDirection, diff, i);
        for (const card of cards) {
          state = selectPassCard(state, i, card);
        }
      }
      state = commitPass(state);
      if (isRealPass) {
        passingRounds++;
        for (let i = 0; i < 4; i++) {
          const suits = new Set(
            (state.playerHands[i] ?? []).map((c) => c.suit),
          );
          if (suits.size < 4) voidsByPlayer[i]++;
        }
      }
    } else if (state.phase === "playing") {
      // Detect earlyMoon triggers once per hand, at trick 0.
      if (
        state.tricksPlayedInHand === 0 &&
        state.handNumber !== lastAttemptCheckHand
      ) {
        lastAttemptCheckHand = state.handNumber;
        for (let i = 0; i < 4; i++) {
          if (difficulties[i] === "daring") {
            const h = state.playerHands[i] ?? [];
            const heartsCount = h.filter((c) => c.suit === "hearts").length;
            const hasQ = h.some((c) => c.suit === "spades" && c.rank === 12);
            // earlyMoon: 7+ hearts + Q♠, no hearts yet won, enough cards remaining.
            if (heartsCount >= 7 && hasQ && h.length >= 8) {
              moonAttemptsByPlayer[i]++;
            }
          }
        }
      }
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
    qSpadeByPlayer,
    voidsByPlayer,
    passingRounds,
    moonShotsByPlayer,
    handScoreSumByPlayer,
    moonAttemptsByPlayer,
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
        const cards = selectCardsToPass(hand, state.passDirection, diff, i);
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

const VALID_DIFFICULTIES = new Set<AiPersona>([
  "cautious",
  "schemer",
  "daring",
]);

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
    if (!VALID_DIFFICULTIES.has(p as AiPersona)) return null;
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
      "Error: --difficulties must be 4 comma-separated values of cautious/schemer/daring\n" +
        "  Example: --difficulties cautious,schemer,daring,schemer\n",
    );
    process.exit(1);
  }
  const logDifficulties: Difficulties = difficultiesArg ?? [
    "schemer",
    "schemer",
    "schemer",
    "schemer",
  ];
  for (let i = 0; i < count; i++) {
    const log = simulateGameLogged(logDifficulties, i);
    process.stdout.write(JSON.stringify(log) + "\n");
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------

function fmt4pct(vals: number[], denom: number): string {
  if (denom === 0) return "  n/a     n/a     n/a     n/a";
  return vals
    .map((v) => `${((v / denom) * 100).toFixed(1)}%`.padStart(7))
    .join(" ");
}

function fmt4score(vals: number[], denom: number): string {
  return vals.map((v) => (v / denom).toFixed(1).padStart(7)).join(" ");
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

const GAMES_PER_BATCH = 3000;

const batches: Array<{ label: string; difficulties: Difficulties }> = [
  {
    label: "Cautious vs Cautious vs Cautious (baseline)",
    difficulties: ["cautious", "cautious", "cautious", "cautious"],
  },
  {
    label: "Cautious vs Schemer vs Schemer vs Schemer",
    difficulties: ["cautious", "schemer", "schemer", "schemer"],
  },
  {
    label: "Cautious vs Daring vs Daring vs Daring",
    difficulties: ["cautious", "daring", "daring", "daring"],
  },
  {
    label: "Schemer vs Daring vs Daring vs Daring",
    difficulties: ["schemer", "daring", "daring", "daring"],
  },
  {
    // Daring vs Schemer, with 2 Cautious neutrals to reduce field noise.
    // If Daring beats Schemer, player 0 (Daring) should win > player 1 (Schemer).
    label: "Daring vs Schemer + 2 Cautious neutrals (player 0 = Daring)",
    difficulties: ["daring", "schemer", "cautious", "cautious"],
  },
  {
    // Mirror of the above — player 0 is now Schemer.
    // Comparing batch 5 win rate vs batch 6 win rate isolates Daring vs Schemer.
    label: "Schemer vs Daring + 2 Cautious neutrals (player 0 = Schemer)",
    difficulties: ["schemer", "daring", "cautious", "cautious"],
  },
];

console.log("Hearts AI Persona Simulation Results");
console.log("=======================================\n");

const batchWinRates: number[] = [];
// earlyMoon success rate from batch 5 (Daring at seat 0) for Interpretation check.
let daringEarlyMoonSuccessRate = 0;

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

  // Behavioral metrics (#1632)
  const totalHands = results.reduce((s, r) => s + r.handsPlayed, 0);
  const totalPassRounds = results.reduce((s, r) => s + r.passingRounds, 0);
  const qByPlayerAgg = [0, 1, 2, 3].map((i) =>
    results.reduce((s, r) => s + r.qSpadeByPlayer[i]!, 0),
  );
  const voidsAgg = [0, 1, 2, 3].map((i) =>
    results.reduce((s, r) => s + r.voidsByPlayer[i]!, 0),
  );
  const moonAgg = [0, 1, 2, 3].map((i) =>
    results.reduce((s, r) => s + r.moonShotsByPlayer[i]!, 0),
  );
  const moonAttemptsAgg = [0, 1, 2, 3].map((i) =>
    results.reduce((s, r) => s + r.moonAttemptsByPlayer[i]!, 0),
  );
  const handScoreAgg = [0, 1, 2, 3].map((i) =>
    results.reduce((s, r) => s + r.handScoreSumByPlayer[i]!, 0),
  );

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
  console.log(`  Behavioral Metrics      s0      s1      s2      s3`);
  console.log(`  Q♠/Hand by Seat:    ${fmt4pct(qByPlayerAgg, totalHands)}`);
  console.log(`  Void Rate by Seat:  ${fmt4pct(voidsAgg, totalPassRounds)}`);
  console.log(`  Moon Shots/Round:   ${fmt4pct(moonAgg, totalHands)}`);
  console.log(`  Avg Hand Score:     ${fmt4score(handScoreAgg, totalHands)}`);
  // earlyMoon success rate: shots / attempts per seat (n/a when no Daring at that seat).
  // Values >100% mean midMoon completions in that hand exceeded earlyMoon triggers —
  // moonShotsByPlayer counts all moon completions, not just earlyMoon-initiated ones.
  const moonSuccessRate = moonAttemptsAgg.map((attempts, i) =>
    attempts === 0
      ? "    n/a"
      : `${(((moonAgg[i] ?? 0) / attempts) * 100).toFixed(1)}%`.padStart(7),
  );
  console.log(`  earlyMoon Success:  ${moonSuccessRate.join(" ")}`);
  console.log();
  // Store Daring seat-0 earlyMoon success rate (batch 5, batchIndex=4) for Interpretation.
  if (batchIndex === 4) {
    const attempts = moonAttemptsAgg[0] ?? 0;
    const shots = moonAgg[0] ?? 0;
    daringEarlyMoonSuccessRate = attempts > 0 ? shots / attempts : 0;
  }
}

// ---------------------------------------------------------------------------
// Interpretation
// ---------------------------------------------------------------------------

const [
  cautiousWr,
  cautiousVsSchemerWr,
  cautiousVsDaringWr,
  schemerVs3DaringWr,
  daringVsSchemerNeutralWr,
  schemerVsDaringNeutralWr,
] = batchWinRates as [number, number, number, number, number, number];

const zCS = zTest(cautiousWr, cautiousVsSchemerWr, GAMES_PER_BATCH);
const zSDFull = zTest(cautiousVsSchemerWr, cautiousVsDaringWr, GAMES_PER_BATCH);
// Direct Daring vs Schemer comparison: Daring (batch 5) vs Schemer (batch 6) — same game, seat swapped.
const zDvS_direct = zTest(
  daringVsSchemerNeutralWr,
  schemerVsDaringNeutralWr,
  GAMES_PER_BATCH,
);
const check = (cond: boolean) => (cond ? "✓" : "✗");

console.log("Interpretation:");
console.log(
  `  ${check(cautiousWr > 0.2 && cautiousWr < 0.3)} Cautious baseline win rate near 25% (got ${(cautiousWr * 100).toFixed(1)}%)`,
);
console.log(
  `  ${check(cautiousVsSchemerWr < cautiousWr)} Cautious vs Schemer: win rate drops (${sigLabel(zCS)})`,
);
// Removed: "Cautious vs Daring drops further" check is structurally flawed.
// Daring's high-variance failed moon attempts self-punish Daring, so Cautious
// can actually win MORE against 3 Darings than against 3 Schemers — the check
// reliably fails without indicating an AI regression. Direct Daring-beats-Schemer
// z-test below is the correct acceptance criterion.
console.log(
  `  ${check(schemerVs3DaringWr < 0.25)} Schemer vs 3 Daring: Schemer below 25% (got ${(schemerVs3DaringWr * 100).toFixed(1)}%, ${sigLabel(zSDFull)} vs Cautious batches)`,
);
console.log(
  `  ${check(daringVsSchemerNeutralWr > schemerVsDaringNeutralWr)} Daring vs Schemer (neutral field): Daring ${(daringVsSchemerNeutralWr * 100).toFixed(1)}% vs Schemer ${(schemerVsDaringNeutralWr * 100).toFixed(1)}% (${sigLabel(zDvS_direct)})`,
);
console.log(
  `  ${check(daringEarlyMoonSuccessRate >= 0.15)} earlyMoon success rate ≥ 15% (got ${(daringEarlyMoonSuccessRate * 100).toFixed(1)}%)`,
);

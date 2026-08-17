/**
 * Hearts PIMC/determinization spike (#2240).
 *
 * RESEARCH SPIKE — not production code. Deliberately kept out of
 * frontend/src/game/hearts/ so it can't be imported by the shipped app; it
 * only *reads* the production engine/AI/info-set modules to reuse them as
 * ground truth (rules engine) and as the rollout policy for sampled
 * opponents. No production file is modified by this script.
 *
 * Implements one-step lookahead over N determinized opponent-hand samples
 * (the html5-hearts McBrain.js approach), constrained by voidLedger and
 * pass-memory (#2237), and benchmarks it against the current utility AI
 * using the existing scripts/simulate-hearts.ts-style harness (sim gate v2,
 * #2238, hasn't landed yet — this is the best available comparison tool;
 * see the write-up in the PR/issue for that caveat).
 *
 * Usage:
 *   npx tsx scripts/hearts-pimc-spike.ts latency --samples 20,50,100
 *   npx tsx scripts/hearts-pimc-spike.ts benchmark --count 300 --samples 50
 *   npx tsx scripts/hearts-pimc-spike.ts ablation --count 300 --samples 50
 */

import {
  commitPass,
  createSeededRng,
  dealGame,
  dealNextHand,
  getValidPlays,
  playCard,
  selectPassCard,
  setRng,
  type RandomSource,
} from "../frontend/src/game/hearts/engine";
import {
  selectCardToPlay,
  selectCardsToPass,
} from "../frontend/src/game/hearts/ai";
import { buildHeartsInfoSet } from "../frontend/src/game/hearts/aiInfoSet";
import type { HeartsInfoSet } from "../frontend/src/game/hearts/aiInfoSet";
import type {
  AiPersona,
  Card,
  HeartsState,
  PassDirection,
  TrickCard,
} from "../frontend/src/game/hearts/types";
import { RANKS, SUITS } from "../frontend/src/game/hearts/types";

// ---------------------------------------------------------------------------
// Deck / card helpers
// ---------------------------------------------------------------------------

function cardKey(c: Card): string {
  return `${c.suit}:${c.rank}`;
}

function cardEquals(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ suit, rank });
  }
  return deck;
}

function shuffle<T>(arr: readonly T[], rng: RandomSource): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

// ---------------------------------------------------------------------------
// Determinization: sample a full, rules-consistent set of opponent hands
// given only what the acting player could legitimately know (seenKeys, own
// hand, hand-size counts derived from public trick progress, voidLedger, and
// — the thing this spike exists to evaluate — pass-memory from #2237).
//
// "constrained" mode uses voidLedger + pass-memory. "uniform" mode ignores
// both (pure random deal respecting only hand sizes) — this is the ablation
// arm requested by the issue's acceptance criteria ("how much does
// pass-memory + void-ledger constraint actually help vs. uniform-random
// sampling").
// ---------------------------------------------------------------------------

export type SamplingMode = "constrained" | "uniform";

/**
 * Every opponent's remaining hand size, derived from public information only
 * (trick count + who has already played this trick) — never from reading
 * state.playerHands directly for anyone but the acting player.
 */
function remainingHandSizes(
  state: HeartsState,
  opponents: readonly number[],
): Record<number, number> {
  const atTrickStart = 13 - state.tricksPlayedInHand;
  const alreadyPlayed = new Set(state.currentTrick.map((tc) => tc.playerIndex));
  const sizes: Record<number, number> = {};
  for (const p of opponents) {
    sizes[p] = alreadyPlayed.has(p) ? atTrickStart - 1 : atTrickStart;
  }
  return sizes;
}

interface DeterminizeResult {
  hands: Record<number, Card[]>;
  /** true if a fully constraint-satisfying assignment was found within the retry budget. */
  ok: boolean;
}

function determinizeOpponentHands(
  state: HeartsState,
  infoSet: HeartsInfoSet,
  playerIndex: number,
  rng: RandomSource,
  mode: SamplingMode,
): DeterminizeResult {
  const opponents = [0, 1, 2, 3].filter((p) => p !== playerIndex);
  const ownHandKeys = new Set(infoSet.hand.map(cardKey));
  const pool = fullDeck().filter(
    (c) => !infoSet.seenKeys.has(cardKey(c)) && !ownHandKeys.has(cardKey(c)),
  );

  const targetSize = remainingHandSizes(state, opponents);
  const assigned: Record<number, Card[]> = { 0: [], 1: [], 2: [], 3: [] };
  let remainingPool = [...pool];

  // Pre-assign certain pass-memory knowledge (constrained mode only): a card
  // we know we passed away is not "somewhere out there" — it's pinned to a
  // specific opponent until observed played.
  if (mode === "constrained" && infoSet.passedToPlayerIndex !== null) {
    for (const pc of infoSet.passedCards) {
      const idx = remainingPool.findIndex((c) => cardEquals(c, pc));
      if (idx === -1) continue; // already played (in seenKeys) — nothing to pin
      const [card] = remainingPool.splice(idx, 1);
      assigned[infoSet.passedToPlayerIndex]!.push(card!);
      targetSize[infoSet.passedToPlayerIndex] =
        (targetSize[infoSet.passedToPlayerIndex] ?? 0) - 1;
    }
  }

  const eligibleFor = (card: Card, p: number): boolean => {
    if (mode === "uniform") return true;
    return !infoSet.voidLedger[p]?.[card.suit];
  };

  // Most-constrained-first assignment with retry: cards whose suit has fewer
  // eligible opponents go first, so a void doesn't get boxed out by capacity
  // exhaustion elsewhere. Retry with a fresh shuffle on failure (rare).
  for (let attempt = 0; attempt < 50; attempt++) {
    const order = shuffle(remainingPool, rng).sort((a, b) => {
      const ea = opponents.filter((p) => eligibleFor(a, p)).length;
      const eb = opponents.filter((p) => eligibleFor(b, p)).length;
      return ea - eb;
    });

    const trialAssigned: Record<number, Card[]> = {
      0: [...assigned[0]!],
      1: [...assigned[1]!],
      2: [...assigned[2]!],
      3: [...assigned[3]!],
    };
    const trialTarget: Record<number, number> = { ...targetSize };
    let ok = true;

    for (const card of order) {
      const eligible = opponents.filter(
        (p) => eligibleFor(card, p) && (trialTarget[p] ?? 0) > 0,
      );
      if (eligible.length === 0) {
        ok = false;
        break;
      }
      const pick = eligible[Math.floor(rng() * eligible.length)]!;
      trialAssigned[pick]!.push(card);
      trialTarget[pick] = (trialTarget[pick] ?? 0) - 1;
    }

    if (ok) return { hands: trialAssigned, ok: true };
  }

  // Fallback (should be exceedingly rare — only pathological void combinations
  // could exhaust the retry budget): relax void constraints entirely so the
  // spike degrades to uniform sampling rather than crashing mid-benchmark.
  const relaxedOrder = shuffle(remainingPool, rng);
  const relaxedAssigned: Record<number, Card[]> = {
    0: [...assigned[0]!],
    1: [...assigned[1]!],
    2: [...assigned[2]!],
    3: [...assigned[3]!],
  };
  const relaxedTarget: Record<number, number> = { ...targetSize };
  for (const card of relaxedOrder) {
    const eligible = opponents.filter((p) => (relaxedTarget[p] ?? 0) > 0);
    const pick = eligible[Math.floor(rng() * eligible.length)]!;
    relaxedAssigned[pick]!.push(card);
    relaxedTarget[pick] = (relaxedTarget[pick] ?? 0) - 1;
  }
  return { hands: relaxedAssigned, ok: false };
}

// ---------------------------------------------------------------------------
// One-step lookahead: resolve the REST of the current trick under a sampled
// determinization, using the production utility AI as the rollout policy for
// sampled opponents (assumedPersona — see write-up for the "average strategy
// fusion" limitation this implies). Returns points captured by `playerIndex`
// in this trick under this sample.
// ---------------------------------------------------------------------------

function resolveTrickUnderSample(
  state: HeartsState,
  playerIndex: number,
  candidate: Card,
  opponentHands: Record<number, Card[]>,
  assumedPersona: AiPersona,
): number {
  // playCard removes the played card from the hand itself (and validates it's
  // a legal play by re-deriving valid plays from the hand) — pass the hand
  // with `candidate` still present, exactly as the real engine expects.
  let sample: HeartsState = {
    ...state,
    playerHands: [0, 1, 2, 3].map((p) =>
      p === playerIndex ? state.playerHands[playerIndex]! : opponentHands[p]!,
    ),
  };

  const pointsBefore = sample.handScores[playerIndex] ?? 0;
  sample = playCard(sample, playerIndex, candidate);

  // Play out the rest of the trick (up to 3 more cards) using the production
  // AI as the rollout policy for sampled opponents.
  let guard = 0;
  while (
    sample.phase === "playing" &&
    sample.currentTrick.length > 0 &&
    sample.currentTrick.length < 4 &&
    guard < 4
  ) {
    guard++;
    const p = sample.currentPlayerIndex;
    const hand = [...(sample.playerHands[p] ?? [])];
    const trick = [...sample.currentTrick];
    const card = selectCardToPlay(hand, trick, sample, p, assumedPersona);
    sample = playCard(sample, p, card);
  }

  const pointsAfter = sample.handScores[playerIndex] ?? 0;
  return pointsAfter - pointsBefore;
}

// ---------------------------------------------------------------------------
// PIMC card selection: score every legal candidate by average points-to-self
// across N determinized samples; pick the minimum (fewest points captured).
// ---------------------------------------------------------------------------

export interface PimcOptions {
  samples: number;
  mode: SamplingMode;
  assumedPersona: AiPersona;
  rng: RandomSource;
}

export function pimcSelectCardToPlay(
  hand: Card[],
  trick: TrickCard[],
  state: HeartsState,
  playerIndex: number,
  opts: PimcOptions,
): { card: Card; elapsedMs: number; degradedSamples: number } {
  const start = performance.now();
  const valid = getValidPlays(state, playerIndex);
  if (valid.length === 1) {
    return {
      card: valid[0]!,
      elapsedMs: performance.now() - start,
      degradedSamples: 0,
    };
  }

  const infoSet = buildHeartsInfoSet(hand, trick, state, playerIndex);
  let degradedSamples = 0;

  const totals = new Map<string, { sum: number; card: Card }>();
  for (const card of valid) totals.set(cardKey(card), { sum: 0, card });

  for (let s = 0; s < opts.samples; s++) {
    const det = determinizeOpponentHands(
      state,
      infoSet,
      playerIndex,
      opts.rng,
      opts.mode,
    );
    if (!det.ok) degradedSamples++;
    for (const card of valid) {
      const pts = resolveTrickUnderSample(
        state,
        playerIndex,
        card,
        det.hands,
        opts.assumedPersona,
      );
      totals.get(cardKey(card))!.sum += pts;
    }
  }

  let best: Card = valid[0]!;
  let bestAvg = Infinity;
  for (const { sum, card } of totals.values()) {
    const avg = sum / opts.samples;
    if (avg < bestAvg) {
      bestAvg = avg;
      best = card;
    }
  }

  return { card: best, elapsedMs: performance.now() - start, degradedSamples };
}

// ---------------------------------------------------------------------------
// Benchmark harness (mirrors scripts/simulate-hearts.ts's simulateGame, with
// seat 0 optionally driven by PIMC instead of the utility AI).
// ---------------------------------------------------------------------------

type Difficulties = [AiPersona, AiPersona, AiPersona, AiPersona];

interface GameResult {
  win: number;
  player0Score: number;
  handsPlayed: number;
}

function simulateGame(
  difficulties: Difficulties,
  seed: number,
  seat0Mode: "baseline" | "pimc",
  pimcOpts: Omit<PimcOptions, "rng">,
): GameResult {
  const rng = createSeededRng(seed);
  setRng(rng);
  let state: HeartsState = dealGame(difficulties[0]);

  while (state.phase !== "game_over") {
    if (state.phase === "passing") {
      for (let i = 0; i < 4; i++) {
        const diff = difficulties[i]!;
        const hand = [...(state.playerHands[i] ?? [])];
        const cards = selectCardsToPass(hand, state.passDirection, diff, i);
        for (const card of cards) state = selectPassCard(state, i, card);
      }
      state = commitPass(state);
    } else if (state.phase === "playing") {
      const playerIndex = state.currentPlayerIndex;
      const hand = [...(state.playerHands[playerIndex] ?? [])];
      const trick = [...state.currentTrick];
      let card: Card;
      if (playerIndex === 0 && seat0Mode === "pimc") {
        card = pimcSelectCardToPlay(hand, trick, state, playerIndex, {
          ...pimcOpts,
          rng,
        }).card;
      } else {
        card = selectCardToPlay(
          hand,
          trick,
          state,
          playerIndex,
          difficulties[playerIndex]!,
        );
      }
      state = playCard(state, playerIndex, card);
    } else if (state.phase === "dealing") {
      state = dealNextHand(state);
    }
  }

  return {
    win: state.winnerIndex === 0 ? 1 : 0,
    player0Score: state.cumulativeScores[0] ?? 0,
    handsPlayed: state.handNumber,
  };
}

// ---------------------------------------------------------------------------
// Stats helpers (same formulas as scripts/simulate-hearts.ts, for a directly
// comparable report — sim gate v2 (#2238) hasn't landed yet, so this reuses
// the interim tooling rather than inventing a third statistics approach).
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

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

function parseIntArg(args: string[], flag: string, fallback: number): number {
  const idx = args.indexOf(flag);
  if (idx === -1) return fallback;
  const n = parseInt(args[idx + 1] ?? "", 10);
  return isNaN(n) ? fallback : n;
}

function parseIntListArg(
  args: string[],
  flag: string,
  fallback: number[],
): number[] {
  const idx = args.indexOf(flag);
  if (idx === -1) return fallback;
  const parts = (args[idx + 1] ?? "").split(",").map((s) => parseInt(s, 10));
  return parts.every((n) => !isNaN(n)) ? parts : fallback;
}

const mode = process.argv[2];
const args = process.argv.slice(3);

if (mode === "latency") {
  const sampleCounts = parseIntListArg(args, "--samples", [20, 50, 100]);
  const decisions = parseIntArg(args, "--decisions", 200);

  console.log("Hearts PIMC latency benchmark (#2240)");
  console.log("======================================\n");
  console.log(
    `Measuring ${decisions} real in-game decision points per sample count.\n`,
  );

  for (const samples of sampleCounts) {
    const rng = createSeededRng(1);
    setRng(rng);
    let state: HeartsState = dealGame("schemer");
    const difficulties: Difficulties = [
      "schemer",
      "schemer",
      "schemer",
      "schemer",
    ];
    const timings: number[] = [];
    let degradedTotal = 0;

    while (timings.length < decisions) {
      if (state.phase === "passing") {
        for (let i = 0; i < 4; i++) {
          const hand = [...(state.playerHands[i] ?? [])];
          const cards = selectCardsToPass(
            hand,
            state.passDirection,
            difficulties[i]!,
            i,
          );
          for (const card of cards) state = selectPassCard(state, i, card);
        }
        state = commitPass(state);
      } else if (state.phase === "playing") {
        const playerIndex = state.currentPlayerIndex;
        const hand = [...(state.playerHands[playerIndex] ?? [])];
        const trick = [...state.currentTrick];
        if (playerIndex === 0) {
          const result = pimcSelectCardToPlay(hand, trick, state, playerIndex, {
            samples,
            mode: "constrained",
            assumedPersona: "schemer",
            rng,
          });
          timings.push(result.elapsedMs);
          degradedTotal += result.degradedSamples;
          state = playCard(state, playerIndex, result.card);
        } else {
          const card = selectCardToPlay(
            hand,
            trick,
            state,
            playerIndex,
            difficulties[playerIndex]!,
          );
          state = playCard(state, playerIndex, card);
        }
      } else if (state.phase === "dealing") {
        state = dealNextHand(state);
      }
    }

    timings.sort((a, b) => a - b);
    const avg = mean(timings);
    const p50 = percentile(timings, 0.5);
    const p95 = percentile(timings, 0.95);
    const max = timings[timings.length - 1]!;

    console.log(`samples=${samples}:`);
    console.log(
      `  mean=${avg.toFixed(2)}ms  p50=${p50.toFixed(2)}ms  p95=${p95.toFixed(2)}ms  max=${max.toFixed(2)}ms`,
    );
    console.log(
      `  degraded-sample retries exhausted: ${degradedTotal} / ${decisions * samples} sample-attempts`,
    );
    console.log(
      `  <1s/decision on this machine: ${p95 < 1000 ? "✓ yes (p95)" : "✗ no (p95)"}\n`,
    );
  }
  console.log(
    "Note: this is dev-machine timing (Node/tsx), not on-device mobile hardware — see\n" +
      "write-up for why that gap matters and how it should be read.",
  );
} else if (mode === "benchmark" || mode === "ablation") {
  const GAMES = parseIntArg(args, "--count", 300);
  const samples = parseIntArg(args, "--samples", 50);
  const opponentDifficulty: AiPersona = "schemer";

  console.log(`Hearts PIMC ${mode} (#2240)`);
  console.log("======================================\n");
  console.log(
    `Games per arm: ${GAMES}, samples/decision: ${samples}, opponents: 3x ${opponentDifficulty}\n`,
  );

  const arms: Array<{
    label: string;
    seat0: "baseline" | "pimc";
    samplingMode: SamplingMode;
  }> =
    mode === "benchmark"
      ? [
          {
            label: "Baseline utility AI (schemer) — seat 0",
            seat0: "baseline",
            samplingMode: "constrained",
          },
          {
            label: "PIMC (constrained sampling) — seat 0",
            seat0: "pimc",
            samplingMode: "constrained",
          },
        ]
      : [
          {
            label: "PIMC (constrained: voidLedger + pass-memory)",
            seat0: "pimc",
            samplingMode: "constrained",
          },
          {
            label: "PIMC (uniform-random sampling, no constraints)",
            seat0: "pimc",
            samplingMode: "uniform",
          },
        ];

  const difficulties: Difficulties = [
    opponentDifficulty,
    opponentDifficulty,
    opponentDifficulty,
    opponentDifficulty,
  ];
  const armWinRates: number[] = [];

  for (const arm of arms) {
    const results: GameResult[] = [];
    for (let g = 0; g < GAMES; g++) {
      // Same seed sequence across arms (paired comparison) — isolates the
      // seat-0 strategy change from deal-to-deal variance.
      results.push(
        simulateGame(difficulties, g, arm.seat0, {
          samples,
          mode: arm.samplingMode,
          assumedPersona: "schemer",
        }),
      );
    }
    const wins = results.map((r) => r.win);
    const scores = results.map((r) => r.player0Score);
    const winRate = mean(wins);
    armWinRates.push(winRate);
    const [ciLow, ciHigh] = binomialCI(winRate, GAMES);
    const avgScore = mean(scores);
    const sdScore = stdDev(scores, avgScore);

    console.log(arm.label);
    console.log(
      `  Win Rate: ${(winRate * 100).toFixed(1)}% (95% CI: [${(ciLow * 100).toFixed(1)}%, ${(ciHigh * 100).toFixed(1)}%])`,
    );
    console.log(
      `  Avg Score: ${avgScore.toFixed(1)} ± ${sdScore.toFixed(1)}\n`,
    );
  }

  const z = zTest(armWinRates[0]!, armWinRates[1]!, GAMES);
  const delta = (armWinRates[1]! - armWinRates[0]!) * 100;
  console.log(
    `Delta (arm 2 − arm 1): ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp, ${sigLabel(z)} (z=${z.toFixed(2)})`,
  );
} else {
  console.error(
    "Usage: npx tsx scripts/hearts-pimc-spike.ts <latency|benchmark|ablation> [--count N] [--samples N|N,N,N]",
  );
  process.exit(1);
}

/**
 * Hearts AI calibration gate (GH #2204, HRT-1/HRT-3).
 *
 * Full N-game validation of persona calibration bands, mirroring the Yacht
 * gate (yacht/__tests__/ai.calibrate.test.ts). Skipped by default; enable
 * with HEARTS_SIM_FULL=<N> (e.g. HEARTS_SIM_FULL=3000).
 *
 * Acceptance bands (measured on an instrumented 3,000-game / 33,325-hand run,
 * see #2204):
 *   Cautious baseline win rate (uniform Cautious field):    20–30%
 *   Daring moon attempt rate (Daring seat 0 vs S/C/C):      8–16% of hands
 *   Daring PAIRED moon success (completions ÷ activations): 2–10% of attempts
 *
 * The paired-success band replaces the old unpaired ratio (all completions ÷
 * trick-0-only attempt count), which reported 48–80% against a true paired
 * rate of ~4.9%. #2234 (rank-aware attempts) is expected to raise this band
 * deliberately; update the numbers there, with sim evidence, when it lands.
 */

import { detectMoonAttempt, selectCardToPlay, selectCardsToPass } from "../ai";
import {
  commitPass,
  createSeededRng,
  dealGame,
  dealNextHand,
  playCard,
  selectPassCard,
  setRng,
} from "../engine";
import type { AiPersona, HeartsState } from "../types";

const RUN = !!process.env.HEARTS_SIM_FULL;
const N = process.env.HEARTS_SIM_FULL ? parseInt(process.env.HEARTS_SIM_FULL, 10) : 3000;

const itFull = (RUN ? it : it.skip) as jest.It;

type Difficulties = [AiPersona, AiPersona, AiPersona, AiPersona];

// ---------------------------------------------------------------------------
// Simulator (trimmed from scripts/simulate-hearts.ts — win + paired moon only)
// ---------------------------------------------------------------------------

interface SimResult {
  win: boolean;
  handsPlayed: number;
  moonAttemptsBySeat0: number;
  pairedMoonSuccessBySeat0: number;
}

function simulateGame(difficulties: Difficulties, seed: number): SimResult {
  setRng(createSeededRng(seed));
  let state: HeartsState = dealGame(difficulties[0]); // aiDifficulty field is informational

  // Paired moon instrumentation (#2204): a hand counts as "attempted" for seat 0
  // the first time the real earlyMoon/midMoon trigger (detectMoonAttempt — the
  // same check ai.ts uses to activate DARING_MOON_PLAY_WEIGHTS) fires, and as a
  // paired success only when that SAME hand ends with seat 0 shooting the moon.
  let attemptedThisHand = false;
  let moonAttempts = 0;
  let pairedSuccesses = 0;

  function collectHandEvents(s: HeartsState) {
    for (const e of s.events ?? []) {
      if (e.type === "moonShot" && e.shooter === 0 && attemptedThisHand) {
        pairedSuccesses++;
      }
    }
  }

  while (state.phase !== "game_over") {
    if (state.phase === "passing") {
      for (let i = 0; i < 4; i++) {
        const hand = [...(state.playerHands[i] ?? [])];
        const cards = selectCardsToPass(hand, state.passDirection, difficulties[i]!, i);
        for (const card of cards) {
          state = selectPassCard(state, i, card);
        }
      }
      state = commitPass(state);
    } else if (state.phase === "playing") {
      const playerIndex = state.currentPlayerIndex;
      const hand = [...(state.playerHands[playerIndex] ?? [])];
      if (
        playerIndex === 0 &&
        !attemptedThisHand &&
        detectMoonAttempt(hand, state, playerIndex, difficulties[0]!)
      ) {
        attemptedThisHand = true;
        moonAttempts++;
      }
      const card = selectCardToPlay(
        hand,
        [...state.currentTrick],
        state,
        playerIndex,
        difficulties[playerIndex]!
      );
      state = playCard(state, playerIndex, card);
    } else if (state.phase === "dealing") {
      collectHandEvents(state);
      attemptedThisHand = false;
      state = dealNextHand(state);
    }
  }
  collectHandEvents(state);

  return {
    win: state.winnerIndex === 0,
    handsPlayed: state.handNumber,
    moonAttemptsBySeat0: moonAttempts,
    pairedMoonSuccessBySeat0: pairedSuccesses,
  };
}

interface BatchResult {
  winRate: number;
  totalHands: number;
  moonAttemptRate: number;
  pairedMoonSuccessRate: number;
}

function runBatch(difficulties: Difficulties, n: number, seedOffset: number): BatchResult {
  let wins = 0;
  let hands = 0;
  let attempts = 0;
  let successes = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateGame(difficulties, seedOffset + i);
    if (r.win) wins++;
    hands += r.handsPlayed;
    attempts += r.moonAttemptsBySeat0;
    successes += r.pairedMoonSuccessBySeat0;
  }
  return {
    winRate: wins / n,
    totalHands: hands,
    moonAttemptRate: hands > 0 ? attempts / hands : 0,
    pairedMoonSuccessRate: attempts > 0 ? successes / attempts : 0,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => setRng(Math.random));

describe("Hearts calibration — persona bands (#2204)", () => {
  itFull("Cautious baseline: seat 0 win rate 20–30% in a uniform Cautious field", () => {
    const r = runBatch(["cautious", "cautious", "cautious", "cautious"], N, 0);
    expect(r.winRate).toBeGreaterThanOrEqual(0.2);
    expect(r.winRate).toBeLessThanOrEqual(0.3);
  });

  itFull("Daring moon calibration: paired attempt→outcome bands (seat 0 Daring vs S/C/C)", () => {
    // Same lineup as simulate-hearts.ts batch 5 for comparability.
    const r = runBatch(["daring", "schemer", "cautious", "cautious"], N, 100000);

    // Attempt rate: hands where the real trigger activated / hands played.
    expect(r.moonAttemptRate).toBeGreaterThanOrEqual(0.08);
    expect(r.moonAttemptRate).toBeLessThanOrEqual(0.16);

    // PAIRED success: completions in attempted hands / attempted hands (HRT-1).
    expect(r.pairedMoonSuccessRate).toBeGreaterThanOrEqual(0.02);
    expect(r.pairedMoonSuccessRate).toBeLessThanOrEqual(0.1);
  });
});

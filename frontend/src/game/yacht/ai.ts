/**
 * Yacht AI engine — hold and score strategies for Easy / Medium / Hard.
 *
 * Mirrors frontend/src/game/hearts/ai.ts. Pure functions, no React, no side
 * effects. All randomness is handled by the caller (GameScreen) via the
 * existing engine.roll() + engine.score() functions.
 *
 * Win-rate targets (human vs AI, validated by scripts/simulate-yacht.ts):
 *   Easy   ~65%  — greedy/reactive, no bonus awareness
 *   Medium ~50%  — heuristic strategist, bonus tracking, protects Chance
 *   Hard   ~35%  — EV-optimized holds on final roll, adversarial scoring
 */

import { AiDifficulty, GameState } from "./types";
import { CATEGORIES, UPPER_CATEGORIES, Category, calculateScore, possibleScores } from "./engine";

// ─── Local maps ──────────────────────────────────────────────────────────────

const UPPER_FACE: Partial<Record<Category, number>> = {
  ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6,
};

const FACE_TO_CAT: Record<number, Category> = {
  1: "ones", 2: "twos", 3: "threes", 4: "fours", 5: "fives", 6: "sixes",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function faceCounts(dice: readonly number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const d of dice) m.set(d, (m.get(d) ?? 0) + 1);
  return m;
}

function diceSum(dice: readonly number[]): number {
  return dice.reduce((a, b) => a + b, 0);
}

function upperSubtotal(scores: GameState["scores"]): number {
  let s = 0;
  for (const cat of UPPER_CATEGORIES) {
    const v = scores[cat];
    if (v !== null && v !== undefined) s += v;
  }
  return s;
}

function isOpen(scores: GameState["scores"], cat: Category): boolean {
  return scores[cat] === null || scores[cat] === undefined;
}

/** Returns the highest-scoring category from a pre-computed legal move set. */
function bestInLegal(legal: Record<string, number>): Category | null {
  let bestCat: Category | null = null;
  let bestVal = -1;
  for (const [cat, val] of Object.entries(legal)) {
    if (val > bestVal) {
      bestVal = val;
      bestCat = cat as Category;
    }
  }
  return bestCat;
}

function mostFrequentFace(dice: readonly number[]): number {
  const counts = faceCounts(dice);
  let maxCnt = 0;
  let face = dice[0] ?? 1;
  for (const [f, cnt] of counts) {
    if (cnt > maxCnt || (cnt === maxCnt && f > face)) {
      maxCnt = cnt;
      face = f;
    }
  }
  return face;
}

function holdFace(dice: readonly number[], face: number): boolean[] {
  return dice.map(d => d === face);
}

function holdForRun(dice: readonly number[], runFaces: Set<number>): boolean[] {
  const held = [false, false, false, false, false];
  const seen = new Set<number>();
  for (let i = 0; i < dice.length; i++) {
    const d = dice[i]!;
    if (runFaces.has(d) && !seen.has(d)) {
      held[i] = true;
      seen.add(d);
    }
  }
  return held;
}

function longestRunFaces(dice: readonly number[], minLength: number): Set<number> | null {
  const unique = [...new Set(dice)].sort((a, b) => a - b);
  let run: number[] = unique[0] !== undefined ? [unique[0]] : [];
  let best: number[] = [];
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] === unique[i - 1]! + 1) {
      run.push(unique[i]!);
    } else {
      if (run.length > best.length) best = run;
      run = [unique[i]!];
    }
  }
  if (run.length > best.length) best = run;
  return best.length >= minLength ? new Set(best) : null;
}

// ─── Expected-value helpers (used by Hard hold strategy) ─────────────────────

/**
 * Returns the maximum immediate score available for `dice` across all open
 * categories. This is what the AI would get if it stopped rolling now.
 */
function maxImmediateScore(
  dice: readonly number[],
  scores: GameState["scores"],
): number {
  let best = 0;
  for (const cat of CATEGORIES) {
    if (isOpen(scores, cat)) {
      const s = calculateScore(cat, dice);
      if (s > best) best = s;
    }
  }
  return best;
}

/**
 * Expected score when `keptIndices` dice are held and the rest are rerolled once.
 * Enumerates all 6^(free) outcomes — tractable when free ≤ 5.
 */
function evForHold(
  dice: readonly number[],
  keptIndices: readonly number[],
  scores: GameState["scores"],
): number {
  const keptValues = keptIndices.map(i => dice[i]!);
  const freeCount = 5 - keptIndices.length;
  if (freeCount === 0) return maxImmediateScore(keptValues, scores);

  const outcomes = Math.pow(6, freeCount);
  let total = 0;

  for (let mask = 0; mask < outcomes; mask++) {
    const freeRoll: number[] = [];
    let rem = mask;
    for (let j = 0; j < freeCount; j++) {
      freeRoll.push((rem % 6) + 1);
      rem = Math.floor(rem / 6);
    }
    total += maxImmediateScore([...keptValues, ...freeRoll], scores);
  }

  return total / outcomes;
}

// ─── Hold strategies ─────────────────────────────────────────────────────────

function holdEasy(dice: readonly number[]): boolean[] {
  // Hold the most-frequent face; ties go to highest face.
  return holdFace(dice, mostFrequentFace(dice));
}

function holdMedium(
  dice: readonly number[],
  scores: GameState["scores"],
): boolean[] {
  const counts = faceCounts(dice);
  const toBonus = Math.max(0, 63 - upperSubtotal(scores));

  // 4+ of a kind: lock those
  for (const [face, cnt] of counts) {
    if (cnt >= 4) return holdFace(dice, face);
  }

  // Full house already in hand (3+2): keep all
  const sortedCnts = [...counts.values()].sort((a, b) => b - a);
  if (sortedCnts[0] === 3 && (sortedCnts[1] ?? 0) >= 2) {
    return [true, true, true, true, true];
  }

  // 5-run: keep all
  if (longestRunFaces(dice, 5)) return [true, true, true, true, true];

  // Trips: hold the 3
  for (const [face, cnt] of counts) {
    if (cnt === 3) return holdFace(dice, face);
  }

  // 4-run: hold the run to complete a large straight
  const run4 = longestRunFaces(dice, 4);
  if (run4) return holdForRun(dice, run4);

  // Upper bonus pursuit: hold an open upper face that appears ≥ 2 times.
  // Threshold of 55 keeps this active early in the game (all cats open → toBonus=63).
  if (toBonus > 0 && toBonus <= 55) {
    let bestFace = 0;
    let bestCnt = 0;
    for (const [face, cnt] of counts) {
      const cat = FACE_TO_CAT[face];
      if (cat && isOpen(scores, cat) && cnt > bestCnt) {
        bestCnt = cnt;
        bestFace = face;
      }
    }
    if (bestFace > 0 && bestCnt >= 2) return holdFace(dice, bestFace);
  }

  // 3-run: keep for potential small/large straight
  const run3 = longestRunFaces(dice, 3);
  if (run3) return holdForRun(dice, run3);

  // Highest pair
  let bestPairFace = 0;
  for (const [face, cnt] of counts) {
    if (cnt >= 2 && face > bestPairFace) bestPairFace = face;
  }
  if (bestPairFace > 0) return holdFace(dice, bestPairFace);

  // Fallback: hold single highest die
  const maxFace = Math.max(...dice);
  const held = [false, false, false, false, false];
  for (let i = 0; i < dice.length; i++) {
    if (dice[i] === maxFace) {
      held[i] = true;
      break;
    }
  }
  return held;
}

function holdHard(
  dice: readonly number[],
  scores: GameState["scores"],
  rollsUsed: number,
): boolean[] {
  if (rollsUsed !== 2) {
    // Only the final hold (rollsUsed === 2) warrants full EV enumeration.
    // For earlier holds — or if called unexpectedly at rollsUsed === 0 —
    // fall back to the medium heuristic. 2-step lookahead is O(6^10) and
    // infeasible at runtime.
    return holdMedium(dice, scores);
  }

  // rollsUsed === 2: one roll remaining — enumerate all 32 hold patterns and
  // pick the one with highest expected score across all 6^(free) outcomes.
  let bestHeld: boolean[] = [false, false, false, false, false];
  let bestEV = -Infinity;

  for (let mask = 0; mask < 32; mask++) {
    const keptIndices: number[] = [];
    for (let i = 0; i < 5; i++) {
      if (mask & (1 << i)) keptIndices.push(i);
    }
    const ev = evForHold(dice, keptIndices, scores);
    if (ev > bestEV) {
      bestEV = ev;
      bestHeld = [false, false, false, false, false];
      for (const i of keptIndices) bestHeld[i] = true;
    }
  }

  return bestHeld;
}

// ─── Score strategies ─────────────────────────────────────────────────────────
//
// All three functions receive `legal` — the output of engine.possibleScores(state).
// This is the single source of truth for which categories are legally available
// (it enforces Joker priority rules) and the scores already account for
// calculateJokerScore when a Joker is active.

function scoreEasy(dice: readonly number[], legal: Record<string, number>): Category {
  // Use Chance early when sum is decent (no strategy — purely reactive).
  const open = Object.keys(legal) as Category[];
  const s = diceSum(dice);
  if ("chance" in legal && s >= 20 && open.length > 6) return "chance";
  return bestInLegal(legal) ?? open[0]!;
}

function scoreMedium(
  dice: readonly number[],
  scores: GameState["scores"],
  legal: Record<string, number>,
): Category {
  const open = Object.keys(legal) as Category[];
  const upper = upperSubtotal(scores);
  const toBonus = Math.max(0, 63 - upper);
  const s = diceSum(dice);

  // Yacht — always take 50 pts
  if ("yacht" in legal && legal["yacht"] === 50) return "yacht";

  // Large straight — always take 40 pts
  if ("large_straight" in legal && (legal["large_straight"] ?? 0) > 0) return "large_straight";

  // Four of a kind — take when sum is high
  if ("four_of_a_kind" in legal && (legal["four_of_a_kind"] ?? 0) > 20) return "four_of_a_kind";

  // Full house — always take
  if ("full_house" in legal && (legal["full_house"] ?? 0) > 0) return "full_house";

  // Three of a kind — take when sum is decent
  if ("three_of_a_kind" in legal && (legal["three_of_a_kind"] ?? 0) > 15) return "three_of_a_kind";

  // Upper bonus: score an upper category when hitting par (3× the face)
  if (toBonus > 0 && toBonus <= 40) {
    const counts = faceCounts(dice);
    for (const cat of ["sixes", "fives", "fours", "threes"] as Category[]) {
      if (cat in legal) {
        const face = UPPER_FACE[cat]!;
        if ((counts.get(face) ?? 0) >= 3) return cat;
      }
    }
  }

  // Small straight — take 30 pts
  if ("small_straight" in legal && (legal["small_straight"] ?? 0) > 0) return "small_straight";

  // Chance — use when sum is solid and enough rounds remain
  if ("chance" in legal && s >= 22 && open.length > 4) return "chance";

  // Sacrifice: only when the bonus is mathematically unreachable
  const openUpperCats = (["ones", "twos", "threes", "fours", "fives", "sixes"] as Category[])
    .filter(c => c in legal);
  const maxReachable = upper + openUpperCats.reduce((acc, c) => acc + (UPPER_FACE[c] ?? 0) * 5, 0);
  if (maxReachable < 63) {
    if ("ones" in legal) return "ones";
    if ("twos" in legal) return "twos";
  }

  return bestInLegal(legal) ?? open[0]!;
}

function scoreHard(
  dice: readonly number[],
  scores: GameState["scores"],
  opponentScore: number,
  legal: Record<string, number>,
): Category {
  const open = Object.keys(legal) as Category[];
  const counts = faceCounts(dice);
  const s = diceSum(dice);
  const upper = upperSubtotal(scores);
  const toBonus = Math.max(0, 63 - upper);

  const myScore = Object.values(scores).reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const trailing = myScore < opponentScore - 30;
  const leading = myScore > opponentScore + 50;

  // Always take Yacht
  if ("yacht" in legal && legal["yacht"] === 50) return "yacht";

  // Always take Large Straight
  if ("large_straight" in legal && (legal["large_straight"] ?? 0) > 0) return "large_straight";

  // Trailing: take high-variance plays before medium-value ones.
  // Floor of 16 avoids counting four-1s (score=4) as a meaningful high-variance play.
  if (trailing) {
    if ("four_of_a_kind" in legal && (legal["four_of_a_kind"] ?? 0) > 16)
      return "four_of_a_kind";
    if ("full_house" in legal && (legal["full_house"] ?? 0) > 0) return "full_house";
    if ("small_straight" in legal && (legal["small_straight"] ?? 0) > 0) return "small_straight";
  }

  // Leading: lock in sure points
  if (leading) {
    for (const cat of ["sixes", "fives", "fours", "threes", "twos", "ones"] as Category[]) {
      if (cat in legal) {
        const face = UPPER_FACE[cat]!;
        if ((counts.get(face) ?? 0) >= 3) return cat;
      }
    }
    if ("chance" in legal && s >= 20) return "chance";
  }

  // Four of a kind
  if ("four_of_a_kind" in legal && (legal["four_of_a_kind"] ?? 0) > 18) return "four_of_a_kind";

  // Full house
  if ("full_house" in legal && (legal["full_house"] ?? 0) > 0) return "full_house";

  // Three of a kind with high sum
  if ("three_of_a_kind" in legal && (legal["three_of_a_kind"] ?? 0) >= 18) return "three_of_a_kind";

  // Aggressively pursue upper bonus (worth 35 pts — highest EV in the game)
  if (toBonus > 0 && toBonus <= 50) {
    for (const cat of ["sixes", "fives", "fours", "threes", "twos", "ones"] as Category[]) {
      if (cat in legal) {
        const face = UPPER_FACE[cat]!;
        const cnt = counts.get(face) ?? 0;
        if (cnt >= 3 || (face >= 5 && cnt >= 2)) return cat;
      }
    }
  }

  // Small straight
  if ("small_straight" in legal && (legal["small_straight"] ?? 0) > 0) return "small_straight";

  // Chance: use when sum is high, or few open categories remain
  if ("chance" in legal && (s >= 24 || (open.length <= 3 && s >= 18))) return "chance";

  // Sacrifice: only when bonus is mathematically unreachable
  const openUpperCats = (["ones", "twos", "threes", "fours", "fives", "sixes"] as Category[])
    .filter(c => c in legal);
  const maxPossibleUpperFromRemaining = openUpperCats.reduce(
    (acc, c) => acc + (UPPER_FACE[c] ?? 0) * 5,
    0,
  );
  if (upper + maxPossibleUpperFromRemaining < 63) {
    if ("ones" in legal) return "ones";
    if ("twos" in legal) return "twos";
  }

  return bestInLegal(legal) ?? open[0]!;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns which dice the AI should hold before its next roll.
 *
 * Call after each roll (when state.rolls_used is 1 or 2). Returns a boolean[]
 * parallel to state.dice — true means keep that die.
 */
export function holdStrategy(state: GameState, difficulty: AiDifficulty): boolean[] {
  const { dice, scores, rolls_used } = state;
  switch (difficulty) {
    case "easy":
      return holdEasy(dice);
    case "medium":
      return holdMedium(dice, scores);
    case "hard":
      return holdHard(dice, scores, rolls_used);
  }
}

/**
 * Returns the category the AI should score into.
 *
 * Call when the AI decides to stop rolling (rolls_used >= 3 or elects to bank).
 * Uses engine.possibleScores() as the legal move set — this enforces Joker
 * priority rules automatically, preventing illegal category selections.
 * `opponentScore` is the human player's current total, used by Hard for
 * adversarial awareness (high-variance plays when trailing, conservative when
 * leading).
 */
export function scoreStrategy(
  state: GameState,
  difficulty: AiDifficulty,
  opponentScore = 0,
): Category {
  const { dice, scores } = state;
  // possibleScores is the single source of truth for legal categories — it
  // handles Joker priority rules so we never suggest an illegal move.
  const legal = possibleScores(state);
  switch (difficulty) {
    case "easy":
      return scoreEasy(dice, legal);
    case "medium":
      return scoreMedium(dice, scores, legal);
    case "hard":
      return scoreHard(dice, scores, opponentScore, legal);
  }
}

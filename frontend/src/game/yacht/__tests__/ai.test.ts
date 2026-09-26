/**
 * Yacht AI tiers (#2246): Easy / Medium / Hard as handicapped reads off the
 * optimal-play oracle.
 *
 * - Option scoring (`scoreHolds`, `scoreCategories`) agrees with the oracle.
 * - Selection (`chooseOption`): temperature 0 is argmax, the cap and
 *   exclusions hold, and draws follow the softmax weights.
 * - Tier behaviour on fixed fixtures, with noise off so the choice is exact.
 * - Properties of the live (noisy) tiers over seeded games: legal moves,
 *   determinism, and never breaking a made yacht or large straight.
 *
 * Replaces the utility-AI tests (#2027/#2028). Their weight- and
 * consideration-specific assertions (chance-safety valve, adversarial
 * trailing/leading play, opponentRound handling) had no counterpart once
 * those layers were retired; the behaviours that still apply (legality,
 * Joker pricing #2242, holding made hands) are kept below.
 */

import {
  TIERS,
  chooseOption,
  holdStrategy,
  scoreCategories,
  scoreHolds,
  scoreStrategy,
} from "../ai";
import {
  computeDerived,
  createSeededRng,
  newGame,
  possibleScores,
  roll,
  score,
  setRng,
  type Category,
} from "../engine";
import { optimalCategoryEVs, optimalHoldEVs } from "../oracle/oracle";
import type { AiDifficulty, GameState } from "../types";

const DIFFICULTIES: readonly AiDifficulty[] = ["easy", "medium", "hard"];

function makeGame(dice: number[], rollsUsed: number, filled: Partial<GameState["scores"]> = {}) {
  const base = newGame();
  return computeDerived({
    ...base,
    dice,
    rolls_used: rollsUsed,
    scores: { ...base.scores, ...filled },
  });
}

function argmax(values: readonly number[]): number {
  return values.reduce((best, v, i) => (v > values[best]! ? i : best), 0);
}

/** The tier's choice with its noise switched off. */
function noiseFreeCategory(state: GameState, d: AiDifficulty): Category {
  const options = scoreCategories(state, TIERS[d].foresight);
  return options[argmax(options.map((o) => o.value))]!.category;
}

function noiseFreeHold(state: GameState, d: AiDifficulty): readonly number[] {
  const holds = scoreHolds(state, TIERS[d].foresight).filter((h) => !h.dominated);
  return holds[argmax(holds.map((h) => h.value))]!.kept;
}

function keptDice(state: GameState, mask: readonly boolean[]): number[] {
  return state.dice.filter((_, i) => mask[i]).sort((a, b) => a - b);
}

afterEach(() => setRng(Math.random));

// ---------------------------------------------------------------------------
// Tier parameters
// ---------------------------------------------------------------------------

describe("TIERS", () => {
  it("ladders foresight up and noise down from Easy to Hard", () => {
    expect(TIERS.easy.foresight).toBeLessThan(TIERS.medium.foresight);
    expect(TIERS.medium.foresight).toBeLessThan(TIERS.hard.foresight);
    expect(TIERS.hard.foresight).toBe(1);
    expect(TIERS.easy.temperature).toBeGreaterThan(TIERS.medium.temperature);
    expect(TIERS.medium.temperature).toBeGreaterThan(TIERS.hard.temperature);
    // Hard's slips stay under the regret metric's 5-point blunder threshold.
    expect(TIERS.hard.maxLoss).toBeLessThan(5);
  });
});

// ---------------------------------------------------------------------------
// Option scoring agrees with the oracle
// ---------------------------------------------------------------------------

describe("scoreCategories / scoreHolds — agree with the oracle at foresight 1", () => {
  const states = [
    makeGame([5, 5, 5, 3, 2], 3),
    makeGame([2, 2, 2, 2, 2], 3, { yacht: 50, twos: 10 }), // Joker turn
    makeGame([1, 2, 3, 4, 6], 3, { ones: 3, twos: 6, threes: 9, chance: 22 }),
  ];

  it.each(states.map((s, i) => [i, s] as const))(
    "category values match optimalCategoryEVs (%i)",
    async (_, s) => {
      const oracle = await optimalCategoryEVs(s, s.dice);
      const ours = scoreCategories(s, 1);
      expect(ours.map((o) => o.category).sort()).toEqual(Object.keys(oracle).sort());
      for (const o of ours) expect(o.value).toBeCloseTo(oracle[o.category]!, 6);
    }
  );

  it.each([1, 2] as const)(
    "hold values match optimalHoldEVs (rolls_used=%i)",
    async (rollsUsed) => {
      const s = makeGame([2, 3, 4, 5, 5], rollsUsed);
      const oracle = await optimalHoldEVs(s, s.dice, (3 - rollsUsed) as 1 | 2);
      for (const h of scoreHolds(s, 1)) {
        if (h.kept.length === 5) continue; // keep-all = bank now in the AI loop (see below)
        const match = oracle.find((o) => o.hold.join() === h.kept.join());
        expect(h.value).toBeCloseTo(match!.ev, 6);
      }
    }
  );

  it("values keeping all five dice as banking the roll now", () => {
    const s = makeGame([3, 3, 3, 3, 1], 1);
    for (const f of [0, 0.4, 1]) {
      const keepAll = scoreHolds(s, f).find((h) => h.kept.length === 5)!;
      const bestCategory = Math.max(...scoreCategories(s, f).map((c) => c.value));
      expect(keepAll.value).toBeCloseTo(bestCategory, 6);
    }
  });

  it("marks every reroll of a made yacht as dominated", () => {
    for (const f of [0, 0.4, 1]) {
      for (const h of scoreHolds(makeGame([4, 4, 4, 4, 4], 1), f)) {
        expect(h.dominated).toBe(h.kept.length !== 5);
      }
    }
  });

  it.each(DIFFICULTIES)(
    "%s: every reroll of a made large straight is dominated or beyond the tier's loss cap",
    (d) => {
      // Rerolling everything could still land a yacht (50 > 40), so not every
      // reroll is dominated; the ones that aren't cost more than maxLoss.
      const { foresight, maxLoss } = TIERS[d];
      for (const rollsUsed of [1, 2]) {
        const holds = scoreHolds(makeGame([2, 3, 4, 5, 6], rollsUsed), foresight);
        const bank = holds.find((h) => h.kept.length === 5)!.value;
        for (const h of holds) {
          if (h.kept.length === 5) continue;
          expect(h.dominated || bank - h.value > maxLoss).toBe(true);
        }
      }
    }
  );
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe("chooseOption", () => {
  it("is argmax at temperature 0 (first index on ties) and never draws", () => {
    const rng = jest.fn(() => 0.5);
    expect(chooseOption([1, 5, 3, 5], { temperature: 0, maxLoss: 10 }, undefined, rng)).toBe(1);
    expect(rng).not.toHaveBeenCalled();
  });

  it("never picks an excluded option, and throws if all are excluded", () => {
    const params = { temperature: 5, maxLoss: 100 };
    const rng = createSeededRng(1);
    for (let i = 0; i < 500; i++) {
      expect(chooseOption([9, 8, 7], params, (j) => j === 0, rng)).not.toBe(0);
    }
    expect(() => chooseOption([1, 2], params, () => true, rng)).toThrow(/no eligible option/);
  });

  it("never picks an option more than maxLoss below the best", () => {
    const rng = createSeededRng(2);
    for (let i = 0; i < 2000; i++) {
      const pick = chooseOption([10, 9.5, 4, 0], { temperature: 50, maxLoss: 1 }, undefined, rng);
      expect([0, 1]).toContain(pick);
    }
  });

  it("draws in proportion to exp(−loss / T)", () => {
    const rng = createSeededRng(3);
    const counts = [0, 0, 0];
    const n = 20_000;
    for (let i = 0; i < n; i++)
      counts[chooseOption([3, 2, 0], { temperature: 1, maxLoss: 10 }, undefined, rng)]!++;
    const w = [1, Math.exp(-1), Math.exp(-3)];
    const total = w.reduce((a, b) => a + b, 0);
    // Binomial SD at n = 20,000 is < 0.004; 0.015 is ~4σ.
    counts.forEach((c, i) => expect(Math.abs(c / n - w[i]! / total)).toBeLessThan(0.015));
  });
});

// ---------------------------------------------------------------------------
// Tier behaviour on fixed fixtures (noise off)
// ---------------------------------------------------------------------------

describe("tiers with noise off", () => {
  it("separate on foresight: Easy grabs points, Hard banks for the upper bonus", () => {
    // Early game, 5-5-5-3-2: three of a kind scores 20 now, fives scores 15
    // but is worth more once the 63-point bonus is counted.
    const s = makeGame([5, 5, 5, 3, 2], 3);
    expect(noiseFreeCategory(s, "easy")).toBe("three_of_a_kind");
    expect(noiseFreeCategory(s, "hard")).toBe("fives");

    const s2 = makeGame([4, 4, 4, 1, 2], 3);
    expect(noiseFreeCategory(s2, "easy")).toBe("three_of_a_kind");
    expect(noiseFreeCategory(s2, "medium")).toBe("fours");
    expect(noiseFreeCategory(s2, "hard")).toBe("fours");
  });

  it.each(DIFFICULTIES)("%s: takes a made yacht, large straight and full house", (d) => {
    expect(noiseFreeCategory(makeGame([6, 6, 6, 6, 6], 3), d)).toBe("yacht");
    expect(noiseFreeCategory(makeGame([1, 2, 3, 4, 5], 3), d)).toBe("large_straight");
    expect(noiseFreeCategory(makeGame([5, 5, 5, 2, 2], 3), d)).toBe("full_house");
  });

  it.each(DIFFICULTIES)("%s: holds four of a kind on the last reroll", (d) => {
    expect(noiseFreeHold(makeGame([6, 6, 6, 6, 1], 2), d)).toEqual([6, 6, 6, 6]);
  });

  // GH #2242: on a Joker turn Full House / Small / Large Straight score their
  // fixed 25/30/40. Five 2s with yacht and twos filled: large straight (40)
  // must beat the 10-point sum categories.
  it.each(DIFFICULTIES)("%s Joker: prices the fixed Large Straight value", (d) => {
    const s = makeGame([2, 2, 2, 2, 2], 3, { yacht: 50, twos: 10 });
    expect(noiseFreeCategory(s, d)).toBe("large_straight");
  });

  it.each(DIFFICULTIES)("%s: never picks a filled category", (d) => {
    expect(noiseFreeCategory(makeGame([5, 5, 5, 5, 5], 3, { yacht: 50 }), d)).not.toBe("yacht");
    expect(noiseFreeCategory(makeGame([1, 2, 3, 4, 5], 3, { large_straight: 40 }), d)).not.toBe(
      "large_straight"
    );
  });
});

// ---------------------------------------------------------------------------
// Live tiers (with noise) over seeded games
// ---------------------------------------------------------------------------

/** Play one seeded solitaire game, checking every decision. */
function playChecked(
  d: AiDifficulty,
  seed: number,
  check: (s: GameState, holds: boolean[] | null, cat: Category | null) => void
) {
  setRng(createSeededRng(seed));
  const log: string[] = [];
  let s = newGame();
  for (let round = 0; round < 13; round++) {
    s = roll(s, [false, false, false, false, false]);
    while (s.rolls_used < 3) {
      const holds = holdStrategy(s, d);
      check(s, holds, null);
      log.push(holds.map(Number).join(""));
      if (holds.every((h) => h)) break;
      s = roll(s, holds);
    }
    const cat = scoreStrategy(s, d);
    check(s, null, cat);
    log.push(cat);
    s = score(s, cat);
  }
  expect(s.game_over).toBe(true);
  return log;
}

describe("live tiers — properties over seeded games", () => {
  it.each(DIFFICULTIES)("%s: every hold is boolean[5] and every category is legal", (d) => {
    for (const seed of [1, 42, 999, 2024]) {
      playChecked(d, seed, (s, holds, cat) => {
        if (holds) {
          expect(holds).toHaveLength(5);
          holds.forEach((h) => expect(typeof h).toBe("boolean"));
        }
        if (cat) expect(cat in possibleScores(s)).toBe(true);
      });
    }
  });

  it.each(DIFFICULTIES)("%s: the same seed replays the same decisions", (d) => {
    expect(playChecked(d, 77, () => {})).toEqual(playChecked(d, 77, () => {}));
  });

  it("Easy's noise actually varies play across seeds", () => {
    expect(playChecked("easy", 1, () => {})).not.toEqual(playChecked("easy", 2, () => {}));
  });

  it.each(DIFFICULTIES)("%s: never rerolls a made yacht or large straight it can score", (d) => {
    const rng = createSeededRng(11);
    const categories = Object.keys(newGame().scores);
    for (let trial = 0; trial < 150; trial++) {
      // Random partial scorecard, keeping yacht and large straight open.
      const filled: Record<string, number> = {};
      for (const c of categories) {
        if (c !== "yacht" && c !== "large_straight" && rng() < 0.4) filled[c] = 0;
      }
      const face = 1 + Math.floor(rng() * 6);
      const straight = rng() < 0.5 ? [1, 2, 3, 4, 5] : [2, 3, 4, 5, 6];
      for (const dice of [[face, face, face, face, face], straight]) {
        const s = makeGame(dice, 1 + Math.floor(rng() * 2), filled);
        setRng(createSeededRng(trial));
        expect(keptDice(s, holdStrategy(s, d))).toEqual([...dice].sort((a, b) => a - b));
      }
    }
  });
});

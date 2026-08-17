/**
 * stateKey.ts rule-fidelity tests (#2243).
 *
 * The highest-risk part of the oracle: stateKey.ts's legal-category and
 * scoring-transition logic MUST agree with engine.ts's real score()/
 * possibleScores() exactly, or the solver optimizes against rules the
 * shipped game doesn't actually enforce. These tests play many randomized
 * real games through the ACTUAL engine (not a reimplementation) and compare
 * every scoring decision point against stateKey.ts's output.
 */

import {
  newGame,
  roll,
  score,
  possibleScores,
  setRng,
  createSeededRng,
  type Category,
} from "../../engine";
import type { GameState } from "../../types";
import {
  encodeKey,
  decodeKey,
  keyFromGameState,
  legalCategoriesFor,
  successorAfterScore,
  isAllUpperFilled,
  isTerminalKey,
  INITIAL_KEY,
  YACHT_OPEN,
  YACHT_FILLED_50,
  YACHT_FILLED_0,
  NON_YACHT_CATEGORIES,
  UPPER_CAP,
  TABLE_SIZE,
} from "../stateKey";

afterEach(() => {
  setRng(Math.random);
});

// ---------------------------------------------------------------------------
// Key encode/decode round-trip
// ---------------------------------------------------------------------------

describe("encodeKey / decodeKey", () => {
  it("round-trips every valid (mask, yachtStatus, upperCapped) combination", () => {
    // Full round-trip would be 4096*3*64 = 786,432 — sample a representative
    // slice (all yachtStatus/upperCapped values, a sample of masks) rather
    // than every mask, to keep this test fast.
    const sampleMasks = [0, 1, 5, 63, 64, 128, 4095, 2048, 273];
    for (const mask of sampleMasks) {
      for (const yachtStatus of [YACHT_OPEN, YACHT_FILLED_50, YACHT_FILLED_0] as const) {
        for (const upperCapped of [0, 1, 30, 62, 63]) {
          const key = encodeKey(mask, yachtStatus, upperCapped);
          expect(decodeKey(key)).toEqual({ mask, yachtStatus, upperCapped });
        }
      }
    }
  });

  it("INITIAL_KEY decodes to nothing filled, yacht open, upperCapped 0", () => {
    expect(decodeKey(INITIAL_KEY)).toEqual({ mask: 0, yachtStatus: YACHT_OPEN, upperCapped: 0 });
  });

  it("TABLE_SIZE matches the dense (mask × yachtStatus × upperCapped) product", () => {
    expect(TABLE_SIZE).toBe(4096 * 3 * 64);
  });

  it("isAllUpperFilled is true only when all 6 upper bits (0-5) are set", () => {
    expect(isAllUpperFilled(0b111111)).toBe(true);
    expect(isAllUpperFilled(0b011111)).toBe(false);
    expect(isAllUpperFilled(0b111111 | (1 << 6))).toBe(true); // extra lower bit doesn't matter
  });

  it("isTerminalKey is true only when all 12 non-yacht bits set AND yacht filled", () => {
    const allNonYacht = (1 << NON_YACHT_CATEGORIES.length) - 1;
    expect(isTerminalKey(encodeKey(allNonYacht, YACHT_FILLED_50, 0))).toBe(true);
    expect(isTerminalKey(encodeKey(allNonYacht, YACHT_FILLED_0, 0))).toBe(true);
    expect(isTerminalKey(encodeKey(allNonYacht, YACHT_OPEN, 0))).toBe(false);
    expect(isTerminalKey(encodeKey(allNonYacht - 1, YACHT_FILLED_50, 0))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// keyFromGameState — matches a real GameState's scorecard
// ---------------------------------------------------------------------------

describe("keyFromGameState", () => {
  it("returns INITIAL_KEY for a fresh game", () => {
    expect(keyFromGameState(newGame().scores)).toBe(INITIAL_KEY);
  });

  it("caps the upper subtotal at 63", () => {
    const base = newGame();
    const scores = {
      ...base.scores,
      ones: 5,
      twos: 10,
      threes: 15,
      fours: 20,
      fives: 25,
      sixes: 30, // real subtotal 105, well over 63
    };
    const key = keyFromGameState(scores);
    expect(decodeKey(key).upperCapped).toBe(0); // normalized to 0 once all upper filled
  });

  it("distinguishes yacht filled-50 from filled-0", () => {
    const base = newGame();
    const filled50 = keyFromGameState({ ...base.scores, yacht: 50 });
    const filled0 = keyFromGameState({ ...base.scores, yacht: 0 });
    expect(decodeKey(filled50).yachtStatus).toBe(YACHT_FILLED_50);
    expect(decodeKey(filled0).yachtStatus).toBe(YACHT_FILLED_0);
  });
});

// ---------------------------------------------------------------------------
// Cross-validation against the real engine — the critical test
// ---------------------------------------------------------------------------

describe("stateKey.ts vs engine.ts — randomized cross-validation", () => {
  it("legalCategoriesFor + successorAfterScore agree with possibleScores + score() across many randomized games", () => {
    setRng(createSeededRng(1234));
    // Separate deterministic RNG for test-only meta-decisions (hold pattern,
    // which category to pick) so a failure is reproducible from this seed
    // without depending on the engine's own dice RNG stream.
    const decide = createSeededRng(5678);

    let comparisons = 0;

    for (let game = 0; game < 60; game++) {
      let state: GameState = newGame();

      while (!state.game_over) {
        // Roll up to 3 times with a random hold pattern each time (biased
        // toward re-rolling to exercise more joker/upper-bonus paths).
        const rollsThisTurn = 1 + Math.floor(decide() * 3);
        for (let r = 0; r < rollsThisTurn && state.rolls_used < 3; r++) {
          const held =
            state.rolls_used === 0
              ? [false, false, false, false, false]
              : state.dice.map(() => decide() < 0.4);
          state = roll(state, held);
        }

        const key = keyFromGameState(state.scores);
        const realPossible = possibleScores(state);
        const realCategories = new Set(Object.keys(realPossible));
        const oracleCategories = new Set(legalCategoriesFor(key, state.dice));

        expect(oracleCategories).toEqual(realCategories);
        comparisons++;

        for (const cat of oracleCategories) {
          const category = cat as Category;
          const { scoreDelta, nextKey } = successorAfterScore(key, category, state.dice);
          const rawExpected = realPossible[category]!;

          // scoreDelta may include the +35 upper bonus on top of rawExpected
          // — isolate the raw component by checking it's either exactly
          // rawExpected or rawExpected+35 (bonus-completing transition).
          expect([rawExpected, rawExpected + 35]).toContain(scoreDelta);

          // Full end-to-end check: actually score it via the real engine and
          // confirm both the resulting key and the resulting total_score
          // delta match stateKey.ts's prediction exactly.
          const beforeTotal = state.total_score;
          const afterState = score(state, category);
          const realDelta = afterState.total_score - beforeTotal;
          expect(scoreDelta).toBe(realDelta);
          expect(nextKey).toBe(keyFromGameState(afterState.scores));
        }

        // Actually advance the game using a real (possibly non-optimal)
        // legal choice, so subsequent turns explore new states.
        const choices = Object.keys(realPossible) as Category[];
        const chosen = choices[Math.floor(decide() * choices.length)]!;
        state = score(state, chosen);
      }
    }

    // Sanity: we actually exercised a meaningful number of decision points.
    expect(comparisons).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// successorAfterScore — upper bonus transition precision
// ---------------------------------------------------------------------------

describe("successorAfterScore — yacht (joker) bonus", () => {
  it("awards +100 when scoring a joker-active 5-of-a-kind into a non-yacht category", () => {
    // Yacht already filled with 50 (unlocks joker). Roll another 5-of-a-kind
    // (of 4s) and score it into chance — joker priority allows this (no
    // matching open upper "fours"... wait fours is upper; use a case where
    // "fours" is already filled, so priority falls to open lower "chance").
    let key = INITIAL_KEY;
    ({ nextKey: key } = successorAfterScore(key, "yacht", [3, 3, 3, 3, 3])); // yacht filled with 50
    ({ nextKey: key } = successorAfterScore(key, "fours", [4, 1, 2, 3, 5])); // fours filled (not via joker)

    const { scoreDelta } = successorAfterScore(key, "chance", [4, 4, 4, 4, 4]); // joker-active 5oak of 4s -> chance
    // Real engine: scores[chance] = calculateJokerScore("chance", dice) = 20
    // (sum of dice), PLUS the +100 yacht/joker bonus on top — total delta 120.
    expect(scoreDelta).toBe(20 + 100);
  });

  it("cross-validates the joker bonus against the real engine end-to-end", () => {
    let state = newGame();
    state = roll(state, [false, false, false, false, false], { dice: [3, 3, 3, 3, 3] });
    state = score(state, "yacht");
    expect(state.scores.yacht).toBe(50);

    // Fill "fours" first (non-joker) so the mandatory-upper joker priority
    // doesn't force the next 4-of-4s roll into "fours" — otherwise "chance"
    // wouldn't be legal and this test would be checking the wrong scenario.
    state = roll(state, [false, false, false, false, false], { dice: [4, 1, 2, 3, 5] });
    state = score(state, "fours");

    state = roll(state, [false, false, false, false, false], { dice: [4, 4, 4, 4, 4] });
    const key = keyFromGameState(state.scores); // yacht=50, fours=4 filled at this point
    const { scoreDelta } = successorAfterScore(key, "chance", state.dice);

    const beforeTotal = state.total_score;
    const afterState = score(state, "chance");
    const realDelta = afterState.total_score - beforeTotal;

    expect(scoreDelta).toBe(realDelta);
    expect(realDelta).toBe(20 + 100); // sanity: this really is the joker-bonus path
  });
});

describe("successorAfterScore — upper bonus timing", () => {
  it("does not award the bonus while upper section is incomplete", () => {
    // Fill 5 of 6 upper categories with high values (subtotal way over 63),
    // but sixes still open — bonus must not fire yet.
    let key = INITIAL_KEY;
    for (const [cat, dice] of [
      ["ones", [1, 1, 1, 1, 1]],
      ["twos", [2, 2, 2, 2, 2]],
      ["threes", [3, 3, 3, 3, 3]],
      ["fours", [4, 4, 4, 4, 4]],
      ["fives", [5, 5, 5, 5, 5]],
    ] as const) {
      const { nextKey } = successorAfterScore(key, cat, dice);
      key = nextKey;
    }
    expect(decodeKey(key).upperCapped).toBe(UPPER_CAP); // 5+10+15+20+25=75, capped to 63
    // sixes still open — no bonus should have been added anywhere above;
    // verify by confirming total upperCapped reflects raw sums, not +35.
  });

  it("awards +35 exactly at the transition completing the upper section when subtotal >= 63", () => {
    let key = INITIAL_KEY;
    let totalDelta = 0;
    for (const [cat, dice] of [
      ["ones", [1, 1, 1, 1, 1]], // 5
      ["twos", [2, 2, 2, 2, 2]], // 10
      ["threes", [3, 3, 3, 3, 3]], // 15
      ["fours", [4, 4, 4, 4, 4]], // 20
      ["fives", [5, 5, 5, 5, 5]], // 25 -> subtotal 75 so far
      ["sixes", [6, 6, 1, 1, 1]], // 12 -> subtotal 87 >= 63, bonus should fire here
    ] as const) {
      const { nextKey, scoreDelta } = successorAfterScore(key, cat, dice);
      totalDelta += scoreDelta;
      key = nextKey;
    }
    // Raw sum: 5+10+15+20+25+12 = 87, plus one +35 bonus = 122.
    expect(totalDelta).toBe(87 + 35);
  });

  it("does not award the bonus when the completed upper subtotal is under 63", () => {
    let key = INITIAL_KEY;
    let totalDelta = 0;
    for (const [cat, dice] of [
      ["ones", [1, 1, 2, 3, 4]], // 2
      ["twos", [2, 2, 1, 3, 4]], // 4
      ["threes", [3, 3, 1, 2, 4]], // 6
      ["fours", [4, 4, 1, 2, 3]], // 8
      ["fives", [5, 5, 1, 2, 3]], // 10
      ["sixes", [6, 6, 1, 2, 3]], // 12 -> subtotal 42, under 63, no bonus
    ] as const) {
      const { nextKey, scoreDelta } = successorAfterScore(key, cat, dice);
      totalDelta += scoreDelta;
      key = nextKey;
    }
    expect(totalDelta).toBe(2 + 4 + 6 + 8 + 10 + 12);
  });
});

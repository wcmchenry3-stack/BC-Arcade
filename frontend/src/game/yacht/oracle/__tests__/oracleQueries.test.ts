/**
 * oracle.ts public API tests (#2243) — end-to-end query logic against a
 * mocked table.
 *
 * An all-zero table is a VALID oracle table (every terminal state genuinely
 * has VTG=0), so mocking `oracleTable.generated` with all zeros lets these
 * tests exercise the real dynamic-import → decode → query code path while
 * keeping every expected value hand-computable: with all successor VTGs at
 * 0, optimalCategoryEVs/optimalHoldEVs reduce to plain immediate-score
 * expectations, independently checkable by hand.
 */

import { newGame } from "../../engine";
import type { GameState } from "../../types";

// jest.mock's factory can't close over out-of-scope variables (only
// "mock"-prefixed ones) — inline the table size literal (786,432 =
// stateKey.ts's TABLE_SIZE, cross-checked below) rather than importing it.
const MOCK_TABLE_SIZE = 786_432;

jest.mock(
  "../oracleTable.generated",
  () => ({
    ORACLE_TABLE_SIZE: 786_432,
    ORACLE_TABLE_BASE64: Buffer.from(new Float32Array(786_432).buffer).toString("base64"),
  }),
  { virtual: true }
);

// Imported AFTER the mock is registered so oracle.ts's dynamic import resolves to it.
import { optimalStateEV, optimalCategoryEVs, optimalHoldEVs } from "../oracle";
import { TABLE_SIZE } from "../stateKey";

it("MOCK_TABLE_SIZE matches the real TABLE_SIZE (guards the mock against drifting stale)", () => {
  expect(MOCK_TABLE_SIZE).toBe(TABLE_SIZE);
});

/** A scorecard with only "ones" open (all-zero table ⇒ scoring anything else terminates at VTG=0). */
function onesOnlyState(): GameState {
  const base = newGame();
  const scores: GameState["scores"] = { ...base.scores };
  for (const cat of Object.keys(scores)) {
    if (cat !== "ones") scores[cat] = 0; // filled with 0 for every other category
  }
  return { ...base, scores, dice: [1, 1, 2, 3, 4], rolls_used: 1 };
}

describe("optimalStateEV — against an all-zero mock table", () => {
  it("returns 0 for a fresh game (every terminal-adjacent slot is 0 by construction)", async () => {
    expect(await optimalStateEV(newGame())).toBe(0);
  });
});

describe("optimalCategoryEVs — against an all-zero mock table", () => {
  it("reduces to the raw immediate score when every successor VTG is 0", async () => {
    const state = onesOnlyState();
    const evs = await optimalCategoryEVs(state, state.dice);
    // Only "ones" is open; [1,1,2,3,4] scores 2 in ones, successor VTG is 0.
    expect(evs).toEqual({ ones: 2 });
  });

  it("returns one entry per legal category when multiple are open", async () => {
    const base = newGame();
    const state: GameState = { ...base, dice: [3, 3, 3, 5, 6], rolls_used: 1 };
    const evs = await optimalCategoryEVs(state, state.dice);
    // All 13 categories open on a fresh game; spot-check a few immediate scores.
    expect(evs.threes).toBe(9); // three 3s
    expect(evs.three_of_a_kind).toBe(20); // sum of all 5 dice (3+3+3+5+6)
    expect(evs.chance).toBe(20);
    expect(evs.full_house).toBe(0); // not a 2+3 split
    expect(Object.keys(evs)).toHaveLength(13);
  });
});

describe("optimalHoldEVs — against an all-zero mock table", () => {
  it("hand-checkable: holding both 1s and rerolling 3 dice (ones-only, 1 reroll left)", async () => {
    const state = onesOnlyState();
    const results = await optimalHoldEVs(state, state.dice, 1);

    // Holding [1,1] and rerolling 3 dice: EV = 2 (kept 1s) + E[count of new
    // 1s among 3 rerolled dice] = 2 + 3×(1/6) = 2.5 — since only "ones" is
    // open, only the count of 1s matters at all.
    const holdBothOnes = results.find((r) => r.hold.length === 2 && r.hold.every((v) => v === 1));
    expect(holdBothOnes).toBeDefined();
    expect(holdBothOnes!.ev).toBeCloseTo(2 + 3 * (1 / 6), 9);

    // Holding everything (no reroll): EV is just the immediate score, 2.
    const holdAll = results.find((r) => r.hold.length === 5);
    expect(holdAll).toBeDefined();
    expect(holdAll!.ev).toBe(2);

    // The best hold overall must be the one that rerolls everything except
    // the two 1s (maximizes expected future 1-count) — no hold should beat
    // holding both 1s and rerolling the rest, since discarding a kept 1
    // strictly reduces the guaranteed base score for a "only ones matter"
    // scenario.
    const best = results.reduce((a, b) => (b.ev > a.ev ? b : a));
    expect(best.hold.filter((v) => v === 1).length).toBe(2);
  });

  it("rerollsLeft=2 gives an EV at least as good as rerollsLeft=1 for the same dice", async () => {
    const state = onesOnlyState();
    const oneReroll = await optimalHoldEVs(state, state.dice, 1);
    const twoRerolls = await optimalHoldEVs(state, state.dice, 2);

    const best1 = Math.max(...oneReroll.map((r) => r.ev));
    const best2 = Math.max(...twoRerolls.map((r) => r.ev));
    expect(best2).toBeGreaterThanOrEqual(best1 - 1e-9);
  });

  it("throws for a dice array that isn't a valid 5-dice roll", async () => {
    const state = onesOnlyState();
    await expect(optimalHoldEVs(state, [1, 2, 3], 1)).rejects.toThrow();
  });
});

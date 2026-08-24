/**
 * regret.ts async-wrapper integration tests (#2244) — against the REAL
 * committed oracle table (no mocking), mirroring pinnedEV.test.ts's approach.
 *
 * Focus: Joker-turn fixtures. `categoryEvLoss`/`holdEvLoss` themselves are
 * agnostic to how the EV data was priced (regret.test.ts covers that with
 * fixed fixtures) — what needs an end-to-end check is that `computeCategoryEvLoss`/
 * `computeHoldEvLoss`, wired to the real oracle, correctly grade a Joker turn
 * (#2242 fixed a prior Joker-pricing bug in the live AI's own consideration
 * layer; this confirms the independent oracle-grading path prices it right too).
 */

import { newGame } from "../../engine";
import type { GameState } from "../../types";
import { computeCategoryEvLoss, computeHoldEvLoss } from "../regret";
import { optimalCategoryEVs, optimalHoldEVs } from "../oracle";

function jokerTurnState(fillFours: boolean): GameState {
  const base = newGame();
  const scores: GameState["scores"] = { ...base.scores };
  scores.yacht = 50; // yacht filled with 50 -> unlocks the Joker rule
  if (fillFours) scores.fours = 12; // matching-upper already filled -> priority falls through to lower cats
  return { ...base, scores, dice: [4, 4, 4, 4, 4], rolls_used: 3 };
}

describe("computeCategoryEvLoss — Joker turn, matching upper still open", () => {
  it("the only legal category is the matching upper ('fours'), graded as optimal", async () => {
    const state = jokerTurnState(false);
    const evs = await optimalCategoryEVs(state, state.dice);
    expect(Object.keys(evs)).toEqual(["fours"]); // Joker priority 1

    const result = await computeCategoryEvLoss(state, state.dice, "fours");
    expect(result.chosenEV).toBe(evs.fours);
    expect(result.optimalEV).toBe(evs.fours);
    expect(result.evLoss).toBe(0);
    expect(result.band).toBe("optimal");
    expect(result.optimalCategory).toBe("fours");
  });
});

describe("computeCategoryEvLoss — Joker turn, matching upper already filled", () => {
  it("falls through to open lower categories, priced via the Joker fixed-value rule", async () => {
    const state = jokerTurnState(true);
    const evs = await optimalCategoryEVs(state, state.dice);
    expect(evs.fours).toBeUndefined(); // no longer legal — already filled
    expect(evs.full_house).toBeDefined(); // Joker priority 2: open lower categories

    const result = await computeCategoryEvLoss(state, state.dice, "full_house");
    // Full House via Joker scores its fixed 25 + the +100 yacht/joker bonus,
    // regardless of the dice not being an actual 2+3 split — matches
    // optimalCategoryEVs' own number exactly (this IS that number, just
    // re-derived through the regret wrapper).
    expect(result.chosenEV).toBe(evs.full_house);
    expect(result.chosenEV).toBeGreaterThanOrEqual(125); // fixed Joker value (25) + bonus (100) is the floor

    const maxEv = Math.max(...Object.values(evs).filter((v): v is number => v !== undefined));
    expect(result.optimalEV).toBe(maxEv);
    expect(result.evLoss).toBeCloseTo(maxEv - evs.full_house!, 10);
  });
});

describe("computeHoldEvLoss — non-Joker turn (sanity: wrapper agrees with optimalHoldEVs' own max)", () => {
  it("holding everything is graded against the same max the raw oracle query reports", async () => {
    const state = newGame();
    const dice = [3, 3, 3, 5, 6];
    const holdEVs = await optimalHoldEVs(state, dice, 2);
    const maxEv = Math.max(...holdEVs.map((h) => h.ev));
    const holdAll = holdEVs.find((h) => h.hold.join(",") === "3,3,3,5,6")!;

    const result = await computeHoldEvLoss(state, dice, 2, [true, true, true, true, true]);
    expect(result.chosenEV).toBe(holdAll.ev);
    expect(result.optimalEV).toBe(maxEv);
    expect(result.evLoss).toBeCloseTo(maxEv - holdAll.ev, 10);
  });
});

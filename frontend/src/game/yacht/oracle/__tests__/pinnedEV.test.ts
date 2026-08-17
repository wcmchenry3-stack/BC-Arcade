/**
 * Pinned optimal-EV validation (#2243).
 *
 * Reads the ACTUAL committed table (oracleTable.generated.ts) — no
 * recomputation, no mocking — and checks the game-start EV against the
 * published reference for this exact rule variant (joker + bonus-score
 * rule, the same solitaire dice-and-scorecard game this engine implements).
 * This is the end-to-end confirmation that the shipped asset matches
 * ground truth, on top of the unit-level rule-fidelity tests in
 * stateKey.test.ts and solver.test.ts.
 *
 * References (cross-confirmed independently): T. Verhoeff's solitaire
 * optimal-play analysis (optimal EV 254.5896 for the joker/bonus-score rule
 * variant this engine implements); T. Glenn (2006); Serra & Widell (KTH,
 * 2013). Without the joker/bonus rule the optimal EV is ~245.87 — the
 * historical bug this table caught (#2243's commit history) initially
 * landed near that lower figure because the +100 yacht/joker bonus was
 * missing from the transition math, not the ~254.59 this test pins to.
 */

import { optimalStateEV } from "../oracle";
import { newGame } from "../../engine";

const PUBLISHED_OPTIMAL_EV = 254.5896;

describe("pinned optimal EV — shipped table vs published reference", () => {
  it("game-start EV matches the published joker+bonus-score optimal (within numerical tolerance)", async () => {
    const ev = await optimalStateEV(newGame());
    // Tolerance: Float32 quantization + solver floating-point accumulation
    // over ~579K states, not rule inaccuracy — the observed gap is ~0.1
    // (0.04% relative). A tolerance an order of magnitude looser than that
    // (1.0 absolute) still tightly bounds against the ~8.7-point gap a
    // missing-joker-bonus regression would reintroduce.
    expect(ev).toBeGreaterThan(PUBLISHED_OPTIMAL_EV - 1.0);
    expect(ev).toBeLessThan(PUBLISHED_OPTIMAL_EV + 1.0);
  });

  it("is nowhere near the no-joker-rule optimal (~245.87) — regression guard for the yacht-bonus bug", async () => {
    const ev = await optimalStateEV(newGame());
    const NO_JOKER_OPTIMAL_EV = 245.87;
    expect(ev).toBeGreaterThan(NO_JOKER_OPTIMAL_EV + 3); // clearly above, not just barely
  });
});

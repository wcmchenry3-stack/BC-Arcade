/**
 * Hearts sim gate — per-PR smoke layer (#2204, #2238).
 *
 * Runs the real gate pipeline (duplicate-deal harness → conditional
 * metrics → SPRT checks) at a tiny block cap, so every PR proves the gate
 * still runs end to end, every check still finds its data, and the
 * instrumented rates are still defined. It does not judge calibration:
 * at this size the checks are truncated and meaningless as verdicts. The
 * statistical gate is .github/workflows/hearts-sim-gate.yml, run on PRs
 * that touch the AI and nightly (`npx tsx scripts/simulate-hearts.ts
 * --gate`); see docs/TESTING.md.
 *
 * The #2204 fixes are guarded structurally: moon success is gated as the
 * paired rate (sim/__tests__/metrics.test.ts), and the corrected
 * Cautious-vs-Schemer direction (HRT-3) is a pre-registered separation
 * (sim/__tests__/gate.test.ts).
 */

import { setRng } from "../engine";
import { GATE_CHECKS, GATE_GROUPS, runGroup, type GroupRun } from "../sim/gate";

afterEach(() => setRng(Math.random));

describe("Hearts sim gate smoke", () => {
  const runs: GroupRun[] = Object.keys(GATE_GROUPS).map((group) =>
    runGroup(group, { maxBlocks: 12, minBlocks: 12, lookEvery: 12 })
  );

  it("evaluates every gate check, each to a decision", () => {
    const results = runs.flatMap((r) => r.results);
    expect(results.map((r) => r.check.id).sort()).toEqual(GATE_CHECKS.map((c) => c.id).sort());
    for (const r of results) expect(["pass", "fail"]).toContain(r.status);
  });

  it("observes every checked rate's denominator, and finite estimates", () => {
    for (const r of runs.flatMap((run) => run.results)) {
      if (r.check.kind === "regression") expect(r.den).toBeGreaterThan(0);
      expect(Number.isFinite(r.estimate.mean)).toBe(true);
    }
  });
});

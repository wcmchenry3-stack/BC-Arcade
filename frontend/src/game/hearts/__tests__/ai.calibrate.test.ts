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
 * Moon success is gated as the paired rate (#2204 HRT-1,
 * sim/__tests__/metrics.test.ts), and the persona difficulty ladder is a set
 * of pre-registered separations (#2555, sim/__tests__/gate.test.ts). HRT-3's
 * "the human does better against Schemers" held only while the ladder was
 * inverted; #2555 fixed the ladder, so the direction is now the opposite.
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

import { readFileSync } from "fs";
import { join } from "path";
import { createStream } from "../../../_shared/simRandom";
import { emptyCounters, type BlockRecord } from "../harness";
import {
  BASELINE,
  CHECK_ALPHA,
  FAMILY_ALPHA,
  GATE_CHECKS,
  GATE_GROUPS,
  GATE_MATCHUPS,
  REGRESSION_CHECKS,
  SEPARATION_CHECKS,
  checkRefs,
  evaluateCheck,
  formatCheck,
  groupOf,
  refKey,
  type Baseline,
  type RegressionCheck,
  type Runs,
  type SeparationCheck,
} from "../gate";

describe("gate definition", () => {
  it("has unique check ids", () => {
    const ids = GATE_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reads each check from exactly one group of real matchups", () => {
    for (const check of GATE_CHECKS) {
      expect(() => groupOf(check)).not.toThrow();
      for (const ref of checkRefs(check)) expect(GATE_MATCHUPS[ref.matchup]).toBeDefined();
    }
    for (const group of Object.values(GATE_GROUPS)) {
      for (const id of group.matchups) expect(GATE_MATCHUPS[id]).toBeDefined();
      expect(group.minBlocks).toBeLessThanOrEqual(group.maxBlocks);
    }
  });

  it("reads only roles that its matchup seats", () => {
    for (const check of GATE_CHECKS) {
      for (const ref of checkRefs(check)) {
        const roles = new Set(GATE_MATCHUPS[ref.matchup]!.lineups.flatMap((l) => l.roles));
        expect(roles).toContain(ref.role);
      }
    }
  });

  it("Bonferroni-corrects every check against the whole family", () => {
    expect(CHECK_ALPHA).toBeCloseTo(FAMILY_ALPHA / GATE_CHECKS.length, 15);
  });

  it("has a baseline value, with a logged denominator, for every regression check", () => {
    for (const check of REGRESSION_CHECKS) {
      const entry = BASELINE.metrics[refKey(check.ref)];
      expect(entry).toBeDefined();
      expect(entry!.den).toBeGreaterThan(0);
      expect(Number.isFinite(entry!.value)).toBe(true);
      // The baseline must be measured tightly compared with what the check detects.
      expect(entry!.se).toBeLessThan(check.delta / 4);
    }
  });

  it("pre-registers a signed, non-zero expectation for every separation", () => {
    for (const check of SEPARATION_CHECKS) expect(check.expected).not.toBe(0);
  });

  it("keeps HRT-3's corrected direction: the human does better against Schemers than Cautious players", () => {
    const hrt3 = SEPARATION_CHECKS.find(
      (c) =>
        c.left.matchup === "table-schemer" &&
        c.right.matchup === "table-cautious" &&
        c.left.role === "proxy" &&
        c.right.role === "proxy"
    );
    expect(hrt3?.expected).toBeGreaterThan(0);
  });

  it("gates the paired moon success rate (HRT-1)", () => {
    expect(REGRESSION_CHECKS.map((c) => c.ref.metric)).toContain("moon_success");
  });

  it("matches the workflow's job matrix", () => {
    const workflow = readFileSync(
      join(__dirname, "../../../../../../.github/workflows/hearts-sim-gate.yml"),
      "utf8"
    );
    const matrix = /group: \[([^\]]*)\]/.exec(workflow)?.[1] ?? "";
    expect(matrix.split(",").map((s) => s.trim())).toEqual(Object.keys(GATE_GROUPS));
  });
});

// ---------------------------------------------------------------------------
// evaluateCheck on synthetic block records
// ---------------------------------------------------------------------------

/** `blocks` blocks in which `role` wins each game with probability p. */
function winBlocks(
  role: string,
  p: number,
  blocks: number,
  seed: number,
  games = 1
): BlockRecord[] {
  const rng = createStream(seed);
  return Array.from({ length: blocks }, (_, index) => {
    const c = emptyCounters();
    c.seatGames = games;
    for (let g = 0; g < games; g++) c.winShare += rng() < p ? 1 : 0;
    return { index, roles: { [role]: c } };
  });
}

const regressionCheck: RegressionCheck = {
  kind: "regression",
  id: "t/proxy/win_share",
  ref: { matchup: "t", role: "proxy", metric: "win_share" },
  delta: 0.05,
};

const baseline: Baseline = {
  version: 1,
  reason: "test",
  generated: "2026-09-24",
  seed: 1,
  blocks: {},
  metrics: { "t/proxy/win_share": { value: 0.25, num: 250, den: 1000, se: 0.001 } },
  separations: {},
};

describe("evaluateCheck — regression", () => {
  it("passes at the baseline rate", () => {
    const r = evaluateCheck(
      regressionCheck,
      { t: winBlocks("proxy", 0.25, 6000, 1) },
      baseline,
      false
    );
    expect(r.status).toBe("pass");
    expect(r).toMatchObject({ den: 6000, target: 0.25 });
  });

  it("fails when the rate drops or rises by δ", () => {
    for (const p of [0.18, 0.32]) {
      const r = evaluateCheck(
        regressionCheck,
        { t: winBlocks("proxy", p, 6000, 2) },
        baseline,
        false
      );
      expect(r.status).toBe("fail");
    }
  });

  it("keeps sampling when the data can't tell yet, then truncates at the cap", () => {
    const runs = { t: winBlocks("proxy", 0.25, 40, 3) };
    expect(evaluateCheck(regressionCheck, runs, baseline, false).status).toBe("continue");
    const final = evaluateCheck(regressionCheck, runs, baseline, true);
    expect(final.truncated).toBe(true);
    expect(final.status).not.toBe("continue");
  });

  it("fails at the cap when the conditioning event never happened (0 denominator)", () => {
    const zero: Runs = {
      t: [
        { index: 0, roles: {} },
        { index: 1, roles: {} },
      ],
    };
    expect(evaluateCheck(regressionCheck, zero, baseline, false).status).toBe("continue");
    const r = evaluateCheck(regressionCheck, zero, baseline, true);
    expect(r.status).toBe("fail");
    expect(formatCheck(r)).toContain("denominator is 0");
  });

  it("refuses to run without a baseline entry", () => {
    expect(() =>
      evaluateCheck(regressionCheck, { t: [] }, { ...baseline, metrics: {} }, false)
    ).toThrow(/no entry/);
  });
});

describe("evaluateCheck — separation", () => {
  const separation: SeparationCheck = {
    kind: "separation",
    id: "t:a-over-b",
    description: "a outwins b",
    left: { matchup: "t", role: "a", metric: "win_share" },
    right: { matchup: "t", role: "b", metric: "win_share" },
    expected: 0.05,
  };

  function pairRuns(pa: number, pb: number, blocks: number, seed: number): Runs {
    const a = winBlocks("a", pa, blocks, seed, 3);
    const b = winBlocks("b", pb, blocks, seed + 1, 3);
    return { t: a.map((blk, i) => ({ index: i, roles: { ...blk.roles, ...b[i]!.roles } })) };
  }

  it("passes when the pre-registered separation holds (or is larger)", () => {
    expect(evaluateCheck(separation, pairRuns(0.3, 0.25, 4000, 10), baseline, true).status).toBe(
      "pass"
    );
    expect(evaluateCheck(separation, pairRuns(0.35, 0.25, 4000, 12), baseline, true).status).toBe(
      "pass"
    );
  });

  it("fails when the separation vanishes or reverses", () => {
    expect(evaluateCheck(separation, pairRuns(0.25, 0.25, 4000, 14), baseline, true).status).toBe(
      "fail"
    );
    expect(evaluateCheck(separation, pairRuns(0.2, 0.25, 4000, 16), baseline, true).status).toBe(
      "fail"
    );
  });

  it("reports a Bonferroni-adjusted CI", () => {
    const r = evaluateCheck(separation, pairRuns(0.3, 0.25, 2000, 18), baseline, true);
    const half = r.estimate.ciHigh - r.estimate.mean;
    expect(half / r.estimate.se).toBeGreaterThan(2.5); // z at 1 − 0.05/20 two-sided ≈ 3.02
  });
});

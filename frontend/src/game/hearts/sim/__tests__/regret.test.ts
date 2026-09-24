import { setRng } from "../../engine";
import { emptyCounters, fieldMatchup, personaPolicy, runBlock } from "../harness";
import {
  addTally,
  emptyTally,
  formatRegretReport,
  noiseLadder,
  oraclePolicy,
  pointsLostPer100,
  runRegretBlock,
  sampled,
  summarizeRole,
  type RegretBlock,
  type RegretTally,
} from "../regret";

afterEach(() => setRng(Math.random));

// A light reference keeps these tests fast; the default is 16 rollouts.
const FAST = { oracle: { moonCommit: 10, rollouts: 1, epsilon: 0 }, sampleEvery: 3 } as const;

const tally = (over: Partial<RegretTally>): RegretTally => ({ ...emptyTally(), ...over });

describe("runRegretBlock", () => {
  const matchup = fieldMatchup("t", personaPolicy("schemer"), [
    personaPolicy("cautious"),
    personaPolicy("daring"),
  ]);
  const graded = runRegretBlock(matchup, 11, 0, FAST);

  it("plays exactly the games runBlock plays: grading and noise tagging only observe", () => {
    expect(graded.roles).toEqual(runBlock(matchup, 11, 0).roles);
  });

  it("grades the test roles, not the field", () => {
    expect(Object.keys(graded.regret).sort()).toEqual(["cautious", "daring"]);
    for (const role of ["cautious", "daring"]) {
      const t = graded.regret[role]!;
      expect(t.hands).toBe(graded.roles[role]!.handsPlayed);
      expect(t.decisions).toBeGreaterThan(0);
      expect(Object.values(t.bands).reduce((a, b) => a + b, 0)).toBe(t.decisions);
      expect(t.regret).toBeGreaterThanOrEqual(0);
    }
  });

  it("tags noise plays: Cautious has some, Daring (0% noise) none", () => {
    expect(graded.regret.cautious!.noiseDecisions).toBeGreaterThan(0);
    expect(graded.regret.daring!.noiseDecisions).toBe(0);
    expect(graded.regret.daring!.noiseRegret).toBe(0);
    const c = graded.regret.cautious!;
    expect(c.noiseBlunders).toBeLessThanOrEqual(Math.min(c.noiseDecisions, c.bands.blunder));
  });

  it("grades about one play in sampleEvery", () => {
    const all = runRegretBlock(matchup, 11, 0, { ...FAST, sampleEvery: 1 });
    const every = all.regret.cautious!.decisions;
    const third = graded.regret.cautious!.decisions;
    expect(third).toBeGreaterThan(every / 3 / 1.5);
    expect(third).toBeLessThan((every / 3) * 1.5);
  });
});

describe("sampled", () => {
  it("picks about one play in `every` and grades everything at 1", () => {
    let picked = 0;
    for (let play = 0; play < 13000; play++) if (sampled(4, 1, 2, 0, 1, play)) picked++;
    expect(picked / 13000).toBeGreaterThan(0.23);
    expect(picked / 13000).toBeLessThan(0.27);
    expect(sampled(1, 1, 2, 0, 1, 5)).toBe(true);
  });

  it("doesn't lock onto one trick of every hand when `every` divides 13", () => {
    const tricks = new Set<number>();
    for (let play = 0; play < 13 * 40; play++)
      if (sampled(13, 1, 2, 0, 1, play)) tricks.add(play % 13);
    expect(tricks.size).toBeGreaterThan(8);
  });
});

describe("tallies and points lost", () => {
  it("adds tallies field by field", () => {
    const a = tally({ decisions: 2, regret: 3, hands: 1, noiseDecisions: 1, noiseRegret: 2 });
    a.bands.minor = 2;
    const b = tally({ decisions: 1, regret: 13, hands: 1 });
    b.bands.blunder = 1;
    addTally(a, b);
    expect(a).toEqual({
      decisions: 3,
      regret: 16,
      hands: 2,
      noiseDecisions: 1,
      noiseRegret: 2,
      noiseBlunders: 0,
      bands: { optimal: 0, minor: 2, mistake: 0, blunder: 1 },
    });
  });

  it("reports points lost per 100 hands, split into noise and deliberate, scaled for sampling", () => {
    const t = tally({ decisions: 10, regret: 6, hands: 4, noiseDecisions: 2, noiseRegret: 2 });
    expect(pointsLostPer100(t)).toBe(150);
    expect(pointsLostPer100(t, 1, "noise")).toBe(50);
    expect(pointsLostPer100(t, 1, "deliberate")).toBe(100);
    expect(pointsLostPer100(t, 4)).toBe(600);
    expect(pointsLostPer100(emptyTally())).toBe(0);
  });
});

/** A block whose roles carry the given regret tallies and win shares. */
function block(index: number, parts: Record<string, [RegretTally, number]>): RegretBlock {
  const roles: Record<string, ReturnType<typeof emptyCounters>> = {};
  const regret: Record<string, RegretTally> = {};
  for (const [role, [t, wins]] of Object.entries(parts)) {
    roles[role] = { ...emptyCounters(), seatGames: 3, winShare: wins, handsPlayed: t.hands };
    regret[role] = t;
  }
  return { index, roles, regret };
}

describe("summaries", () => {
  it("reports regret and win share independently: more points lost can still mean more wins", () => {
    const blocks = [
      block(0, {
        daring: [tally({ decisions: 30, regret: 30, hands: 10 }), 2],
        schemer: [tally({ decisions: 30, regret: 15, hands: 10 }), 0.5],
      }),
    ];
    const d = summarizeRole(blocks, "daring");
    const s = summarizeRole(blocks, "schemer");
    expect(d.per100Hands).toBeGreaterThan(s.per100Hands);
    expect(d.winShare).toBeGreaterThan(s.winShare);
    expect(d).toMatchObject({ decisions: 30, perDecision: 1, per100Hands: 300 });
    expect(d.winShare).toBeCloseTo(2 / 3);
  });

  it("splits a role's regret into noise and deliberate plays", () => {
    const t = tally({
      decisions: 10,
      regret: 8,
      hands: 5,
      noiseDecisions: 4,
      noiseRegret: 6,
      noiseBlunders: 1,
    });
    const r = summarizeRole([block(0, { cautious: [t, 1] })], "cautious");
    expect(r.noiseShare).toBeCloseTo(0.4);
    expect(r.perNoiseDecision).toBeCloseTo(1.5);
    expect(r.perDeliberateDecision).toBeCloseTo(2 / 6);
    expect(r.noisePer100Hands).toBeCloseTo(120);
    expect(r.noiseBlunderShare).toBeCloseTo(0.25);
  });

  it("checks the noise ladder step by step, paired by block", () => {
    const blocks = [0, 1, 2, 3, 4, 5].map((i) =>
      block(i, {
        cautious: [tally({ hands: 10, regret: 30 + i, noiseRegret: 20 + i }), 1],
        schemer: [tally({ hands: 10, regret: 20 + (i % 2), noiseRegret: 5 }), 1],
        daring: [tally({ hands: 10, regret: 25 - (i % 3), noiseRegret: 0 }), 1],
      })
    );
    const steps = noiseLadder(blocks);
    const find = (part: string, left: string) =>
      steps.find((s) => s.part === part && s.left === left)!;
    expect(find("all", "cautious").holds).toBe(true);
    expect(find("all", "schemer").holds).toBe(false); // Daring loses more in total here
    expect(find("noise", "cautious").holds).toBe(true);
    expect(find("noise", "schemer").holds).toBe(true);
    expect(find("noise", "schemer").estimate.mean).toBeCloseTo(50);
  });

  it("formats a report naming every role and ladder step", () => {
    const blocks = [0, 1].map((i) =>
      block(i, {
        cautious: [tally({ decisions: 5, hands: 2, regret: 3 + i }), 0],
        schemer: [tally({ decisions: 5, hands: 2, regret: 2 }), 1],
        daring: [tally({ decisions: 5, hands: 2, regret: 1 }), 2],
      })
    );
    const report = formatRegretReport(blocks, ["cautious", "schemer", "daring"]);
    for (const text of ["cautious", "schemer", "daring", "Noise ladder", "win share"]) {
      expect(report).toContain(text);
    }
  });
});

describe("oraclePolicy", () => {
  it("plays a legal card", () => {
    const matchup = fieldMatchup("o", personaPolicy("schemer"), [
      oraclePolicy("oracle", { moonCommit: 10, rollouts: 1, epsilon: 0 }),
    ]);
    // runBlock would throw on an illegal play (engine.playCard validates).
    expect(() => runBlock(matchup, 3, 0)).not.toThrow();
  });
});

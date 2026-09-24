import { getRng, setRng } from "../../engine";
import {
  COUNTER_KEYS,
  FIELD_ROLE,
  PROXY_ROLE,
  aiRotations,
  fieldMatchup,
  personaPolicy,
  playGame,
  presetMatchup,
  runBlock,
  winShares,
  type HeartsPolicy,
  type Policies,
} from "../harness";

const C = personaPolicy("cautious");
const S = personaPolicy("schemer");
const D = personaPolicy("daring");

afterEach(() => setRng(Math.random));

describe("duplicate-deal replay", () => {
  it("replays a game exactly from (seed, block)", () => {
    const lineup: Policies = [S, C, S, D];
    const a = playGame(lineup, 7, 3, { recordDeals: true });
    const b = playGame(lineup, 7, 3, { recordDeals: true });
    expect(b).toEqual(a);
  });

  it("deals every hand the same cards whoever sits where, however play went", () => {
    const a = playGame([S, C, C, C], 7, 3, { recordDeals: true });
    const b = playGame([S, D, D, D], 7, 3, { recordDeals: true });
    const hands = Math.min(a.deals!.length, b.deals!.length);
    expect(hands).toBeGreaterThan(3);
    // Different personas play differently (their games diverge)...
    expect(a.finalScores).not.toEqual(b.finalScores);
    // ...but every hand both games reached was dealt identically.
    for (let h = 0; h < hands; h++) expect(b.deals![h]).toEqual(a.deals![h]);
  });

  it("deals different cards in different blocks and seeds", () => {
    const base = playGame([S, S, S, S], 7, 3, { recordDeals: true }).deals![0];
    expect(playGame([S, S, S, S], 7, 4, { recordDeals: true }).deals![0]).not.toEqual(base);
    expect(playGame([S, S, S, S], 8, 3, { recordDeals: true }).deals![0]).not.toEqual(base);
  });

  it("gives each seat its own noise: a noisy neighbour doesn't change a seat's draws", () => {
    // A policy that records the first noise draw it sees each decision.
    const draws: number[][] = [[], [], [], []];
    const probe = (inner: HeartsPolicy): HeartsPolicy => ({
      ...inner,
      label: `probe-${inner.label}`,
      play: (hand, trick, state, seat) => {
        draws[seat]!.push(getRng()());
        return inner.play(hand, trick, state, seat);
      },
    });
    // Daring draws no noise itself, so the probe's k-th draw is the k-th value
    // of seat 1's stream — unless another seat's draws leak into it.
    playGame([S, probe(D), D, D], 5, 0);
    const quiet = draws[1]!.slice(0, 13); // hand 1: 13 plays
    draws.forEach((d) => (d.length = 0));
    // Seats 2-3 now Cautious, which draws noise on every decision.
    playGame([S, probe(D), C, C], 5, 0);
    expect(quiet).toHaveLength(13);
    expect(draws[1]!.slice(0, 13)).toEqual(quiet);
  });
});

describe("per-seat counters", () => {
  const games = [0, 1, 2, 3, 4].map((b) => playGame([S, C, S, D], 11, b));

  it("splits exactly one win per game", () => {
    for (const g of games) {
      expect(g.seats.reduce((s, c) => s + c.winShare, 0)).toBeCloseTo(1, 12);
      g.seats.forEach((c) => expect(c.seatGames).toBe(1));
    }
  });

  it("gives Q♠ to exactly one seat per hand and counts hands for every seat", () => {
    for (const g of games) {
      const hands = g.seats[0].handsPlayed;
      g.seats.forEach((c) => expect(c.handsPlayed).toBe(hands));
      expect(g.seats.reduce((s, c) => s + c.qsTaken, 0)).toBe(hands);
    }
  });

  it("records the final score as points", () => {
    for (const g of games) g.seats.forEach((c, i) => expect(c.points).toBe(g.finalScores[i]));
  });

  it("keeps every numerator within its denominator", () => {
    for (const g of games) {
      for (const c of g.seats) {
        expect(c.moonAttemptSuccesses).toBeLessThanOrEqual(c.moonAttempts);
        expect(c.moonAttemptSuccesses).toBeLessThanOrEqual(c.moonShots);
        expect(c.moonAttempts).toBeLessThanOrEqual(c.handsPlayed);
        expect(c.qsDumpsOnHuman).toBeLessThanOrEqual(c.qsDumps);
        expect(c.voidsCreated).toBeLessThanOrEqual(c.voidOpportunities);
        for (const k of COUNTER_KEYS) expect(c[k]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("only instruments moon attempts for Daring, and never dumps on the human from seat 0", () => {
    const totals = { daringAttempts: 0 };
    for (let b = 0; b < 12; b++) {
      const g = playGame([S, C, S, D], 12, b);
      expect(g.seats[1].moonAttempts + g.seats[2].moonAttempts + g.seats[0].moonAttempts).toBe(0);
      expect(g.seats[0].qsDumpsOnHuman).toBe(0);
      totals.daringAttempts += g.seats[3].moonAttempts;
    }
    expect(totals.daringAttempts).toBeGreaterThan(0);
  });

  it("reads 0/0 moon attempts for a custom policy without a persona", () => {
    const custom: HeartsPolicy = { ...D, label: "custom", persona: undefined };
    const g = playGame([S, custom, custom, custom], 13, 0);
    g.seats.forEach((c) => expect(c.moonAttempts).toBe(0));
  });
});

describe("winShares", () => {
  it("gives the lowest score the win and splits ties", () => {
    expect(winShares([40, 100, 55, 70])).toEqual([1, 0, 0, 0]);
    expect(winShares([40, 100, 40, 70])).toEqual([0.5, 0, 0.5, 0]);
  });
});

describe("matchups", () => {
  it("rotates a mixed line-up three ways and a uniform one once", () => {
    expect(aiRotations([C, S, D]).map((r) => r.map((p) => p.label))).toEqual([
      ["cautious", "schemer", "daring"],
      ["schemer", "daring", "cautious"],
      ["daring", "cautious", "schemer"],
    ]);
    expect(aiRotations([S, S, S])).toHaveLength(1);
  });

  it("keeps the human stand-in in seat 0 of every preset line-up", () => {
    const m = presetMatchup("m", S, [C, S, D]);
    for (const l of m.lineups) {
      expect(l.policies[0]).toBe(S);
      expect(l.roles[0]).toBe(PROXY_ROLE);
    }
  });

  it("puts each test persona in each AI seat once against a fixed field", () => {
    const m = fieldMatchup("f", S, [C, D]);
    expect(m.lineups).toHaveLength(6);
    for (const l of m.lineups) {
      const tests = l.roles.map((r, seat) => (r === FIELD_ROLE ? -1 : seat)).filter((s) => s >= 0);
      expect(tests).toHaveLength(1);
      expect(tests[0]).toBeGreaterThanOrEqual(1);
    }
    const seatsFor = (label: string) =>
      m.lineups
        .map((l) => l.roles.indexOf(label))
        .filter((s) => s >= 0)
        .sort();
    expect(seatsFor("cautious")).toEqual([1, 2, 3]);
    expect(seatsFor("daring")).toEqual([1, 2, 3]);
  });

  it("sums a block's counters by role", () => {
    const blk = runBlock(presetMatchup("m", S, [C, S, D]), 3, 0, { keepGames: true });
    expect(blk.games).toHaveLength(3);
    // Three games: one win shared out per game, across proxy + three AI roles.
    const wins = Object.values(blk.roles).reduce((s, c) => s + c.winShare, 0);
    expect(wins).toBeCloseTo(3, 12);
    expect(blk.roles[PROXY_ROLE]!.seatGames).toBe(3);
    // The proxy's "schemer" role is separate from the AI Schemer's.
    expect(blk.roles.schemer!.seatGames).toBe(3);
  });
});

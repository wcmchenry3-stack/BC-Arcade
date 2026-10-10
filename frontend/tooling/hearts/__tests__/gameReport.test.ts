/**
 * The whole-game report (#3162): a tiny seeded run returns every metric for
 * every matchup, the simulator-only bots play legal cards, the moon-shooter
 * shoots, and the sanity floor passes and fails as documented.
 */
import { getValidPlays, setRng } from "../../../src/game/hearts/engine";
import type { Card } from "../../../src/game/hearts/types";
import { moonShooterPolicy, randomLegalPolicy } from "../bots";
import {
  FIRE_FLAG_SHARE,
  PASS_PRINCIPLES,
  PLAY_PRINCIPLES,
  REPORT_METRICS,
  SANITY_FLOOR_MARGIN,
  evaluateSanityFloor,
  fireFlags,
  formatGameReportMarkdown,
  parseGamesArg,
  parseSeedArg,
  runGameReport,
  type GameReport,
  type MatchupReport,
  type MetricResult,
} from "../gameReport";
import { fieldMatchup, personaPolicy, playGame, runBlocks, type Policies } from "../harness";

afterEach(() => setRng(Math.random));

const IDS = [
  "random-legal",
  "conservative-mirror",
  "legacy-cautious",
  "legacy-schemer",
  "legacy-daring",
  "moon-shooter",
];

describe("runGameReport", () => {
  const report = runGameReport({ games: 6, seed: 11 });

  it("returns every metric for every matchup", () => {
    expect(report.matchups.map((m) => m.id)).toEqual(IDS);
    for (const m of report.matchups) {
      expect(m.games).toBeGreaterThanOrEqual(6);
      for (const metric of REPORT_METRICS) {
        expect(m.subject[metric.id]).toBeDefined();
        expect(m.opponent[metric.id]).toBeDefined();
      }
      // Conservative plays 52 cards a hand: some with a choice, some forced.
      expect(m.judgedPlays).toBeGreaterThan(0);
      expect(m.forcedPlays).toBeGreaterThan(0);
      expect(m.playFires.map((f) => f.principle)).toEqual(
        expect.arrayContaining([...PLAY_PRINCIPLES])
      );
      expect(m.passFires.map((f) => f.principle)).toEqual(
        expect.arrayContaining([...PASS_PRINCIPLES])
      );
      expect(m.playFires.reduce((s, f) => s + f.count, 0)).toBe(m.judgedPlays);
    }
    const ppH = report.matchups[0]!.subject["points_per_hand"]!;
    expect(ppH.den).toBeGreaterThan(0);
    expect(ppH.estimate).toBeCloseTo(ppH.num / ppH.den, 10);
  });

  it("runs the principle checker on the conservative seats of the moon-shooter matchup only", () => {
    for (const m of report.matchups) {
      if (m.id === "moon-shooter") {
        expect(m.principleCheck?.decisions).toBeGreaterThan(6 * 52);
        expect(m.principleCheck?.violations).toBe(0);
      } else {
        expect(m.principleCheck).toBeUndefined();
      }
    }
    expect(report.matchups[0]!.pointsPerHandAdvantage).toBeDefined();
  });

  it("is deterministic for a seed and differs for another", () => {
    expect(runGameReport({ games: 6, seed: 11 })).toEqual(report);
    expect(runGameReport({ games: 6, seed: 12 })).not.toEqual(report);
  });

  it("formats Markdown with the floor, matchups and moon guard", () => {
    const md = formatGameReportMarkdown(report);
    expect(md).toContain("## Sanity floor");
    for (const id of IDS) expect(md).toContain(id);
    expect(md).toContain("P7-MOON-GUARD");
  });

  it("rejects a bad size", () => {
    expect(() => runGameReport({ games: 0 })).toThrow(RangeError);
  });
});

describe("bots", () => {
  const legalOnly = (policies: Policies) => {
    let plays = 0;
    let passes = 0;
    playGame(policies, 5, 0, {
      onPass: (state, seat, cards) => {
        passes++;
        const hand = state.playerHands[seat]!;
        expect(cards).toHaveLength(3);
        expect(new Set(cards.map((c) => `${c.suit}${c.rank}`)).size).toBe(3);
        for (const c of cards) {
          expect(hand.some((h) => h.suit === c.suit && h.rank === c.rank)).toBe(true);
        }
      },
      onPlay: (state, seat, card) => {
        plays++;
        const legal = getValidPlays(state, seat);
        expect(legal.some((c: Card) => c.suit === card.suit && c.rank === card.rank)).toBe(true);
      },
    });
    expect(plays).toBeGreaterThan(52);
    expect(passes).toBeGreaterThan(0);
  };

  it("random-legal only plays legal cards, and replays exactly", () => {
    const r = randomLegalPolicy();
    legalOnly([r, r, r, r]);
    expect(playGame([r, r, r, r], 5, 1)).toEqual(playGame([r, r, r, r], 5, 1));
  });

  it("moon-shooter only plays legal cards", () => {
    const m = moonShooterPolicy();
    const r = randomLegalPolicy();
    legalOnly([r, m, r, m]);
    legalOnly([m, m, m, m]);
  });

  it("moon-shooter shoots the moon sometimes against random-legal", () => {
    const blocks = runBlocks(
      fieldMatchup("t", randomLegalPolicy(), [moonShooterPolicy()]),
      3162,
      0,
      40
    );
    const shots = blocks.reduce((s, b) => s + (b.roles["moon-shooter"]?.moonShots ?? 0), 0);
    expect(shots).toBeGreaterThan(0);
  });

  it("labels the bots so reports can tell them from personas", () => {
    const c = personaPolicy("conservative");
    const g = playGame([randomLegalPolicy(), c, c, moonShooterPolicy()], 9, 0);
    expect(g.labels).toEqual(["random-legal", "conservative", "conservative", "moon-shooter"]);
  });
});

describe("sanity floor", () => {
  const mr = (estimate: number): MetricResult => ({
    estimate,
    ciLow: estimate - 0.1,
    ciHigh: estimate + 0.1,
    num: 1,
    den: 1,
  });
  const stub = (id: string, extra: Partial<MatchupReport>): MatchupReport =>
    ({ id, ...extra }) as unknown as MatchupReport;
  const make = (
    margin: number | null,
    violations: number | null
  ): Pick<GameReport, "matchups"> => ({
    matchups: [
      stub("random-legal", margin === null ? {} : { pointsPerHandAdvantage: mr(margin) }),
      stub(
        "moon-shooter",
        violations === null ? {} : { principleCheck: { decisions: 10, violations, examples: [] } }
      ),
    ],
  });

  it("passes with a clear margin and no violations", () => {
    const f = evaluateSanityFloor(make(SANITY_FLOOR_MARGIN + 1, 0));
    expect(f.pass).toBe(true);
    expect(f.margin).toBe(SANITY_FLOOR_MARGIN);
  });

  it("passes exactly at the margin and fails just below it", () => {
    expect(evaluateSanityFloor(make(SANITY_FLOOR_MARGIN, 0)).pass).toBe(true);
    const f = evaluateSanityFloor(make(SANITY_FLOOR_MARGIN - 0.01, 0));
    expect(f.marginPass).toBe(false);
    expect(f.pass).toBe(false);
  });

  it("fails on any moon-shooter violation, however large the margin", () => {
    const f = evaluateSanityFloor(make(10, 1));
    expect(f.marginPass).toBe(true);
    expect(f.violationsPass).toBe(false);
    expect(f.pass).toBe(false);
  });

  it("fails when a matchup is missing", () => {
    expect(evaluateSanityFloor(make(null, 0)).pass).toBe(false);
    expect(evaluateSanityFloor(make(10, null)).pass).toBe(false);
  });

  it("takes the margin as a parameter", () => {
    expect(evaluateSanityFloor(make(1, 0), 0.5).pass).toBe(true);
    expect(evaluateSanityFloor(make(1, 0), 1.5).pass).toBe(false);
  });

  it("a tiny real run clears the floor", () => {
    expect(runGameReport({ games: 12, seed: 3162 }).sanityFloor.pass).toBe(true);
  });
});

describe("fireFlags", () => {
  const rows = (counts: Record<string, number>, base: number) =>
    Object.entries(counts).map(([principle, count]) => ({ principle, count, share: count / base }));

  it("flags principles that never fire or fire too often", () => {
    const flags = fireFlags([
      {
        judgedPlays: 100,
        playFires: rows({ "P1-DUCK": 100 * (FIRE_FLAG_SHARE + 0.1), "P2-FREE-TRICK": 20 }, 100),
        passFires: rows({ "P4-DANGER": 3, "P5-QUEEN": 3, "P6-DISCARD": 3 }, 9),
      },
    ]);
    const has = (k: string, w: string, p: string) =>
      flags.some((f) => f.kind === k && f.where === w && f.principle === p);
    expect(has("fires-often", "play", "P1-DUCK")).toBe(true);
    expect(has("never-fires", "play", "P7-MOON-GUARD")).toBe(true);
    expect(has("never-fires", "play", "P2-FREE-TRICK")).toBe(false);
    expect(flags.some((f) => f.where === "pass")).toBe(false);
  });
});

describe("arguments", () => {
  it("parses --games strictly", () => {
    expect(parseGamesArg(undefined, false)).toBeGreaterThan(0);
    expect(parseGamesArg("40", true)).toBe(40);
    for (const bad of [undefined, "", "0", "-3", "abc", "5abc", "1e3", "2.5"]) {
      expect(() => parseGamesArg(bad, true)).toThrow(RangeError);
    }
  });

  it("parses --seed strictly", () => {
    expect(parseSeedArg(undefined, false)).toBe(3162);
    expect(parseSeedArg("0", true)).toBe(0);
    expect(parseSeedArg("77", true)).toBe(77);
    for (const bad of [undefined, "", "-1", "x", "1e3", "007", "4294967296"]) {
      expect(() => parseSeedArg(bad, true)).toThrow(RangeError);
    }
  });
});

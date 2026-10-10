/**
 * The whole-game report (#3162): a tiny seeded run returns every metric for
 * every matchup, the simulator-only bots play legal cards, the moon-shooter
 * shoots, and the sanity floor passes and fails as documented.
 */
import { dealGame, getValidPlays, setRng } from "../../../src/game/hearts/engine";
import type { Card, HeartsState } from "../../../src/game/hearts/types";
import { moonShooterPolicy, randomLegalPolicy } from "../bots";
import {
  FIRE_FLAG_SHARE,
  PASS_PRINCIPLES,
  MAX_GAME_REPORT_GAMES,
  PLAY_PRINCIPLES,
  REPORT_METRICS,
  SANITY_FLOOR_MARGIN,
  emptyBlock,
  evaluateSanityFloor,
  exitCodeFor,
  fireFlags,
  formatGameReportMarkdown,
  gameHooks,
  parseGamesArg,
  parseSeedArg,
  runGameReport,
  wilson,
  type Probe,
  type GameReport,
  type MatchupReport,
  type PointsAdvantage,
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

describe("metric logic on hand-built final hands", () => {
  const c = (suit: Card["suit"], rank: Card["rank"]): Card => ({ suit, rank });
  const hearts = (...ranks: Card["rank"][]) => ranks.map((r) => c("hearts", r));
  const label = (subjects: number[]): Policies => {
    const mk = (seat: number) => ({
      ...personaPolicy("conservative"),
      label: subjects.includes(seat) ? "conservative" : "other",
    });
    return [mk(0), mk(1), mk(2), mk(3)];
  };
  const probe = (principle: string | null): Probe => ({
    sink: null,
    last: { principle },
    policy: personaPolicy("conservative"),
  });
  /** A mid-hand state where `seat` leads its only card and seat 3 alone holds 15 points. */
  const threatState = (
    seat: number,
    card: Card = c("clubs", 7),
    won: Card[][] = [[], [], [], []]
  ): HeartsState => ({
    ...dealGame("schemer"),
    phase: "playing",
    tricksPlayedInHand: 8,
    currentTrick: [],
    currentLeaderIndex: seat,
    currentPlayerIndex: seat,
    heartsBroken: true,
    playerHands: [0, 1, 2, 3].map((i) => (i === seat ? [card] : [])),
    wonCards: won,
    handScores: [0, 0, 0, 15],
  });
  /** The hand's last trick: seat 0 leads, seat 3 plays last. */
  const finalState = (
    trick: Card[],
    wonCards: Card[][],
    handScores: number[]
  ): { state: HeartsState; last: Card } => ({
    state: {
      ...dealGame("schemer"),
      phase: "playing",
      tricksPlayedInHand: 12,
      currentLeaderIndex: 0,
      currentPlayerIndex: 3,
      heartsBroken: true,
      currentTrick: trick.slice(0, 3).map((card, i) => ({ card, playerIndex: i })),
      playerHands: [[], [], [], [trick[3]!]],
      wonCards,
      handScores,
    },
    last: trick[3]!,
  });

  it("moon by a non-conservative seat: adjusted points, moons allowed (not its own), Q♠, P7 and threat", () => {
    const data = emptyBlock();
    const hooks = gameHooks(label([0, 1, 2]), data, probe("P7-MOON-GUARD"), false, { count: 0 });
    // At trick 9 seat 3 alone holds 15 points and 3 hearts; seat 1 holds the A♥, which no heart beats.
    hooks.onPlay!(threatState(1, c("hearts", 1), [[], [], [], hearts(2, 3, 4)]), 1, c("hearts", 1));
    // Seat 3 holds Q♠ and hearts A, 6-K; the last trick (2, 3, 4, 5 of hearts) is its too.
    const { state, last } = finalState(
      hearts(2, 3, 4, 5),
      [[], [], [], [...hearts(1, 6, 7, 8, 9, 10, 11, 12, 13), c("spades", 12)]],
      [0, 0, 0, 22]
    );
    hooks.onPlay!(state, 3, last);

    expect(data.subject).toMatchObject({
      hands: 3,
      handPoints: 78,
      zeroHands: 0,
      qsTaken: 0,
      moonShots: 0,
      moonsAllowed: 3,
      p7Hands: 1,
    });
    expect(data.opponent).toMatchObject({
      hands: 1,
      handPoints: 0,
      zeroHands: 1,
      qsTaken: 1,
      moonShots: 1,
      moonsAllowed: 0,
      p7Hands: 0,
    });
    const at9 = (n: number) => Array.from({ length: 13 }, (_, i) => (i === 8 ? n : 0));
    expect(data.opponentMoonHands).toBe(1);
    // Both triggers first fire at trick 9, in a hand that ends in a moon, with the means to stop it.
    for (const t of [data.cpuTrigger, data.heartsTrigger]) {
      expect(t.moon).toEqual({ hist: at9(1), canStop: 1 });
      expect(t.stopped).toEqual({ hist: at9(0), canStop: 0 });
    }
  });

  it("a recognized threat with no moon: raw points, Q♠ owner, stopped, no moon allowed", () => {
    const data = emptyBlock();
    const hooks = gameHooks(label([0, 1, 2]), data, probe("P1-DUCK"), false, { count: 0 });
    hooks.onPlay!(threatState(1), 1, c("clubs", 7));
    // Seat 0 leads 7♣ and wins it with three hearts on it; seat 1 holds Q♠.
    const { state, last } = finalState(
      [c("clubs", 7), ...hearts(2, 3), c("hearts", 4)],
      [[], [c("spades", 12)], [], hearts(1, 6, 7, 8, 9, 10, 11, 12, 13)],
      [0, 13, 0, 9]
    );
    hooks.onPlay!(state, 3, last);

    expect(data.subject).toMatchObject({
      hands: 3,
      handPoints: 3 + 13 + 0,
      zeroHands: 1,
      qsTaken: 1,
      moonShots: 0,
      moonsAllowed: 0,
      p7Hands: 0,
    });
    expect(data.opponent).toMatchObject({ hands: 1, handPoints: 9, qsTaken: 0, moonsAllowed: 0 });
    const at9 = Array.from({ length: 13 }, (_, i) => (i === 8 ? 1 : 0));
    expect(data.opponentMoonHands).toBe(0);
    // Only the CPU's trigger fires (no hearts taken yet); no heart in hand, so no means to stop it.
    expect(data.cpuTrigger.stopped).toEqual({ hist: at9, canStop: 0 });
    expect(data.cpuTrigger.moon.hist.every((n) => n === 0)).toBe(true);
    expect(data.heartsTrigger.stopped.hist.every((n) => n === 0)).toBe(true);
  });

  it("the hearts trigger needs 3 hearts, all by one non-conservative seat", () => {
    const fires = (won: Card[][], subjects: number[]) => {
      const data = emptyBlock();
      const hooks = gameHooks(label(subjects), data, probe("P1-DUCK"), false, { count: 0 });
      hooks.onPlay!(threatState(1, c("clubs", 7), won), 1, c("clubs", 7));
      // The hand never finishes here, so the trigger is not tallied; read the first play's effect via a full hand.
      const { state, last } = finalState(
        [c("clubs", 7), ...hearts(2, 3), c("hearts", 4)],
        [[], [], [], []],
        [0, 0, 0, 0]
      );
      hooks.onPlay!(state, 3, last);
      return [...data.heartsTrigger.moon.hist, ...data.heartsTrigger.stopped.hist].some(
        (n) => n > 0
      );
    };
    expect(fires([[], [], [], hearts(2, 3, 4)], [0, 1, 2])).toBe(true);
    expect(fires([[], [], [], hearts(2, 3)], [0, 1, 2])).toBe(false);
    expect(fires([[], [], hearts(5), hearts(2, 3)], [0, 1, 2])).toBe(false);
    expect(fires([[], [], [], hearts(2, 3, 4)], [0, 1, 2, 3])).toBe(false);
  });

  /** Plays the given mid-hand positions for seat 1, then a hand that ends with no moon. */
  const stoppedHand = (
    subjects: number[],
    mids: readonly { trick: number; card: Card; won?: Card[][] }[]
  ) => {
    const data = emptyBlock();
    const hooks = gameHooks(label(subjects), data, probe("P1-DUCK"), false, { count: 0 });
    for (const m of mids) {
      const state = { ...threatState(1, m.card, m.won), tricksPlayedInHand: m.trick - 1 };
      hooks.onPlay!(state, 1, m.card);
    }
    const { state, last } = finalState(
      [c("clubs", 7), ...hearts(2, 3), c("hearts", 4)],
      [[], [], [], []],
      [0, 0, 0, 0]
    );
    hooks.onPlay!(state, 3, last);
    return data;
  };
  const histAt = (trick: number) => Array.from({ length: 13 }, (_, i) => (i === trick - 1 ? 1 : 0));

  it("records the trick of the first recognition, not a later one", () => {
    const data = stoppedHand(
      [0, 1, 2],
      [
        { trick: 3, card: c("clubs", 7) },
        { trick: 5, card: c("clubs", 7) },
      ]
    );
    expect(data.cpuTrigger.stopped.hist).toEqual(histAt(3));
  });

  it("does not fire for a threat by a conservative seat", () => {
    const data = stoppedHand([0, 1, 2, 3], [{ trick: 3, card: c("clubs", 7) }]);
    expect(data.cpuTrigger.stopped.hist).toEqual(histAt(0));
    expect(data.cpuTrigger.moon.hist).toEqual(histAt(0));
  });

  it("can stop needs a heart that no out heart beats (one higher heart out is not enough)", () => {
    const won = [[], [], [], hearts(2, 3, 4)];
    // K♥ in hand, the A♥ still out: beatable.
    const beatable = stoppedHand([0, 1, 2], [{ trick: 9, card: c("hearts", 13), won }]);
    expect(beatable.cpuTrigger.stopped).toEqual({ hist: histAt(9), canStop: 0 });
    // A♥ in hand: nothing beats it.
    const top = stoppedHand([0, 1, 2], [{ trick: 9, card: c("hearts", 1), won }]);
    expect(top.cpuTrigger.stopped).toEqual({ hist: histAt(9), canStop: 1 });
  });

  it("credits P7 to the seat that played it", () => {
    const data = emptyBlock();
    // Only seat 1 is conservative; every other seat is an opponent.
    const hooks = gameHooks(label([1]), data, probe("P7-MOON-GUARD"), false, { count: 0 });
    hooks.onPlay!(threatState(1), 1, c("clubs", 7));
    const { state, last } = finalState(
      [c("clubs", 7), ...hearts(2, 3), c("hearts", 4)],
      [[], [], [], []],
      [0, 0, 0, 0]
    );
    hooks.onPlay!(state, 3, last);
    expect(data.subject).toMatchObject({ hands: 1, p7Hands: 1 });
    expect(data.opponent).toMatchObject({ hands: 3, p7Hands: 0 });
  });

  it("per group, summed hand points equal summed final scores, and hands match", () => {
    const r = runGameReport({ games: 8, seed: 21 });
    for (const m of r.matchups) {
      for (const g of [m.subject, m.opponent]) {
        expect(g["points_per_hand"]!.num).toBe(g["points_per_game"]!.num);
        // The mirror has no opponents.
        if (g === m.subject || m.id !== "conservative-mirror") {
          expect(g["points_per_hand"]!.den).toBeGreaterThan(0);
        }
      }
    }
  });

  it("trigger stats are consistent in a real run", () => {
    const r = runGameReport({ games: 12, seed: 8 });
    for (const m of r.matchups) {
      for (const t of [m.moonGuard.cpu, m.moonGuard.heartsTrigger]) {
        expect(t.hands).toBe(t.moon.hands + t.stoppedHands.hands);
        expect(t.moon.histogram).toHaveLength(13);
        expect(t.moon.histogram.reduce((a, b) => a + b, 0)).toBe(t.moon.hands);
        expect(t.stopped.k).toBe(t.stoppedHands.hands);
        for (const o of [t.moon, t.stoppedHands]) {
          if (o.hands > 0) {
            expect(o.meanTrick).toBeGreaterThanOrEqual(1);
            expect(o.meanTrick).toBeLessThanOrEqual(13);
            expect(o.medianTrick).toBeGreaterThanOrEqual(1);
          }
          expect(o.canStop.k).toBeLessThanOrEqual(o.hands);
        }
      }
      expect(m.moonGuard.cpu.moon.hands).toBeLessThanOrEqual(m.moonGuard.opponentMoons);
    }
  });

  it("wilson intervals stay informative at zero", () => {
    const z = wilson(0, 40);
    expect(z.rate).toBe(0);
    expect(z.low).toBe(0);
    expect(z.high).toBeGreaterThan(0.05);
    expect(z.high).toBeLessThan(0.15);
    const half = wilson(20, 40);
    expect(half.low).toBeLessThan(0.5);
    expect(half.high).toBeGreaterThan(0.5);
    expect(wilson(0, 0).high).toBe(1);
  });

  it("the report carries both operands of the sanity floor", () => {
    const a = runGameReport({ games: 6, seed: 5 }).matchups[0]!.pointsPerHandAdvantage!;
    expect(a.conservative.den).toBeGreaterThan(0);
    expect(a.opponent.den).toBeGreaterThan(0);
    // Totals are over blocks; the paired mean is close to the difference of the two rates.
    const diff = a.opponent.num / a.opponent.den - a.conservative.num / a.conservative.den;
    expect(a.estimate).toBeCloseTo(diff, 6);
  });
});

describe("sanity floor", () => {
  /** An advantage whose CI lower bound is `low` (the value the floor compares). */
  const mr = (low: number, estimate = low + 0.1): PointsAdvantage => ({
    conservative: { num: 1, den: 1 },
    opponent: { num: 1, den: 1 },
    estimate,
    ciLow: low,
    ciHigh: estimate + 0.1,
    blocks: 10,
  });
  const stub = (id: string, extra: Partial<MatchupReport>): MatchupReport =>
    ({ id, ...extra }) as unknown as MatchupReport;
  const make = (
    margin: number | null,
    violations: number | null,
    estimate?: number
  ): Pick<GameReport, "matchups"> => ({
    matchups: [
      stub("random-legal", margin === null ? {} : { pointsPerHandAdvantage: mr(margin, estimate) }),
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

  it("compares the CI lower bound, not the point estimate", () => {
    const f = evaluateSanityFloor(make(SANITY_FLOOR_MARGIN - 0.5, 0, SANITY_FLOOR_MARGIN + 2));
    expect(f.marginPass).toBe(false);
  });

  it("exits 1 when the floor fails and 0 when it holds (the CLI's exit code)", () => {
    expect(exitCodeFor({ sanityFloor: evaluateSanityFloor(make(10, 0)) })).toBe(0);
    expect(exitCodeFor({ sanityFloor: evaluateSanityFloor(make(0, 0)) })).toBe(1);
    expect(exitCodeFor({ sanityFloor: evaluateSanityFloor(make(10, 2)) })).toBe(1);
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
    expect(parseGamesArg(String(MAX_GAME_REPORT_GAMES), true)).toBe(MAX_GAME_REPORT_GAMES);
    for (const bad of [
      undefined,
      "",
      "0",
      "-3",
      "abc",
      "5abc",
      "1e3",
      "2.5",
      String(MAX_GAME_REPORT_GAMES + 1),
    ]) {
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

import {
  heartsSeatOrder,
  parseHeartsBreakdown,
  parseStarSwarmBreakdown,
  parseYachtBreakdown,
  splitSource,
} from "../breakdowns";

describe("parseHeartsBreakdown", () => {
  const ok = { hand_scores: [[0, 26, 26, 26]], final_scores: [0, 26, 26, 26], human_seat: 0 };

  it("parses a reconciled breakdown and finds the moon shooter", () => {
    const b = parseHeartsBreakdown(ok);
    expect(b?.reconciled).toBe(true);
    expect(b?.hands[0]?.moonSeat).toBe(0);
  });

  it.each([
    ["absent", {}],
    ["no hands", { ...ok, hand_scores: [] }],
    ["three seats", { ...ok, final_scores: [0, 26, 26] }],
    ["bad seat", { ...ok, human_seat: 4 }],
    ["non-integer delta", { ...ok, hand_scores: [[0, 26, 26, "26"]] }],
  ])("is null when %s", (_, metadata) => {
    expect(parseHeartsBreakdown(metadata)).toBeNull();
  });

  it("flags totals the hands don't add up to", () => {
    expect(parseHeartsBreakdown({ ...ok, final_scores: [1, 26, 26, 26] })?.reconciled).toBe(false);
  });

  it("finds the moon shooter when the human isn't seat 0", () => {
    const b = parseHeartsBreakdown({
      hand_scores: [
        [26, 26, 0, 26],
        [5, 5, 13, 3],
      ],
      final_scores: [31, 31, 13, 29],
      human_seat: 2,
    });
    expect(b?.humanSeat).toBe(2);
    expect(b?.hands[0]?.moonSeat).toBe(2);
    expect(b?.hands[1]?.moonSeat).toBeNull();
    expect(b?.reconciled).toBe(true);
  });

  it("orders the human first", () => {
    expect(heartsSeatOrder(2)).toEqual([2, 0, 1, 3]);
  });
});

describe("parseYachtBreakdown", () => {
  it("never counts an unfilled category as 0 filled", () => {
    const b = parseYachtBreakdown({ scorecard: { categories: { ones: 3 } } }, 3);
    expect(b?.player.categories.twos).toBeUndefined();
    expect(b?.player.complete).toBe(false);
    expect(b?.playerReconciled).toBe(true);
  });

  it("is not reconciled when its total differs from the final score", () => {
    expect(
      parseYachtBreakdown({ scorecard: { categories: { ones: 3 } } }, 5)?.playerReconciled
    ).toBe(false);
  });

  it.each([
    ["an upper bonus without the upper section filled", { upper_bonus: 35 }, 38],
    [
      "a Yacht bonus total that isn't 100 per bonus",
      { yacht_bonus_count: 1, yacht_bonus_total: 50 },
      53,
    ],
    ["a Yacht bonus without a Yacht", { yacht_bonus_count: 1, yacht_bonus_total: 100 }, 103],
  ])("is not reconciled with %s, even when the total matches", (_, extra, score) => {
    const b = parseYachtBreakdown({ scorecard: { categories: { ones: 3 }, ...extra } }, score);
    expect(b?.playerReconciled).toBe(false);
  });

  it("uses the server's flag only when there is no score to check the card against", () => {
    const md = { scorecard: { categories: { ones: 3 } }, scorecard_reconciled: false };
    expect(parseYachtBreakdown(md, 3)?.playerReconciled).toBe(true);
    expect(parseYachtBreakdown(md, null)?.playerReconciled).toBe(false);
  });

  it("checks each vs card against its own score", () => {
    const b = parseYachtBreakdown(
      {
        scorecard: { categories: { ones: 3 } },
        opponent_scorecard: { categories: { twos: 4 } },
        opponent_score: 6,
      },
      3
    );
    expect(b?.playerReconciled).toBe(true);
    expect(b?.opponentReconciled).toBe(false);
  });

  it("keeps a good player card beside a bad opponent card in vs", () => {
    const b = parseYachtBreakdown(
      {
        scorecard: { categories: { ones: 3 } },
        opponent_scorecard: { categories: { ones: -2 } },
        opponent_score: 10,
      },
      3
    );
    expect(b?.player.total).toBe(3);
    expect(b?.opponent).toBeNull();
    expect(b?.playerReconciled).toBe(true);
    expect(b?.opponentReconciled).toBe(true);
  });

  it.each([
    ["no card", {}],
    ["no categories", { scorecard: { upper_bonus: 35 } }],
    ["negative score", { scorecard: { categories: { ones: -1 } } }],
  ])("is null with %s", (_, metadata) => {
    expect(parseYachtBreakdown(metadata, 0)).toBeNull();
  });

  it("drops a malformed opponent card but keeps the player's", () => {
    const b = parseYachtBreakdown(
      { scorecard: { categories: { ones: 3 } }, opponent_scorecard: "junk" },
      3
    );
    expect(b?.opponent).toBeNull();
  });
});

describe("parseStarSwarmBreakdown", () => {
  it("is null for null, a newer version or a malformed wave", () => {
    expect(parseStarSwarmBreakdown({ score_breakdown: null }, 0)).toBeNull();
    expect(parseStarSwarmBreakdown({ score_breakdown: { v: 2, waves: [] } }, 0)).toBeNull();
    expect(
      parseStarSwarmBreakdown({ score_breakdown: { v: 1, waves: [{ wave: 1, total: 1 }] } }, 1)
    ).toBeNull();
  });

  it.each([
    ["not an object", "junk"],
    ["missing its span", { total: 10, pts: { Grunt: 10 } }],
    ["non-integer points", { first: 1, last: 2, total: 10, pts: { Grunt: "10" } }],
  ])("is null when `earlier` is %s", (_, earlier) => {
    expect(
      parseStarSwarmBreakdown({ score_breakdown: { v: 1, earlier, waves: [] } }, 10)
    ).toBeNull();
  });

  it("parses a zero-score run as an empty breakdown, not a missing one", () => {
    const md = { score_breakdown: { v: 1, waves: [] } };
    expect(parseStarSwarmBreakdown(md, 0)).toEqual({ rows: [], unattributed: 0, reconciled: true });
    expect(parseStarSwarmBreakdown(md, null)?.reconciled).toBe(true);
    expect(parseStarSwarmBreakdown(md, 500)?.reconciled).toBe(false);
  });

  it("sorts a wave's sources, highest first, and keeps unknown ones", () => {
    const b = parseStarSwarmBreakdown(
      {
        score_breakdown: {
          v: 1,
          waves: [
            { wave: 1, start: 0, end: 300, total: 300, pts: { Grunt: 100, "Guardian:dive": 200 } },
          ],
        },
      },
      300
    );
    expect(b?.rows[0]?.sources.map((s) => s.key)).toEqual(["Guardian:dive", "Grunt"]);
    expect(b?.reconciled).toBe(true);
  });

  it("splits a source into its base and modifier", () => {
    expect(splitSource("Elite:dive")).toEqual({ base: "Elite", mod: "dive" });
    expect(splitSource("clear")).toEqual({ base: "clear", mod: null });
  });
});

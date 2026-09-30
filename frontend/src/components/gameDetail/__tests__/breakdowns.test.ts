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

  it("orders the human first", () => {
    expect(heartsSeatOrder(2)).toEqual([2, 0, 1, 3]);
  });
});

describe("parseYachtBreakdown", () => {
  it("never counts an unfilled category as 0 filled", () => {
    const b = parseYachtBreakdown({ scorecard: { categories: { ones: 3 } } }, 3);
    expect(b?.player.categories.twos).toBeUndefined();
    expect(b?.player.complete).toBe(false);
    expect(b?.reconciled).toBe(true);
  });

  it("is not reconciled when its total differs from the final score", () => {
    expect(parseYachtBreakdown({ scorecard: { categories: { ones: 3 } } }, 5)?.reconciled).toBe(
      false
    );
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

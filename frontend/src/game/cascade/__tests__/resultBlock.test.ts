import { cascadeCompletion, cascadeResultBlock } from "../resultBlock";
import { CAPSTONE_TIER } from "../tiers";
import { BONUS_RULE, timeBonus } from "../timeBonus";

const PROGRESS: Parameters<typeof cascadeResultBlock>[0] = {
  mergeScore: 7_954,
  durationMs: 211_000,
  theme: "fruits",
  drops: 188,
  merges: 170,
  maxTier: 9,
};

describe("cascadeResultBlock (#3700)", () => {
  it("a win: the merge score, the time bonus, its sum as the score, won and the capstone", () => {
    const block = cascadeResultBlock(PROGRESS, "win");
    expect(block).toEqual({
      final_score: 7_954 + 12_417,
      merge_score: 7_954,
      time_bonus: 12_417,
      bonus_rule: BONUS_RULE,
      duration_ms: 211_000,
      theme: "fruits",
      total_drops: 188,
      total_merges: 170,
      max_tier: CAPSTONE_TIER,
      won: true,
      outcome: "win",
    });
    expect(block.time_bonus).toBe(timeBonus("win", 211_000));
  });

  it("a loss: no bonus, the merge score is the score", () => {
    const block = cascadeResultBlock(PROGRESS, "loss");
    expect(block).toMatchObject({
      final_score: 7_954,
      merge_score: 7_954,
      time_bonus: 0,
      max_tier: 9,
      won: false,
      outcome: "loss",
    });
  });

  it("a win under the 20 s floor earns no bonus but is still a win", () => {
    const block = cascadeResultBlock({ ...PROGRESS, durationMs: 5_000 }, "win");
    expect(block).toMatchObject({ final_score: 7_954, time_bonus: 0, won: true, outcome: "win" });
  });

  it.each([null, "abandoned", "completed"] as const)(
    "%s: no bonus and no outcome key (the column has it)",
    (end) => {
      const block = cascadeResultBlock(PROGRESS, end);
      expect(block).toMatchObject({ final_score: 7_954, time_bonus: 0, won: false });
      expect(block).not.toHaveProperty("outcome");
    }
  );

  it("cascadeCompletion: a finish sends the total as the score, with its outcome in the result", () => {
    const block = cascadeResultBlock(PROGRESS, "win");
    const { summary, payload } = cascadeCompletion(block, "win");
    expect(summary).toEqual({
      finalScore: 7_954 + 12_417,
      outcome: "win",
      durationMs: 211_000,
      result: { ...block, outcome: "win" },
    });
    expect(payload).toEqual(summary.result);
  });

  it("cascadeCompletion: an abandon's result is the snapshot block, with no outcome", () => {
    const block = cascadeResultBlock(PROGRESS, "abandoned");
    const { summary, payload } = cascadeCompletion(block, "abandoned");
    expect(summary.result).toBe(block);
    expect(summary.result).not.toHaveProperty("outcome");
    expect(payload).toEqual({ ...block, outcome: "abandoned" });
  });

  it("stays small: about 100 bytes more than the block before #3700", () => {
    const block = cascadeResultBlock(PROGRESS, "win");
    const before = {
      final_score: block.final_score,
      duration_ms: block.duration_ms,
      theme: block.theme,
      total_drops: block.total_drops,
      total_merges: block.total_merges,
      outcome: block.outcome,
    };
    const added = JSON.stringify(block).length - JSON.stringify(before).length;
    expect(added).toBeLessThanOrEqual(120);
  });
});

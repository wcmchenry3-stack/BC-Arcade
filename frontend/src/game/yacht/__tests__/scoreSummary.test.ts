import { newGame } from "../engine";
import { bestPotentialKey, soloSubtitle } from "../scoreSummary";
import type { GameState } from "../types";

const ORDER = ["ones", "twos", "threes", "chance"];

describe("bestPotentialKey", () => {
  it("is the row with the most points", () => {
    expect(bestPotentialKey({ ones: 3, twos: 12, chance: 9 }, ORDER)).toBe("twos");
  });

  it("is the first of equals, in scorecard order", () => {
    expect(bestPotentialKey({ twos: 8, ones: 8 }, ORDER)).toBe("ones");
  });

  it("is null when nothing is worth marking (every potential 0, or none)", () => {
    expect(bestPotentialKey({ ones: 0, twos: 0 }, ORDER)).toBeNull();
    expect(bestPotentialKey({}, ORDER)).toBeNull();
  });
});

function finished(over: Partial<GameState>): GameState {
  return { ...newGame(), game_over: true, ...over };
}

describe("soloSubtitle — what a finished solo game brags about (audit bug 12)", () => {
  it("a scored Yacht is not outranked by the upper bonus", () => {
    const s = finished({
      scores: { ...newGame().scores, yacht: 50 },
      upper_bonus: 35,
    });
    expect(soloSubtitle(s)).toEqual({ kind: "yachtScored", score: 50 });
  });

  it("Yacht bonuses (further five of a kinds) outrank a scored Yacht", () => {
    const s = finished({
      scores: { ...newGame().scores, yacht: 50 },
      upper_bonus: 35,
      yacht_bonus_count: 2,
      yacht_bonus_total: 200,
    });
    expect(soloSubtitle(s)).toEqual({ kind: "yachtBonus", count: 2, total: 200 });
  });

  it("the upper bonus is the line when there is no Yacht", () => {
    expect(soloSubtitle(finished({ upper_bonus: 35 }))).toEqual({ kind: "upperBonus" });
  });

  it("a Yacht row scratched with 0 is no Yacht", () => {
    const s = finished({ scores: { ...newGame().scores, yacht: 0 }, upper_bonus: 35 });
    expect(soloSubtitle(s)).toEqual({ kind: "upperBonus" });
  });

  it("is null with nothing to say", () => {
    expect(soloSubtitle(finished({}))).toBeNull();
  });
});

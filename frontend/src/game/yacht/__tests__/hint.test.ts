import { newGame } from "../engine";
import { bestCategory, suggestHint } from "../hint";
import { scoreCategories } from "../ai";
import type { GameState } from "../types";

function state(over: Partial<GameState> = {}): GameState {
  return { ...newGame(), ...over };
}

describe("suggestHint (#3748)", () => {
  it("has nothing to say before the first roll", () => {
    expect(suggestHint(state({ rolls_used: 0, dice: [0, 0, 0, 0, 0] }))).toBeNull();
  });

  it("has nothing to say once the game is over", () => {
    expect(
      suggestHint(state({ rolls_used: 3, dice: [1, 2, 3, 4, 5], game_over: true }))
    ).toBeNull();
  });

  it("before the last roll, names the dice to keep as a mask over the five dice", () => {
    const hint = suggestHint(state({ rolls_used: 1, dice: [6, 6, 6, 2, 3] }));
    expect(hint?.kind).toBe("hold");
    if (hint?.kind !== "hold") return;
    expect(hint.held).toHaveLength(5);
    // Three sixes are worth keeping from an empty card; the odd dice are not.
    expect(hint.held.slice(0, 3)).toEqual([true, true, true]);
    expect(hint.held.slice(3)).toEqual([false, false]);
  });

  it("keeps the matching dice wherever they sit among the five", () => {
    const hint = suggestHint(state({ rolls_used: 2, dice: [6, 2, 6, 3, 6] }));
    expect(hint?.kind).toBe("hold");
    if (hint?.kind !== "hold") return;
    expect(hint.held).toEqual([true, false, true, false, true]);
  });

  it("when the best play is to stop, names the row instead (a made yacht)", () => {
    expect(suggestHint(state({ rolls_used: 1, dice: [5, 5, 5, 5, 5] }))).toEqual({
      kind: "score",
      category: "yacht",
    });
  });

  it("when the best play is to stop, names the row instead (a made large straight)", () => {
    expect(suggestHint(state({ rolls_used: 2, dice: [1, 2, 3, 4, 5] }))).toEqual({
      kind: "score",
      category: "large_straight",
    });
  });

  it("after the third roll, always names a row", () => {
    expect(suggestHint(state({ rolls_used: 3, dice: [1, 2, 3, 4, 5] }))).toEqual({
      kind: "score",
      category: "large_straight",
    });
    expect(suggestHint(state({ rolls_used: 3, dice: [1, 1, 2, 3, 6] }))?.kind).toBe("score");
  });

  it("follows the Joker rule: a second five of a kind goes to its upper row", () => {
    const scores = { ...newGame().scores, yacht: 50 };
    expect(
      suggestHint(state({ rolls_used: 3, dice: [3, 3, 3, 3, 3], scores, upper_subtotal: 0 }))
    ).toEqual({ kind: "score", category: "threes" });
  });

  it("is deterministic: optimal play, no slips", () => {
    const s = state({ rolls_used: 1, dice: [2, 3, 3, 5, 6] });
    expect(suggestHint(s)).toEqual(suggestHint(s));
  });

  it("does not change the state it is given", () => {
    const s = state({ rolls_used: 2, dice: [2, 3, 3, 5, 6] });
    const before = JSON.stringify(s);
    suggestHint(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("bestCategory", () => {
  it("is the row with the highest optimal value (λ = 1)", () => {
    const s = state({ rolls_used: 3, dice: [4, 4, 4, 4, 2] });
    const best = bestCategory(s);
    const options = scoreCategories(s, 1);
    const max = Math.max(...options.map((o) => o.value));
    expect(options.find((o) => o.category === best)?.value).toBe(max);
  });
});

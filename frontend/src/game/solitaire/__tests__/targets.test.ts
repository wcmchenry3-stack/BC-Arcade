import { legalTargets } from "../targets";
import type { Card, Rank, SolitaireState, Suit } from "../types";

const up = (suit: Suit, rank: Rank): Card => ({ suit, rank, faceUp: true });
const down = (suit: Suit, rank: Rank): Card => ({ suit, rank, faceUp: false });

function board(overrides: Partial<SolitaireState> = {}): SolitaireState {
  return {
    _v: 1,
    drawMode: 1,
    tableau: [[], [], [], [], [], [], []],
    foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
    stock: [],
    waste: [],
    score: 0,
    recycleCount: 0,
    undoStack: [],
    isComplete: false,
    startedAt: null,
    accumulatedMs: 0,
    ...overrides,
  };
}

describe("legalTargets (#3606)", () => {
  it("is empty with no selection", () => {
    const t = legalTargets(board(), null);
    expect(t.cols.size).toBe(0);
    expect(t.suits.size).toBe(0);
  });

  it("a tableau card goes on the next rank up in the other colour", () => {
    const state = board({
      tableau: [
        [up("spades", 6)],
        [up("hearts", 7)],
        [up("clubs", 7)],
        [up("diamonds", 2)],
        [],
        [],
        [],
      ],
    });
    const t = legalTargets(state, { kind: "tableau", col: 0, index: 0 });
    expect([...t.cols]).toEqual([1]);
    expect(t.suits.size).toBe(0);
  });

  it("a run moves with its head card", () => {
    const state = board({
      tableau: [
        [down("clubs", 2), up("spades", 6), up("hearts", 5)],
        [up("diamonds", 7)],
        [up("clubs", 6)],
        [],
        [],
        [],
        [],
      ],
    });
    const t = legalTargets(state, { kind: "tableau", col: 0, index: 1 });
    expect([...t.cols]).toEqual([1]);
  });

  it("an empty column takes only a king", () => {
    const state = board({
      tableau: [[up("spades", 13)], [up("hearts", 7)], [], [], [], [], []],
      waste: [up("clubs", 5)],
    });
    expect(legalTargets(state, { kind: "waste" }).cols.size).toBe(0);
    const king = legalTargets(state, { kind: "tableau", col: 0, index: 0 });
    expect([...king.cols].sort()).toEqual([2, 3, 4, 5, 6]);
  });

  it("an ace on top goes to its own foundation", () => {
    const state = board({ tableau: [[up("hearts", 1)], [], [], [], [], [], []] });
    const t = legalTargets(state, { kind: "tableau", col: 0, index: 0 });
    expect([...t.suits]).toEqual(["hearts"]);
  });

  it("a buried card never goes to a foundation", () => {
    const state = board({ tableau: [[up("hearts", 3), up("spades", 1)], [], [], [], [], [], []] });
    // The 3 of hearts is not the top; and not next on the foundation either.
    expect(legalTargets(state, { kind: "tableau", col: 0, index: 0 }).suits.size).toBe(0);
  });

  it("the waste card goes to its foundation when it is next in the suit", () => {
    const state = board({
      foundations: { spades: [up("spades", 1)], hearts: [], diamonds: [], clubs: [] },
      waste: [up("spades", 2)],
    });
    expect([...legalTargets(state, { kind: "waste" }).suits]).toEqual(["spades"]);
    const notNext = board({ waste: [up("spades", 2)] });
    expect(legalTargets(notNext, { kind: "waste" }).suits.size).toBe(0);
  });

  it("a foundation card can go back onto a column it fits", () => {
    const state = board({
      foundations: {
        spades: [up("spades", 1), up("spades", 2)],
        hearts: [],
        diamonds: [],
        clubs: [],
      },
      tableau: [[up("hearts", 3)], [up("clubs", 3)], [], [], [], [], []],
    });
    const t = legalTargets(state, { kind: "foundation", suit: "spades" });
    expect([...t.cols]).toEqual([0]);
    expect(t.suits.size).toBe(0);
  });
});

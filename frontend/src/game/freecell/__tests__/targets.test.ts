import { validateMove } from "../engine";
import { legalTargets } from "../targets";
import type { Card, FreeCellState, FreeCells, Rank, Suit } from "../types";

const c = (suit: Suit, rank: Rank): Card => ({ suit, rank });

function board(overrides: Partial<FreeCellState> = {}): FreeCellState {
  return {
    _v: 1,
    tableau: [[], [], [], [], [], [], [], []],
    freeCells: [null, null, null, null],
    foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
    undoStack: [],
    isComplete: false,
    moveCount: 0,
    ...overrides,
  };
}

const full: FreeCells = [c("clubs", 13), c("clubs", 12), c("diamonds", 13), c("diamonds", 12)];

describe("legalTargets (#3607)", () => {
  it("is empty with no selection", () => {
    const t = legalTargets(board(), null);
    expect([t.cols.size, t.cells.size, t.suits.size]).toEqual([0, 0, 0]);
  });

  it("a top card: columns one rank up in the other colour (an empty one takes only a King), empty free cells", () => {
    const state = board({
      tableau: [
        [c("spades", 6)],
        [c("hearts", 7)],
        [c("clubs", 7)],
        [c("diamonds", 7)],
        [],
        [c("hearts", 2)],
        [c("spades", 9)],
        [c("hearts", 9)],
      ],
      freeCells: [c("clubs", 2), null, null, c("clubs", 3)],
    });
    const t = legalTargets(state, { kind: "tableau", col: 0, index: 0 });
    expect([...t.cols].sort()).toEqual([1, 3]);
    expect([...t.cells].sort()).toEqual([1, 2]);
    expect(t.suits.size).toBe(0);
  });

  it("an Ace's foundation is its own suit only", () => {
    const state = board({ tableau: [[c("hearts", 1)], [], [], [], [], [], [], []] });
    expect([...legalTargets(state, { kind: "tableau", col: 0, index: 0 }).suits]).toEqual([
      "hearts",
    ]);
  });

  it("a run is offered no free cell or foundation, and only columns its supermove capacity allows", () => {
    // A 3-card run 8♥ 7♠ 6♥ onto 9♣. With all four free cells full and no empty column the
    // capacity is (1 + 0) x 2^0 = 1, so the run cannot go; with one free cell open it is 2.
    const run = [c("spades", 13), c("hearts", 8), c("spades", 7), c("hearts", 6)];
    const tableau = [
      run,
      [c("clubs", 9)],
      [c("spades", 2)],
      [c("spades", 3)],
      [c("spades", 4)],
      [c("spades", 5)],
      [c("spades", 10)],
      [c("spades", 11)],
    ];
    const blocked = board({ tableau, freeCells: full });
    const t = legalTargets(blocked, { kind: "tableau", col: 0, index: 1 });
    expect(t.cols.size).toBe(0);
    expect(t.cells.size).toBe(0);
    expect(t.suits.size).toBe(0);

    // Two free cells open: (1 + 2) x 1 = 3 cards, so 9♣ takes the run.
    const open = board({ tableau, freeCells: [null, null, full[2], full[3]] });
    const t2 = legalTargets(open, { kind: "tableau", col: 0, index: 1 });
    expect([...t2.cols]).toEqual([1]);
    expect(t2.cells.size).toBe(0);
  });

  it("a free-cell card: columns and its foundation; never another free cell", () => {
    const state = board({
      tableau: [[c("spades", 3)], [], [c("hearts", 3)], [], [], [], [], []],
      freeCells: [c("hearts", 2), null, null, null],
      foundations: { spades: [], hearts: [c("hearts", 1)], diamonds: [], clubs: [] },
    });
    const t = legalTargets(state, { kind: "freecell", cell: 0 });
    expect([...t.cols]).toEqual([0]);
    expect(t.cells.size).toBe(0);
    expect([...t.suits]).toEqual(["hearts"]);
  });

  it("a foundation card: the columns it can go back to", () => {
    const state = board({
      tableau: [[c("spades", 3)], [c("hearts", 3)], [], [], [], [], [], []].map((p, i) =>
        i >= 2 ? [c("clubs", 13)] : p
      ),
      foundations: {
        spades: [],
        hearts: [c("hearts", 1), c("hearts", 2)],
        diamonds: [],
        clubs: [],
      },
    });
    expect([...legalTargets(state, { kind: "foundation", suit: "hearts" }).cols]).toEqual([0]);
  });

  it("agrees with validateMove for every column, on a dealt board", () => {
    const tableau = [
      [c("spades", 13), c("hearts", 12), c("clubs", 11)],
      [c("diamonds", 12)],
      [c("hearts", 10)],
      [],
      [c("clubs", 5)],
      [c("hearts", 4)],
      [c("spades", 1)],
      [c("diamonds", 11)],
    ];
    const state = board({ tableau });
    for (let col = 0; col < 8; col++) {
      for (let index = 0; index < tableau[col]!.length; index++) {
        const t = legalTargets(state, { kind: "tableau", col, index });
        for (let toCol = 0; toCol < 8; toCol++) {
          const ok =
            toCol !== col &&
            validateMove(state, {
              type: "tableau-to-tableau",
              fromCol: col,
              fromIndex: index,
              toCol,
            });
          expect(t.cols.has(toCol)).toBe(ok);
        }
      }
    }
  });
});

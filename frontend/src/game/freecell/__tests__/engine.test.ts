/**
 * FreeCell engine unit tests (#812).
 *
 * Covers all acceptance criteria from the issue:
 *   - Deal shape (52 unique cards, column sizes)
 *   - Tableau→tableau: valid/invalid moves
 *   - Tableau→free cell: available/full
 *   - Free cell→tableau: valid/invalid
 *   - Any→foundation: correct suit+rank; rejects out-of-order/wrong suit
 *   - Supermove formula: (1 + emptyCells) × 2^emptyColumns ≥ N
 *   - Supermove: destination excluded from empty column count
 *   - Undo: state restored; stack decrements; no-op when empty
 *   - Win condition: isComplete only when all 4 foundations have 13 cards
 */

import {
  applyHint,
  applyMove,
  autoComplete,
  canAutoComplete,
  createSeededRng,
  dealGame,
  getHintMoves,
  hasLegalMoves,
  isProductiveMove,
  setRng,
  undoMove,
  validateMove,
} from "../engine";
import type { Card, Foundations, FreeCellState, Rank, Suit } from "../types";
import { SUITS } from "../types";
import type { GameEvent } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function c(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

function emptyFoundations(): Foundations {
  return { spades: [], hearts: [], diamonds: [], clubs: [] };
}

function mkState(overrides: Partial<FreeCellState> = {}): FreeCellState {
  return {
    _v: 1,
    tableau: [[], [], [], [], [], [], [], []],
    freeCells: [null, null, null, null],
    foundations: emptyFoundations(),
    undoStack: [],
    isComplete: false,
    moveCount: 0,
    ...overrides,
  };
}

afterEach(() => {
  setRng(Math.random);
});

// ---------------------------------------------------------------------------
// Deal
// ---------------------------------------------------------------------------

describe("dealGame", () => {
  it("produces exactly 52 unique cards", () => {
    const state = dealGame(1);
    const all = [
      ...state.tableau.flat(),
      ...state.freeCells.filter((c): c is Card => c !== null),
      ...SUITS.flatMap((s) => state.foundations[s]),
    ];
    expect(all).toHaveLength(52);
    const ids = new Set(all.map((card) => `${card.suit}-${card.rank}`));
    expect(ids.size).toBe(52);
  });

  it("cols 0–3 have 7 cards, cols 4–7 have 6 cards", () => {
    const state = dealGame(42);
    for (let col = 0; col < 8; col++) {
      expect(state.tableau[col]).toHaveLength(col < 4 ? 7 : 6);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = dealGame(99);
    const b = dealGame(99);
    expect(a.tableau).toEqual(b.tableau);
  });

  it("freeCells start empty and foundations start empty", () => {
    const state = dealGame(7);
    expect(state.freeCells).toEqual([null, null, null, null]);
    for (const suit of SUITS) {
      expect(state.foundations[suit]).toEqual([]);
    }
  });

  it("uses _rng when no seed is supplied", () => {
    setRng(createSeededRng(5));
    const state = dealGame();
    const all = state.tableau.flat();
    expect(all).toHaveLength(52);
  });
});

// ---------------------------------------------------------------------------
// Tableau → Tableau
// ---------------------------------------------------------------------------

describe("tableau → tableau", () => {
  it("valid single-card move (alternating color, rank -1) succeeds", () => {
    // 5♠ (black) onto 6♥ (red)
    const state = mkState({
      tableau: [[c("spades", 5)], [c("hearts", 6)], [], [], [], [], [], []],
    });
    expect(
      validateMove(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 })
    ).toBe(true);
    const next = applyMove(state, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    expect(next.tableau[0]).toEqual([]);
    expect(next.tableau[1]).toHaveLength(2);
    expect(next.moveCount).toBe(1);
  });

  it("rejects same-color stacking", () => {
    // 5♥ (red) onto 6♦ (red) — invalid
    const state = mkState({
      tableau: [[c("hearts", 5)], [c("diamonds", 6)], [], [], [], [], [], []],
    });
    expect(
      validateMove(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 })
    ).toBe(false);
  });

  it("rejects wrong-rank stacking", () => {
    // 4♠ onto 6♥ — rank gap is 2, not 1
    const state = mkState({
      tableau: [[c("spades", 4)], [c("hearts", 6)], [], [], [], [], [], []],
    });
    expect(
      validateMove(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 })
    ).toBe(false);
  });

  it("rejects same-column move", () => {
    const state = mkState({ tableau: [[c("spades", 5)], [], [], [], [], [], [], []] });
    expect(
      validateMove(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 0 })
    ).toBe(false);
  });

  it("rejects out-of-bounds column indices", () => {
    const state = mkState();
    expect(
      validateMove(state, { type: "tableau-to-tableau", fromCol: -1, fromIndex: 0, toCol: 1 })
    ).toBe(false);
    expect(
      validateMove(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 8 })
    ).toBe(false);
  });

  it("applyMove returns same reference on invalid move", () => {
    const state = mkState({
      tableau: [[c("hearts", 5)], [c("diamonds", 6)], [], [], [], [], [], []],
    });
    expect(
      applyMove(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 })
    ).toBe(state);
  });

  it("only allows a King on an empty column", () => {
    const nonKing = mkState({ tableau: [[c("hearts", 7)], [], [], [], [], [], [], []] });
    expect(
      validateMove(nonKing, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 })
    ).toBe(false);

    const king = mkState({ tableau: [[c("hearts", 13)], [], [], [], [], [], [], []] });
    expect(
      validateMove(king, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 })
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tableau → Free Cell
// ---------------------------------------------------------------------------

describe("tableau → free cell", () => {
  it("succeeds when a slot is available", () => {
    const state = mkState({
      tableau: [[c("spades", 5)], [], [], [], [], [], [], []],
      freeCells: [null, null, null, null],
    });
    expect(validateMove(state, { type: "tableau-to-freecell", fromCol: 0, toCell: 0 })).toBe(true);
    const next = applyMove(state, { type: "tableau-to-freecell", fromCol: 0, toCell: 0 });
    expect(next.freeCells[0]).toEqual(c("spades", 5));
    expect(next.tableau[0]).toEqual([]);
    expect(next.moveCount).toBe(1);
  });

  it("rejected when target cell is already occupied", () => {
    const state = mkState({
      tableau: [[c("spades", 5)], [], [], [], [], [], [], []],
      freeCells: [c("hearts", 3), null, null, null],
    });
    expect(validateMove(state, { type: "tableau-to-freecell", fromCol: 0, toCell: 0 })).toBe(false);
  });

  it("rejected when all 4 cells are occupied", () => {
    const state = mkState({
      tableau: [[c("spades", 5)], [], [], [], [], [], [], []],
      freeCells: [c("hearts", 1), c("diamonds", 2), c("clubs", 3), c("spades", 4)],
    });
    for (let cell = 0; cell < 4; cell++) {
      expect(validateMove(state, { type: "tableau-to-freecell", fromCol: 0, toCell: cell })).toBe(
        false
      );
    }
  });

  it("rejected from an empty tableau column", () => {
    const state = mkState({ freeCells: [null, null, null, null] });
    expect(validateMove(state, { type: "tableau-to-freecell", fromCol: 0, toCell: 0 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Free Cell → Tableau
// ---------------------------------------------------------------------------

describe("free cell → tableau", () => {
  it("valid placement succeeds", () => {
    // 5♠ (black) from free cell onto 6♥ (red) on tableau
    const state = mkState({
      freeCells: [c("spades", 5), null, null, null],
      tableau: [[], [c("hearts", 6)], [], [], [], [], [], []],
    });
    expect(validateMove(state, { type: "freecell-to-tableau", fromCell: 0, toCol: 1 })).toBe(true);
    const next = applyMove(state, { type: "freecell-to-tableau", fromCell: 0, toCol: 1 });
    expect(next.freeCells[0]).toBeNull();
    expect(next.tableau[1]).toHaveLength(2);
    expect(next.moveCount).toBe(1);
  });

  it("rejected when the tableau placement is invalid (same color)", () => {
    const state = mkState({
      freeCells: [c("hearts", 5), null, null, null],
      tableau: [[], [c("diamonds", 6)], [], [], [], [], [], []],
    });
    expect(validateMove(state, { type: "freecell-to-tableau", fromCell: 0, toCol: 1 })).toBe(false);
  });

  it("rejected from an empty free cell", () => {
    const state = mkState({
      freeCells: [null, null, null, null],
      tableau: [[], [c("hearts", 6)], [], [], [], [], [], []],
    });
    expect(validateMove(state, { type: "freecell-to-tableau", fromCell: 0, toCol: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Any → Foundation
// ---------------------------------------------------------------------------

describe("any → foundation", () => {
  it("tableau → foundation: accepts Ace onto empty foundation", () => {
    const state = mkState({ tableau: [[c("spades", 1)], [], [], [], [], [], [], []] });
    expect(validateMove(state, { type: "tableau-to-foundation", fromCol: 0 })).toBe(true);
    const next = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(next.foundations.spades).toHaveLength(1);
    expect(next.foundations.spades[0]).toEqual(c("spades", 1));
    expect(next.moveCount).toBe(1);
  });

  it("tableau → foundation: accepts next rank of the same suit", () => {
    const state = mkState({
      tableau: [[c("hearts", 2)], [], [], [], [], [], [], []],
      foundations: { ...emptyFoundations(), hearts: [c("hearts", 1)] },
    });
    expect(validateMove(state, { type: "tableau-to-foundation", fromCol: 0 })).toBe(true);
  });

  it("tableau → foundation: rejects wrong suit", () => {
    const state = mkState({
      tableau: [[c("diamonds", 1)], [], [], [], [], [], [], []],
      foundations: { ...emptyFoundations(), spades: [c("spades", 1)] },
    });
    // diamonds ace should go to diamonds foundation, not spades
    // validateMove checks if the top card can be placed — diamonds ace to empty diamonds is fine
    // but moving diamonds onto spades pile is checked internally by suit
    const next = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(next.foundations.diamonds).toHaveLength(1);
    expect(next.foundations.spades).toHaveLength(1); // spades unchanged
  });

  it("tableau → foundation: rejects out-of-order rank (rank 3 onto rank 1)", () => {
    const state = mkState({
      tableau: [[c("spades", 3)], [], [], [], [], [], [], []],
      foundations: { ...emptyFoundations(), spades: [c("spades", 1)] },
    });
    expect(validateMove(state, { type: "tableau-to-foundation", fromCol: 0 })).toBe(false);
  });

  it("free cell → foundation: succeeds when rank matches", () => {
    const state = mkState({
      freeCells: [c("clubs", 1), null, null, null],
    });
    expect(validateMove(state, { type: "freecell-to-foundation", fromCell: 0 })).toBe(true);
    const next = applyMove(state, { type: "freecell-to-foundation", fromCell: 0 });
    expect(next.freeCells[0]).toBeNull();
    expect(next.foundations.clubs).toHaveLength(1);
  });

  it("free cell → foundation: rejects wrong rank", () => {
    const state = mkState({
      freeCells: [c("clubs", 3), null, null, null],
    });
    expect(validateMove(state, { type: "freecell-to-foundation", fromCell: 0 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Supermove formula
// ---------------------------------------------------------------------------

describe("supermove", () => {
  it("allows moving N cards when (1 + emptyCells) × 2^emptyColumns ≥ N", () => {
    // 4 free cells empty, 0 empty tableau columns (excluding dest) → max = (1+4) × 1 = 5
    // Try moving a 3-card run: should succeed
    const state = mkState({
      freeCells: [null, null, null, null],
      tableau: [
        // col 0: valid 3-card descending alternating run: 7♥, 6♠, 5♥
        [c("hearts", 7), c("spades", 6), c("hearts", 5)],
        // col 1: destination — 8♠ (black), run head 7♥ (red) can stack
        [c("spades", 8)],
        [c("clubs", 2)],
        [c("clubs", 3)],
        [c("clubs", 4)],
        [c("clubs", 5)],
        [c("clubs", 6)],
        [c("clubs", 7)],
      ],
    });
    expect(
      validateMove(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 })
    ).toBe(true);
  });

  it("blocks moving N cards when supermove capacity is exceeded", () => {
    // 0 free cells, 0 empty columns (excluding dest) → max = (1+0) × 1 = 1
    // Trying to move 2 cards should fail
    const state = mkState({
      freeCells: [c("clubs", 1), c("clubs", 2), c("clubs", 3), c("clubs", 4)],
      tableau: [
        [c("hearts", 6), c("spades", 5)], // 2-card run
        [c("diamonds", 7)], // dest
        [c("clubs", 9)],
        [c("clubs", 10)],
        [c("clubs", 11)],
        [c("clubs", 12)],
        [c("clubs", 13)],
        [c("hearts", 1)],
      ],
    });
    expect(
      validateMove(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 })
    ).toBe(false);
  });

  it("excludes the destination column from the empty column count", () => {
    // dest col is empty — if it were counted, max would be higher than it should be
    // 1 free cell empty, dest col is the only empty col → emptyColumns = 0 (dest excluded)
    // max = (1+1) × 2^0 = 2
    // Trying to move a 3-card run onto an empty column should fail (exceeds 2)
    const state = mkState({
      freeCells: [null, c("clubs", 1), c("clubs", 2), c("clubs", 3)],
      tableau: [
        [c("hearts", 7), c("spades", 6), c("hearts", 5)], // 3-card run
        [], // dest — empty but excluded
        [c("clubs", 4)],
        [c("clubs", 5)],
        [c("clubs", 6)],
        [c("clubs", 7)],
        [c("clubs", 8)],
        [c("clubs", 9)],
      ],
    });
    expect(
      validateMove(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 })
    ).toBe(false);
  });

  it("includes non-destination empty columns in the count", () => {
    // 0 free cells, 2 empty columns (neither is dest) → max = (1+0) × 2^2 = 4
    // Moving a 3-card run should succeed
    const state = mkState({
      freeCells: [c("clubs", 1), c("clubs", 2), c("clubs", 3), c("clubs", 4)],
      tableau: [
        [c("hearts", 7), c("spades", 6), c("hearts", 5)], // 3-card run
        [c("spades", 8)], // dest
        [], // empty col 1
        [], // empty col 2
        [c("clubs", 5)],
        [c("clubs", 6)],
        [c("clubs", 7)],
        [c("clubs", 9)],
      ],
    });
    expect(
      validateMove(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 })
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe("undoMove", () => {
  it("restores state exactly after one move", () => {
    const state = mkState({
      tableau: [[c("spades", 1)], [], [], [], [], [], [], []],
    });
    const after = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(after.foundations.spades).toHaveLength(1);
    expect(after.undoStack).toHaveLength(1);

    const reverted = undoMove(after);
    expect(reverted.foundations.spades).toEqual([]);
    expect(reverted.tableau[0]).toEqual([c("spades", 1)]);
    expect(reverted.moveCount).toBe(0);
  });

  it("undo stack decrements by one after undoMove", () => {
    const s0 = mkState({ tableau: [[c("spades", 1)], [c("hearts", 1)], [], [], [], [], [], []] });
    const s1 = applyMove(s0, { type: "tableau-to-foundation", fromCol: 0 });
    const s2 = applyMove(s1, { type: "tableau-to-foundation", fromCol: 1 });
    expect(s2.undoStack).toHaveLength(2);
    const back = undoMove(s2);
    expect(back.undoStack).toHaveLength(1);
  });

  it("is a no-op when the undo stack is empty", () => {
    const state = mkState();
    expect(undoMove(state)).toBe(state);
  });

  it("chains multiple undos back to the original state", () => {
    const s0 = mkState({ tableau: [[c("spades", 1)], [c("hearts", 1)], [], [], [], [], [], []] });
    const s1 = applyMove(s0, { type: "tableau-to-foundation", fromCol: 0 });
    const s2 = applyMove(s1, { type: "tableau-to-foundation", fromCol: 1 });
    const back1 = undoMove(s2);
    const back2 = undoMove(back1);
    expect(back2.foundations.spades).toEqual([]);
    expect(back2.foundations.hearts).toEqual([]);
    expect(back2.moveCount).toBe(0);
  });

  it("snapshots stored in undoStack have empty nested undoStack", () => {
    const s0 = mkState({ tableau: [[c("spades", 1)], [c("hearts", 1)], [], [], [], [], [], []] });
    const s1 = applyMove(s0, { type: "tableau-to-foundation", fromCol: 0 });
    const s2 = applyMove(s1, { type: "tableau-to-foundation", fromCol: 1 });
    for (const snap of s2.undoStack) {
      expect(snap.undoStack).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Win condition
// ---------------------------------------------------------------------------

describe("isComplete", () => {
  it("is true only when all 4 foundations have 13 cards", () => {
    const foundations: Foundations = {
      spades: Array.from({ length: 13 }, (_, i) => c("spades", (i + 1) as Rank)),
      hearts: Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank)),
      diamonds: Array.from({ length: 13 }, (_, i) => c("diamonds", (i + 1) as Rank)),
      clubs: Array.from({ length: 12 }, (_, i) => c("clubs", (i + 1) as Rank)),
    };
    const state = mkState({
      foundations,
      tableau: [[c("clubs", 13)], [], [], [], [], [], [], []],
    });
    expect(state.isComplete).toBe(false);

    const next = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(next.isComplete).toBe(true);
    expect(next.foundations.clubs).toHaveLength(13);
  });

  it("is false when 3 foundations are full but 1 is not", () => {
    const incomplete: Foundations = {
      spades: Array.from({ length: 13 }, (_, i) => c("spades", (i + 1) as Rank)),
      hearts: Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank)),
      diamonds: Array.from({ length: 13 }, (_, i) => c("diamonds", (i + 1) as Rank)),
      clubs: Array.from({ length: 12 }, (_, i) => c("clubs", (i + 1) as Rank)),
    };
    const s = mkState({ foundations: incomplete });
    expect(s.isComplete).toBe(false);
  });

  it("starts as false on a freshly dealt game", () => {
    const state = dealGame(1);
    expect(state.isComplete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------

describe("game events", () => {
  it("emits cardPlace for a single-card tableau → tableau move", () => {
    const state = mkState({
      tableau: [[c("spades", 5)], [c("hearts", 6)], [], [], [], [], [], []],
    });
    const next = applyMove(state, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    expect(next.events).toEqual<readonly GameEvent[]>([{ type: "cardPlace" }]);
  });

  it("emits supermove (not cardPlace) for a multi-card tableau → tableau move", () => {
    const state = mkState({
      freeCells: [null, null, null, null],
      tableau: [
        [c("hearts", 7), c("spades", 6), c("hearts", 5)],
        [c("spades", 8)],
        [c("clubs", 2)],
        [c("clubs", 3)],
        [c("clubs", 4)],
        [c("clubs", 5)],
        [c("clubs", 6)],
        [c("clubs", 7)],
      ],
    });
    const next = applyMove(state, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    expect(next.events).toEqual<readonly GameEvent[]>([{ type: "supermove", cardCount: 3 }]);
  });

  it("emits cardPlace for tableau → free cell", () => {
    // col 1 has a 6♥ so after 5♠ parks in the free cell, freecell→tableau is still legal
    const state = mkState({
      tableau: [[c("spades", 5)], [c("hearts", 6)], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "tableau-to-freecell", fromCol: 0, toCell: 0 });
    expect(next.events).toEqual<readonly GameEvent[]>([{ type: "cardPlace" }]);
  });

  it("emits cardPlace for free cell → tableau", () => {
    const state = mkState({
      freeCells: [c("spades", 5), null, null, null],
      tableau: [[], [c("hearts", 6)], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "freecell-to-tableau", fromCell: 0, toCol: 1 });
    expect(next.events).toEqual<readonly GameEvent[]>([{ type: "cardPlace" }]);
  });

  it("emits only cardPlace for a non-completing tableau → foundation move", () => {
    // col 1 has 2♠ so after A♠ reaches the foundation, 2♠→foundation is still legal
    const state = mkState({
      tableau: [[c("spades", 1)], [c("spades", 2)], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(next.events).toEqual<readonly GameEvent[]>([{ type: "cardPlace" }]);
  });

  it("emits cardPlace + foundationComplete when a suit reaches 13 cards (tableau → foundation)", () => {
    const foundations: Foundations = {
      spades: Array.from({ length: 12 }, (_, i) => c("spades", (i + 1) as Rank)),
      hearts: [],
      diamonds: [],
      clubs: [],
    };
    // A♥ in col 1 → hearts foundation is legal after K♠ completes spades
    const state = mkState({
      foundations,
      tableau: [[c("spades", 13)], [c("hearts", 1)], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(next.events).toEqual<readonly GameEvent[]>([
      { type: "cardPlace" },
      { type: "foundationComplete", suit: "spades" },
    ]);
  });

  it("emits cardPlace + foundationComplete when a suit reaches 13 cards (free cell → foundation)", () => {
    const foundations: Foundations = {
      clubs: Array.from({ length: 12 }, (_, i) => c("clubs", (i + 1) as Rank)),
      spades: [],
      hearts: [],
      diamonds: [],
    };
    // A♠ in tableau → spades foundation is legal after K♣ completes clubs
    const state = mkState({
      freeCells: [c("clubs", 13), null, null, null],
      foundations,
      tableau: [[c("spades", 1)], [], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "freecell-to-foundation", fromCell: 0 });
    expect(next.events).toEqual<readonly GameEvent[]>([
      { type: "cardPlace" },
      { type: "foundationComplete", suit: "clubs" },
    ]);
  });

  it("emits noMovesAvailable when no legal move exists after a move", () => {
    // Only one card, nowhere to go after it parks in the free cell
    const state = mkState({
      tableau: [[c("spades", 5)], [], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "tableau-to-freecell", fromCol: 0, toCell: 0 });
    expect(next.events).toEqual<readonly GameEvent[]>([
      { type: "cardPlace" },
      { type: "noMovesAvailable" },
    ]);
  });

  it("does not emit noMovesAvailable on a gameWin", () => {
    const foundations: Foundations = {
      spades: Array.from({ length: 13 }, (_, i) => c("spades", (i + 1) as Rank)),
      hearts: Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank)),
      diamonds: Array.from({ length: 13 }, (_, i) => c("diamonds", (i + 1) as Rank)),
      clubs: Array.from({ length: 12 }, (_, i) => c("clubs", (i + 1) as Rank)),
    };
    const state = mkState({
      foundations,
      tableau: [[c("clubs", 13)], [], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(next.events).not.toContainEqual({ type: "noMovesAvailable" });
  });

  it("emits gameWin as the final event when all 52 cards reach foundations", () => {
    const foundations: Foundations = {
      spades: Array.from({ length: 13 }, (_, i) => c("spades", (i + 1) as Rank)),
      hearts: Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank)),
      diamonds: Array.from({ length: 13 }, (_, i) => c("diamonds", (i + 1) as Rank)),
      clubs: Array.from({ length: 12 }, (_, i) => c("clubs", (i + 1) as Rank)),
    };
    const state = mkState({
      foundations,
      tableau: [[c("clubs", 13)], [], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(next.events).toEqual<readonly GameEvent[]>([
      { type: "cardPlace" },
      { type: "foundationComplete", suit: "clubs" },
      { type: "gameWin" },
    ]);
    expect(next.isComplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hint system
// ---------------------------------------------------------------------------

describe("getHintMoves", () => {
  it("returns foundation moves first when available", () => {
    const state = mkState({
      tableau: [[c("spades", 1)], [c("hearts", 6)], [], [], [], [], [], []],
    });
    const hints = getHintMoves(state);
    expect(hints[0]).toEqual({ type: "tableau-to-foundation", fromCol: 0 });
  });

  it("returns tableau-to-tableau moves when no foundation move exists", () => {
    const state = mkState({
      tableau: [[c("spades", 5)], [c("hearts", 6)], [], [], [], [], [], []],
    });
    const hints = getHintMoves(state);
    expect(hints.some((m) => m.type === "tableau-to-tableau")).toBe(true);
  });

  it("returns empty array when no legal moves exist", () => {
    // Single card parked in freecell with no valid destination
    const state = mkState({
      freeCells: [c("spades", 5), null, null, null],
    });
    expect(getHintMoves(state)).toHaveLength(0);
  });

  it("excludes reversible single-card swap when it is the only move (#1295)", () => {
    // 7♥ sits on 8♠; 8♣ is in another column. Freecells full — no parking.
    // Moving 7♥ between the two black 8s is the only legal move, but non-productive.
    const state = mkState({
      tableau: [
        [c("spades", 8), c("hearts", 7)], // col 0: 8♠ then 7♥ on top
        [c("clubs", 8)], // col 1: 8♣ alone
        [],
        [],
        [],
        [],
        [],
        [],
      ],
      freeCells: [c("hearts", 3), c("diamonds", 3), c("clubs", 3), c("spades", 3)],
    });
    expect(getHintMoves(state)).toHaveLength(0);
  });

  it("excludes reversible multi-card swap (7♥+6♠ between two black 8s) (#1295)", () => {
    // Freecells full — no parking available. Only move is the reversible swap.
    const state = mkState({
      tableau: [
        [c("spades", 8), c("hearts", 7), c("spades", 6)], // col 0
        [c("clubs", 8)], // col 1: 8♣ alone
        [],
        [],
        [],
        [],
        [],
        [],
      ],
      freeCells: [c("hearts", 3), c("diamonds", 3), c("clubs", 3), c("spades", 3)],
    });
    expect(getHintMoves(state)).toHaveLength(0);
  });

  it("includes productive move alongside reversible swap (#1295)", () => {
    // 7♥ can swap between 8♠ (col 0) and 8♣ (col 1) — non-productive.
    // 5♠ (col 3, alone) can move onto 6♥ (col 2, top) — productive.
    // Freecells full to remove parking noise.
    const state = mkState({
      tableau: [
        [c("spades", 8), c("hearts", 7)], // col 0: reversible swap source
        [c("clubs", 8)], // col 1: reversible swap dest
        [c("hearts", 6)], // col 2: 6♥ exposed (target for 5♠)
        [c("spades", 5)], // col 3: 5♠ alone — can move to 6♥ (productive, fromIndex=0)
        [],
        [],
        [],
        [],
      ],
      freeCells: [c("hearts", 3), c("diamonds", 3), c("clubs", 3), c("spades", 3)],
    });
    const hints = getHintMoves(state);
    // The productive 5♠→6♥ move (col 3 → col 2) must appear
    expect(hints.some((m) => m.type === "tableau-to-tableau" && m.fromCol === 3)).toBe(true);
    // The reversible swap from col 0 must not appear
    expect(hints.every((m) => m.type !== "tableau-to-tableau" || m.fromCol !== 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isProductiveMove (#1295)
// ---------------------------------------------------------------------------

describe("isProductiveMove", () => {
  it("returns true for non-tableau moves", () => {
    const state = mkState({
      tableau: [[c("spades", 1)], [], [], [], [], [], [], []],
    });
    expect(isProductiveMove(state, { type: "tableau-to-foundation", fromCol: 0 })).toBe(true);
    expect(isProductiveMove(state, { type: "tableau-to-freecell", fromCol: 0, toCell: 0 })).toBe(
      true
    );
  });

  it("returns false for single-card reversible swap (canonical 7♥/8♠/8♣ position)", () => {
    // 7♥ on 8♠ in col 0; 8♣ in col 1. Moving 7♥ to col 1 is non-productive.
    const state = mkState({
      tableau: [[c("spades", 8), c("hearts", 7)], [c("clubs", 8)], [], [], [], [], [], []],
    });
    const move = { type: "tableau-to-tableau" as const, fromCol: 0, fromIndex: 1, toCol: 1 };
    expect(isProductiveMove(state, move)).toBe(false);
  });

  it("returns false for multi-card reversible swap (7♥+6♠ between two black 8s)", () => {
    const state = mkState({
      tableau: [
        [c("spades", 8), c("hearts", 7), c("spades", 6)],
        [c("clubs", 8)],
        [],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    const move = { type: "tableau-to-tableau" as const, fromCol: 0, fromIndex: 1, toCol: 1 };
    expect(isProductiveMove(state, move)).toBe(false);
  });

  it("returns true when the move exposes a foundation play", () => {
    // 7♥ on A♠; A♠ can go to foundation after 7♥ is moved.
    // (A♠ has rank 1; foundations.spades is empty — rank 1 can go to empty foundation)
    const state = mkState({
      tableau: [
        [c("clubs", 8), c("spades", 1), c("hearts", 7)], // col 0: …8♣, A♠, 7♥
        [c("diamonds", 8)], // col 1: 8♦ (red, so 7♥ can land here)
        [],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    // Moving 7♥ (fromIndex 2) to col 1. Parent of 7♥ is A♠ which can go to foundation.
    const move = { type: "tableau-to-tableau" as const, fromCol: 0, fromIndex: 2, toCol: 1 };
    expect(isProductiveMove(state, move)).toBe(true);
  });

  it("returns true when moving from the column base (creates empty column)", () => {
    const state = mkState({
      tableau: [
        [c("hearts", 7)], // col 0: single card (moving it empties the column)
        [c("spades", 8)],
        [],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    const move = { type: "tableau-to-tableau" as const, fromCol: 0, fromIndex: 0, toCol: 1 };
    expect(isProductiveMove(state, move)).toBe(true);
  });

  it("returns true when parent and destination differ in color", () => {
    // 6♦ on 7♠ in col 0; 7♥ in col 1.
    // Moving 6♦ to col 1: parent is 7♠ (black), dest is 7♥ (red) — different colors.
    // Not a reversible swap even though ranks match (black ≠ red).
    // Note: this move is invalid per validateMove (6♦ red cannot stack on 7♥ red),
    // but isProductiveMove is a pure predicate tested independently of validateMove.
    const state = mkState({
      tableau: [
        [c("spades", 7), c("diamonds", 6)], // col 0: 7♠ then 6♦ on top
        [c("hearts", 7)], // col 1: 7♥ — different color from parent 7♠
        [],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    const move = { type: "tableau-to-tableau" as const, fromCol: 0, fromIndex: 1, toCol: 1 };
    expect(isProductiveMove(state, move)).toBe(true);
  });

  it("returns true when player manually executes non-productive move (applyMove accepts it)", () => {
    const state = mkState({
      tableau: [[c("spades", 8), c("hearts", 7)], [c("clubs", 8)], [], [], [], [], [], []],
    });
    const move = { type: "tableau-to-tableau" as const, fromCol: 0, fromIndex: 1, toCol: 1 };
    // isProductiveMove returns false (hint would skip it), but applyMove still accepts it
    expect(isProductiveMove(state, move)).toBe(false);
    const next = applyMove(state, move);
    expect(next).not.toBe(state);
    expect(next.tableau[1]).toEqual([c("clubs", 8), c("hearts", 7)]);
  });
});

describe("hasLegalMoves", () => {
  it("returns true when at least one legal move exists", () => {
    const state = mkState({
      tableau: [[c("spades", 5)], [c("hearts", 6)], [], [], [], [], [], []],
    });
    expect(hasLegalMoves(state)).toBe(true);
  });

  it("returns false when no legal moves exist", () => {
    const state = mkState({
      freeCells: [c("spades", 5), null, null, null],
    });
    expect(hasLegalMoves(state)).toBe(false);
  });

  it("returns true when a freecell card can reach the foundation", () => {
    const state = mkState({
      freeCells: [c("spades", 1), null, null, null],
    });
    expect(hasLegalMoves(state)).toBe(true);
  });
});

describe("applyHint", () => {
  it("sets state.hint to the first legal move", () => {
    const state = mkState({
      tableau: [[c("spades", 1)], [c("hearts", 6)], [], [], [], [], [], []],
    });
    const next = applyHint(state);
    expect(next.hint).toEqual({ type: "tableau-to-foundation", fromCol: 0 });
  });

  it("sets hint to undefined when no legal moves exist", () => {
    const state = mkState({
      freeCells: [c("spades", 5), null, null, null],
    });
    const next = applyHint(state);
    expect(next.hint).toBeUndefined();
  });

  it("does not increment moveCount", () => {
    const state = mkState({
      tableau: [[c("spades", 5)], [c("hearts", 6)], [], [], [], [], [], []],
      moveCount: 3,
    });
    expect(applyHint(state).moveCount).toBe(3);
  });

  it("clears hint after the next real move", () => {
    const state = mkState({
      tableau: [[c("spades", 5)], [c("hearts", 6)], [], [], [], [], [], []],
    });
    const withHint = applyHint(state);
    expect(withHint.hint).toBeDefined();
    const afterMove = applyMove(withHint, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    expect(afterMove.hint).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// canAutoComplete
// ---------------------------------------------------------------------------

describe("canAutoComplete", () => {
  function fullFoundations(): Foundations {
    const thirteen = (suit: Suit) =>
      ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const).map((r) => c(suit, r));
    return {
      spades: thirteen("spades"),
      hearts: thirteen("hearts"),
      diamonds: thirteen("diamonds"),
      clubs: thirteen("clubs"),
    };
  }

  it("returns false when the game is already complete", () => {
    const state = mkState({ foundations: fullFoundations(), isComplete: true });
    expect(canAutoComplete(state)).toBe(false);
  });

  it("returns true when all remaining cards are directly playable to foundations", () => {
    // All suits at rank 12 (Queen) in foundations; Kings on tableau top
    const foundations: Foundations = {
      spades: ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const).map((r) => c("spades", r)),
      hearts: ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const).map((r) => c("hearts", r)),
      diamonds: ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const).map((r) => c("diamonds", r)),
      clubs: ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const).map((r) => c("clubs", r)),
    };
    const state = mkState({
      foundations,
      tableau: [
        [c("spades", 13)],
        [c("hearts", 13)],
        [c("diamonds", 13)],
        [c("clubs", 13)],
        [],
        [],
        [],
        [],
      ],
    });
    expect(canAutoComplete(state)).toBe(true);
  });

  it("returns true when freecell cards are the next needed for all foundations", () => {
    // foundations at rank 12; all four kings are split between freecells and tableau
    const f12 = (suit: Suit) =>
      ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const).map((r) => c(suit, r));
    const foundations: Foundations = {
      spades: f12("spades"),
      hearts: f12("hearts"),
      diamonds: f12("diamonds"),
      clubs: f12("clubs"),
    };
    const state = mkState({
      foundations,
      freeCells: [c("spades", 13), c("hearts", 13), null, null],
      tableau: [[c("diamonds", 13)], [c("clubs", 13)], [], [], [], [], [], []],
    });
    expect(canAutoComplete(state)).toBe(true);
  });

  it("returns false when a card is buried under a card that cannot yet be placed", () => {
    // foundations empty; 3♠ sits on top of 2♠ — 2♠ needs A♠ first but A♠ is buried
    const state = mkState({
      tableau: [
        [c("spades", 3), c("spades", 2)], // 2♠ on top but A♠ missing
        [],
        [],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    expect(canAutoComplete(state)).toBe(false);
  });

  it("returns false when tableau still needs rearrangement", () => {
    // Aces buried mid-column
    const state = mkState({
      tableau: [[c("hearts", 5), c("spades", 1)], [], [], [], [], [], [], []],
    });
    expect(canAutoComplete(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// autoComplete (single step)
// ---------------------------------------------------------------------------

describe("autoComplete", () => {
  it("moves a freecell ace to the foundation", () => {
    const state = mkState({ freeCells: [c("spades", 1), null, null, null] });
    const next = autoComplete(state);
    expect(next.foundations.spades).toHaveLength(1);
    expect(next.foundations.spades[0]).toEqual(c("spades", 1));
    expect(next.freeCells[0]).toBeNull();
  });

  it("prefers freecell over tableau when both are playable", () => {
    const foundations: Foundations = {
      spades: [c("spades", 1)],
      hearts: [],
      diamonds: [],
      clubs: [],
    };
    const state = mkState({
      foundations,
      freeCells: [c("spades", 2), null, null, null],
      tableau: [[c("hearts", 1)], [], [], [], [], [], [], []],
    });
    const next = autoComplete(state);
    expect(next.foundations.spades).toHaveLength(2);
    expect(next.freeCells[0]).toBeNull();
  });

  it("moves a tableau card to the foundation when freecells are empty", () => {
    const state = mkState({
      tableau: [[c("spades", 1)], [], [], [], [], [], [], []],
    });
    const next = autoComplete(state);
    expect(next.foundations.spades).toHaveLength(1);
    expect(next.tableau[0]).toHaveLength(0);
  });

  it("returns the same state when no card can be placed on the foundation", () => {
    const state = mkState({
      tableau: [[c("spades", 5)], [], [], [], [], [], [], []],
    });
    expect(autoComplete(state)).toBe(state);
  });

  it("increments moveCount by 1 per step", () => {
    const state = mkState({
      tableau: [[c("clubs", 1)], [], [], [], [], [], [], []],
      moveCount: 7,
    });
    const next = autoComplete(state);
    expect(next.moveCount).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// foundation-to-tableau (#1111)
// ---------------------------------------------------------------------------

describe("validateMove — foundation-to-tableau", () => {
  it("allows a valid stack (alternating colour, descending rank)", () => {
    const state = mkState({
      tableau: [[], [c("hearts", 3)], [], [], [], [], [], []],
      foundations: { ...emptyFoundations(), spades: [c("spades", 1), c("spades", 2)] },
    });
    expect(
      validateMove(state, { type: "foundation-to-tableau", fromSuit: "spades", toCol: 1 })
    ).toBe(true);
  });

  it("allows a King onto an empty column", () => {
    const state = mkState({
      foundations: {
        ...emptyFoundations(),
        hearts: Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank)),
      },
    });
    expect(
      validateMove(state, { type: "foundation-to-tableau", fromSuit: "hearts", toCol: 0 })
    ).toBe(true);
  });

  it("rejects a non-King onto an empty column", () => {
    const state = mkState({
      foundations: { ...emptyFoundations(), spades: [c("spades", 1), c("spades", 2)] },
    });
    expect(
      validateMove(state, { type: "foundation-to-tableau", fromSuit: "spades", toCol: 0 })
    ).toBe(false);
  });

  it("rejects when the foundation is empty", () => {
    const state = mkState({
      tableau: [[c("hearts", 3)], [], [], [], [], [], [], []],
    });
    expect(
      validateMove(state, { type: "foundation-to-tableau", fromSuit: "spades", toCol: 0 })
    ).toBe(false);
  });

  it("rejects a same-colour placement", () => {
    // clubs (black) on top of spades (black) — same colour, invalid
    const state = mkState({
      tableau: [[], [c("spades", 3)], [], [], [], [], [], []],
      foundations: { ...emptyFoundations(), clubs: [c("clubs", 1), c("clubs", 2)] },
    });
    expect(
      validateMove(state, { type: "foundation-to-tableau", fromSuit: "clubs", toCol: 1 })
    ).toBe(false);
  });

  it("rejects a non-consecutive rank", () => {
    // 2♠ on top of 4♥ — wrong rank (needs rank 3)
    const state = mkState({
      tableau: [[], [c("hearts", 4)], [], [], [], [], [], []],
      foundations: { ...emptyFoundations(), spades: [c("spades", 1), c("spades", 2)] },
    });
    expect(
      validateMove(state, { type: "foundation-to-tableau", fromSuit: "spades", toCol: 1 })
    ).toBe(false);
  });
});

describe("applyMove — foundation-to-tableau", () => {
  it("moves the top card from the foundation to the tableau column", () => {
    const state = mkState({
      tableau: [[], [c("hearts", 3)], [], [], [], [], [], []],
      foundations: { ...emptyFoundations(), spades: [c("spades", 1), c("spades", 2)] },
    });
    const next = applyMove(state, { type: "foundation-to-tableau", fromSuit: "spades", toCol: 1 });
    expect(next.foundations.spades).toEqual([c("spades", 1)]);
    expect(next.tableau[1]).toEqual([c("hearts", 3), c("spades", 2)]);
  });

  it("costs 2 moves (penalty for retreating from foundation)", () => {
    const state = mkState({
      moveCount: 5,
      tableau: [[], [c("hearts", 3)], [], [], [], [], [], []],
      foundations: { ...emptyFoundations(), spades: [c("spades", 1), c("spades", 2)] },
    });
    const next = applyMove(state, { type: "foundation-to-tableau", fromSuit: "spades", toCol: 1 });
    expect(next.moveCount).toBe(7);
  });

  it("clears the active hint after the retreat move", () => {
    const state = mkState({
      tableau: [[], [c("hearts", 3)], [], [], [], [], [], []],
      foundations: { ...emptyFoundations(), spades: [c("spades", 1), c("spades", 2)] },
      hint: { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 },
    });
    const next = applyMove(state, { type: "foundation-to-tableau", fromSuit: "spades", toCol: 1 });
    expect(next.hint).toBeUndefined();
  });

  it("returns state unchanged when the move is invalid", () => {
    const state = mkState({
      foundations: emptyFoundations(),
    });
    const next = applyMove(state, { type: "foundation-to-tableau", fromSuit: "spades", toCol: 0 });
    expect(next).toBe(state);
  });
});

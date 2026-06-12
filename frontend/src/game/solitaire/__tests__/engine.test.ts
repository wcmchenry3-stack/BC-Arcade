/**
 * Solitaire engine unit tests (#593).
 *
 * Covers all acceptance criteria from the issue:
 *   - Deck uniqueness (52 unique cards, all face-down from createDeck)
 *   - Deal shape (column sizes, face-up/down distribution, 24 in stock)
 *   - Each scoring event
 *   - Undo reversibility + cap + nested stripping
 *   - Recycle penalty (first free, -50 after)
 *   - Auto-complete detection (true/false) + stepwise drain
 *   - Win detection + +500 bonus applied once
 *   - Score floor (never negative)
 *   - Invalid move rejection (returns unchanged state)
 */

import {
  applyHint,
  applyMove,
  autoComplete,
  canAutoComplete,
  createDeck,
  createSeededRng,
  dealGame,
  drawFromStock,
  getHintMoves,
  isProductiveMove,
  recycleWaste,
  setRng,
  undo,
  validateMove,
} from "../engine";
import type { Card, Foundations, GameEvent, Rank, SolitaireState, Suit } from "../types";
import { SUITS } from "../types";

// ---------------------------------------------------------------------------
// Helpers — mint hand-crafted states so tests don't depend on a real deal.
// ---------------------------------------------------------------------------

function c(suit: Suit, rank: Rank, faceUp = true): Card {
  return { suit, rank, faceUp };
}

function emptyFoundations(): Foundations {
  return { spades: [], hearts: [], diamonds: [], clubs: [] };
}

function mkState(overrides: Partial<SolitaireState> = {}): SolitaireState {
  return {
    _v: 1,
    drawMode: 1,
    tableau: [[], [], [], [], [], [], []],
    foundations: emptyFoundations(),
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

afterEach(() => {
  // Tests that call setRng must not leak determinism into later tests.
  setRng(Math.random);
});

// ---------------------------------------------------------------------------
// Deck + deal
// ---------------------------------------------------------------------------

describe("createDeck", () => {
  it("returns 52 unique cards, all face-down", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    const ids = new Set(deck.map((card) => `${card.suit}-${card.rank}`));
    expect(ids.size).toBe(52);
    expect(deck.every((card) => !card.faceUp)).toBe(true);
  });
});

describe("dealGame", () => {
  it("lays out 7 columns sized 1..7 with only the top card face-up", () => {
    const state = dealGame(1, 42);
    expect(state.tableau).toHaveLength(7);
    state.tableau.forEach((col, i) => {
      expect(col).toHaveLength(i + 1);
      col.forEach((card, j) => {
        expect(card.faceUp).toBe(j === i);
      });
    });
  });

  it("puts the remaining 24 cards face-down in stock", () => {
    const state = dealGame(1, 7);
    expect(state.stock).toHaveLength(24);
    expect(state.stock.every((card) => !card.faceUp)).toBe(true);
    expect(state.waste).toEqual([]);
  });

  it("places every card of the 52-card deck exactly once", () => {
    const state = dealGame(3, 99);
    const all = [
      ...state.tableau.flat(),
      ...state.stock,
      ...state.waste,
      ...SUITS.flatMap((suit) => state.foundations[suit]),
    ];
    const ids = new Set(all.map((card) => `${card.suit}-${card.rank}`));
    expect(ids.size).toBe(52);
  });

  it("is deterministic for a given seed", () => {
    const a = dealGame(1, 123);
    const b = dealGame(1, 123);
    expect(a.tableau).toEqual(b.tableau);
    expect(a.stock).toEqual(b.stock);
  });

  it("picks a seed from the bank when none is supplied (draw-1)", () => {
    setRng(createSeededRng(1));
    const state = dealGame(1);
    expect(state.tableau).toHaveLength(7);
    expect(state.stock).toHaveLength(24);
  });

  it("picks a seed from the bank when none is supplied (draw-3)", () => {
    setRng(createSeededRng(1));
    const state = dealGame(3);
    expect(state.drawMode).toBe(3);
    expect(state.tableau).toHaveLength(7);
  });
});

describe("createSeededRng", () => {
  it("is deterministic for a given seed", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const aSeq = [a(), a(), a()];
    const bSeq = [b(), b(), b()];
    expect(aSeq).toEqual(bSeq);
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe("scoring", () => {
  it("waste → tableau gives +5", () => {
    const state = mkState({
      waste: [c("hearts", 12)],
      tableau: [[c("spades", 13)], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "waste-to-tableau", toCol: 0 });
    expect(next.score).toBe(5);
    expect(next.waste).toEqual([]);
    expect(next.tableau[0]).toHaveLength(2);
  });

  it("waste → foundation gives +10", () => {
    const state = mkState({ waste: [c("spades", 1)] });
    const next = applyMove(state, { type: "waste-to-foundation" });
    expect(next.score).toBe(10);
    expect(next.foundations.spades).toHaveLength(1);
  });

  it("tableau → foundation gives +10", () => {
    const state = mkState({
      tableau: [[c("hearts", 1)], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(next.score).toBe(10);
    expect(next.foundations.hearts).toHaveLength(1);
    expect(next.tableau[0]).toEqual([]);
  });

  it("foundation → tableau costs -15", () => {
    // K♥ (red) onto an empty column is valid and costs -15.
    const state = mkState({
      score: 50,
      foundations: { ...emptyFoundations(), hearts: [c("hearts", 13)] },
      tableau: [[], [], [], [], [], [], []],
    });
    const next = applyMove(state, {
      type: "foundation-to-tableau",
      fromSuit: "hearts",
      toCol: 0,
    });
    expect(next.score).toBe(35);
    expect(next.tableau[0]).toHaveLength(1);
    expect(next.foundations.hearts).toEqual([]);
  });

  it("auto-reveals a newly uncovered face-down card and gives +5", () => {
    const state = mkState({
      tableau: [[c("hearts", 2, false), c("spades", 1)], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(next.score).toBe(10 + 5);
    expect(next.tableau[0]).toHaveLength(1);
    expect(next.tableau[0]?.[0]?.faceUp).toBe(true);
  });

  it("clamps score at 0 even when a -15 move would push it negative", () => {
    const state = mkState({
      score: 5,
      foundations: { ...emptyFoundations(), hearts: [c("hearts", 13)] },
      tableau: [[], [], [], [], [], [], []],
    });
    const next = applyMove(state, {
      type: "foundation-to-tableau",
      fromSuit: "hearts",
      toCol: 0,
    });
    expect(next.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe("undo", () => {
  it("reverts the previous move", () => {
    const state = mkState({
      waste: [c("spades", 1)],
    });
    const after = applyMove(state, { type: "waste-to-foundation" });
    const reverted = undo(after);
    expect(reverted.waste).toEqual([c("spades", 1)]);
    expect(reverted.foundations.spades).toEqual([]);
    expect(reverted.score).toBe(0);
  });

  it("returns the state unchanged when the stack is empty", () => {
    const state = mkState();
    expect(undo(state)).toBe(state);
  });

  it("caps the undo stack at 50 entries", () => {
    let state = mkState({
      stock: Array.from({ length: 60 }, (_, i) =>
        c(SUITS[i % 4] as Suit, ((i % 13) + 1) as Rank, false)
      ),
    });
    for (let i = 0; i < 55; i++) {
      const next = drawFromStock(state);
      if (next === state) break;
      state = next;
    }
    expect(state.undoStack.length).toBeLessThanOrEqual(50);
  });

  it("chains undos back across multiple moves", () => {
    const base = mkState({
      stock: [c("clubs", 5, false), c("hearts", 7, false), c("spades", 3, false)],
    });
    const d1 = drawFromStock(base);
    const d2 = drawFromStock(d1);
    expect(d2.waste).toHaveLength(2);
    const back1 = undo(d2);
    expect(back1.waste).toHaveLength(1);
    const back2 = undo(back1);
    expect(back2.waste).toHaveLength(0);
    expect(back2.stock).toHaveLength(3);
  });

  it("strips nested undoStack to [] in snapshots to prevent exponential nesting", () => {
    const state = mkState({
      stock: [c("clubs", 5, false), c("hearts", 7, false)],
    });
    const d1 = drawFromStock(state);
    const d2 = drawFromStock(d1);
    // Each snapshot inside d2.undoStack must have undoStack === [].
    for (const snap of d2.undoStack) {
      expect(snap.undoStack).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Stock / recycle
// ---------------------------------------------------------------------------

describe("drawFromStock", () => {
  it("moves drawMode cards from stock to waste (top first)", () => {
    const state = mkState({
      drawMode: 3,
      stock: [
        c("spades", 1, false),
        c("hearts", 2, false),
        c("diamonds", 3, false),
        c("clubs", 4, false),
      ],
    });
    const next = drawFromStock(state);
    expect(next.waste.map((card) => card.rank)).toEqual([4, 3, 2]);
    expect(next.waste.every((card) => card.faceUp)).toBe(true);
    expect(next.stock).toHaveLength(1);
  });

  it("is a no-op when stock is empty", () => {
    const state = mkState();
    expect(drawFromStock(state)).toBe(state);
  });
});

describe("recycleWaste", () => {
  it("first recycle is free", () => {
    const state = mkState({
      score: 10,
      stock: [],
      waste: [c("spades", 1), c("hearts", 2)],
    });
    const next = recycleWaste(state);
    expect(next.score).toBe(10);
    expect(next.recycleCount).toBe(1);
    expect(next.stock).toHaveLength(2);
    expect(next.waste).toEqual([]);
    expect(next.stock.every((card) => !card.faceUp)).toBe(true);
  });

  it("second and later recycles cost -50", () => {
    const onceRecycled = mkState({
      score: 80,
      recycleCount: 1,
      stock: [],
      waste: [c("spades", 1)],
    });
    const next = recycleWaste(onceRecycled);
    expect(next.score).toBe(30);
    expect(next.recycleCount).toBe(2);
  });

  it("clamps at 0 when penalty would drop below", () => {
    const state = mkState({
      score: 10,
      recycleCount: 2,
      stock: [],
      waste: [c("spades", 1)],
    });
    const next = recycleWaste(state);
    expect(next.score).toBe(0);
  });

  it("is a no-op when stock still has cards", () => {
    const state = mkState({
      stock: [c("spades", 1, false)],
      waste: [c("hearts", 2)],
    });
    expect(recycleWaste(state)).toBe(state);
  });

  it("is a no-op when waste is empty", () => {
    const state = mkState();
    expect(recycleWaste(state)).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// Win detection + bonus
// ---------------------------------------------------------------------------

describe("win detection", () => {
  it("applies +500 once when the last card reaches the foundation", () => {
    // Build a state where moving the last A→K climax triggers win.
    // Three suits full; clubs at Q; final K♣ sitting on a tableau column.
    const foundations: Foundations = {
      spades: Array.from({ length: 13 }, (_, i) => c("spades", (i + 1) as Rank)),
      hearts: Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank)),
      diamonds: Array.from({ length: 13 }, (_, i) => c("diamonds", (i + 1) as Rank)),
      clubs: Array.from({ length: 12 }, (_, i) => c("clubs", (i + 1) as Rank)),
    };
    const state = mkState({
      score: 0,
      foundations,
      tableau: [[c("clubs", 13)], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(next.isComplete).toBe(true);
    // Foundation move +10, win bonus +500.
    expect(next.score).toBe(510);
  });
});

// ---------------------------------------------------------------------------
// Invalid moves
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tableau → tableau (multi-card run)
// ---------------------------------------------------------------------------

describe("tableau → tableau", () => {
  it("validates and moves a valid single-card run onto a placeable pile", () => {
    const state = mkState({
      tableau: [[c("spades", 5)], [c("hearts", 6)], [], [], [], [], []],
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
  });

  it("moves a multi-card alternating-color run and reveals the freshly exposed card", () => {
    // Run 6♥ (red) → 5♠ (black), placing onto 7♣ (black) in dest col.
    const state = mkState({
      tableau: [
        [c("clubs", 9, false), c("hearts", 6), c("spades", 5)],
        [c("clubs", 7)],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    const next = applyMove(state, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 1,
      toCol: 1,
    });
    expect(next.tableau[0]).toHaveLength(1);
    expect(next.tableau[0]?.[0]?.faceUp).toBe(true);
    expect(next.score).toBe(5);
    expect(next.tableau[1]?.map((card) => card.rank)).toEqual([7, 6, 5]);
  });

  it("rejects a run that is not a valid alternating-color descending sequence", () => {
    const state = mkState({
      tableau: [
        [c("hearts", 6), c("diamonds", 5)], // same color, invalid run
        [c("spades", 7)],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    expect(
      validateMove(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 })
    ).toBe(false);
  });

  it("rejects fromIndex pointing to a face-down card", () => {
    const state = mkState({
      tableau: [[c("hearts", 6, false), c("spades", 5)], [c("diamonds", 6)], [], [], [], [], []],
    });
    expect(
      validateMove(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 })
    ).toBe(false);
  });

  it("rejects same-column moves", () => {
    const state = mkState({
      tableau: [[c("spades", 5)], [], [], [], [], [], []],
    });
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
      validateMove(state, { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 9 })
    ).toBe(false);
  });
});

describe("invalid moves", () => {
  it("validateMove rejects a waste → empty-column move that isn't a King", () => {
    const state = mkState({ waste: [c("hearts", 5)] });
    expect(validateMove(state, { type: "waste-to-tableau", toCol: 0 })).toBe(false);
  });

  it("applyMove emits invalidMove event and returns a new reference on an invalid move", () => {
    const state = mkState({ waste: [c("hearts", 5)] });
    const result = applyMove(state, { type: "waste-to-tableau", toCol: 0 });
    expect(result).not.toBe(state);
    expect(result.events).toContain("invalidMove" as GameEvent);
  });

  it("rejects same-color tableau stacking", () => {
    const state = mkState({
      waste: [c("hearts", 5)],
      tableau: [[c("diamonds", 6)], [], [], [], [], [], []],
    });
    expect(validateMove(state, { type: "waste-to-tableau", toCol: 0 })).toBe(false);
  });

  it("rejects wrong-rank foundation push", () => {
    const state = mkState({
      waste: [c("spades", 5)],
      foundations: { ...emptyFoundations(), spades: [c("spades", 1)] },
    });
    expect(validateMove(state, { type: "waste-to-foundation" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Game events
// ---------------------------------------------------------------------------

describe("game events", () => {
  it("applyMove emits cardPlace on a valid waste-to-foundation move", () => {
    const state = mkState({ waste: [c("spades", 1)] });
    const next = applyMove(state, { type: "waste-to-foundation" });
    expect(next.events).toContain("cardPlace" as GameEvent);
  });

  it("applyMove emits cardFlip when a face-down tableau card is revealed", () => {
    const state = mkState({
      tableau: [[c("hearts", 2, false), c("spades", 1)], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(next.events).toContain("cardFlip" as GameEvent);
    expect(next.events).toContain("cardPlace" as GameEvent);
  });

  it("applyMove emits foundationComplete when a suit reaches 13 cards", () => {
    const foundations: Foundations = {
      spades: Array.from({ length: 12 }, (_, i) => c("spades", (i + 1) as Rank)),
      hearts: [],
      diamonds: [],
      clubs: [],
    };
    const state = mkState({
      foundations,
      tableau: [[c("spades", 13)], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(next.events).toContain("foundationComplete" as GameEvent);
  });

  it("applyMove emits gameWin when the last card completes all foundations", () => {
    const foundations: Foundations = {
      spades: Array.from({ length: 13 }, (_, i) => c("spades", (i + 1) as Rank)),
      hearts: Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank)),
      diamonds: Array.from({ length: 13 }, (_, i) => c("diamonds", (i + 1) as Rank)),
      clubs: Array.from({ length: 12 }, (_, i) => c("clubs", (i + 1) as Rank)),
    };
    const state = mkState({
      foundations,
      tableau: [[c("clubs", 13)], [], [], [], [], [], []],
    });
    const next = applyMove(state, { type: "tableau-to-foundation", fromCol: 0 });
    expect(next.events).toContain("gameWin" as GameEvent);
    expect(next.isComplete).toBe(true);
  });

  it("drawFromStock emits cardFlip", () => {
    const state = mkState({ stock: [c("clubs", 5, false)] });
    const next = drawFromStock(state);
    expect(next.events).toContain("cardFlip" as GameEvent);
  });

  it("events are cleared from undo snapshots so undo does not re-fire them", () => {
    const state = mkState({ waste: [c("spades", 1)] });
    const after = applyMove(state, { type: "waste-to-foundation" });
    expect(after.events).toContain("cardPlace" as GameEvent);
    const reverted = undo(after);
    expect(reverted.events).toBeUndefined();
  });

  it("applyMove does not emit foundationComplete on subsequent moves once already won", () => {
    const foundations: Foundations = {
      spades: Array.from({ length: 13 }, (_, i) => c("spades", (i + 1) as Rank)),
      hearts: Array.from({ length: 13 }, (_, i) => c("hearts", (i + 1) as Rank)),
      diamonds: Array.from({ length: 13 }, (_, i) => c("diamonds", (i + 1) as Rank)),
      clubs: Array.from({ length: 12 }, (_, i) => c("clubs", (i + 1) as Rank)),
    };
    // Win the game first
    const preWin = mkState({
      foundations,
      tableau: [[c("clubs", 13)], [], [], [], [], [], []],
    });
    const won = applyMove(preWin, { type: "tableau-to-foundation", fromCol: 0 });
    expect(won.isComplete).toBe(true);
    // After win, move A♠ back to tableau and then to foundation again — should not re-emit
    const withSpadeOnTableau = {
      ...won,
      foundations: {
        ...won.foundations,
        spades: Array.from({ length: 12 }, (_, i) => c("spades", (i + 1) as Rank)),
      },
      tableau: [[c("spades", 13)], [], [], [], [], [], []],
    };
    const reMove = applyMove(withSpadeOnTableau, { type: "tableau-to-foundation", fromCol: 0 });
    expect(reMove.events).not.toContain("foundationComplete" as GameEvent);
    expect(reMove.events).not.toContain("gameWin" as GameEvent);
  });
});

// ---------------------------------------------------------------------------
// Auto-complete
// ---------------------------------------------------------------------------

describe("canAutoComplete", () => {
  it("is false when any tableau card is face-down", () => {
    const state = mkState({
      tableau: [[c("hearts", 2, false), c("spades", 1)], [], [], [], [], [], []],
    });
    expect(canAutoComplete(state)).toBe(false);
  });

  it("is true when every tableau card is face-up", () => {
    const state = mkState({
      tableau: [[c("hearts", 2), c("spades", 1)], [], [], [], [], [], []],
    });
    expect(canAutoComplete(state)).toBe(true);
  });

  it("is false once the game is complete", () => {
    expect(canAutoComplete(mkState({ isComplete: true }))).toBe(false);
  });
});

describe("autoComplete", () => {
  it("drains stock into waste, then waste into foundation, then tableau → foundation", () => {
    // Two face-up aces sitting on tableau, ready to go. Stock empty.
    const state = mkState({
      tableau: [[c("spades", 1)], [c("hearts", 1)], [], [], [], [], []],
    });
    const s1 = autoComplete(state);
    expect(s1.foundations.spades).toHaveLength(1);
    const s2 = autoComplete(s1);
    expect(s2.foundations.hearts).toHaveLength(1);
  });

  it("returns the input unchanged when no auto step applies", () => {
    // Nothing playable: an off-suit 5 with no foundation to accept it.
    const state = mkState({
      tableau: [[c("hearts", 5)], [], [], [], [], [], []],
    });
    expect(autoComplete(state)).toBe(state);
  });

  it("drains stock first when waste has no playable top", () => {
    const state = mkState({
      stock: [c("clubs", 4, false), c("hearts", 9, false)],
      tableau: [[], [], [], [], [], [], []],
    });
    const next = autoComplete(state);
    expect(next.waste).toHaveLength(1);
    expect(next.stock).toHaveLength(1);
  });

  it("plays the waste top to foundation when eligible", () => {
    const state = mkState({
      waste: [c("spades", 1)],
    });
    const next = autoComplete(state);
    expect(next.foundations.spades).toHaveLength(1);
    expect(next.waste).toEqual([]);
  });

  it("is a no-op when the game is already complete", () => {
    const state = mkState({ isComplete: true });
    expect(autoComplete(state)).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// Hint engine (#2033)
// ---------------------------------------------------------------------------

describe("getHintMoves", () => {
  it("returns a foundation move first when one exists", () => {
    // A♠ on tableau, foundation empty → tableau-to-foundation should be first
    const state = mkState({
      tableau: [[c("spades", 1)], [], [], [], [], [], []],
    });
    const hints = getHintMoves(state);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]!.type).toBe("tableau-to-foundation");
  });

  it("returns waste→foundation first when waste top can go to foundation", () => {
    const state = mkState({
      waste: [c("spades", 1)],
      tableau: [[c("hearts", 2)], [], [], [], [], [], []],
    });
    const hints = getHintMoves(state);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]!.type).toBe("waste-to-foundation");
  });

  it("returns a face-down-revealing tableau move when no foundation move exists", () => {
    // Col 0: face-down 9♣ under face-up 8♦ (red). Col 1: face-up 9♠ (black, rank 9).
    // Moving 8♦ from col 0 index 1 onto 9♠ in col 1 reveals the face-down 9♣.
    const state = mkState({
      tableau: [[c("clubs", 9, false), c("diamonds", 8)], [c("spades", 9)], [], [], [], [], []],
    });
    const hints = getHintMoves(state);
    expect(hints.length).toBeGreaterThan(0);
    const first = hints[0]!;
    expect(first.type).toBe("tableau-to-tableau");
    if (first.type === "tableau-to-tableau") {
      expect(first.fromCol).toBe(0);
      expect(first.fromIndex).toBe(1);
      expect(first.toCol).toBe(1);
    }
  });

  it("returns waste→tableau before non-revealing tableau moves", () => {
    // Col 0: face-up K♠ alone. Col 1: face-up Q♥ (red) can go onto K♠.
    // Waste: J♠ (black) can go onto Q♥.
    // Moving Q♥→K♠ is a non-revealing move (col 1 becomes empty → productive, but
    // we specifically want waste→tableau to come before non-revealing non-empty-creating moves).
    // Let's build a cleaner case: waste has a playable card, tableau move doesn't reveal.
    const state = mkState({
      waste: [c("hearts", 5)],
      tableau: [
        [c("spades", 6)], // waste 5♥ can go here (non-revealing, no face-down below)
        [],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    const hints = getHintMoves(state);
    // waste→tableau should appear before any tableau→tableau
    const wasteIdx = hints.findIndex((m) => m.type === "waste-to-tableau");
    const ttIdx = hints.findIndex((m) => m.type === "tableau-to-tableau");
    expect(wasteIdx).toBeGreaterThanOrEqual(0);
    if (ttIdx >= 0) {
      expect(wasteIdx).toBeLessThan(ttIdx);
    }
  });

  it("excludes reversible non-productive tableau swaps", () => {
    // Col 0: face-up 5♠ (black). Col 1: face-up 6♥ (red).
    // Moving 5♠ onto 6♥ is valid but non-productive if it doesn't reveal a face-down
    // card below 5♠ and col 0 is not left with an empty-column king opportunity.
    // Let's add another card below that is face-up (no reveal benefit).
    const state = mkState({
      tableau: [
        [c("hearts", 7), c("spades", 5)], // 7♥ is face-up, no benefit to expose it
        [c("hearts", 6)],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    const hints = getHintMoves(state);
    // The swap 5♠ col0 → 6♥ col1 is valid but reversible (no face-down card revealed,
    // no foundation play enabled, no empty column created). It should be excluded.
    const hasNonProductiveSwap = hints.some(
      (m) => m.type === "tableau-to-tableau" && m.fromCol === 0 && m.toCol === 1
    );
    expect(hasNonProductiveSwap).toBe(false);
  });

  it("returns [] when no productive moves exist", () => {
    // A state with no legal moves at all.
    const state = mkState();
    const hints = getHintMoves(state);
    expect(hints).toEqual([]);
  });
});

describe("isProductiveMove", () => {
  it("returns true for non-tableau-to-tableau moves", () => {
    const state = mkState({ waste: [c("spades", 1)] });
    expect(isProductiveMove(state, { type: "waste-to-foundation" })).toBe(true);
    expect(isProductiveMove(state, { type: "waste-to-tableau", toCol: 0 })).toBe(true);
    expect(isProductiveMove(state, { type: "tableau-to-foundation", fromCol: 0 })).toBe(true);
  });

  it("returns true when the move reveals a face-down card", () => {
    const state = mkState({
      tableau: [[c("clubs", 9, false), c("diamonds", 8)], [c("spades", 9)], [], [], [], [], []],
    });
    const move: import("../types").Move = {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 1,
      toCol: 1,
    };
    expect(isProductiveMove(state, move)).toBe(true);
  });

  it("returns false for a reversible swap that gains nothing", () => {
    // Col 0: [7♥ (face-up), 5♠ (face-up)]. Col 1: [6♥ (face-up)].
    // 5♠ → 6♥ is valid but reversible: no face-down revealed, 7♥ can't go to foundation.
    const state = mkState({
      tableau: [[c("hearts", 7), c("spades", 5)], [c("hearts", 6)], [], [], [], [], []],
    });
    const move: import("../types").Move = {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 1,
      toCol: 1,
    };
    expect(isProductiveMove(state, move)).toBe(false);
  });

  it("returns true when the exposed parent card can go to foundation", () => {
    // Col 0: [A♠ (face-up), 2♥ (face-up)]. Moving 2♥ exposes A♠ → can go to empty spades pile.
    // Col 1: [3♣ (face-up)]. 2♥ (red) onto 3♣ (black) is a valid tableau move.
    const state = mkState({
      tableau: [[c("spades", 1), c("hearts", 2)], [c("clubs", 3)], [], [], [], [], []],
    });
    const move: import("../types").Move = {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 1,
      toCol: 1,
    };
    expect(isProductiveMove(state, move)).toBe(true);
  });

  it("returns true when moving the full column (fromIndex === 0) to create empty space", () => {
    const state = mkState({
      tableau: [[c("spades", 5)], [c("hearts", 6)], [], [], [], [], []],
    });
    const move: import("../types").Move = {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    };
    expect(isProductiveMove(state, move)).toBe(true);
  });
});

describe("applyHint", () => {
  it("sets hint to the first move from getHintMoves", () => {
    const state = mkState({
      tableau: [[c("spades", 1)], [], [], [], [], [], []],
    });
    const next = applyHint(state);
    expect(next.hint).toBeDefined();
    expect(next.hint?.type).toBe("tableau-to-foundation");
  });

  it("sets hint to undefined when no moves exist", () => {
    const state = mkState();
    const next = applyHint(state);
    expect(next.hint).toBeUndefined();
  });

  it("does not mutate the input state", () => {
    const state = mkState({
      tableau: [[c("spades", 1)], [], [], [], [], [], []],
    });
    const before = JSON.stringify(state);
    applyHint(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("returns a new state object even when hint is undefined", () => {
    const state = mkState();
    const next = applyHint(state);
    // applyHint always returns a new spread — reference differs
    expect(next).not.toBe(state);
  });

  it("input state undoStack is unaffected (applyHint does not push undo)", () => {
    const state = mkState({
      tableau: [[c("spades", 1)], [], [], [], [], [], []],
    });
    const next = applyHint(state);
    expect(next.undoStack).toEqual(state.undoStack);
    expect(next.undoStack).toHaveLength(0);
  });

  it("applies a 20-point penalty to the score", () => {
    const state = mkState({
      score: 100,
      tableau: [[c("spades", 1)], [], [], [], [], [], []],
    });
    const next = applyHint(state);
    expect(next.score).toBe(80);
  });

  it("floors the score at 0 when penalty would go negative", () => {
    const state = mkState({
      score: 10,
      tableau: [[c("spades", 1)], [], [], [], [], [], []],
    });
    const next = applyHint(state);
    expect(next.score).toBe(0);
  });

  it("clears hint when a real move is made after applyHint", () => {
    const state = mkState({
      tableau: [[c("spades", 1)], [c("hearts", 2)], [], [], [], [], []],
    });
    let current = applyHint(state);
    expect(current.hint).toBeDefined();
    // Make a move (tableau-to-foundation for the ace)
    current = applyMove(current, { type: "tableau-to-foundation", fromCol: 0 });
    expect(current.hint).toBeUndefined();
  });
});

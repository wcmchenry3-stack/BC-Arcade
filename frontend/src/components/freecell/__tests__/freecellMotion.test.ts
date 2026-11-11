/**
 * #3573: FreeCell's motion planner (which cards fly, from where, for how long, at what size)
 * against the owner's "A. Match Solitaire" parameters, and the cues it times.
 */
import { applyMove, autoComplete, undoMove } from "../../../game/freecell/engine";
import type { Card, FreeCellState, Rank, Suit } from "../../../game/freecell/types";
import { computeTableGeometry, faceUpStepFor } from "../../../game/_shared/cards/tableLayout";
import { createCardFlightStore } from "../../cards/cardFlights";
import {
  AUTO_FLIGHT_MS,
  easeOutCubic,
  cueTimes,
  DROP_SETTLE_MS,
  PEAK,
  PLACE_LEAD_MS,
  RUN_FLIGHT_MS,
  RUN_STAGGER_MS,
  TAP_FLIGHT_MS,
  type Shown,
} from "../../cards/cardMotion";
import {
  freeCellMotionLayout,
  planFreeCellMotion,
  type FreeCellMotionLayout,
} from "../freecellMotion";

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

const cols = (...piles: Card[][]): FreeCellState["tableau"] =>
  Array.from({ length: 8 }, (_, i) => piles[i] ?? []);

// Tableau cards 40 x 56, top-row cards 36 x 50 (0.9), gaps 4: columns are 44 apart, the top row
// is at y = 6 (the padding) and the tableau starts at 6 + 50 + 10 = 66, 20 dp a card.
const LAYOUT: FreeCellMotionLayout = {
  cardWidth: 40,
  cardHeight: 56,
  topCardWidth: 36,
  topCardHeight: 50,
  gap: 4,
  padding: 6,
  rowGap: 10,
  faceUpStep: () => 20,
};
const TOP = 36 / 40;
const TOP_SIZE = { width: 36, height: 50 };

const plan = (
  prev: FreeCellState,
  next: FreeCellState,
  kind: "tap" | "drop" | "undo" | "auto" = "tap",
  extra: { drop?: { x: number; y: number }; shownAt?: (key: string) => Shown | null } = {}
) => planFreeCellMotion({ prev, next, kind, layout: LAYOUT, ...extra });

describe("planFreeCellMotion", () => {
  it("a tapped card flies 200 ms from its slot to its new one; card place 40 ms before contact", () => {
    const prev = board({ tableau: cols([c("hearts", 6)], [c("spades", 7)]) });
    const next = applyMove(prev, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    const p = plan(prev, next);
    expect(p.flights).toEqual([
      {
        key: "hearts-6",
        card: c("hearts", 6),
        from: { x: 0, y: 66 },
        to: { x: 44, y: 86 },
        fromFaceUp: true,
        toFaceUp: true,
        delayMs: 0,
        durationMs: TAP_FLIGHT_MS,
      },
    ]);
    expect(p.moved).toBe(1);
    expect(p.contactMs).toBe(200);
    expect(cueTimes(p).place).toBe(200 - PLACE_LEAD_MS);
  });

  it("a supermove lands head first, 15 ms apart; the multi-move peak lands on the last contact", () => {
    const prev = board({
      tableau: cols([c("spades", 8), c("hearts", 7), c("clubs", 6)], [c("hearts", 9)]),
    });
    const next = applyMove(prev, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    const p = plan(prev, next);
    expect(p.flights.map((f) => [f.key, f.delayMs, f.durationMs])).toEqual([
      ["spades-8", 0, RUN_FLIGHT_MS],
      ["hearts-7", RUN_STAGGER_MS, RUN_FLIGHT_MS],
      ["clubs-6", 2 * RUN_STAGGER_MS, RUN_FLIGHT_MS],
    ]);
    expect(p.contactMs).toBe(250);
    expect(cueTimes(p).multi).toBe(250 - PEAK.multiMove);
  });

  it("a card going up to a free cell is drawn at the top row's size, shrinking from the tableau's", () => {
    const prev = board({ tableau: cols([c("hearts", 6)]) });
    const next = applyMove(prev, { type: "tableau-to-freecell", fromCol: 0, toCell: 2 });
    const [f] = plan(prev, next).flights;
    expect(f).toMatchObject({
      from: { x: 0, y: 66 },
      to: { x: 88, y: 6 },
      fromScale: 1,
      toScale: TOP,
      size: TOP_SIZE,
    });
  });

  it("a free-cell card coming down grows to the tableau's size, drawn at it", () => {
    const prev = board({
      tableau: cols([c("spades", 7)]),
      freeCells: [null, c("hearts", 6), null, null],
    });
    const next = applyMove(prev, { type: "freecell-to-tableau", fromCell: 1, toCol: 0 });
    const [f] = plan(prev, next).flights;
    expect(f).toMatchObject({
      from: { x: 44, y: 6 },
      to: { x: 0, y: 86 },
      fromScale: TOP,
      toScale: 1,
    });
    expect(f!.size).toBeUndefined();
  });

  it("a free-cell card to its foundation stays at the top row's size", () => {
    const prev = board({ freeCells: [c("spades", 1), null, null, null] });
    const next = applyMove(prev, { type: "freecell-to-foundation", fromCell: 0 });
    const [f] = plan(prev, next).flights;
    // Spades is the first foundation, over column 4.
    expect(f).toMatchObject({
      from: { x: 0, y: 6 },
      to: { x: 4 * 44, y: 6 },
      fromScale: TOP,
      toScale: TOP,
      size: TOP_SIZE,
    });
  });

  it("a tableau-to-tableau flight carries no scale or size (as Solitaire's)", () => {
    const prev = board({ tableau: cols([c("hearts", 6)], [c("spades", 7)]) });
    const next = applyMove(prev, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    const [f] = plan(prev, next).flights;
    expect(f).not.toHaveProperty("fromScale");
    expect(f).not.toHaveProperty("size");
  });

  it("a drop settles in 110 ms from where the ghost was let go; a dropped run all at once", () => {
    const prev = board({
      tableau: cols([c("spades", 8), c("hearts", 7)], [c("hearts", 9)]),
    });
    const next = applyMove(prev, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    const p = plan(prev, next, "drop", { drop: { x: 30, y: -12 } });
    expect(p.flights.map((f) => [f.from, f.delayMs, f.durationMs])).toEqual([
      [{ x: 30, y: 54 }, 0, DROP_SETTLE_MS],
      [{ x: 30, y: 74 }, 0, DROP_SETTLE_MS],
    ]);
    expect(p.contactMs).toBe(DROP_SETTLE_MS);
  });

  it("an Auto-Complete step's card flies 220 ms to its foundation", () => {
    const prev = board({ tableau: cols([c("spades", 1)]) });
    const next = autoComplete(prev);
    const p = plan(prev, next, "auto");
    expect(p.flights).toHaveLength(1);
    expect(p.flights[0]!.durationMs).toBe(AUTO_FLIGHT_MS);
    expect(cueTimes(p).settle).toBe(AUTO_FLIGHT_MS - PEAK.riffleSettle);
    expect(cueTimes(p).landed).toBe(AUTO_FLIGHT_MS);
  });

  it("Undo flies the card back with a tap's flight, a run with a run's", () => {
    const one = board({ tableau: cols([c("hearts", 6)], [c("spades", 7)]) });
    const moved = applyMove(one, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    expect(plan(moved, undoMove(moved), "undo").contactMs).toBe(TAP_FLIGHT_MS);
    const run = board({ tableau: cols([c("spades", 8), c("hearts", 7)], [c("hearts", 9)]) });
    const runMoved = applyMove(run, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    expect(plan(runMoved, undoMove(runMoved), "undo").contactMs).toBe(
      RUN_FLIGHT_MS + RUN_STAGGER_MS
    );
  });

  it("a card in flight is re-targeted from where, and at the size, it is shown", () => {
    const prev = board({
      tableau: cols([c("spades", 7)]),
      freeCells: [c("hearts", 6), null, null, null],
    });
    const next = applyMove(prev, { type: "freecell-to-tableau", fromCell: 0, toCol: 0 });
    const shown: Shown = {
      x: 10,
      y: 20,
      faceUp: true,
      toFaceUp: true,
      to: { x: 0, y: 6 },
      remainingMs: 80,
      action: 4,
      scale: 0.95,
    };
    const p = plan(prev, next, "tap", { shownAt: (k) => (k === "hearts-6" ? shown : null) });
    expect(p.flights[0]).toMatchObject({ from: { x: 10, y: 20 }, fromScale: 0.95, toScale: 1 });
    expect(p.cancelled).toEqual([4]);
  });

  it("a card shown already where it now lies does not fly and does not count toward the contact", () => {
    // Undo of a supermove whose second card had not left yet (still in its stagger): it is
    // shown at its old slot, which the Undo puts it back in. Only the first card flies back.
    const prev = board({
      tableau: cols([c("spades", 8), c("hearts", 7)], [c("hearts", 9)]),
    });
    const moved = applyMove(prev, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    const undone = undoMove(moved);
    const shownAt = (key: string): Shown | null => {
      const base = { faceUp: true, toFaceUp: true, remainingMs: 200, action: 7 };
      if (key === "spades-8") return { ...base, x: 30, y: 80, to: { x: 44, y: 86 } };
      if (key === "hearts-7") return { ...base, x: 0, y: 86, to: { x: 44, y: 106 } };
      return null;
    };
    const p = plan(moved, undone, "undo", { shownAt });
    expect(p.flights.map((f) => f.key)).toEqual(["spades-8"]);
    expect(p.settled).toEqual(["hearts-7"]);
    expect(p.moved).toBe(1);
    // The run's timing (two cards), but the contact is the moving card's: 220, not 235.
    expect(p.contactMs).toBe(RUN_FLIGHT_MS);
    expect(p.cancelled).toEqual([7]);
  });

  it("a card still in flight whose slot a move shifted slides on to its new slot", () => {
    // The step tightens from 20 to 14 once a column holds four cards.
    const layout = {
      ...LAYOUT,
      faceUpStep: (st: FreeCellState) => (st.tableau.some((p) => p.length >= 4) ? 14 : 20),
    };
    const prev = board({
      tableau: cols(
        [c("spades", 9), c("hearts", 8)],
        [c("clubs", 10), c("diamonds", 9), c("spades", 8)],
        [c("hearts", 7)]
      ),
    });
    const next = applyMove(prev, {
      type: "tableau-to-tableau",
      fromCol: 2,
      fromIndex: 0,
      toCol: 1,
    });
    // The 8♥ (column 0, second card) is still landing from an earlier action, aimed at y 86.
    const shownAt = (key: string): Shown | null =>
      key === "hearts-8"
        ? {
            x: 20,
            y: 80,
            faceUp: true,
            toFaceUp: true,
            to: { x: 0, y: 86 },
            remainingMs: 40,
            action: 3,
          }
        : null;
    const p = planFreeCellMotion({ prev, next, kind: "tap", layout, shownAt });
    expect(p.flights[0]).toMatchObject({
      key: "hearts-8",
      from: { x: 20, y: 80 },
      to: { x: 0, y: 66 + 14 },
      delayMs: 0,
      durationMs: 100,
    });
    // Its landing is its own action's: the contact is the moved card's.
    expect(p.contactMs).toBe(TAP_FLIGHT_MS);
    expect(p.moved).toBe(1);
    expect(p.cancelled).toEqual([]);
  });

  it("nothing moves for a hint (a state change with every card in place)", () => {
    const prev = board({ tableau: cols([c("hearts", 6)], [c("spades", 7)]) });
    const p = plan(prev, { ...prev, hint: { type: "tableau-to-freecell", fromCol: 0, toCell: 0 } });
    expect(p.flights).toEqual([]);
    expect(p.contactMs).toBe(0);
  });
});

describe("freeCellMotionLayout", () => {
  it("takes the board's geometry and its face-up step per state", () => {
    const g = computeTableGeometry({
      width: 390,
      height: 600,
      columns: 8,
      maxFaceDown: 0,
      maxFaceUp: 19,
      topRowScale: 0.92,
    });
    const layout = freeCellMotionLayout(g);
    expect(layout).toMatchObject({
      cardWidth: g.cardWidth,
      cardHeight: g.cardHeight,
      topCardWidth: g.topCardWidth,
      topCardHeight: g.topCardHeight,
      gap: g.gap,
      padding: g.padding,
      rowGap: g.rowGap,
    });
    const tall = board({
      tableau: cols(Array.from({ length: 13 }, (_, i) => c("spades", (13 - i) as Rank))),
    });
    expect(layout.faceUpStep(tall)).toBe(faceUpStepFor(g, [{ down: 0, up: 13 }]));
  });
});

describe("the flight store with scaling flights", () => {
  const spec = {
    key: "hearts-6",
    card: c("hearts", 6),
    from: { x: 0, y: 66 },
    to: { x: 88, y: 6 },
    fromFaceUp: true,
    toFaceUp: true,
    delayMs: 0,
    durationMs: 200,
  };

  it("shows a scaling card at its eased size, so a re-target starts from it", () => {
    const store = createCardFlightStore();
    store.launch([{ ...spec, fromScale: 1, toScale: TOP, size: TOP_SIZE }], 1000, 1);
    expect(store.shownAt("hearts-6", 1000)!.scale).toBe(1);
    expect(store.shownAt("hearts-6", 1100)!.scale).toBeCloseTo(1 + (TOP - 1) * easeOutCubic(0.5));
    expect(store.shownAt("hearts-6", 1200)!.scale).toBeCloseTo(TOP);
  });

  it("leaves the scale out for a flight that never scales", () => {
    const store = createCardFlightStore();
    store.launch([spec], 1000, 1);
    expect(store.shownAt("hearts-6", 1100)!.scale).toBeUndefined();
  });
});

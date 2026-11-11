/**
 * #3572: the motion planner (which cards fly, from where, for how long) and the sound cues it
 * times, against the owner's "A. Brisk" parameters; and the flight store's landings.
 */
import {
  applyMove,
  autoCompleteStepOf,
  drawFromStock,
  recycleWaste,
  undo,
} from "../../../game/solitaire/engine";
import type { Card, Rank, SolitaireState, Suit } from "../../../game/solitaire/types";
import { createCardFlightStore } from "../../cards/cardFlights";
import {
  AUTO_FLIGHT_MS,
  MIN_SLIDE_MS,
  cueTimes,
  DROP_SETTLE_MS,
  easeOutCubic,
  INSTANT_CUES,
  PEAK,
  PLACE_LEAD_MS,
  RUN_FLIGHT_MS,
  RUN_STAGGER_MS,
  TAP_FLIGHT_MS,
  type FlightSpec,
} from "../../cards/cardMotion";
import {
  DRAW3_STAGGER_MS,
  DRAW_MS,
  planMotion,
  RECYCLE_MS,
  REVEAL_TURN_MS,
  type MotionKind,
  type MotionLayout,
} from "../solitaireMotion";

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

const tableau = (...cols: Card[][]) => Array.from({ length: 7 }, (_, i) => cols[i] ?? []);

// Cards 40 x 56, gaps 4, a 12 dp row gap: the tableau starts at y = 68; columns are 44 apart.
const LAYOUT: MotionLayout = {
  cardWidth: 40,
  cardHeight: 56,
  gap: 4,
  rowGap: 12,
  boardWidth: 7 * 40 + 6 * 4,
  faceDownStep: 8,
  wasteFanOffset: 12,
  faceUpStep: () => 20,
};
const TABLEAU_Y = 56 + 12;
const colX = (col: number) => col * 44;
const FOUNDATION_X = 7 * 40 + 6 * 4 - 4 * 40 - 3 * 4;

const plan = (
  prev: SolitaireState,
  next: SolitaireState,
  kind: MotionKind = "tap",
  extra: Partial<Parameters<typeof planMotion>[0]> = {}
) => planMotion({ prev, next, kind, layout: LAYOUT, ...extra });

const keys = (flights: readonly FlightSpec[]) => flights.map((f) => f.key);

describe("planMotion", () => {
  it("a tapped card flies from its slot to its new one: 200 ms, card place 40 ms before contact", () => {
    const prev = board({ tableau: tableau([up("hearts", 6)], [up("spades", 7)]) });
    const next = applyMove(prev, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    const p = plan(prev, next);
    expect(p.flights).toEqual([
      expect.objectContaining({
        key: "hearts-6",
        from: { x: colX(0), y: TABLEAU_Y },
        to: { x: colX(1), y: TABLEAU_Y + 20 },
        delayMs: 0,
        durationMs: TAP_FLIGHT_MS,
      }),
    ]);
    expect(p.contactMs).toBe(200);
    expect(cueTimes(p).place).toBe(200 - PLACE_LEAD_MS);
  });

  it("a run flies 15 ms apart down the run; the multi-move peak lands on the last contact", () => {
    const prev = board({
      tableau: tableau([up("spades", 7), up("hearts", 6), up("clubs", 5)], [up("hearts", 8)]),
    });
    const next = applyMove(prev, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    const p = plan(prev, next);
    expect(keys(p.flights)).toEqual(["spades-7", "hearts-6", "clubs-5"]);
    expect(p.flights.map((f) => f.delayMs)).toEqual([0, RUN_STAGGER_MS, 2 * RUN_STAGGER_MS]);
    expect(p.flights.every((f) => f.durationMs === RUN_FLIGHT_MS)).toBe(true);
    expect(p.contactMs).toBe(220 + 30);
    expect(cueTimes(p).multi).toBe(250 - PEAK.multiMove);
  });

  it("the uncovered card turns in place after the landing, its flip peak on the edge-on point", () => {
    const prev = board({
      tableau: tableau([down("clubs", 9), up("hearts", 6)], [up("spades", 7)]),
    });
    const next = applyMove(prev, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 1,
      toCol: 1,
    });
    const p = plan(prev, next);
    // The turn is drawn under the moved card.
    expect(keys(p.flights)).toEqual(["clubs-9", "hearts-6"]);
    expect(p.flights[0]).toEqual(
      expect.objectContaining({
        from: { x: colX(0), y: TABLEAU_Y },
        to: { x: colX(0), y: TABLEAU_Y },
        fromFaceUp: false,
        toFaceUp: true,
        delayMs: TAP_FLIGHT_MS,
        durationMs: REVEAL_TURN_MS,
      })
    );
    expect(p.revealEdgeMs).toBe(200 + 70);
    expect(cueTimes(p).flip).toBe(270 - PEAK.flip);
  });

  it("Draw 1 slides and turns; the flip peaks on the edge-on point", () => {
    const prev = board({ stock: [down("clubs", 4), down("hearts", 2)] });
    const p = plan(prev, drawFromStock(prev), "stock");
    expect(p.flights).toEqual([
      expect.objectContaining({
        key: "hearts-2",
        from: { x: 0, y: 0 },
        to: { x: 44, y: 0 },
        fromFaceUp: false,
        toFaceUp: true,
        durationMs: DRAW_MS,
      }),
    ]);
    expect(cueTimes(p).flip).toBe(100 - PEAK.flip);
  });

  it("Draw 3 fans the three cards 36 ms apart; the fan leads the first card's edge-on point", () => {
    const prev = board({
      drawMode: 3,
      stock: [down("clubs", 4), down("hearts", 2), down("spades", 9)],
      waste: [up("diamonds", 5)],
    });
    const p = plan(prev, drawFromStock(prev), "stock");
    // The stock's top card is drawn first and lands at the back of the fan.
    expect(keys(p.flights)).toEqual(["spades-9", "hearts-2", "clubs-4"]);
    expect(p.flights.map((f) => f.delayMs)).toEqual([0, DRAW3_STAGGER_MS, 2 * DRAW3_STAGGER_MS]);
    expect(p.flights.map((f) => f.to.x)).toEqual([44, 44 + 12, 44 + 24]);
    expect(p.firstEdgeMs).toBe(DRAW_MS / 2);
    expect(cueTimes(p).fan).toBe(100 - PEAK.fanFirst);
  });

  it("the recycle slides the shown waste back to the stock, turning; the settle peaks on contact", () => {
    const prev = board({ waste: [up("clubs", 4), up("hearts", 2), up("spades", 9)] });
    const p = plan(prev, recycleWaste(prev), "stock");
    // Draw 1 shows one waste card: it slides on top of the deck, with the card that becomes the
    // stock's top under it; the cards between are not seen to move.
    expect(keys(p.flights)).toEqual(["clubs-4", "spades-9"]);
    expect(p.flights[1]).toEqual(
      expect.objectContaining({
        from: { x: 44, y: 0 },
        to: { x: 0, y: 0 },
        fromFaceUp: true,
        toFaceUp: false,
        delayMs: 0,
        durationMs: RECYCLE_MS,
      })
    );
    expect(cueTimes(p).settle).toBe(220 - PEAK.riffleSettle);
  });

  it("Undo flies the card back, card place on its landing; a re-covered card turns at once", () => {
    const start = board({
      tableau: tableau([down("clubs", 9), up("hearts", 6)], [up("spades", 7)]),
    });
    const moved = applyMove(start, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 1,
      toCol: 1,
    });
    const p = plan(moved, undo(moved), "undo");
    expect(keys(p.flights)).toEqual(["clubs-9", "hearts-6"]);
    expect(p.flights[0]).toEqual(expect.objectContaining({ delayMs: 0, toFaceUp: false }));
    expect(p.flights[1]).toEqual(
      expect.objectContaining({ from: { x: colX(1), y: TABLEAU_Y + 20 }, durationMs: 200 })
    );
    expect(cueTimes(p).place).toBe(200 - PLACE_LEAD_MS);
  });

  it("an Auto-Complete step flies its card to the foundation in 220 ms", () => {
    const prev = board({
      tableau: tableau([up("hearts", 1)]),
      foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
    });
    const { state: next } = autoCompleteStepOf(prev);
    const p = plan(prev, next, "auto");
    expect(p.flights).toEqual([
      expect.objectContaining({
        key: "hearts-1",
        to: { x: FOUNDATION_X + 44, y: 0 },
        durationMs: AUTO_FLIGHT_MS,
      }),
    ]);
  });

  it("a drop settles from where the ghost was let go, card place on contact", () => {
    const prev = board({ tableau: tableau([up("hearts", 6)], [up("spades", 7)]) });
    const next = applyMove(prev, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    const p = plan(prev, next, "drop", { drop: { x: 30, y: -12 } });
    expect(p.flights[0]).toEqual(
      expect.objectContaining({
        from: { x: colX(0) + 30, y: TABLEAU_Y - 12 },
        durationMs: DROP_SETTLE_MS,
      })
    );
    expect(cueTimes(p).place).toBe(110 - PLACE_LEAD_MS);
  });

  it("a dropped run settles together (no stagger)", () => {
    const prev = board({ tableau: tableau([up("spades", 7), up("hearts", 6)], [up("hearts", 8)]) });
    const next = applyMove(prev, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    const p = plan(prev, next, "drop", { drop: { x: 0, y: 0 } });
    expect(p.flights.map((f) => [f.delayMs, f.durationMs])).toEqual([
      [0, DROP_SETTLE_MS],
      [0, DROP_SETTLE_MS],
    ]);
  });

  it("a card already in flight is re-targeted from where it is shown", () => {
    const prev = board({ tableau: tableau([up("hearts", 6)], [up("spades", 7)]) });
    const next = applyMove(prev, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    const p = plan(prev, next, "tap", {
      shownAt: (key) =>
        key === "hearts-6"
          ? {
              x: 99,
              y: 77,
              faceUp: true,
              toFaceUp: true,
              action: 4,
              to: { x: 0, y: TABLEAU_Y },
              remainingMs: 100,
            }
          : null,
    });
    expect(p.flights[0]?.from).toEqual({ x: 99, y: 77 });
    // The action that had it in flight is called off.
    expect(p.cancelled).toEqual([4]);
  });

  it("a card re-targeted mid-turn turns on from the face it shows, not the state's", () => {
    // Draw 1 is under way: the 2♥ still shows its back. A new action (a re-target) moves it on.
    const prev = board({ waste: [up("hearts", 2)], tableau: tableau([], [up("spades", 3)]) });
    const next = applyMove(prev, { type: "waste-to-tableau", toCol: 1 });
    const p = plan(prev, next, "tap", {
      shownAt: (key) =>
        key === "hearts-2"
          ? {
              x: 50,
              y: 0,
              faceUp: false,
              toFaceUp: true,
              action: 1,
              to: { x: 0, y: TABLEAU_Y },
              remainingMs: 100,
            }
          : null,
    });
    expect(p.flights[0]).toEqual(expect.objectContaining({ fromFaceUp: false, toFaceUp: true }));
    expect(p.firstEdgeMs).toBe(TAP_FLIGHT_MS / 2);
  });

  it("Undo mid-flight: a reveal not yet turned is called off and lands face down, no turn", () => {
    const start = board({
      tableau: tableau([down("clubs", 9), up("hearts", 6)], [up("spades", 7)]),
    });
    const moved = applyMove(start, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 1,
      toCol: 1,
    });
    // 90 ms in: the 6♥ is on its way, the 9♣ still shows its back (its turn starts at 200).
    const shownAt = (key: string) =>
      key === "hearts-6"
        ? {
            x: 20,
            y: 70,
            faceUp: true,
            toFaceUp: true,
            action: 7,
            to: { x: 0, y: TABLEAU_Y },
            remainingMs: 100,
          }
        : key === "clubs-9"
          ? {
              x: 0,
              y: TABLEAU_Y,
              faceUp: false,
              toFaceUp: true,
              action: 7,
              to: { x: 0, y: TABLEAU_Y },
              remainingMs: 100,
            }
          : null;
    const p = plan(moved, undo(moved), "undo", { shownAt });
    expect(keys(p.flights)).toEqual(["hearts-6"]);
    expect(p.settled).toEqual(["clubs-9"]);
    expect(p.cancelled).toEqual([7]);
    expect(p.revealEdgeMs).toBeNull();
  });

  it("Undo after the reveal's edge-on point turns the card back from its face", () => {
    const start = board({
      tableau: tableau([down("clubs", 9), up("hearts", 6)], [up("spades", 7)]),
    });
    const moved = applyMove(start, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 1,
      toCol: 1,
    });
    const shownAt = (key: string) =>
      key === "hearts-6"
        ? {
            x: colX(1),
            y: TABLEAU_Y + 20,
            faceUp: true,
            toFaceUp: true,
            action: 7,
            to: { x: 0, y: TABLEAU_Y },
            remainingMs: 100,
          }
        : key === "clubs-9"
          ? {
              x: 0,
              y: TABLEAU_Y,
              faceUp: true,
              toFaceUp: true,
              action: 7,
              to: { x: 0, y: TABLEAU_Y },
              remainingMs: 100,
            }
          : null;
    const p = plan(moved, undo(moved), "undo", { shownAt });
    expect(p.flights[0]).toEqual(
      expect.objectContaining({ key: "clubs-9", fromFaceUp: true, toFaceUp: false, delayMs: 0 })
    );
    expect(p.settled).toEqual([]);
  });

  // Review round 2: an Undo while the reveal turns (not called off: the 6♥ had landed).
  const revealUndo = (faceUp: boolean) => {
    const start = board({
      tableau: tableau([down("clubs", 9), up("hearts", 6)], [up("spades", 7)]),
    });
    const moved = applyMove(start, {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 1,
      toCol: 1,
    });
    return plan(moved, undo(moved), "undo", {
      shownAt: (key) =>
        key === "clubs-9"
          ? {
              x: 0,
              y: TABLEAU_Y,
              faceUp,
              toFaceUp: true,
              action: 5,
              to: { x: 0, y: TABLEAU_Y },
              remainingMs: 100,
            }
          : null,
    });
  };

  it("Undo before the reveal's edge-on point: the card lands face down, its turn's action called off", () => {
    const p = revealUndo(false);
    expect(p.settled).toEqual(["clubs-9"]);
    expect(p.cancelled).toEqual([5]);
    expect(keys(p.flights)).toEqual(["hearts-6"]);
  });

  it("Undo past the reveal's edge-on point turns it back from the face it shows", () => {
    const p = revealUndo(true);
    expect(p.flights[0]).toEqual(
      expect.objectContaining({ key: "clubs-9", fromFaceUp: true, toFaceUp: false })
    );
    expect(p.settled).toEqual([]);
    expect(p.owesFlip).toBe(false);
  });

  it("a reveal re-planned for a called-off move owes its flip to the new action", () => {
    const prev = board({
      tableau: tableau([down("clubs", 9)], [up("spades", 7), up("hearts", 6)], [up("clubs", 7)]),
    });
    // The 6♥ (still flying to the 7♠) goes on to the 7♣; the 9♣'s turn has not begun.
    const moved = {
      ...prev,
      tableau: tableau([up("clubs", 9)], [up("spades", 7), up("hearts", 6)], [up("clubs", 7)]),
    };
    const next = applyMove(moved, {
      type: "tableau-to-tableau",
      fromCol: 1,
      fromIndex: 1,
      toCol: 2,
    });
    const p = plan(moved, next, "tap", {
      shownAt: (key) =>
        key === "hearts-6"
          ? {
              x: 30,
              y: 80,
              faceUp: true,
              toFaceUp: true,
              action: 3,
              to: { x: 0, y: TABLEAU_Y },
              remainingMs: 100,
            }
          : key === "clubs-9"
            ? {
                x: 0,
                y: TABLEAU_Y,
                faceUp: false,
                toFaceUp: true,
                action: 3,
                to: { x: 0, y: TABLEAU_Y },
                remainingMs: 100,
              }
            : null,
    });
    expect(p.flights[0]).toEqual(
      expect.objectContaining({ key: "clubs-9", fromFaceUp: false, delayMs: TAP_FLIGHT_MS })
    );
    expect(p.owesFlip).toBe(true);
    expect(cueTimes(p).flip).toBe(200 + 70 - PEAK.flip);
  });

  it("a drawn card re-targeted before its edge-on point owes its flip", () => {
    const prev = board({ waste: [up("hearts", 2)], tableau: tableau([], [up("spades", 3)]) });
    const next = applyMove(prev, { type: "waste-to-tableau", toCol: 1 });
    const p = plan(prev, next, "tap", {
      shownAt: () => ({
        x: 20,
        y: 0,
        faceUp: false,
        toFaceUp: true,
        action: 1,
        to: { x: 0, y: TABLEAU_Y },
        remainingMs: 100,
      }),
    });
    expect(p.owesFlip).toBe(true);
  });

  it("a called-off Draw-3 card still sliding slides on from where it is shown", () => {
    const prev = board({
      drawMode: 3,
      waste: [up("hearts", 7), up("hearts", 6), up("clubs", 5)],
      tableau: tableau([], [up("diamonds", 6)]),
    });
    // The draw (action 2) is under way; its 5♣ is played on to the 6♦.
    const next = applyMove(prev, { type: "waste-to-tableau", toCol: 1 });
    const p = plan(prev, next, "tap", {
      shownAt: (key) =>
        key === "clubs-5"
          ? {
              x: 30,
              y: 0,
              faceUp: false,
              toFaceUp: true,
              action: 2,
              to: { x: 68, y: 0 },
              remainingMs: 150,
            }
          : key === "hearts-6"
            ? {
                x: 40,
                y: 0,
                faceUp: false,
                toFaceUp: true,
                action: 2,
                to: { x: 56, y: 0 },
                remainingMs: 120,
              }
            : null,
    });
    expect(p.flights.find((f) => f.key === "hearts-6")).toEqual(
      expect.objectContaining({
        from: { x: 40, y: 0 },
        to: { x: 56, y: 0 },
        fromFaceUp: false,
        toFaceUp: true,
        delayMs: 0,
        durationMs: 120,
      })
    );
    expect(p.owesFlip).toBe(true);
  });

  it("a card that slides on stays its own action's (#3712 review)", () => {
    const prev = board({
      drawMode: 3,
      waste: [up("hearts", 7), up("hearts", 6), up("clubs", 5)],
      tableau: tableau([], [up("diamonds", 6)]),
    });
    const next = applyMove(prev, { type: "waste-to-tableau", toCol: 1 });
    const shown = (x: number, to: number, remainingMs: number) => ({
      x,
      y: 0,
      faceUp: false,
      toFaceUp: true,
      action: 2,
      to: { x: to, y: 0 },
      remainingMs,
    });
    const p = plan(prev, next, "tap", {
      shownAt: (key) =>
        key === "clubs-5" ? shown(30, 68, 150) : key === "hearts-6" ? shown(40, 56, 40) : null,
    });
    const slide = p.flights.find((f) => f.key === "hearts-6")!;
    expect(slide.owner).toBe(2);
    // 40 ms were left: the slide takes MIN_SLIDE_MS.
    expect(slide.durationMs).toBe(MIN_SLIDE_MS);
    // The card the tap moves is the tap's own.
    expect(p.flights.find((f) => f.key === "clubs-5")!.owner).toBeUndefined();
  });

  it("an unrelated action leaves another action's flights and cues alone", () => {
    const prev = board({
      stock: [down("clubs", 4)],
      tableau: tableau([], [up("spades", 7), up("hearts", 6)]),
    });
    const p = plan(prev, drawFromStock(prev), "stock", {
      shownAt: (key) =>
        key === "hearts-6"
          ? {
              x: 5,
              y: 5,
              faceUp: true,
              toFaceUp: true,
              action: 2,
              to: { x: colX(1), y: TABLEAU_Y + 20 },
              remainingMs: 100,
            }
          : null,
    });
    expect(keys(p.flights)).toEqual(["clubs-4"]);
    expect(p.cancelled).toEqual([]);
    expect(p.settled).toEqual([]);
  });

  it("nothing flies when nothing changed pile", () => {
    const s = board({ tableau: tableau([up("hearts", 6)]) });
    const p = plan(s, { ...s });
    expect(p.flights).toEqual([]);
    expect(p.contactMs).toBe(0);
  });

  // A constants check: the screen uses INSTANT_CUES for every action under Reduce Motion
  // (the screen-level Reduce Motion tests are in SolitaireScreen.motion.test.tsx).
  it("INSTANT_CUES (Reduce Motion's cue table) is all zeros", () => {
    expect(Object.values(INSTANT_CUES).every((v) => v === 0)).toBe(true);
  });
});

describe("createCardFlightStore", () => {
  const spec = (key: string, extra: Partial<FlightSpec> = {}): FlightSpec => ({
    key,
    card: up("hearts", 6),
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    fromFaceUp: true,
    toFaceUp: true,
    delayMs: 0,
    durationMs: 200,
    ...extra,
  });

  it("hides a card until its flight lands, and reports the action's landing once", () => {
    const store = createCardFlightStore();
    const landed = jest.fn();
    store.launch([spec("a"), spec("b")], 0, 1, landed);
    expect(store.isFlying("a")).toBe(true);
    const [a, b] = store.getFlights();
    store.land(a!.id);
    expect(landed).not.toHaveBeenCalled();
    store.land(b!.id);
    store.land(b!.id);
    expect(landed).toHaveBeenCalledTimes(1);
    expect(store.isFlying("a")).toBe(false);
  });

  it("a re-targeted card's old flight counts as landed for its action", () => {
    const store = createCardFlightStore();
    const first = jest.fn();
    store.launch([spec("a")], 0, 1, first);
    store.launch([spec("a", { from: { x: 50, y: 0 } })], 100, 2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(store.getFlights()).toHaveLength(1);
  });

  it("shows a card in flight where its eased flight has it", () => {
    const store = createCardFlightStore();
    store.launch([spec("a", { delayMs: 20, fromFaceUp: false })], 1000, 3);
    expect(store.shownAt("a", 1000)).toEqual({
      x: 0,
      y: 0,
      faceUp: false,
      toFaceUp: true,
      action: 3,
      to: { x: 100, y: 0 },
      remainingMs: 220,
    });
    expect(store.shownAt("a", 1120)!.x).toBeCloseTo(100 * easeOutCubic(0.5));
    // The face turns at the edge-on point, halfway through the flight's own time.
    expect(store.shownAt("a", 1119)!.faceUp).toBe(false);
    expect(store.shownAt("a", 1120)!.faceUp).toBe(true);
    expect(store.shownAt("a", 5000)).toEqual({
      x: 100,
      y: 0,
      faceUp: true,
      toFaceUp: true,
      action: 3,
      to: { x: 100, y: 0 },
      remainingMs: 0,
    });
    expect(store.shownAt("b", 1000)).toBeNull();
  });

  it("landKeys lands those cards now and settles their action", () => {
    const store = createCardFlightStore();
    const landed = jest.fn();
    store.launch([spec("a"), spec("b")], 0, 1, landed);
    store.landKeys(["a"]);
    expect(store.isFlying("a")).toBe(false);
    expect(store.isFlying("b")).toBe(true);
    store.landKeys(["b"]);
    expect(landed).toHaveBeenCalledTimes(1);
  });

  it("clear drops every flight and every pending landing", () => {
    const store = createCardFlightStore();
    const landed = jest.fn();
    store.launch([spec("a")], 0, 1, landed);
    store.clear();
    expect(store.getFlights()).toEqual([]);
    store.land(1);
    expect(landed).not.toHaveBeenCalled();
  });
});

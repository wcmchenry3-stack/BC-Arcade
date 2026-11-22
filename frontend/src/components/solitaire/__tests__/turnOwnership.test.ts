/**
 * #3712 review round 2: a card that slides on for its own action, turning, had its flip cued by
 * the later action that launched the slide. A third action that takes the card over (plays it,
 * or recycles the waste) must call that flip off and owe it itself, so the flip never plays for
 * a turn that is no longer happening, nor at the wrong edge. Run through the screen's own rules:
 * `planMotion`, the flight store, `launchMotion` and the cue clock on fake timers, the cues
 * scheduled as SolitaireScreen schedules them.
 */
import { applyMove, drawFromStock, recycleWaste } from "../../../game/solitaire/engine";
import type { Card, Rank, SolitaireState, Suit } from "../../../game/solitaire/types";
import { createCardFlightStore } from "../../cards/cardFlights";
import { cueTimes, type MotionPlan } from "../../cards/cardMotion";
import { launchMotion } from "../../cards/launchMotion";
import { createCueClock } from "../../cards/useCueClock";
import { planMotion, type MotionKind, type MotionLayout } from "../solitaireMotion";

const T0 = 1_700_000_000_000;
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
const down = (suit: Suit, rank: Rank): Card => ({ suit, rank, faceUp: false });
const upTo = (suit: Suit, rank: number): Card[] =>
  Array.from({ length: rank }, (_, i) => ({ suit, rank: (i + 1) as Rank, faceUp: true }));

function board(overrides: Partial<SolitaireState> = {}): SolitaireState {
  return {
    _v: 1,
    drawMode: 3,
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

interface Step {
  readonly at: number;
  readonly kind: MotionKind;
  readonly next: (s: SolitaireState) => SolitaireState;
}

/** Runs actions at the given times; returns when each flip played, in ms after the first. */
function run(steps: readonly Step[], start: SolitaireState) {
  const store = createCardFlightStore();
  const clock = createCueClock();
  const flips: number[] = [];
  const plans: MotionPlan[] = [];
  let state = start;
  let action = 0;
  const base = Date.now();
  for (const step of steps) {
    jest.advanceTimersByTime(base + step.at - Date.now());
    const now = Date.now();
    const next = step.next(state);
    const a = ++action;
    const plan = planMotion({
      prev: state,
      next,
      kind: step.kind,
      layout: LAYOUT,
      shownAt: (key) => store.shownAt(key, now),
    });
    plans.push(plan);
    const { owesFlip } = launchMotion({ plan, now, action: a, store, clock, playPlace: () => {} });
    const c = cueTimes(plan);
    const events = next.events ?? [];
    const flip = () => flips.push(Date.now() - base);
    if (events.includes("cardFlip")) clock.schedule(flip, c.flip, a, "flip");
    if (events.includes("cardFan")) clock.schedule(() => undefined, c.fan, a, "fan");
    if (owesFlip && !events.includes("cardFlip")) clock.schedule(flip, c.flip, a, "flip");
    state = next;
  }
  jest.advanceTimersByTime(2000);
  return { flips, plans };
}

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
});
afterEach(() => {
  jest.useRealTimers();
});

const DRAW: Step = { at: 0, kind: "stock", next: drawFromStock };
/** B, at 40 ms: the waste's top card (the 5♣, still waiting for its stagger) to its foundation. */
const PLAY_TOP: Step = {
  at: 40,
  kind: "tap",
  next: (s) => applyMove(s, { type: "waste-to-foundation" }),
};

/**
 * A draws three (the 5♣ on top, drawn last); the 6♥ and the 7♥ are still turning face up when B
 * plays the 5♣ at 40 ms, calling A off: they slide on, as A's, and B owes their flip.
 */
const start = () =>
  board({
    foundations: { spades: [], hearts: upTo("hearts", 5), diamonds: [], clubs: upTo("clubs", 4) },
    stock: [down("clubs", 5), down("hearts", 6), down("hearts", 7)],
  });

it("the slide's flip, owed by the action that launched it, lands on its edge-on point", () => {
  const { flips, plans } = run([DRAW, PLAY_TOP], start());
  expect(plans[1]!.flights.filter((f) => f.owner === 1).map((f) => f.key)).toEqual([
    "hearts-7",
    "hearts-6",
  ]);
  // The 7♥ slides on in 160 ms: edge-on at 40 + 80, less the flip's 28 ms lead.
  expect(flips).toEqual([92]);
});

it("C plays a sliding card at 60 ms: B's flip goes, and C owes it on its own edge-on point", () => {
  const PLAY: Step = {
    at: 60,
    kind: "tap",
    next: (s) => applyMove(s, { type: "waste-to-foundation" }),
  };
  const { flips, plans } = run([DRAW, PLAY_TOP, PLAY], start());
  // C takes the 6♥ (the top: A's card, its turn cued by B): it calls both off.
  expect(plans[2]!.cancelled).toEqual(expect.arrayContaining([1, 2]));
  // C's first edge-on point is at 60 + 70 (the 7♥ sliding on in 140 ms), less 28.
  expect(flips).toEqual([102]);
});

it("C recycles the waste at 60 ms: B's flip goes, and no card turns face up, so none plays", () => {
  const RECYCLE: Step = { at: 60, kind: "stock", next: recycleWaste };
  const { flips, plans } = run([DRAW, PLAY_TOP, RECYCLE], start());
  expect(plans[2]!.cancelled).toEqual(expect.arrayContaining([1, 2]));
  // Both cards still showed their backs (their edge-on points were ahead), and go back face down.
  expect(plans[2]!.flights.every((f) => !f.fromFaceUp && !f.toFaceUp)).toBe(true);
  expect(flips).toEqual([]);
});

/**
 * #3712 review: a card that only slides on to a shifted slot stays its own action's. Launched
 * by a later action, it keeps its action's landing (and its card place); a third action that
 * moves the card calls off its own action, not the one that slid it.
 */
import { createCardFlightStore } from "../cardFlights";
import { type FlightSpec, type MotionPlan, PLACE_LEAD_MS } from "../cardMotion";
import { launchMotion } from "../launchMotion";
import { createCueClock, type CueTag } from "../useCueClock";

const T0 = 1_700_000_000_000;

const spec = (key: string, extra: Partial<FlightSpec> = {}): FlightSpec => ({
  key,
  card: { suit: "hearts", rank: 6 },
  from: { x: 0, y: 0 },
  to: { x: 100, y: 0 },
  fromFaceUp: true,
  toFaceUp: true,
  delayMs: 0,
  durationMs: 200,
  ...extra,
});

const planOf = (flights: FlightSpec[], extra: Partial<MotionPlan> = {}): MotionPlan => ({
  flights,
  moved: flights.length,
  contactMs: 200,
  firstEdgeMs: null,
  revealEdgeMs: null,
  cancelled: [],
  settled: [],
  owesFlip: false,
  ...extra,
});

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
});
afterEach(() => {
  jest.useRealTimers();
});

describe("a slide keeps its action", () => {
  it("is launched as its owner's: the owner's landing waits for it, the launcher's does not", () => {
    const store = createCardFlightStore();
    const aLanded = jest.fn();
    const bLanded = jest.fn();
    store.launch([spec("hearts-6")], T0, 1, aLanded);
    store.launch(
      [spec("hearts-6", { from: { x: 50, y: 0 }, to: { x: 100, y: 20 }, owner: 1 })],
      T0 + 50,
      2,
      bLanded
    );
    // B moved none of its own cards: it has landed; A has not.
    expect(bLanded).toHaveBeenCalledTimes(1);
    expect(aLanded).not.toHaveBeenCalled();
    expect(store.getFlights()[0]!.action).toBe(1);
    expect(store.shownAt("hearts-6", T0 + 60)!.action).toBe(1);
    expect(store.lastContactOf(2)).toBeNull();
    expect(store.lastContactOf(1)).toBe(T0 + 50 + 200);
    store.land(store.getFlights()[0]!.id);
    expect(aLanded).toHaveBeenCalledTimes(1);
  });

  it("the probe: A's card place goes when C moves the card B slid on; B's and C's play", () => {
    const store = createCardFlightStore();
    const clock = createCueClock();
    const played: { tag: CueTag; group: number; at: number }[] = [];
    const cue = (group: number, ms: number) =>
      clock.schedule(
        () => played.push({ tag: "place", group, at: Date.now() - T0 }),
        ms,
        group,
        "place"
      );
    const playPlace = (group: number) => played.push({ tag: "place", group, at: Date.now() - T0 });

    // A (1): the 6♥ flies, card place at 160.
    launchMotion({ plan: planOf([spec("hearts-6")]), now: T0, action: 1, store, clock, playPlace });
    cue(1, 200 - PLACE_LEAD_MS);
    // B (2), at 50: its own card flies; the 6♥ slides on to its shifted slot, still A's.
    jest.advanceTimersByTime(50);
    launchMotion({
      plan: planOf([
        spec("hearts-6", {
          from: { x: 50, y: 0 },
          to: { x: 100, y: 20 },
          durationMs: 150,
          owner: 1,
        }),
        spec("clubs-9"),
      ]),
      now: T0 + 50,
      action: 2,
      store,
      clock,
      playPlace,
    });
    cue(2, 200 - PLACE_LEAD_MS);
    // C (3), at 100: the 6♥ goes to a free cell. It calls A off (the card is A's), not B.
    jest.advanceTimersByTime(50);
    const shown = store.shownAt("hearts-6", T0 + 100)!;
    expect(shown.action).toBe(1);
    launchMotion({
      plan: planOf([spec("hearts-6", { from: { x: shown.x, y: shown.y } })], {
        cancelled: [shown.action],
      }),
      now: T0 + 100,
      action: 3,
      store,
      clock,
      playPlace,
    });
    cue(3, 200 - PLACE_LEAD_MS);
    jest.advanceTimersByTime(1000);
    // A's place never plays (its only card is C's now); B's and C's do, once each.
    expect(played.map((p) => [p.group, p.at])).toEqual([
      [2, 210],
      [3, 260],
    ]);
  });

  it("a called-off action keeps a card place for a card it slides on", () => {
    const store = createCardFlightStore();
    const clock = createCueClock();
    const played: number[] = [];
    const playPlace = (group: number) => played.push(group);
    // A (1) flies two cards; its card place is pending.
    launchMotion({
      plan: planOf([spec("a"), spec("b")]),
      now: T0,
      action: 1,
      store,
      clock,
      playPlace,
    });
    clock.schedule(() => played.push(1), 160, 1, "place");
    jest.advanceTimersByTime(50);
    // B (2) takes over card a and slides card b on as A's: A's place moves to b's contact.
    launchMotion({
      plan: planOf(
        [spec("a", { from: { x: 30, y: 0 } }), spec("b", { durationMs: 300, owner: 1 })],
        { cancelled: [1] }
      ),
      now: T0 + 50,
      action: 2,
      store,
      clock,
      playPlace,
    });
    expect(store.lastContactOf(1)).toBe(T0 + 50 + 300);
    jest.advanceTimersByTime(1000);
    expect(played).toEqual([1]);
  });
});

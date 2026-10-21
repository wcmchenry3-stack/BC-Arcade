/**
 * #3397 — the ghost card must start on the card and stay anchored to the
 * finger for the whole gesture, whatever the measurements do. These tests
 * drive the real DraggableCard pan callbacks (as RNGH calls them) with
 * Reanimated's measure() mocked per view, and read the ghost's shared values.
 */
import React, { useEffect, useRef } from "react";
import { AppState, Text } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";
import * as Sentry from "@sentry/react-native";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { DragProvider, useDragContext } from "../DragContext";
import type { Bounds, DragCard, DragSource } from "../DragContext";
import { DraggableCard } from "../DraggableCard";
import { DragContainer } from "../DragContainer";
import { DragOverlay } from "../DragOverlay";
import { DRAG_MISMATCH_SAMPLE_RATE, resetDragDiagnosticsForTests } from "../dragDiagnostics";
import type { PageRect } from "../dragGeometry";
import { detectedGesture } from "../../../../test-utils/mockScreenDeps";
import type { DetectorRender } from "../../../../test-utils/mockScreenDeps";

const mockDetected: DetectorRender[] = [];
jest.mock("react-native-gesture-handler", () =>
  mockScreenDeps().mockGestureHandler(() => mockDetected)
);

// ---------------------------------------------------------------------------
// Fixtures: a phone with a header + safe area above the DragContainer.
// ---------------------------------------------------------------------------

const SOL_CARD = { width: 52, height: 73 };
const FC_CARD = { width: 40, height: 56 };
const CONTAINER: PageRect = { pageX: 0, pageY: 90, width: 390, height: 700 };

const wasteSrc: DragSource = { game: "solitaire", type: "waste" };
const tableauSrc: DragSource = { game: "solitaire", type: "tableau", col: 2, fromIndex: 0 };
const fcSrc: DragSource = { game: "freecell", type: "tableau", col: 4, fromIndex: 0 };

const cardsOf = (size: { width: number; height: number }): DragCard[] => [
  { suit: "hearts", rank: 7, faceDown: false, width: size.width, height: size.height },
];

const ZONE: Bounds = { x: 0, y: 600, width: 60, height: 90 };

let ctxRef: ReturnType<typeof useDragContext> | null = null;

function Probe() {
  const ctx = useDragContext();
  ctxRef = ctx;
  return <Text testID="probe">{ctx.dragState ? "dragging" : "idle"}</Text>;
}

function Zone() {
  const { registerDropZone, unregisterDropZone, updateDropZoneLayout } = useDragContext();
  useEffect(() => {
    registerDropZone("zone", { onDrop: () => true });
    updateDropZoneLayout("zone", ZONE);
    return () => unregisterDropZone("zone");
  }, [registerDropZone, unregisterDropZone, updateDropZoneLayout]);
  return null;
}

function Board({
  source = wasteSrc,
  size = SOL_CARD,
  cardKey = "7h",
  showCard = true,
}: {
  source?: DragSource;
  size?: { width: number; height: number };
  cardKey?: string;
  showCard?: boolean;
}) {
  return (
    <DragProvider getLegalDropIds={() => ["zone"]}>
      <ThemeProvider>
        <Probe />
        <Zone />
        {showCard && (
          // Keyed like the draw-3 waste fan: a new key is a fresh mount.
          <DraggableCard key={cardKey} testID="card" dragCards={cardsOf(size)} dragSource={source}>
            <Text testID="face">7♥</Text>
          </DraggableCard>
        )}
        <DragOverlay />
      </ThemeProvider>
    </DragProvider>
  );
}

// ---------------------------------------------------------------------------
// measure(): the container ref answers `containerMeasure`, every other ref
// (the card wrapper) answers `cardMeasure`. null = not laid out yet.
// ---------------------------------------------------------------------------

let cardMeasure: PageRect | null;
let containerMeasure: PageRect | null;
let measureSpy: jest.SpyInstance;
let refSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  mockDetected.length = 0;
  ctxRef = null;
  cardMeasure = null;
  containerMeasure = CONTAINER;
  resetDragDiagnosticsForTests();
  (Sentry.captureMessage as jest.Mock).mockClear();
  (Sentry.addBreadcrumb as jest.Mock).mockClear();
  // Stable animated refs (the global mock hands out a new object per render),
  // so measure() can tell the container from the card.
  refSpy = jest
    .spyOn(Reanimated, "useAnimatedRef")
    .mockImplementation((() => useRef({ current: null }).current) as never);
  measureSpy = jest
    .spyOn(Reanimated, "measure")
    .mockImplementation(((ref: unknown) =>
      ref === ctxRef?.containerRef ? containerMeasure : cardMeasure) as never);
});

afterEach(() => {
  measureSpy.mockRestore();
  refSpy.mockRestore();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** A touch that lands at `grab` inside a card at page `card` and activates
 *  after moving `act` px (RNGH's minDistance), then follows `moves`. */
function gestureAt(card: { pageX: number; pageY: number }, grab: { x: number; y: number }) {
  const downX = card.pageX + grab.x;
  const downY = card.pageY + grab.y;
  return {
    /** Event at finger offset (dx, dy) from touch-down. */
    ev: (dx: number, dy: number) => ({
      absoluteX: downX + dx,
      absoluteY: downY + dy,
      x: grab.x + dx,
      y: grab.y + dy,
      translationX: dx,
      translationY: dy,
    }),
  };
}

function pan() {
  const h = detectedGesture(mockDetected, "pan", { testID: "face" });
  if (!h) throw new Error("no pan gesture");
  return {
    start: (e: object) => act(() => h.onStart!(e)),
    update: (e: object) => act(() => h.onUpdate!(e)),
    end: (e: object, success: boolean) => act(() => h.onEnd!(e, success)),
    finalize: (e: object, success: boolean) => act(() => h.onFinalize!(e, success)),
  };
}

const ghost = () => ({ x: ctxRef!.cardX.value, y: ctxRef!.cardY.value });

/** Where the ghost must be: finger − grab offset − container. */
function expectAnchored(
  e: { absoluteX: number; absoluteY: number },
  grab: { x: number; y: number },
  container = CONTAINER
) {
  const g = ghost();
  expect(g.x).toBeCloseTo(e.absoluteX - grab.x - container.pageX, 5);
  expect(g.y).toBeCloseTo(e.absoluteY - grab.y - container.pageY, 5);
}

const finishSprings = (cbs: ((f?: boolean) => void)[]) =>
  act(() => {
    cbs.splice(0).forEach((cb) => cb(true));
  });

function spySprings() {
  const springCallbacks: ((f?: boolean) => void)[] = [];
  jest.spyOn(Reanimated, "withSpring").mockImplementation(((
    to: unknown,
    _cfg: unknown,
    cb?: (f?: boolean) => void
  ) => {
    if (cb) springCallbacks.push(cb);
    return to as number;
  }) as never);
  return springCallbacks;
}

const state = (getByTestId: (id: string) => { props: { children: unknown } }) =>
  String(getByTestId("probe").props.children);

// ---------------------------------------------------------------------------

describe("ghost position through a drag (#3397)", () => {
  const cases: [string, DragSource, { width: number; height: number }, PageRect][] = [
    ["Solitaire draw-1 waste", wasteSrc, SOL_CARD, { pageX: 76, pageY: 150, ...SOL_CARD }],
    // Draw-3: the top card is the third in the fan, 2 × 16 px right of the pile.
    ["Solitaire draw-3 waste", wasteSrc, SOL_CARD, { pageX: 76 + 32, pageY: 150, ...SOL_CARD }],
    ["Solitaire tableau", tableauSrc, SOL_CARD, { pageX: 140, pageY: 300, ...SOL_CARD }],
    ["FreeCell tableau", fcSrc, FC_CARD, { pageX: 210, pageY: 260, ...FC_CARD }],
  ];

  it.each(cases)(
    "%s: starts on the card and stays anchored to the finger to release",
    async (_name, source, size, card) => {
      cardMeasure = card;
      await render(<Board source={source} size={size} />);
      const grab = { x: 20, y: 30 };
      const g = gestureAt(card, grab);
      const p = pan();

      // Activation after 5 px of movement (minDistance(5)).
      const start = g.ev(0, 5);
      await p.start(start);
      // The ghost starts exactly on the card — no jump by the activation distance.
      expect(ghost()).toEqual({ x: card.pageX - CONTAINER.pageX, y: card.pageY - CONTAINER.pageY });
      expectAnchored(start, { x: grab.x, y: grab.y + 5 });

      for (const [dx, dy] of [
        [10, 40],
        [-60, -120],
        [150, 350],
      ] as const) {
        const e = g.ev(dx, dy);
        await p.update(e);
        expectAnchored(e, { x: grab.x, y: grab.y + 5 });
      }
      await p.end(g.ev(150, 350), true);
      await p.finalize(g.ev(150, 350), true);
    }
  );

  it("a card measure 500 px off the gesture: at translation 0 the ghost starts at the gesture-derived position", async () => {
    // Isolates the #3397 defence from the activation-anchor change: with
    // translation 0 at onStart, the anchor arithmetic adds nothing, so only
    // the measure cross-check can keep the ghost off the bad measure.
    const card = { pageX: 76, pageY: 150, ...SOL_CARD };
    cardMeasure = { ...card, pageY: 650 };
    await render(<Board />);
    const g = gestureAt(card, { x: 20, y: 30 });
    await pan().start(g.ev(0, 0));
    expect(ghost()).toEqual({ x: card.pageX - CONTAINER.pageX, y: card.pageY - CONTAINER.pageY });
  });

  it("a card measure 500 px off the gesture: the ghost starts under the finger and stays anchored", async () => {
    const card = { pageX: 76, pageY: 150, ...SOL_CARD };
    cardMeasure = { ...card, pageY: 650 }; // bad measure
    await render(<Board />);
    const grab = { x: 20, y: 30 };
    const g = gestureAt(card, grab);
    const p = pan();
    await p.start(g.ev(0, 5));
    expect(ghost().y).toBeCloseTo(card.pageY - CONTAINER.pageY, 5);
    const e = g.ev(30, 200);
    await p.update(e);
    expectAnchored(e, { x: grab.x, y: grab.y + 5 });
  });

  it("a freshly mounted card (measure null) uses the gesture origin and stays anchored", async () => {
    const card = { pageX: 108, pageY: 150, ...SOL_CARD };
    cardMeasure = null;
    const { rerender } = await render(<Board cardKey="7h" />);
    // A draw remounts the waste card under a new key.
    await rerender(<Board cardKey="8s" />);
    const grab = { x: 10, y: 12 };
    const g = gestureAt(card, grab);
    const p = pan();
    await p.start(g.ev(4, 3));
    const e = g.ev(-40, 260);
    await p.update(e);
    expectAnchored(e, { x: grab.x + 4, y: grab.y + 3 });
  });

  it("nonzero container offsets (safe area / landscape inset) on both axes", async () => {
    const container = { pageX: 44, pageY: 137, width: 300, height: 600 };
    containerMeasure = container;
    const card = { pageX: 120, pageY: 200, ...FC_CARD };
    cardMeasure = card;
    await render(<Board source={fcSrc} size={FC_CARD} />);
    const grab = { x: 8, y: 8 };
    const g = gestureAt(card, grab);
    const p = pan();
    await p.start(g.ev(5, 0));
    const e = g.ev(100, 100);
    await p.update(e);
    expectAnchored(e, { x: grab.x + 5, y: grab.y }, container);
  });

  it("changing the cached container offset after drag start does not move the active ghost", async () => {
    const card = { pageX: 76, pageY: 150, ...SOL_CARD };
    cardMeasure = card;
    await render(<Board />);
    const grab = { x: 20, y: 30 };
    const g = gestureAt(card, grab);
    const p = pan();
    await p.start(g.ev(0, 5));
    // A stale DragContainer.onLayout measure lands now.
    ctxRef!.containerOffsetY.value = 600;
    ctxRef!.containerOffsetX.value = 33;
    const e = g.ev(0, 100);
    await p.update(e);
    expectAnchored(e, { x: grab.x, y: grab.y + 5 });
  });

  it("the container measure failing at drag start falls back to the cached onLayout offset", async () => {
    const card = { pageX: 76, pageY: 150, ...SOL_CARD };
    cardMeasure = card;
    // DragContainer's onLayout runs its measure on the UI thread; the global
    // Reanimated mock has no runOnUI, so run it inline.
    const mod = Reanimated as unknown as { runOnUI?: unknown };
    const prevRunOnUI = mod.runOnUI;
    mod.runOnUI = (fn: () => void) => fn;
    try {
      await runCachedFallback();
    } finally {
      mod.runOnUI = prevRunOnUI;
    }

    async function runCachedFallback() {
      const { getByTestId } = await render(
        <DragProvider>
          <ThemeProvider>
            <DragContainer>
              <Probe />
              <DraggableCard testID="card" dragCards={cardsOf(SOL_CARD)} dragSource={wasteSrc}>
                <Text testID="face">7♥</Text>
              </DraggableCard>
            </DragContainer>
          </ThemeProvider>
        </DragProvider>
      );
      // The DragContainer is the probe's host parent.
      const containerView = getByTestId("probe").parent!;
      expect(containerView.props.collapsable).toBe(false);
      await fireEvent(containerView, "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 700 } },
      });
      expect(ctxRef!.containerOffsetY.value).toBe(90);
      expect(ctxRef!.containerMeasuredAt.value).toBeGreaterThan(0);

      // A later 0×0 layout (screen hidden mid-transition) keeps the good cache.
      containerMeasure = { pageX: 0, pageY: 0, width: 0, height: 0 };
      await fireEvent(containerView, "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 0, height: 0 } },
      });
      expect(ctxRef!.containerOffsetY.value).toBe(90);
      expect(ctxRef!.containerHeight.value).toBeGreaterThan(0);

      containerMeasure = null; // the drag-start re-measure fails
      const grab = { x: 20, y: 30 };
      const g = gestureAt(card, grab);
      const p = pan();
      await p.start(g.ev(0, 5));
      const e = g.ev(50, 50);
      await p.update(e);
      expectAnchored(e, { x: grab.x, y: grab.y + 5 });
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    }
  });
});

describe("drag lifecycle with positions (#3397)", () => {
  it("rapid repeated drags: a new grab during the snap-back starts on the card, and the old spring doesn't clear it", async () => {
    const springs = spySprings();
    const card = { pageX: 76, pageY: 150, ...SOL_CARD };
    cardMeasure = card;
    const { getByTestId } = await render(<Board />);
    const grab = { x: 20, y: 30 };
    const g = gestureAt(card, grab);

    for (let i = 0; i < 3; i++) {
      const p = pan();
      await p.start(g.ev(0, 5));
      expect(ghost()).toEqual({ x: 76, y: 60 });
      const e = g.ev(200, -100);
      await p.update(e);
      expectAnchored(e, { x: grab.x, y: grab.y + 5 });
      // Dropped nowhere: springs home; the next grab comes before it lands.
      await p.end(e, true);
      await p.finalize(e, true);
    }
    expect(state(getByTestId)).toBe("dragging");
    await finishSprings(springs);
    expect(state(getByTestId)).toBe("idle");
  });

  it("a grab while the previous snap-back is still springing keeps the new drag after the spring lands", async () => {
    const springs = spySprings();
    const card = { pageX: 76, pageY: 150, ...SOL_CARD };
    cardMeasure = card;
    const { getByTestId } = await render(<Board />);
    const g = gestureAt(card, { x: 20, y: 30 });
    const p = pan();
    await p.start(g.ev(0, 5));
    await p.end(g.ev(200, -100), true);
    await p.finalize(g.ev(200, -100), true);
    // New grab before the spring callback.
    const p2 = pan();
    await p2.start(g.ev(5, 0));
    await finishSprings(springs); // the first drag's spring lands
    expect(state(getByTestId)).toBe("dragging");
    const e = g.ev(40, 40);
    await p2.update(e);
    expectAnchored(e, { x: 25, y: 30 });
  });

  it("a cancelled gesture snaps back to the origin, never drops, and leaves no ghost", async () => {
    const springs = spySprings();
    const card = { pageX: 76, pageY: 150, ...SOL_CARD };
    cardMeasure = card;
    const { getByTestId, queryByTestId } = await render(<Board />);
    const g = gestureAt(card, { x: 20, y: 30 });
    const p = pan();
    await p.start(g.ev(0, 5));
    // Finger over the drop zone when the system cancels.
    const over = { absoluteX: 30, absoluteY: 640, x: 0, y: 0, translationX: 0, translationY: 0 };
    await p.update(over);
    await p.end(over, false);
    await p.finalize(over, false);
    expect(ghost()).toEqual({ x: 76, y: 60 });
    await finishSprings(springs);
    expect(state(getByTestId)).toBe("idle");
    expect(queryByTestId("drag-overlay-ghost")).toBeNull();
  });

  it("the waste card remounting mid-drag (draw-3 key change) cancels the drag cleanly", async () => {
    const card = { pageX: 108, pageY: 150, ...SOL_CARD };
    cardMeasure = card;
    const { getByTestId, rerender } = await render(<Board cardKey="7h" />);
    await pan().start(gestureAt(card, { x: 10, y: 10 }).ev(0, 5));
    expect(state(getByTestId)).toBe("dragging");
    await rerender(<Board cardKey="8s" />);
    expect(state(getByTestId)).toBe("idle");
    // The ghost is parked at the origin, not at the last finger position.
    expect(ghost()).toEqual({ x: 108, y: 60 });
  });

  it("AppState leaving the foreground mid-drag clears without a stranded ghost", async () => {
    const listeners = new Set<(s: string) => void>();
    jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _t: string,
      cb: (s: string) => void
    ) => {
      listeners.add(cb);
      return { remove: () => listeners.delete(cb) };
    }) as never);
    cardMeasure = { pageX: 76, pageY: 150, ...SOL_CARD };
    const { getByTestId } = await render(<Board />);
    await pan().start(gestureAt(cardMeasure, { x: 10, y: 10 }).ev(0, 5));
    await act(() => listeners.forEach((cb) => cb("background")));
    expect(state(getByTestId)).toBe("idle");
  });
});

describe("drag.positionMismatch diagnostics (#3397)", () => {
  const card = { pageX: 76, pageY: 150, ...SOL_CARD };
  const mismatchCalls = () =>
    (Sentry.captureMessage as jest.Mock).mock.calls.filter((c) => c[0] === "drag.positionMismatch");

  async function dragOnce(bad: boolean) {
    cardMeasure = bad ? { ...card, pageY: 650 } : card;
    const p = pan();
    const g = gestureAt(card, { x: 20, y: 30 });
    await p.start(g.ev(0, 5));
    await p.end(g.ev(0, 5), true);
  }

  it("never fires for normal drags", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);
    await render(<Board />);
    for (let i = 0; i < 5; i++) await dragOnce(false);
    expect(mismatchCalls()).toHaveLength(0);
    const starts = (Sentry.addBreadcrumb as jest.Mock).mock.calls.filter(
      (c) => c[0].message === "drag.start"
    );
    expect(starts[0][0].data).toMatchObject({
      cardSource: "measured",
      containerSource: "measured",
    });
  });

  it("fires at most once per process for a sampled-in process, with rounded diagnostics", async () => {
    jest.spyOn(Math, "random").mockReturnValue(DRAG_MISMATCH_SAMPLE_RATE / 2);
    await render(<Board />);
    for (let i = 0; i < 4; i++) await dragOnce(true);
    const calls = mismatchCalls();
    expect(calls).toHaveLength(1);
    const [, opts] = calls[0];
    expect(opts.level).toBe("warning");
    expect(opts.tags).toEqual({ subsystem: "drag", game: "solitaire" });
    expect(opts.extra).toMatchObject({
      cardSource: "gesture",
      containerSource: "measured",
      cardMismatch: true,
      mismatchY: 500,
      originY: 60,
      containerAgeMs: -1,
    });
    expect(opts.extra.trace.length).toBeLessThanOrEqual(5);
    for (const v of Object.values(opts.extra)) {
      if (typeof v === "number") expect(Number.isInteger(v)).toBe(true);
    }
    // Later anomalies are breadcrumbs only.
    const anomalies = (Sentry.addBreadcrumb as jest.Mock).mock.calls.filter(
      (c) => c[0].message === "drag.positionAnomaly"
    );
    expect(anomalies).toHaveLength(4);
  });

  it("a sampled-out process sends nothing", async () => {
    jest.spyOn(Math, "random").mockReturnValue(DRAG_MISMATCH_SAMPLE_RATE + 0.01);
    await render(<Board />);
    for (let i = 0; i < 3; i++) await dragOnce(true);
    expect(mismatchCalls()).toHaveLength(0);
  });
});

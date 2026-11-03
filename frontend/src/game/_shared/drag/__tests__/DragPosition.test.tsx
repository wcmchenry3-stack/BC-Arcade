/**
 * #3397 — the ghost card must start on the card and stay anchored to the
 * finger for the whole gesture, whatever the measurements do. These tests
 * drive the real DraggableCard pan callbacks (as RNGH calls them) with
 * Reanimated's measure() mocked per view, and read the ghost's shared values.
 */
import React, { useEffect, useRef } from "react";
import { AppState, Platform, Text } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";
import * as Sentry from "@sentry/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { __forceStoreBuildForTests } from "../../buildFlavour";
import { DragProvider, useDragContext } from "../DragContext";
import type { Bounds, DragCard, DragSource } from "../DragContext";
import {
  DraggableCard,
  GHOST_CHECK_DELAY_MS,
  GHOST_CHECK_MAX_ATTEMPTS,
  GHOST_CHECK_MAX_MEASURES,
} from "../DraggableCard";
import { DragContainer } from "../DragContainer";
import { DragGhostHost } from "../DragGhostHost";
import { DRAG_MISMATCH_SAMPLE_RATE, resetDragDiagnosticsForTests } from "../dragDiagnostics";
import { resetDragDebugForTests, setDragDebugEnabled } from "../dragDebug";
import { GHOST_LIFT } from "../dragGeometry";
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
  showOverlay = true,
}: {
  source?: DragSource;
  size?: { width: number; height: number };
  cardKey?: string;
  showCard?: boolean;
  showOverlay?: boolean;
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
        {showOverlay && <DragGhostHost />}
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
/** What the ghost's animated ref returns when called on the UI thread: its
 *  shadow-node wrapper, or null before the ghost view first mounts. */
let ghostRefValue: unknown;

/** A stable animated ref that, like Reanimated's on the UI thread, is a
 *  function returning the view's wrapper (null = not mounted). Called by
 *  React as a callback ref (with an argument) it does nothing. */
function makeAnimatedRef() {
  const ref = Object.assign(
    (...args: unknown[]): unknown => {
      if (args.length > 0) return undefined;
      return ref === ctxRef?.ghostRef ? ghostRefValue : {};
    },
    { current: null }
  );
  return ref;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockDetected.length = 0;
  ctxRef = null;
  cardMeasure = null;
  containerMeasure = CONTAINER;
  ghostRefValue = {};
  resetDragDiagnosticsForTests();
  (Sentry.captureMessage as jest.Mock).mockClear();
  (Sentry.addBreadcrumb as jest.Mock).mockClear();
  // Stable animated refs (the global mock hands out a new object per render),
  // so measure() can tell the container from the card.
  refSpy = jest
    .spyOn(Reanimated, "useAnimatedRef")
    .mockImplementation((() => useRef(makeAnimatedRef()).current) as never);
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

/** RNGH resets the pan's translation to 0 when it activates (iOS, Android and
 *  web), so `onStart` sees translation 0 and later events count it from the
 *  activation point. The fixtures describe moves from touch-down; `pan()`
 *  converts them to what RNGH sends (#3531 review). */
let activationTranslation = { x: 0, y: 0 };
type Translated = { translationX?: number; translationY?: number };
const fromActivation = (e: object): object => ({
  ...e,
  translationX: ((e as Translated).translationX ?? 0) - activationTranslation.x,
  translationY: ((e as Translated).translationY ?? 0) - activationTranslation.y,
});

function pan() {
  const h = detectedGesture(mockDetected, "pan", { testID: "face" });
  if (!h) throw new Error("no pan gesture");
  return {
    start: (e: object) => {
      const t = e as Translated;
      activationTranslation = { x: t.translationX ?? 0, y: t.translationY ?? 0 };
      return act(() => h.onStart!(fromActivation(e)));
    },
    update: (e: object) => act(() => h.onUpdate!(fromActivation(e))),
    end: (e: object, success: boolean) => act(() => h.onEnd!(fromActivation(e), success)),
    finalize: (e: object, success: boolean) => act(() => h.onFinalize!(fromActivation(e), success)),
  };
}

const ghost = () => ({ x: ctxRef!.cardX.value, y: ctxRef!.cardY.value });

/** Where the ghost must be: finger − grab offset, in window coordinates
 *  (the root ghost host's, #3531). */
function expectAnchored(
  e: { absoluteX: number; absoluteY: number },
  grab: { x: number; y: number }
) {
  const g = ghost();
  expect(g.x).toBeCloseTo(e.absoluteX - grab.x, 5);
  expect(g.y).toBeCloseTo(e.absoluteY - grab.y, 5);
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
      expect(ghost()).toEqual({ x: card.pageX, y: card.pageY });
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
    expect(ghost()).toEqual({ x: card.pageX, y: card.pageY });
  });

  it("a card measure 500 px off the gesture: the ghost starts under the finger and stays anchored", async () => {
    const card = { pageX: 76, pageY: 150, ...SOL_CARD };
    cardMeasure = { ...card, pageY: 650 }; // bad measure
    await render(<Board />);
    const grab = { x: 20, y: 30 };
    const g = gestureAt(card, grab);
    const p = pan();
    await p.start(g.ev(0, 5));
    expect(ghost().y).toBeCloseTo(card.pageY, 5);
    const e = g.ev(30, 200);
    await p.update(e);
    expectAnchored(e, { x: grab.x, y: grab.y + 5 });
  });

  it("a freshly mounted card (measure null): the ghost starts on it and stays anchored", async () => {
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
    expectAnchored(e, { x: grab.x + 5, y: grab.y });
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

  it("the container measure failing at drag start keeps the cached onLayout offset; the ghost stays anchored", async () => {
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
      expect(ghost()).toEqual({ x: 76, y: 150 });
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
    expect(ghost()).toEqual({ x: 76, y: 150 });
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
    expect(ghost()).toEqual({ x: 108, y: 150 });
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

describe("rendered ghost vs finger: drag.ghostOffset (#3528)", () => {
  const card = { pageX: 76, pageY: 150, ...SOL_CARD };
  const grab = { x: 20, y: 30 };
  let ghostMeasure: () => PageRect | null;
  let ghostMeasures = 0;

  /** The ghost as the root DragGhostHost renders it (#3531): the host's
   *  *rendered* origin (shifted by `renderOffsetY` inside the RN layout) +
   *  cardX/Y − lift. */
  const renderedGhost =
    (renderOffsetY: number): (() => PageRect) =>
    () => ({
      pageX: ctxRef!.cardX.value,
      pageY: renderOffsetY + ctxRef!.cardY.value - GHOST_LIFT,
      width: 0,
      height: 0,
    });

  beforeEach(() => {
    cardMeasure = card;
    ghostMeasures = 0;
    ghostMeasure = renderedGhost(0);
    measureSpy.mockImplementation(((ref: unknown) => {
      if (ref === ctxRef?.ghostRef) {
        ghostMeasures += 1;
        return ghostMeasure();
      }
      return ref === ctxRef?.containerRef ? containerMeasure : cardMeasure;
    }) as never);
  });

  const ghostEvents = () =>
    (Sentry.captureMessage as jest.Mock).mock.calls.filter((c) => c[0] === "drag.ghostOffset");
  const ghostCrumbs = () =>
    (Sentry.addBreadcrumb as jest.Mock).mock.calls
      .map((c) => c[0])
      .filter((b) => b.message === "drag.ghostCheck");
  const wait = (ms: number) => act(() => jest.advanceTimersByTime(ms));

  /** Grab, wait past the check delay, move through `steps`, release. */
  async function drag(steps: [number, number][], { waitMs = GHOST_CHECK_DELAY_MS + 20 } = {}) {
    const g = gestureAt(card, grab);
    const p = pan();
    await p.start(g.ev(0, 5));
    await wait(waitMs);
    for (const [dx, dy] of steps) await p.update(g.ev(dx, dy));
    const [lx, ly] = steps.length ? steps[steps.length - 1] : [0, 5];
    await p.end(g.ev(lx, ly), true);
    await p.finalize(g.ev(lx, ly), true);
  }

  it("a ghost host rendered 120 px low in the RN layout: exactly one event, deltaY ≈ 120", async () => {
    ghostMeasure = renderedGhost(120);
    await render(<Board />);
    await drag([
      [10, 40],
      [30, 90],
      [60, 200],
    ]);
    const events = ghostEvents();
    expect(events).toHaveLength(1);
    const [, opts] = events[0];
    expect(opts.fingerprint).toEqual(["drag.ghostOffset", "render", "solitaire", "waste"]);
    expect(opts.tags).toMatchObject({ subsystem: "drag", game: "solitaire", sourceType: "waste" });
    expect(opts.extra.deltaY).toBeCloseTo(120, 0);
    expect(opts.extra.deltaX).toBe(0);
    // The grab includes the 5 px activation move.
    expect(opts.extra.grabX).toBe(grab.x);
    expect(opts.extra.grabY).toBe(grab.y + 5);
    expect(opts.extra).toMatchObject({
      containerPageY: CONTAINER.pageY,
      containerUsedY: CONTAINER.pageY,
      cardSource: "measured",
      containerSource: "measured",
      at: "update",
      measures: 1,
    });
    expect(opts.extra.msSinceStart).toBeGreaterThanOrEqual(GHOST_CHECK_DELAY_MS);
    // One fail breadcrumb; the end hop adds no second record.
    expect(ghostCrumbs().map((b) => b.data.status)).toEqual(["fail"]);
  });

  it("a ghost rendered where the finger says: no event, one ok breadcrumb", async () => {
    await render(<Board />);
    await drag([
      [10, 40],
      [-60, -120],
      [150, 350],
    ]);
    expect(ghostEvents()).toHaveLength(0);
    expect(ghostCrumbs()).toEqual([
      expect.objectContaining({
        level: "info",
        data: { status: "ok", dx: 0, dy: 0, dmx: 0, dmy: 0, game: "solitaire", src: "waste" },
      }),
    ]);
  });

  it("FreeCell: the same check, grouped under its own game and source", async () => {
    ghostMeasure = renderedGhost(120);
    const fcCard = { pageX: 210, pageY: 260, ...FC_CARD };
    cardMeasure = fcCard;
    await render(<Board source={fcSrc} size={FC_CARD} />);
    const g = gestureAt(fcCard, { x: 8, y: 8 });
    const p = pan();
    await p.start(g.ev(5, 0));
    await wait(GHOST_CHECK_DELAY_MS);
    await p.update(g.ev(20, 20));
    await p.end(g.ev(20, 20), true);
    const events = ghostEvents();
    expect(events).toHaveLength(1);
    expect(events[0][1].fingerprint).toEqual(["drag.ghostOffset", "render", "freecell", "tableau"]);
    expect(events[0][1].extra.deltaY).toBe(120);
  });

  it("a drag shorter than the delay is checked at onEnd", async () => {
    ghostMeasure = renderedGhost(120);
    await render(<Board />);
    await drag([[10, 40]], { waitMs: 0 });
    const events = ghostEvents();
    expect(events).toHaveLength(1);
    expect(events[0][1].extra.at).toBe("end");
    expect(ghostMeasures).toBe(1);
  });

  it("no measure() in onUpdate once the check has run (1 ghost measure per passing drag)", async () => {
    await render(<Board />);
    const g = gestureAt(card, grab);
    const p = pan();
    await p.start(g.ev(0, 5));
    // Before the delay: arithmetic only.
    const afterStart = measureSpy.mock.calls.length;
    await p.update(g.ev(5, 10));
    expect(measureSpy.mock.calls.length).toBe(afterStart);
    await wait(GHOST_CHECK_DELAY_MS);
    await p.update(g.ev(10, 20)); // the check
    expect(ghostMeasures).toBe(1);
    const afterCheck = measureSpy.mock.calls.length;
    for (let i = 0; i < 30; i++) {
      await wait(16);
      await p.update(g.ev(10 + i, 20 + 3 * i));
    }
    await p.end(g.ev(40, 110), true);
    expect(measureSpy.mock.calls.length).toBe(afterCheck);
    expect(ghostMeasures).toBe(1);
  });

  it("onUpdate stops tracking the finger once the check has run", async () => {
    await render(<Board />);
    const g = gestureAt(card, grab);
    const p = pan();
    await p.start(g.ev(0, 5));
    await wait(GHOST_CHECK_DELAY_MS);
    await p.update(g.ev(10, 20)); // the check
    const s = ctxRef!.ghostCheck.value;
    const tracked = { x: s.lastFingerX, y: s.lastFingerY };
    for (let i = 0; i < 5; i++) await p.update(g.ev(50 + i, 90 + i));
    expect({ x: s.lastFingerX, y: s.lastFingerY }).toEqual(tracked);
    // The ghost itself still follows.
    expectAnchored(g.ev(54, 94), { x: grab.x, y: grab.y + 5 });
  });

  it("the check state is per provider: a card adds no ghost-check shared values", async () => {
    const useSV = jest.spyOn(Reanimated, "useSharedValue");
    await render(
      <DragProvider>
        <ThemeProvider>
          <Probe />
        </ThemeProvider>
      </DragProvider>
    );
    const providerOnly = useSV.mock.calls.length;
    useSV.mockClear();
    await render(<Board />);
    // Board = provider + one card; the card keeps only panActivated + anchorX/Y.
    expect(useSV.mock.calls.length - providerOnly).toBeLessThanOrEqual(3);
  });

  describe("a ghost that is not mounted is never measured", () => {
    it("overlay not mounted yet at a quick flick's onEnd: no measure, no throw, unmeasured", async () => {
      ghostMeasure = () => {
        throw new Error("measure() of an unmounted ghost");
      };
      await render(<Board showOverlay={false} />);
      const g = gestureAt(card, grab);
      const p = pan();
      await p.start(g.ev(0, 5));
      await p.update(g.ev(10, 40));
      await p.end(g.ev(10, 40), true);
      expect(ghostMeasures).toBe(0);
      expect(ghostEvents()).toHaveLength(0);
      expect(ghostCrumbs().map((b) => b.data.status)).toEqual(["unmeasured"]);
    });

    it("overlay not mounted through a long drag: bounded attempts, no measure", async () => {
      await render(<Board showOverlay={false} />);
      const g = gestureAt(card, grab);
      const p = pan();
      await p.start(g.ev(0, 5));
      for (let i = 0; i < 60; i++) {
        await wait(16);
        await p.update(g.ev(i, 2 * i));
      }
      expect(ctxRef!.ghostCheck.value.attempts).toBe(GHOST_CHECK_MAX_ATTEMPTS);
      await p.end(g.ev(59, 118), true);
      expect(ghostMeasures).toBe(0);
      expect(ghostCrumbs().map((b) => b.data.status)).toEqual(["unmeasured"]);
    });

    it("the ghost's UI-side ref still null (first mount not applied): no measure", async () => {
      ghostRefValue = null;
      await render(<Board />);
      expect(ctxRef!.ghostMounted.value).toBe(false);
      const g = gestureAt(card, grab);
      const p = pan();
      await p.start(g.ev(0, 5));
      expect(ctxRef!.ghostMounted.value).toBe(true);
      await wait(GHOST_CHECK_DELAY_MS);
      await p.update(g.ev(10, 40));
      await p.end(g.ev(10, 40), true);
      expect(ghostMeasures).toBe(0);
      expect(ghostCrumbs().map((b) => b.data.status)).toEqual(["unmeasured"]);
    });

    it("overlay unmounted (drag cancelled) while the pan keeps going: no measure", async () => {
      await render(<Board />);
      const g = gestureAt(card, grab);
      const p = pan();
      await p.start(g.ev(0, 5));
      expect(ctxRef!.ghostMounted.value).toBe(true);
      await act(() => ctxRef!.cancelDrag("test"));
      expect(ctxRef!.ghostMounted.value).toBe(false);
      await wait(GHOST_CHECK_DELAY_MS);
      await p.update(g.ev(10, 40));
      await p.end(g.ev(10, 40), false);
      expect(ghostMeasures).toBe(0);
      expect(ghostEvents()).toHaveLength(0);
    });
  });

  describe("a constant 60 px RNGH-vs-measure() offset with the card measure rejected", () => {
    // RNGH puts the finger 60 px lower than measure() page space does, so
    // the card measure (150) disagrees with the gesture origin (210) by more
    // than the tolerance and is rejected. The ghost is drawn from the gesture
    // origin: gesture space says it is fine, the card's measure says it is
    // 60 px low. That is informational (measureSpace), not a real offset.
    const eps = 60;
    async function rejectedDrag() {
      cardMeasure = card;
      const g = gestureAt({ pageX: card.pageX, pageY: card.pageY + eps }, grab);
      const p = pan();
      await p.start(g.ev(0, 5));
      await wait(GHOST_CHECK_DELAY_MS);
      await p.update(g.ev(10, 40));
      await p.update(g.ev(20, 80));
      await p.end(g.ev(20, 80), true);
      await p.finalize(g.ev(20, 80), true);
    }

    it("internal build: one measureSpace event (not a render one), deltas kept", async () => {
      await render(<Board />);
      await rejectedDrag();
      const events = ghostEvents();
      expect(events).toHaveLength(1);
      const [, opts] = events[0];
      expect(opts.fingerprint).toEqual(["drag.ghostOffset", "measureSpace", "solitaire", "waste"]);
      expect(opts.tags.failKind).toBe("measureSpace");
      const { extra } = opts;
      expect(Math.abs(extra.deltaX)).toBeLessThanOrEqual(1);
      expect(Math.abs(extra.deltaY)).toBeLessThanOrEqual(1);
      expect(extra.deltaMeasureX).toBe(0);
      expect(extra.deltaMeasureY).toBeCloseTo(eps, 0);
      expect(extra).toMatchObject({
        failGesture: false,
        failMeasure: true,
        cardMismatch: true,
        cardSource: "gesture",
        cardMeasuredX: card.pageX,
        cardMeasuredY: card.pageY,
      });
    });

    it("its own budget (3 per process internal), and a later real offset still reports", async () => {
      await render(<Board />);
      await rejectedDrag();
      await rejectedDrag();
      expect(ghostEvents()).toHaveLength(2);
      // Now a genuine 120 px render offset (card measure accepted).
      ghostMeasure = renderedGhost(120);
      const g = gestureAt(card, grab);
      const p = pan();
      await p.start(g.ev(0, 5));
      await wait(GHOST_CHECK_DELAY_MS);
      await p.update(g.ev(10, 40));
      await p.end(g.ev(10, 40), true);
      await p.finalize(g.ev(10, 40), true);
      expect(ghostEvents().map((c) => c[1].tags.failKind)).toEqual([
        "measureSpace",
        "measureSpace",
        "render",
      ]);
      // The same 60 px twice: a constant surface offset, not a stale measure.
      expect(ghostEvents().map((c) => c[1].extra.measureSpaceConsistent)).toEqual([
        false,
        true,
        undefined,
      ]);
      expect(ghostCrumbs().map((b) => b.data.kind)).toEqual([
        "measureSpace",
        "measureSpace",
        "render",
      ]);
    });

    it("store build: breadcrumb only", async () => {
      __forceStoreBuildForTests(true);
      try {
        jest.spyOn(Math, "random").mockReturnValue(0);
        await render(<Board />);
        await rejectedDrag();
        expect(ghostEvents()).toHaveLength(0);
        expect(ghostCrumbs().map((b) => b.data.kind)).toEqual(["measureSpace"]);
      } finally {
        __forceStoreBuildForTests(false);
      }
    });
  });

  describe("fast flick around the React commit", () => {
    /** Flick straight down at `step` px per frame. The check frame measures a
     *  ghost one frame stale (Reanimated held a frame), offset by `realY`. */
    async function flick(step: number, realY: number) {
      await render(<Board />);
      const g = gestureAt(card, grab);
      const ev = (dy: number) => ({ ...g.ev(0, dy), velocityX: 0, velocityY: step * 60 });
      const p = pan();
      await p.start(ev(5));
      await p.update(ev(5 + step)); // frame A
      await p.update(ev(5 + 2 * step)); // frame B: last write before the check
      // On screen: frame A's ghost (stale), plus any real offset.
      const frameA = ev(5 + step);
      ghostMeasure = () => ({
        pageX: frameA.absoluteX - grab.x,
        pageY: frameA.absoluteY - (grab.y + 5) - GHOST_LIFT + realY,
        width: 0,
        height: 0,
      });
      await wait(GHOST_CHECK_DELAY_MS);
      await p.update(ev(5 + 3 * step)); // the check
      await p.end(ev(5 + 3 * step), true);
    }

    it("a ghost one frame behind a 50 px/frame flick is not reported", async () => {
      await flick(50, 0);
      expect(ghostEvents()).toHaveLength(0);
      expect(ghostCrumbs()[0].data).toMatchObject({ status: "ok", dy: -50, dmy: -50 });
    });

    it("a real 120 px offset during a 27 px/frame flick still is, with the velocity", async () => {
      await flick(27, 120);
      const events = ghostEvents();
      expect(events).toHaveLength(1);
      expect(events[0][1].extra).toMatchObject({
        deltaY: 120 - 27,
        velocityY: 27 * 60,
        tolY: Math.round(36.5 + 27),
      });
    });
  });

  it("a measure that ignores the ghost's transform is a transformIgnored event on the render budget", async () => {
    // The ghost measures at its host's origin (the root host's 0,0, #3531)
    // although DragGhostHost set a large translate on it.
    ghostMeasure = () => ({ pageX: 0, pageY: 0, width: 0, height: 0 });
    await render(<Board />);
    await drag([
      [10, 40],
      [30, 90],
    ]);
    const events = ghostEvents();
    expect(events).toHaveLength(1);
    expect(events[0][1].fingerprint).toEqual([
      "drag.ghostOffset",
      "transformIgnored",
      "solitaire",
      "waste",
    ]);
    expect(events[0][1].tags.failKind).toBe("transformIgnored");
    expect(ghostCrumbs().map((b) => [b.data.status, b.data.kind])).toEqual([
      ["fail", "transformIgnored"],
    ]);
  });

  it("transformIgnored counts against the render cap (3 internal events across kinds)", async () => {
    ghostMeasure = () => ({ pageX: 0, pageY: 0, width: 0, height: 0 });
    await render(<Board />);
    for (let i = 0; i < 5; i++) {
      await drag([[10, 40]]);
      await act(() => jest.runOnlyPendingTimers());
    }
    expect(ghostEvents()).toHaveLength(3);
  });

  it("web: the ghost is never measured and nothing is recorded", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    ghostMeasure = renderedGhost(120);
    await render(<Board />);
    await drag([
      [10, 40],
      [30, 90],
    ]);
    expect(ghostMeasures).toBe(0);
    expect(ghostEvents()).toHaveLength(0);
    expect(ghostCrumbs()).toHaveLength(0);
    expect(ctxRef!.ghostCheck.value.attempts).toBe(0);
  });

  it("a ghost that never measures: at most 2 measures, recorded as unmeasured, never an offset", async () => {
    ghostMeasure = () => null;
    await render(<Board />);
    const g = gestureAt(card, grab);
    const p = pan();
    await p.start(g.ev(0, 5));
    for (let i = 0; i < 40; i++) {
      await wait(16);
      await p.update(g.ev(i, 2 * i));
    }
    await p.end(g.ev(39, 78), true);
    expect(GHOST_CHECK_MAX_MEASURES).toBe(2);
    expect(ghostMeasures).toBe(GHOST_CHECK_MAX_MEASURES);
    expect(ghostEvents()).toHaveLength(0);
    expect(ghostCrumbs().map((b) => b.data.status)).toEqual(["unmeasured"]);
  });

  it("a null first measure is retried and the retry can find the offset", async () => {
    let calls = 0;
    const offset = renderedGhost(120);
    ghostMeasure = () => (++calls === 1 ? null : offset());
    await render(<Board />);
    await drag([
      [10, 40],
      [20, 60],
    ]);
    expect(ghostMeasures).toBe(2);
    const events = ghostEvents();
    expect(events).toHaveLength(1);
    expect(events[0][1].extra.measures).toBe(2);
  });

  it("a passing drag makes no runOnJS hop beyond start and end", async () => {
    const runOnJS = jest.spyOn(Reanimated, "runOnJS");
    await render(<Board />);
    await drag([
      [10, 40],
      [60, 200],
    ]);
    // onStart's startDrag hop + onEnd's drop hop; onFinalize after onEnd is a no-op.
    expect(runOnJS).toHaveBeenCalledTimes(2);
  });

  it("a failing drag adds exactly one hop", async () => {
    ghostMeasure = renderedGhost(120);
    const runOnJS = jest.spyOn(Reanimated, "runOnJS");
    await render(<Board />);
    await drag([
      [10, 40],
      [60, 200],
    ]);
    expect(runOnJS).toHaveBeenCalledTimes(3);
  });

  it("each drag is checked once: repeated failing drags in an internal build stop at 3 events", async () => {
    ghostMeasure = renderedGhost(120);
    await render(<Board />);
    for (let i = 0; i < 5; i++) {
      await drag([[10, 40]]);
      await act(() => jest.runOnlyPendingTimers());
    }
    expect(ghostEvents()).toHaveLength(3);
    expect(ghostCrumbs().map((b) => b.data.status)).toEqual(Array(5).fill("fail"));
  });
});

describe("drag debug overlay result and frame path (#3529)", () => {
  const card = { pageX: 76, pageY: 150, ...SOL_CARD };
  const grab = { x: 20, y: 30 };
  let ghostMeasure: () => PageRect | null;
  const wait = (ms: number) => act(() => jest.advanceTimersByTime(ms));

  beforeEach(async () => {
    // setDragDebugEnabled persists; don't let one test's choice load in the next.
    await AsyncStorage.clear();
    resetDragDebugForTests();
    cardMeasure = card;
    ghostMeasure = () => ({
      pageX: ctxRef!.cardX.value,
      pageY: ctxRef!.cardY.value - GHOST_LIFT,
      width: 0,
      height: 0,
    });
    measureSpy.mockImplementation(((ref: unknown) => {
      if (ref === ctxRef?.ghostRef) return ghostMeasure();
      return ref === ctxRef?.containerRef ? containerMeasure : cardMeasure;
    }) as never);
  });

  afterEach(() => {
    resetDragDebugForTests();
  });

  async function drag(offsetY = 0) {
    const g = gestureAt({ pageX: card.pageX, pageY: card.pageY + offsetY }, grab);
    const p = pan();
    await p.start(g.ev(0, 5));
    await wait(GHOST_CHECK_DELAY_MS + 20);
    await p.update(g.ev(10, 40));
    await p.update(g.ev(60, 200));
    await p.end(g.ev(60, 200), true);
    await p.finalize(g.ev(60, 200), true);
  }

  it("a passing drag shows drag-check: ok with the real deltas", async () => {
    setDragDebugEnabled(true);
    const { getByTestId } = await render(<Board />);
    await drag();
    const line = getByTestId("drag-debug-result");
    expect(line.props.children).toBe("drag-check: ok Δ(0,0)");
    expect(line.props.accessibilityLabel).toBe("drag-check: ok Δ(0,0)");
  });

  it("a ghost rendered 120 px low shows drag-check: FAIL render", async () => {
    setDragDebugEnabled(true);
    ghostMeasure = () => ({
      pageX: ctxRef!.cardX.value,
      pageY: 120 + ctxRef!.cardY.value - GHOST_LIFT,
      width: 0,
      height: 0,
    });
    const { getByTestId } = await render(<Board />);
    await drag();
    expect(getByTestId("drag-debug-result").props.children).toBe(
      "drag-check: FAIL render Δ(0,120)"
    );
  });

  it("a surface (measureSpace) fail shows the surface offset", async () => {
    setDragDebugEnabled(true);
    const { getByTestId } = await render(<Board />);
    // RNGH puts the finger 60 px lower than measure() page space does.
    await drag(60);
    expect(getByTestId("drag-debug-result").props.children).toBe(
      "drag-check: FAIL measureSpace Δ(0,60)"
    );
  });

  it("a ghost that could not be measured shows drag-check: unmeasured", async () => {
    setDragDebugEnabled(true);
    ghostRefValue = null;
    const { getByTestId } = await render(<Board />);
    await drag();
    expect(getByTestId("drag-debug-result").props.children).toBe("drag-check: unmeasured");
  });

  it("a ghost that never mounted plus a 60 px surface offset shows FAIL measureSpace", async () => {
    setDragDebugEnabled(true);
    ghostRefValue = null;
    const { getByTestId } = await render(<Board />);
    await drag(60);
    expect(getByTestId("drag-debug-result").props.children).toBe(
      "drag-check: FAIL measureSpace Δ(0,60)"
    );
  });

  it("ok path: the check records the ghost's measured origin", async () => {
    await render(<Board />);
    await drag();
    const gc = ctxRef!.ghostCheck.value;
    expect(gc.ghostMeasured).toBe(true);
    expect(gc.ghostPageX).toBe(ctxRef!.cardX.value);
    expect(gc.ghostPageY).toBe(ctxRef!.cardY.value - GHOST_LIFT);
  });

  it("transformIgnored: the ghost stuck at the host origin is recorded at (0,0)", async () => {
    ghostMeasure = () => ({ pageX: 0, pageY: 0, width: 0, height: 0 });
    await render(<Board />);
    await drag();
    const gc = ctxRef!.ghostCheck.value;
    expect(gc.ghostMeasured).toBe(true);
    expect([gc.ghostPageX, gc.ghostPageY]).toEqual([0, 0]);
  });

  it("given up after null measures: no measured ghost is recorded", async () => {
    ghostMeasure = () => null;
    await render(<Board />);
    await drag();
    expect(ctxRef!.ghostCheck.value.ghostMeasured).toBe(false);
  });

  it("the next drag clears the previous result", async () => {
    setDragDebugEnabled(true);
    const { queryByTestId } = await render(<Board />);
    await drag();
    expect(queryByTestId("drag-debug-result")).not.toBeNull();
    const p = pan();
    await p.start(gestureAt(card, grab).ev(0, 5));
    expect(queryByTestId("drag-debug-result")).toBeNull();
    await p.end(gestureAt(card, grab).ev(0, 5), false);
  });

  it("disabled: no result line, and no overlay frame callback is registered", async () => {
    const reaction = jest.spyOn(Reanimated, "useFrameCallback");
    const { queryByTestId } = await render(<Board />);
    await drag();
    expect(queryByTestId("drag-debug-result")).toBeNull();
    expect(queryByTestId("drag-debug-panel")).toBeNull();
    expect(reaction).not.toHaveBeenCalled();
  });

  it("frame path unchanged: the same runOnJS hops with the overlay on or off", async () => {
    const runOnJS = jest.spyOn(Reanimated, "runOnJS");
    await render(<Board />);
    await drag();
    const off = runOnJS.mock.calls.length;
    runOnJS.mockClear();
    setDragDebugEnabled(true);
    await drag();
    expect(runOnJS.mock.calls.length).toBe(off);
    // Start + end only, as in "a passing drag makes no runOnJS hop beyond start and end".
    expect(off).toBe(2);
  });
});

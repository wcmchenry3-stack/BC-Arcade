/**
 * #3531 — the finger-anchored invariant: the ghost's WINDOW position is
 * `finger − grab` (±1 px), drawn GHOST_LIFT px higher, at drag start, through
 * the drag and at release, whatever the layout and the measurements do.
 *
 * `grab` is the finger's offset inside the card it touched, at touch-down.
 *
 * The test models the real screen, not the implementation: every view has a
 * TRUE window origin, RNGH reports the finger in window coordinates, and
 * Reanimated's measure() answers per scenario (right, stale, null or wrong).
 * The ghost's rendered window position is the true origin of whatever it is
 * drawn inside (the DragContainer, or the root DragGhostHost at 0,0) plus its
 * transform (cardX, cardY − GHOST_LIFT). The ghost check's measure of the
 * ghost returns that same rendered position, so the check is judged on what
 * the player would see.
 */
import React, { useRef } from "react";
import { StyleSheet, Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";
import * as Sentry from "@sentry/react-native";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { DragProvider, useDragContext } from "../DragContext";
import type { DragCard, DragSource } from "../DragContext";
import { DraggableCard, GHOST_CHECK_DELAY_MS } from "../DraggableCard";
import { DragContainer } from "../DragContainer";
import { DragGhostHost } from "../DragGhostHost";
import { resetDragDiagnosticsForTests } from "../dragDiagnostics";
import { GHOST_LIFT } from "../dragGeometry";
import type { PageRect } from "../dragGeometry";
import { detectedGesture } from "../../../../test-utils/mockScreenDeps";
import type { DetectorRender } from "../../../../test-utils/mockScreenDeps";

const mockDetected: DetectorRender[] = [];
jest.mock("react-native-gesture-handler", () =>
  mockScreenDeps().mockGestureHandler(() => mockDetected)
);

type XY = { x: number; y: number };
type Size = { width: number; height: number };

const SOL_CARD: Size = { width: 52, height: 74 };
const FC_CARD: Size = { width: 40, height: 56 };
const FC_LARGE: Size = { width: 80, height: 112 };
/** GameShell: APP_HEADER_HEIGHT + an iPhone's top inset, roughly. */
const HEADER = 140;

const wasteSrc: DragSource = { game: "solitaire", type: "waste" };
const solTableau: DragSource = { game: "solitaire", type: "tableau", col: 3, fromIndex: 2 };
const fcTableau: DragSource = { game: "freecell", type: "tableau", col: 4, fromIndex: 5 };

interface Scenario {
  name: string;
  source: DragSource;
  size: Size;
  /** Cards in the dragged run, with their stack tops (tableau runs). */
  stackTops?: number[];
  /** True window origin of the DragContainer. */
  container: XY;
  /** What measure(containerRef) answers at drag start; "true" = the truth. */
  containerMeasure: "true" | PageRect | null;
  /** The cached container offset left by an earlier onLayout; null = never measured. */
  containerCache?: PageRect | null;
  /** True window origin of the card the finger touches (its gesture view). */
  card: XY;
  /** The card wrapper (DraggableCard's view) relative to the gesture view:
   *  a selected card's face is lifted 6 px above its wrapper. */
  wrapper?: XY;
  /** What measure(card wrapper) answers: "true", null or the truth + offset. */
  cardMeasure: "true" | null | XY;
  /** Something that happens after the 5th move. */
  midDrag?: "rerender" | "siblingRemount";
  /** The card measure is so wrong that the check's measure-space side flags
   *  it (an informational measureSpace report, #3528). */
  measureSpaceNoise?: boolean;
}

const C0: XY = { x: 0, y: 0 };
const CH: XY = { x: 0, y: HEADER };
const rect = (o: XY, w = 390, h = 700): PageRect => ({
  pageX: o.x,
  pageY: o.y,
  width: w,
  height: h,
});

const SCENARIOS: Scenario[] = [
  {
    name: "container at (0,0)",
    source: wasteSrc,
    size: SOL_CARD,
    container: C0,
    containerMeasure: "true",
    card: { x: 76, y: 60 },
    cardMeasure: "true",
  },
  {
    name: "container at (0,140): header + safe-area inset",
    source: wasteSrc,
    size: SOL_CARD,
    container: CH,
    containerMeasure: "true",
    card: { x: 76, y: HEADER + 60 },
    cardMeasure: "true",
  },
  {
    name: "stale cached container (fresh measure fails, cache from mid-transition)",
    source: wasteSrc,
    size: SOL_CARD,
    container: CH,
    containerMeasure: null,
    containerCache: rect({ x: 0, y: 90 }),
    card: { x: 76, y: HEADER + 60 },
    cardMeasure: "true",
  },
  {
    name: "container measure null and never cached",
    source: solTableau,
    size: SOL_CARD,
    container: CH,
    containerMeasure: null,
    containerCache: null,
    card: { x: 160, y: HEADER + 230 },
    cardMeasure: "true",
  },
  {
    name: "card measure null (fresh mount)",
    source: wasteSrc,
    size: SOL_CARD,
    container: CH,
    containerMeasure: "true",
    card: { x: 108, y: HEADER + 60 },
    cardMeasure: null,
  },
  {
    name: "card measure off by 300 px",
    source: wasteSrc,
    size: SOL_CARD,
    container: CH,
    containerMeasure: "true",
    card: { x: 76, y: HEADER + 60 },
    cardMeasure: { x: 0, y: 300 },
    measureSpaceNoise: true,
  },
  {
    name: "card measure off by 30 px (inside the old cross-check's tolerance)",
    source: solTableau,
    size: SOL_CARD,
    container: CH,
    containerMeasure: "true",
    card: { x: 160, y: HEADER + 230 },
    cardMeasure: { x: 0, y: 30 },
  },
  {
    name: "the screen re-renders mid-drag",
    source: wasteSrc,
    size: SOL_CARD,
    container: CH,
    containerMeasure: "true",
    card: { x: 76, y: HEADER + 60 },
    cardMeasure: "true",
    midDrag: "rerender",
  },
  {
    name: "draw-3 waste: the fan's other cards remount mid-drag",
    source: wasteSrc,
    size: SOL_CARD,
    container: CH,
    containerMeasure: "true",
    card: { x: 76 + 32, y: HEADER + 60 },
    cardMeasure: null,
    midDrag: "siblingRemount",
  },
  {
    name: "large cards (FreeCell board scrolled 150 px)",
    source: fcTableau,
    size: FC_LARGE,
    container: { x: 0, y: 120 },
    containerMeasure: "true",
    card: { x: 410 - 150, y: 120 + 300 },
    cardMeasure: "true",
  },
  {
    name: "selected (lifted) card",
    source: solTableau,
    size: SOL_CARD,
    container: CH,
    containerMeasure: "true",
    card: { x: 160, y: HEADER + 230 - 6 },
    wrapper: { x: 0, y: 6 },
    cardMeasure: "true",
  },
  // Spike #3530's candidate causes, as mock values (the device recipe is
  // still pending there). Each produced a constant card-vs-finger offset
  // before this story.
  {
    name: "spike #3530 cause 2: the board draws 120 px below its container measure (GameShell header)",
    source: solTableau,
    size: SOL_CARD,
    container: CH,
    containerMeasure: rect({ x: 0, y: HEADER - 120 }),
    card: { x: 160, y: HEADER + 230 },
    cardMeasure: "true",
  },
  {
    name: "spike #3530 cause 1: measure() page space 30 px off RNGH space (under the tolerance)",
    source: wasteSrc,
    size: SOL_CARD,
    container: CH,
    containerMeasure: rect({ x: 0, y: HEADER + 30 }),
    containerCache: rect({ x: 0, y: HEADER + 30 }),
    card: { x: 76, y: HEADER + 60 },
    cardMeasure: { x: 0, y: 30 },
  },
  {
    name: "FreeCell tableau run",
    source: fcTableau,
    size: FC_CARD,
    stackTops: [0, 22, 44],
    container: { x: 0, y: 120 },
    containerMeasure: "true",
    card: { x: 210, y: 120 + 260 },
    cardMeasure: "true",
  },
];

// ---------------------------------------------------------------------------
// The modelled screen
// ---------------------------------------------------------------------------

let ctxRef: ReturnType<typeof useDragContext> | null = null;
let sc: Scenario = SCENARIOS[0]!;
/** The root host's true window origin; a test can displace it. */
let hostOrigin: XY = C0;
let ghostMeasures = 0;

function Probe() {
  ctxRef = useDragContext();
  return <Text testID="probe">{ctxRef.dragState ? "dragging" : "idle"}</Text>;
}

const cardsFor = (s: Scenario): DragCard[] =>
  (s.stackTops ?? [undefined]).map((top, i) => ({
    suit: "hearts",
    rank: 7 - i,
    faceDown: false,
    width: s.size.width,
    height: s.size.height,
    ...(top === undefined ? {} : { stackTop: top }),
  }));

function GameScreen({ tick, siblingKey }: { tick: number; siblingKey: string }) {
  return (
    <DragProvider>
      <ThemeProvider>
        <DragContainer style={{ flex: 1 }}>
          <Probe />
          <Text testID="hud">{`t${tick}`}</Text>
          {/* The draw-3 fan's lower cards, keyed like StockWastePile. */}
          <DraggableCard
            key={siblingKey}
            testID="sibling"
            dragCards={cardsFor(SCENARIOS[0]!)}
            dragSource={wasteSrc}
            draggable={false}
          >
            <Text testID="sibling-face">5♣</Text>
          </DraggableCard>
          <DraggableCard testID="card" dragCards={cardsFor(sc)} dragSource={sc.source}>
            <Text testID="face">7♥</Text>
          </DraggableCard>
        </DragContainer>
      </ThemeProvider>
    </DragProvider>
  );
}

function App({ tick = 0, siblingKey = "a" }: { tick?: number; siblingKey?: string }) {
  return (
    <ThemeProvider>
      <GameScreen tick={tick} siblingKey={siblingKey} />
      <DragGhostHost />
    </ThemeProvider>
  );
}

// The rendered tree holds host views only, so the views are told apart by
// their props.
interface HostNode {
  parent: HostNode | null;
  props: Record<string, unknown>;
}
function ancestors(node: HostNode): HostNode[] {
  const out: HostNode[] = [];
  for (let n = node.parent; n; n = n.parent) out.push(n);
  return out;
}
/** Inside the DragContainer: the probe's nearest `collapsable={false}` view. */
function inContainer(node: HostNode): boolean {
  const probe = screen.getByTestId("probe") as unknown as HostNode;
  const container = ancestors(probe).find((n) => n.props.collapsable === false);
  return container !== undefined && ancestors(node).includes(container);
}
/** Inside a `pointerEvents="none"` layer that is not in the board. */
function inRootHost(node: HostNode): boolean {
  return !inContainer(node) && ancestors(node).some((n) => n.props.pointerEvents === "none");
}

/** Where the ghost is drawn on screen (window coordinates, lifted), or null. */
function ghostOnScreen(): XY | null {
  const el = screen.queryByTestId("drag-overlay-ghost");
  if (!el) return null;
  // Its transform is translate(cardX, cardY − GHOST_LIFT) (DragGhostHost.test);
  // its origin is the TRUE origin of the view it is drawn inside.
  const base = inContainer(el as unknown as HostNode) ? sc.container : hostOrigin;
  return { x: base.x + ctxRef!.cardX.value, y: base.y + ctxRef!.cardY.value - GHOST_LIFT };
}

function makeAnimatedRef() {
  return Object.assign((...args: unknown[]): unknown => (args.length > 0 ? undefined : {}), {
    current: null,
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockDetected.length = 0;
  ctxRef = null;
  hostOrigin = C0;
  ghostMeasures = 0;
  resetDragDiagnosticsForTests();
  (Sentry.captureMessage as jest.Mock).mockClear();
  (Sentry.addBreadcrumb as jest.Mock).mockClear();
  jest
    .spyOn(Reanimated, "useAnimatedRef")
    .mockImplementation((() => useRef(makeAnimatedRef()).current) as never);
  jest.spyOn(Reanimated, "measure").mockImplementation(((ref: unknown) => {
    if (ref === ctxRef?.ghostRef) {
      ghostMeasures += 1;
      const g = ghostOnScreen();
      return g && { pageX: g.x, pageY: g.y, width: sc.size.width, height: sc.size.height };
    }
    if (ref === ctxRef?.containerRef) {
      return sc.containerMeasure === "true" ? rect(sc.container) : sc.containerMeasure;
    }
    // A card wrapper.
    if (sc.cardMeasure === null) return null;
    const w = sc.wrapper ?? C0;
    const off = sc.cardMeasure === "true" ? C0 : sc.cardMeasure;
    return {
      pageX: sc.card.x + w.x + off.x,
      pageY: sc.card.y + w.y + off.y,
      ...sc.size,
    };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function pan() {
  const h = detectedGesture(mockDetected, "pan", { testID: "face" });
  if (!h) throw new Error("no pan gesture");
  return h;
}

/** RNGH events for a touch at `grab` inside the card, moved (dx, dy). */
function gesture(grab: XY) {
  const down = { x: sc.card.x + grab.x, y: sc.card.y + grab.y };
  return (dx: number, dy: number) => ({
    absoluteX: down.x + dx,
    absoluteY: down.y + dy,
    x: grab.x + dx,
    y: grab.y + dy,
    translationX: dx,
    translationY: dy,
    velocityX: 0,
    velocityY: 0,
  });
}

function expectUnderFinger(e: { absoluteX: number; absoluteY: number }, grab: XY, when: string) {
  const g = ghostOnScreen();
  expect({ when, drawn: g !== null }).toEqual({ when, drawn: true });
  const dx = g!.x - (e.absoluteX - grab.x);
  const dy = g!.y - (e.absoluteY - grab.y - GHOST_LIFT);
  // Rounded so a failure reads as the offset in px.
  expect({ when, dx: Math.round(dx), dy: Math.round(dy) }).toEqual({ when, dx: 0, dy: 0 });
  expect(Math.abs(dx)).toBeLessThanOrEqual(1);
  expect(Math.abs(dy)).toBeLessThanOrEqual(1);
}

const ghostEvents = () =>
  (Sentry.captureMessage as jest.Mock).mock.calls.filter((c) => c[0] === "drag.ghostOffset");
const ghostCrumbs = () =>
  (Sentry.addBreadcrumb as jest.Mock).mock.calls
    .map((c) => c[0])
    .filter((b) => b.message === "drag.ghostCheck");

/** The touch-down offsets and activation moves (minDistance 5) to try. */
const GRABS: [string, XY, XY][] = [
  ["grab (20,30), activation (0,5)", { x: 20, y: 30 }, { x: 0, y: 5 }],
  ["grab (6,60), activation (4,-3)", { x: 6, y: 60 }, { x: 4, y: -3 }],
];

async function runDrag(grab: XY, activation: XY) {
  const ev = gesture(grab);
  const view = await render(<App />);
  if (sc.containerCache !== undefined) {
    const c = sc.containerCache;
    ctxRef!.containerOffsetX.value = c ? c.pageX : 0;
    ctxRef!.containerOffsetY.value = c ? c.pageY : 0;
    ctxRef!.containerWidth.value = c ? c.width : 0;
    ctxRef!.containerHeight.value = c ? c.height : 0;
  } else {
    ctxRef!.containerOffsetX.value = sc.container.x;
    ctxRef!.containerOffsetY.value = sc.container.y;
    ctxRef!.containerWidth.value = 390;
    ctxRef!.containerHeight.value = 700;
  }

  const start = ev(activation.x, activation.y);
  await act(() => pan().onStart!(start));
  expectUnderFinger(start, grab, "start");

  let last = start;
  await act(() => jest.advanceTimersByTime(GHOST_CHECK_DELAY_MS + 10));
  for (let k = 1; k <= 10; k++) {
    if (k === 6 && sc.midDrag === "rerender") await view.rerender(<App tick={1} />);
    if (k === 6 && sc.midDrag === "siblingRemount") await view.rerender(<App siblingKey="b" />);
    last = ev(activation.x + 13 * k - 50, activation.y + 31 * k);
    await act(() => pan().onUpdate!(last));
    expectUnderFinger(last, grab, `move ${k}`);
    await act(() => jest.advanceTimersByTime(16));
  }
  const end = ev(activation.x - 120, activation.y + 280);
  await act(() => pan().onUpdate!(end));
  expectUnderFinger(end, grab, "end");
  return { view, end };
}

describe("finger-anchored ghost: window position == finger − grab (#3531)", () => {
  describe.each(GRABS)("%s", (_g, grab, activation) => {
    it.each(SCENARIOS.map((s) => [s.name, s] as const))(
      "%s: at start, after 10 moves and at the end",
      async (_name, scenario) => {
        sc = scenario;
        const { end } = await runDrag(grab, activation);
        // Released over nothing: the ghost springs back to the card itself.
        await act(() => pan().onEnd!(end, true));
        await act(() => pan().onFinalize!(end, true));
        const home = ghostOnScreen();
        expect(home).not.toBeNull();
        expect(home!.x).toBeCloseTo(sc.card.x, 5);
        expect(home!.y).toBeCloseTo(sc.card.y - GHOST_LIFT, 5);
        // And the rendered-ghost check (#3528) agrees: in gesture space the
        // ghost is under the finger (no render / transformIgnored fail).
        const crumbs = ghostCrumbs();
        expect(crumbs).toHaveLength(1);
        expect(Math.abs(crumbs[0].data.dx)).toBeLessThanOrEqual(1);
        expect(Math.abs(crumbs[0].data.dy)).toBeLessThanOrEqual(1);
        if (sc.measureSpaceNoise) {
          // A card measure() far from RNGH is still flagged, as information
          // about measure() (failKind measureSpace), never as a ghost offset.
          expect(crumbs[0].data).toMatchObject({ status: "fail", kind: "measureSpace" });
          expect(ghostEvents().map((c) => c[1].tags.failKind)).toEqual(["measureSpace"]);
        } else {
          expect(crumbs[0].data.status).toBe("ok");
          expect(ghostEvents()).toHaveLength(0);
        }
      }
    );
  });

  it("the stack fan of a tableau run uses the run's stackTop offsets", async () => {
    sc = SCENARIOS.find((s) => s.name === "FreeCell tableau run")!;
    await runDrag({ x: 10, y: 10 }, { x: 0, y: 5 });
    const tops = [0, 1, 2].map(
      (i) => StyleSheet.flatten(screen.getByTestId(`drag-overlay-ghost-card-${i}`).props.style).top
    );
    expect(tops).toEqual(sc.stackTops);
  });

  it("snap-back target is the start position (startFinger − grab), from gesture values only", async () => {
    // A card measure 300 px off and no container: the target can't come from them.
    sc = SCENARIOS.find((s) => s.name === "card measure off by 300 px")!;
    sc = { ...sc, containerMeasure: null, containerCache: null };
    const grab = { x: 11, y: 17 };
    const { end } = await runDrag(grab, { x: 3, y: 4 });
    await act(() => pan().onEnd!(end, false)); // cancelled by the system
    expect({ x: ctxRef!.originX.value, y: ctxRef!.originY.value }).toEqual(sc.card);
    expect({ x: ctxRef!.cardX.value, y: ctxRef!.cardY.value }).toEqual(sc.card);
  });

  it("a cancel parks the ghost at the start position", async () => {
    sc = SCENARIOS[1]!;
    await runDrag({ x: 20, y: 30 }, { x: 0, y: 5 });
    await act(() => ctxRef!.cancelDrag("test"));
    expect({ x: ctxRef!.cardX.value, y: ctxRef!.cardY.value }).toEqual(sc.card);
    expect(screen.queryByTestId("drag-overlay-ghost")).toBeNull();
  });

  it("the ghost is drawn by the root host, outside the DragContainer", async () => {
    sc = SCENARIOS[1]!;
    await render(<App />);
    expect(screen.queryByTestId("drag-overlay-ghost")).toBeNull();
    await act(() => pan().onStart!(gesture({ x: 5, y: 5 })(0, 5)));
    const ghost = screen.getByTestId("drag-overlay-ghost") as unknown as HostNode;
    expect(inContainer(ghost)).toBe(false);
    expect(inRootHost(ghost)).toBe(true);
  });
});

describe("performance: onUpdate is arithmetic only once the check has run (#3531)", () => {
  it("10 updates after the check: no measure(), no runOnJS", async () => {
    sc = SCENARIOS[1]!;
    const runOnJS = jest.spyOn(Reanimated, "runOnJS");
    const measure = Reanimated.measure as unknown as jest.Mock;
    await render(<App />);
    const ev = gesture({ x: 20, y: 30 });
    await act(() => pan().onStart!(ev(0, 5)));
    await act(() => jest.advanceTimersByTime(GHOST_CHECK_DELAY_MS + 10));
    await act(() => pan().onUpdate!(ev(5, 20))); // the check
    expect(ghostMeasures).toBe(1);
    const measuresBefore = measure.mock.calls.length;
    const hopsBefore = runOnJS.mock.calls.length;
    const h = pan();
    for (let k = 1; k <= 10; k++) h.onUpdate!(ev(5 + k, 20 + 7 * k));
    expect(measure.mock.calls.length).toBe(measuresBefore);
    expect(runOnJS.mock.calls.length).toBe(hopsBefore);
    expectUnderFinger(ev(15, 90), { x: 20, y: 30 }, "after 10 updates");
  });
});

describe("the ghost check against the root host (#3528 × #3531)", () => {
  it("reports a render fail when the host is drawn 47 px below RNGH's origin", async () => {
    sc = SCENARIOS[1]!;
    hostOrigin = { x: 0, y: 47 };
    await render(<App />);
    const ev = gesture({ x: 20, y: 30 });
    await act(() => pan().onStart!(ev(0, 5)));
    await act(() => jest.advanceTimersByTime(GHOST_CHECK_DELAY_MS + 10));
    await act(() => pan().onUpdate!(ev(10, 40)));
    await act(() => pan().onEnd!(ev(10, 40), true));
    const events = ghostEvents();
    expect(events).toHaveLength(1);
    expect(events[0][1].tags.failKind).toBe("render");
    expect(events[0][1].extra.deltaY).toBe(47);
    expect(events[0][1].extra.deltaX).toBe(0);
    expect(events[0][1].extra.grabX).toBe(20);
    expect(events[0][1].extra.grabY).toBe(30);
  });
});

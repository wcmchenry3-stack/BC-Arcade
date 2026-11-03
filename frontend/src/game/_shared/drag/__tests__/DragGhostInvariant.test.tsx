/**
 * #3531 — the finger-anchored invariant: the ghost's WINDOW position is
 * `finger − grab` (±1 px), drawn GHOST_LIFT px higher, at drag start, through
 * the drag and at release, whatever the layout and the measurements do.
 *
 * `grab` is the finger's offset inside the card it touched when the pan
 * activated. RNGH resets the translation to 0 at activation (iOS, Android,
 * web), so the events here do too.
 *
 * What this matrix guards: a regression to measure-based positioning. The
 * ghost is placed from the finger by construction, so none of the varied
 * measures can reach it; before #3531 the offset cases failed (see the PR).
 * What it does NOT prove: that RNGH's absolute origin and the root host's
 * origin (the RN surface's) coincide on a device. That is verified only on
 * device (#3530). If they don't, the ghost check reports it as a consistent
 * `measureSpace` offset: see "an RN surface offset from RNGH's origin" below.
 *
 * The model: every view has a TRUE position in RNGH (window) coordinates;
 * the RN surface (where the root host sits and where measure() reports) has
 * its origin at `surface`. measure() answers per scenario (right, stale, null
 * or wrong) in SURFACE coordinates. The ghost's on-screen position is the
 * true origin of whatever it is drawn inside (the DragContainer, or the root
 * host at `surface + hostShift`) plus its transform (cardX, cardY − LIFT);
 * the ghost check's measure of the ghost returns that, in surface
 * coordinates, so the check is judged on what the player would see.
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
  /** The card measure is off by more than SURFACE_OFFSET_TOL, so the
   *  surface signal flags it: a measureSpace report (a one-off stale
   *  measure, never a render offset). */
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
    // A stale card measure beyond SURFACE_OFFSET_TOL: flagged as a one-off.
    measureSpaceNoise: true,
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
  // Spike #3530's candidate cause 2, as mock values (the device recipe is
  // still pending there): a constant card-vs-finger offset before this story.
  // Cause 1 (RN surface vs RNGH origin) can't be fixed by positioning; it is
  // the separate "RN surface offset" test below.
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
/** The RN surface's origin in RNGH coordinates (0,0 when they coincide). */
let surface: XY = C0;
/** The root host shifted inside the RN layout (something wrapping it). */
let hostShift: XY = C0;
/** measure(ghost) returns null (a ghost that never measures). */
let ghostNull = false;
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

function App({
  tick = 0,
  siblingKey = "a",
  withHost = true,
}: {
  tick?: number;
  siblingKey?: string;
  /** false: no root host, so the ghost never mounts (ghostMounted stays false). */
  withHost?: boolean;
}) {
  return (
    <ThemeProvider>
      <GameScreen tick={tick} siblingKey={siblingKey} />
      {withHost ? <DragGhostHost /> : null}
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
  const base = inContainer(el as unknown as HostNode)
    ? sc.container
    : { x: surface.x + hostShift.x, y: surface.y + hostShift.y };
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
  surface = C0;
  hostShift = C0;
  ghostNull = false;
  ghostMeasures = 0;
  resetDragDiagnosticsForTests();
  (Sentry.captureMessage as jest.Mock).mockClear();
  (Sentry.addBreadcrumb as jest.Mock).mockClear();
  jest
    .spyOn(Reanimated, "useAnimatedRef")
    .mockImplementation((() => useRef(makeAnimatedRef()).current) as never);
  // measure() reports in RN-surface coordinates: the truth minus `surface`.
  jest.spyOn(Reanimated, "measure").mockImplementation(((ref: unknown) => {
    if (ref === ctxRef?.ghostRef) {
      ghostMeasures += 1;
      if (ghostNull) return null;
      const g = ghostOnScreen();
      return (
        g && {
          pageX: g.x - surface.x,
          pageY: g.y - surface.y,
          width: sc.size.width,
          height: sc.size.height,
        }
      );
    }
    if (ref === ctxRef?.containerRef) {
      if (sc.containerMeasure !== "true") return sc.containerMeasure;
      return rect({ x: sc.container.x - surface.x, y: sc.container.y - surface.y });
    }
    // A card wrapper.
    if (sc.cardMeasure === null) return null;
    const w = sc.wrapper ?? C0;
    const off = sc.cardMeasure === "true" ? C0 : sc.cardMeasure;
    return {
      pageX: sc.card.x + w.x + off.x - surface.x,
      pageY: sc.card.y + w.y + off.y - surface.y,
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

/** RNGH events for a touch-down at `down` inside the card that activates
 *  after `activation` (minDistance 5). As RNGH does, `start` carries
 *  translation 0 and later events count it from the activation point. */
function gesture(down: XY, activation: XY = { x: 0, y: 5 }) {
  const at = (dx: number, dy: number, tx: number, ty: number) => ({
    absoluteX: sc.card.x + down.x + dx,
    absoluteY: sc.card.y + down.y + dy,
    x: down.x + dx,
    y: down.y + dy,
    translationX: tx,
    translationY: ty,
    velocityX: 0,
    velocityY: 0,
  });
  return {
    /** The grab: the finger's offset in the card at activation. */
    grab: { x: down.x + activation.x, y: down.y + activation.y },
    start: at(activation.x, activation.y, 0, 0),
    /** The finger (dx, dy) from touch-down. */
    ev: (dx: number, dy: number) => at(dx, dy, dx - activation.x, dy - activation.y),
  };
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
  ["touch-down (20,30), activation (0,5)", { x: 20, y: 30 }, { x: 0, y: 5 }],
  ["touch-down (6,60), activation (4,-3)", { x: 6, y: 60 }, { x: 4, y: -3 }],
];

async function runDrag(down: XY, activation: XY) {
  const { ev, start, grab } = gesture(down, activation);
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

  await act(() => pan().onStart!(start));
  expectUnderFinger(start, grab, "start");
  // RNGH's translation is 0 at activation: the ghost starts exactly on the card.
  expect(ghostOnScreen()).toEqual({ x: sc.card.x, y: sc.card.y - GHOST_LIFT });

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
  return { view, end, grab };
}

describe("finger-anchored ghost: window position == finger − grab (#3531)", () => {
  describe.each(GRABS)("%s", (_g, down, activation) => {
    it.each(SCENARIOS.map((s) => [s.name, s] as const))(
      "%s: at start, after 10 moves and at the end",
      async (_name, scenario) => {
        sc = scenario;
        const { end } = await runDrag(down, activation);
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
    const { end } = await runDrag({ x: 11, y: 17 }, { x: 3, y: 4 });
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

  it("defensive: a non-zero translation at onStart (RNGH sends 0) still keeps finger − grab", async () => {
    sc = SCENARIOS[1]!;
    await render(<App />);
    const touch = { x: 20, y: 30 };
    const at = (dx: number, dy: number) => ({
      absoluteX: sc.card.x + touch.x + dx,
      absoluteY: sc.card.y + touch.y + dy,
      x: touch.x + dx,
      y: touch.y + dy,
      translationX: dx,
      translationY: dy,
      velocityX: 0,
      velocityY: 0,
    });
    // Translation counted from touch-down: the grab is the touch-down point.
    await act(() => pan().onStart!(at(0, 5)));
    expectUnderFinger(at(0, 5), touch, "start");
    for (const [dx, dy] of [
      [30, 90],
      [-40, 300],
    ] as const) {
      await act(() => pan().onUpdate!(at(dx, dy)));
      expectUnderFinger(at(dx, dy), touch, `move ${dx},${dy}`);
    }
    // And the card's home is still the card: absolute − x.
    expect({ x: ctxRef!.originX.value, y: ctxRef!.originY.value }).toEqual(sc.card);
  });

  it("the ghost is drawn by the root host, outside the DragContainer", async () => {
    sc = SCENARIOS[1]!;
    await render(<App />);
    expect(screen.queryByTestId("drag-overlay-ghost")).toBeNull();
    await act(() => pan().onStart!(gesture({ x: 5, y: 5 }).start));
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
    const { ev, start, grab } = gesture({ x: 20, y: 30 });
    await act(() => pan().onStart!(start));
    await act(() => jest.advanceTimersByTime(GHOST_CHECK_DELAY_MS + 10));
    await act(() => pan().onUpdate!(ev(5, 20))); // the check
    expect(ghostMeasures).toBe(1);
    const measuresBefore = measure.mock.calls.length;
    const hopsBefore = runOnJS.mock.calls.length;
    const h = pan();
    for (let k = 1; k <= 10; k++) h.onUpdate!(ev(5 + k, 20 + 7 * k));
    expect(measure.mock.calls.length).toBe(measuresBefore);
    expect(runOnJS.mock.calls.length).toBe(hopsBefore);
    expectUnderFinger(ev(15, 90), grab, "after 10 updates");
  });
});

describe("the ghost check against the root host (#3528 × #3531)", () => {
  /** One drag: grab, wait past the check delay, move, release. */
  async function checkedDrag() {
    const { ev, start } = gesture({ x: 20, y: 30 });
    await act(() => pan().onStart!(start));
    await act(() => jest.advanceTimersByTime(GHOST_CHECK_DELAY_MS + 10));
    await act(() => pan().onUpdate!(ev(10, 40)));
    await act(() => pan().onUpdate!(ev(12, 44)));
    await act(() => pan().onEnd!(ev(12, 44), true));
    await act(() => pan().onFinalize!(ev(12, 44), true));
    await act(() => jest.runOnlyPendingTimers());
  }

  it("render: the host shifted 47 px down inside the RN layout", async () => {
    sc = SCENARIOS[1]!;
    hostShift = { x: 0, y: 47 };
    await render(<App />);
    await checkedDrag();
    const events = ghostEvents();
    expect(events).toHaveLength(1);
    expect(events[0][1].tags.failKind).toBe("render");
    expect(events[0][1].extra).toMatchObject({ deltaX: 0, deltaY: 47, grabX: 20, grabY: 35 });
  });

  it("render keeps its tolerance (dragTolerance + |step|): a 36 px host shift is silent, 40 px reports", async () => {
    sc = SCENARIOS[1]!;
    hostShift = { x: 0, y: 36 };
    await render(<App />);
    await checkedDrag();
    expect(ghostEvents()).toHaveLength(0);
    hostShift = { x: 0, y: 40 };
    await checkedDrag();
    expect(ghostEvents().map((c) => c[1].tags.failKind)).toEqual(["render"]);
  });

  describe("an RN surface offset from RNGH's origin (the device assumption broken)", () => {
    // Every measure() is surface-relative and the root host sits at the
    // surface origin, so the render check can't see it: measure(ghost) is
    // exactly cardX. The player sees the ghost S px below the finger. The
    // surface signal catches it: the card's gesture origin (absolute − x) is
    // S px below its measure(), judged against SURFACE_OFFSET_TOL (12 px).
    it.each([
      ["container at (0,140)", 47],
      ["FreeCell tableau run", 47],
      ["container at (0,140)", 30],
      ["FreeCell tableau run", 13],
    ] as const)(
      "%s, surface %i px low: measureSpace each drag, consistent from the 2nd",
      async (name, offset) => {
        sc = SCENARIOS.find((s) => s.name.startsWith(name))!;
        surface = { x: 0, y: offset };
        await render(<App />);
        await checkedDrag();
        await checkedDrag();
        // What the player sees, from the model: the ghost this far below the
        // finger on a fresh grab. The production report must say exactly that.
        const { start, grab } = gesture({ x: 20, y: 30 });
        await act(() => pan().onStart!(start));
        const visibleOffsetY = ghostOnScreen()!.y - (start.absoluteY - grab.y - GHOST_LIFT);
        expect(visibleOffsetY).toBe(offset);
        expect(ghostEvents().map((c) => c[1].tags.failKind)).toEqual([
          "measureSpace",
          "measureSpace",
        ]);
        const extras = ghostEvents().map((c) => c[1].extra);
        for (const e of extras) {
          expect(Math.abs(e.deltaX)).toBeLessThanOrEqual(1);
          expect(Math.abs(e.deltaY)).toBeLessThanOrEqual(1);
          expect(e).toMatchObject({ surfaceOffsetX: 0, surfaceOffsetY: offset });
          expect(e.surfaceOffsetY).toBe(Math.round(visibleOffsetY));
          expect(e.failGesture).toBe(false);
          expect(e.failMeasure).toBe(true);
        }
        expect(extras.map((e) => e.measureSpaceConsistent)).toEqual([false, true]);
        expect(ghostEvents()[1][1].tags.measureSpaceConsistent).toBe("true");
      }
    );

    it("11 px (under SURFACE_OFFSET_TOL): silent", async () => {
      sc = SCENARIOS[1]!;
      surface = { x: 0, y: 11 };
      await render(<App />);
      await checkedDrag();
      await checkedDrag();
      expect(ghostEvents()).toHaveLength(0);
      expect(ghostCrumbs().map((b) => b.data.status)).toEqual(["ok", "ok"]);
    });

    it("reported even when the ghost can't be measured (no ghost measure needed)", async () => {
      sc = SCENARIOS[1]!;
      surface = { x: 0, y: 30 };
      ghostNull = true;
      await render(<App />);
      await checkedDrag();
      const events = ghostEvents();
      expect(events.map((c) => c[1].tags.failKind)).toEqual(["measureSpace"]);
      expect(events[0][1].extra).toMatchObject({
        surfaceOffsetY: 30,
        failGesture: false,
        failMeasure: true,
        // NaN in the payload, rounded to −1 like every unknown.
        ghostPageX: -1,
        ghostPageY: -1,
        measures: 2,
        at: "end",
      });
    });

    it("reported when the ghost never mounts (the not-mounted giveUp route), with no ghost measure", async () => {
      sc = SCENARIOS[1]!;
      surface = { x: 0, y: 30 };
      await render(<App withHost={false} />);
      await checkedDrag();
      expect(ghostMeasures).toBe(0);
      const events = ghostEvents();
      expect(events.map((c) => c[1].tags.failKind)).toEqual(["measureSpace"]);
      expect(events[0][1].extra).toMatchObject({
        surfaceOffsetY: 30,
        failGesture: false,
        failMeasure: true,
        ghostPageX: -1,
        ghostPageY: -1,
      });
    });

    it("an unmeasured ghost with no surface offset stays unmeasured, silent", async () => {
      sc = SCENARIOS[1]!;
      ghostNull = true;
      await render(<App />);
      await checkedDrag();
      expect(ghostEvents()).toHaveLength(0);
      expect(ghostCrumbs().map((b) => b.data.status)).toEqual(["unmeasured"]);
    });
  });

  describe("legitimate biases stay under SURFACE_OFFSET_TOL (surface 0)", () => {
    const selected = SCENARIOS.find((s) => s.name === "selected (lifted) card")!;
    // SelectableCard: lift −6 and scale 1.03 about the centre move the
    // gesture view, not the measured wrapper.
    const liftScale = {
      x: SOL_CARD.width * 0.015,
      y: 6 + SOL_CARD.height * 0.015,
    };
    it.each([
      ["selected: lift −6 and scale 1.03", { ...selected, wrapper: liftScale }],
      [
        "selected: lift spring overshoot (≈ −6.6) and scale",
        { ...selected, wrapper: { x: 0.8, y: 7.7 } },
      ],
      ["shaking card, x = +4", { ...SCENARIOS[1]!, wrapper: { x: -4, y: 0 } }],
      ["shaking card, x = −6", { ...SCENARIOS[1]!, wrapper: { x: 6, y: 0 } }],
    ] as const)("%s: silent", async (_n, scenario) => {
      sc = scenario;
      await render(<App />);
      await checkedDrag();
      await checkedDrag();
      expect(ghostEvents()).toHaveLength(0);
      expect(ghostCrumbs().map((b) => b.data.status)).toEqual(["ok", "ok"]);
    });
  });

  it("two stale one-off card measures (40 and 75 px off) report but are not consistent", async () => {
    sc = { ...SCENARIOS[1]!, cardMeasure: { x: 0, y: 40 } };
    await render(<App />);
    await checkedDrag();
    sc = { ...sc, cardMeasure: { x: 0, y: 75 } };
    await checkedDrag();
    const events = ghostEvents();
    expect(events.map((c) => c[1].tags.failKind)).toEqual(["measureSpace", "measureSpace"]);
    expect(events.map((c) => c[1].extra.surfaceOffsetY)).toEqual([-40, -75]);
    expect(events.map((c) => c[1].extra.measureSpaceConsistent)).toEqual([false, false]);
  });
});

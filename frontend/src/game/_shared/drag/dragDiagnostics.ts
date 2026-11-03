/**
 * Cost-bounded diagnostics for drag-start positioning (#3397).
 *
 * Runs on the JS thread, once per drag start, from the single `runOnJS` hop
 * the pan already makes — nothing here is on the per-frame path.
 *
 * Volume (CLAUDE.md: Cost → Performance → Data):
 * - Normal drags: no new Sentry traffic. The existing `drag.start` breadcrumb
 *   gains two short source flags; breadcrumbs only leave the device attached
 *   to an event that is sent anyway.
 * - Fallback or anomalous drags: one extra local breadcrumb (~250 bytes).
 * - `drag.positionMismatch` event: at most DRAG_MISMATCH_MAX_EVENTS_PER_PROCESS
 *   per app process (a device may start several processes a day), and only in
 *   a DRAG_MISMATCH_SAMPLE_RATE share of processes. One event is ~2–3 KB with
 *   the 5-entry trace. The total scales with about 0.25 × the number of
 *   processes that see an anomaly.
 * - Server-side dial (no release needed): a Sentry inbound filter or a
 *   spike-protection / rate limit on the `drag.positionMismatch` message.
 *
 * Rendered-ghost check (#3528) — `drag.ghostCheck` / `drag.ghostOffset`:
 * - Work: per drag, 1 Reanimated `measure()` of the ghost on the UI thread
 *   (2 if the first returns null; 0 while DragGhostHost has not mounted the
 *   ghost; +1 container measure only when the check fails), never per frame.
 *   The per-drag state is one shared value in DragProvider (not per card). A
 *   passing drag makes no extra `runOnJS` hop: its result rides the hop
 *   `onEnd` already makes. A failing drag makes 1 hop.
 * - Every checked drag: one local `drag.ghostCheck` breadcrumb (~170 bytes,
 *   status + rounded gesture- and measure-space deltas). Breadcrumbs leave the device only attached to
 *   an event that is sent anyway: 0 bytes uploaded for a passing drag.
 * - `drag.ghostOffset` event (~3.5 KB with the trace) only on a failing check,
 *   by `failKind`. `render` (ghost not under the finger) and `transformIgnored`
 *   (ghost stuck at the host's origin) share one budget: internal builds at
 *   most GHOST_OFFSET_MAX_EVENTS_INTERNAL (3) per process, always; store
 *   builds at most GHOST_OFFSET_MAX_EVENTS_STORE (1) per process, in a
 *   GHOST_OFFSET_SAMPLE_RATE (25%) share of processes decided once.
 *   `measureSpace` (the RN surface, where measure() and the ghost live, is
 *   offset from RNGH's origin, or the card measure was stale; #3531) has its
 *   own budget: internal builds at most
 *   GHOST_MEASURE_SPACE_MAX_EVENTS_INTERNAL (3) per process, so a constant
 *   offset shows across events, store builds breadcrumb only. It never uses
 *   the render budget. It fires when the lag-free surface offset exceeds
 *   SURFACE_OFFSET_TOL (12 px, dragGeometry.ts). Each carries
 *   `measureSpaceConsistent`: whether its surface offset agrees within
 *   SURFACE_AGREE_PX (10 px) with any of this process's previous ones (an
 *   in-memory history of at most MEASURE_SPACE_HISTORY (5) offsets, ~80 B).
 *   Worst case per process: internal 6 events (3 + 3) ≈ 21 KB; store 1 event
 *   in 25% of processes, so ≈ 0.25 × 3.5 KB × processes that see the bug;
 *   ~0 once it is fixed.
 * - Dials (no release needed): the server Sentry dial (`utils/sentryDial.ts`,
 *   `client_sentry` enabled / sample_rate) applies in `beforeSend` to this
 *   message like every other; it has no per-message field, so the targeted
 *   kill switch is a Sentry inbound filter on the `drag.ghostOffset` message.
 */
import { Dimensions, Platform } from "react-native";
import * as Sentry from "@sentry/react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { isStoreBuild } from "../buildFlavour";
import type { CardSource, ContainerSource, GhostCheckStatus } from "./dragGeometry";

/** At most this many `drag.positionMismatch` events per app process. */
export const DRAG_MISMATCH_MAX_EVENTS_PER_PROCESS = 1;
/** Share of app processes that may send the event at all (decided once). */
export const DRAG_MISMATCH_SAMPLE_RATE = 0.25;
/** Drag starts kept in the trace attached to the event. */
export const DRAG_TRACE_SIZE = 5;

/** What the pan's onStart worklet hands to the JS thread. Plain numbers and
 *  strings only — it crosses the UI→JS boundary. */
export interface DragStartDiagnostics {
  cardSource: CardSource;
  containerSource: ContainerSource;
  anomalous: boolean;
  cardMismatch: boolean;
  fingerOutsideCard: boolean;
  originOutsideContainer: boolean;
  containerUnknown: boolean;
  originX: number;
  originY: number;
  fingerX: number;
  fingerY: number;
  gestureLocalX: number;
  gestureLocalY: number;
  containerX: number;
  containerY: number;
  mismatchX: number;
  mismatchY: number;
  containerDriftX: number;
  containerDriftY: number;
  /** ms since the cached container offset was last measured; -1 = never. */
  containerAgeMs: number;
}

interface TraceEntry {
  gen: number;
  card: "m" | "g";
  cont: "m" | "c";
  anom: boolean;
  ox: number;
  oy: number;
  fx: number;
  fy: number;
}

let eventsSent = 0;
let sampledIn: boolean | null = null;
const trace: TraceEntry[] = [];

const r = (n: number) => (Number.isFinite(n) ? Math.round(n) : -1);

/** True when this drag start used a fallback for either measure. */
export function usedFallback(d: DragStartDiagnostics): boolean {
  return d.cardSource !== "measured" || d.containerSource !== "measured";
}

/**
 * Records one drag start: trace entry always (in memory, ≤ DRAG_TRACE_SIZE),
 * a breadcrumb when a fallback or anomaly was involved, and — rarely — a
 * `drag.positionMismatch` warning event for an anomaly.
 */
export function recordDragStart(d: DragStartDiagnostics, game: string, dragGen: number): void {
  trace.push({
    gen: dragGen,
    card: d.cardSource === "measured" ? "m" : "g",
    cont: d.containerSource === "measured" ? "m" : "c",
    anom: d.anomalous,
    ox: r(d.originX),
    oy: r(d.originY),
    fx: r(d.fingerX),
    fy: r(d.fingerY),
  });
  if (trace.length > DRAG_TRACE_SIZE) trace.splice(0, trace.length - DRAG_TRACE_SIZE);

  if (!d.anomalous && !usedFallback(d)) return;

  const flags = {
    cardSource: d.cardSource,
    containerSource: d.containerSource,
    cardMismatch: d.cardMismatch,
    fingerOutsideCard: d.fingerOutsideCard,
    originOutsideContainer: d.originOutsideContainer,
    containerUnknown: d.containerUnknown,
  };
  const coords = {
    originX: r(d.originX),
    originY: r(d.originY),
    fingerX: r(d.fingerX),
    fingerY: r(d.fingerY),
    gestureLocalX: r(d.gestureLocalX),
    gestureLocalY: r(d.gestureLocalY),
    containerX: r(d.containerX),
    containerY: r(d.containerY),
    mismatchX: r(d.mismatchX),
    mismatchY: r(d.mismatchY),
    containerDriftX: r(d.containerDriftX),
    containerDriftY: r(d.containerDriftY),
    containerAgeMs: r(d.containerAgeMs),
  };

  Sentry.addBreadcrumb({
    category: "drag",
    level: d.anomalous ? "warning" : "info",
    message: d.anomalous ? "drag.positionAnomaly" : "drag.originFallback",
    data: { ...flags, ...coords, gen: dragGen },
  });

  if (!d.anomalous) return;
  if (eventsSent >= DRAG_MISMATCH_MAX_EVENTS_PER_PROCESS) return;
  if (sampledIn === null) sampledIn = Math.random() < DRAG_MISMATCH_SAMPLE_RATE;
  if (!sampledIn) return;
  eventsSent += 1;

  const win = Dimensions.get("window");
  Sentry.captureMessage("drag.positionMismatch", {
    level: "warning",
    tags: { subsystem: "drag", game },
    extra: {
      ...flags,
      ...coords,
      platform: Platform.OS,
      windowWidth: r(win.width),
      windowHeight: r(win.height),
      dragGen,
      trace: trace.slice(),
    },
  });
}

// ---------------------------------------------------------------------------
// Rendered-ghost check (#3528)
// ---------------------------------------------------------------------------

/** Internal builds: at most this many `drag.ghostOffset` events per process. */
export const GHOST_OFFSET_MAX_EVENTS_INTERNAL = 3;
/** Store builds: at most this many `drag.ghostOffset` events per process. */
export const GHOST_OFFSET_MAX_EVENTS_STORE = 1;
/** Store builds: share of processes that may send it at all (decided once). */
export const GHOST_OFFSET_SAMPLE_RATE = 0.25;

/** Optional layout tags a game passes to DragProvider (`diagnosticTags`). */
export interface DragDiagnosticTags {
  /** FreeCell's Large cards setting. */
  cardSize?: "normal" | "large";
  /** Solitaire's draw mode, e.g. "draw1" / "draw3". */
  drawMode?: string;
}

/** The short result of a drag's ghost check that rides the onEnd hop. */
export interface GhostCheckSummary {
  status: GhostCheckStatus;
  deltaX: number;
  deltaY: number;
  /** Measure-space delta; 0 when the card had no measure at onStart. */
  deltaMeasureX: number;
  deltaMeasureY: number;
}

/** What kind of ghost-check failure a report is. `render`: the ghost is not
 *  under the finger (gesture space), the real bug. `transformIgnored`: the
 *  ghost measured at its host's origin although its transform is large,
 *  i.e. it is stuck at the screen's top-left (also a real render failure).
 *  Since #3531 `render` means the host itself is shifted inside the RN
 *  layout. `measureSpace`: the surface offset exceeds SURFACE_OFFSET_TOL:
 *  the RN surface is offset from RNGH's origin (visible on device; recurring,
 *  so `measureSpaceConsistent`) or the card measure was stale (a one-off). */
export type GhostFailKind = "render" | "measureSpace" | "transformIgnored";

/** What the pan worklet hands to the JS thread when the check fails. Plain
 *  numbers and strings only — it crosses the UI→JS boundary. */
export interface GhostOffsetReport {
  failKind: GhostFailKind;
  /** Gesture space: ghost page origin − (finger − grab) − (0, lift). */
  deltaX: number;
  deltaY: number;
  /** Measure space: ghost page origin − (card measure at onStart + finger
   *  movement since) − (0, lift); 0 when the card had no measure. */
  deltaMeasureX: number;
  deltaMeasureY: number;
  /** Which comparison exceeded its tolerance. */
  failGesture: boolean;
  failMeasure: boolean;
  fingerX: number;
  fingerY: number;
  ghostPageX: number;
  ghostPageY: number;
  expectedX: number;
  expectedY: number;
  /** The finger's offset inside the card at activation (#3531). */
  grabX: number;
  grabY: number;
  /** The ghost's window position (cardX/Y, unlifted) for the measured frame. */
  cardX: number;
  cardY: number;
  /** Fresh container measure at check time; NaN when it returned null. */
  containerPageX: number;
  containerPageY: number;
  /** The DragContainer offset at onStart (diagnostics only: since #3531
   *  the ghost is drawn in the root host, not the container). */
  containerUsedX: number;
  containerUsedY: number;
  cardSource: CardSource;
  containerSource: ContainerSource;
  /** The card measure at onStart disagreed with the gesture (rejected). */
  cardMismatch: boolean;
  /** The card's measure() page origin at onStart; NaN when it had none. */
  cardMeasuredX: number;
  cardMeasuredY: number;
  /** Where the RN surface's origin sits in RNGH space, from onStart (#3531):
   *  the card's gesture origin (absolute − x) minus its measure() origin.
   *  Positive Y = the surface, and so the ghost drawn in it, is below the
   *  finger. NaN without a card measure. A selected or shaking card biases it
   *  by up to ~8 px (the lift, scale and shake move the gesture view, not
   *  the measured wrapper), below SURFACE_OFFSET_TOL. */
  surfaceOffsetX: number;
  surfaceOffsetY: number;
  /** Finger movement since the frame the measured ghost was drawn for. */
  fingerStepX: number;
  fingerStepY: number;
  /** The tolerance applied per axis: dragTolerance + |last finger step|. */
  tolX: number;
  tolY: number;
  /** RNGH pan velocity (px/s) at check time. */
  velocityX: number;
  velocityY: number;
  msSinceStart: number;
  /** Ghost measure() calls this drag, including the one that found it. */
  measures: number;
  /** "update" (mid-drag) or "end" (the check ran in onEnd). */
  at: "update" | "end";
}

/** `measureSpace` events: internal builds at most this many per process, so a
 *  constant offset is recognisable across events (#3531); store builds none
 *  (breadcrumb only). Never uses the render-kind budget. */
export const GHOST_MEASURE_SPACE_MAX_EVENTS_INTERNAL = 3;
/** Surface offsets remembered per process for `measureSpaceConsistent`. */
export const MEASURE_SPACE_HISTORY = 5;
/** Two surface offsets within this many px on both axes are "the same". */
export const SURFACE_AGREE_PX = 10;

let ghostEventsSent = 0;
let measureSpaceEventsSent = 0;
let ghostSampledIn: boolean | null = null;
const measureSpaceDeltas: { x: number; y: number }[] = [];

/** Records a measureSpace fail's surface offset (lag-free, from onStart) and
 *  says whether it agrees within SURFACE_AGREE_PX with ANY of the previous
 *  (up to MEASURE_SPACE_HISTORY − 1) ones in this process. A recurring offset
 *  is the signature of a constant RN-surface-vs-RNGH offset, which the player
 *  sees as the ghost sitting that far from the finger; stale card measures
 *  are one-offs that rarely agree with each other. A fail without a surface
 *  offset (no card measure) is never consistent and not remembered. */
function noteMeasureSpace(d: GhostOffsetReport): boolean {
  const x = d.surfaceOffsetX;
  const y = d.surfaceOffsetY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const consistent = measureSpaceDeltas.some(
    (o) => Math.abs(o.x - x) <= SURFACE_AGREE_PX && Math.abs(o.y - y) <= SURFACE_AGREE_PX
  );
  measureSpaceDeltas.push({ x, y });
  if (measureSpaceDeltas.length > MEASURE_SPACE_HISTORY) measureSpaceDeltas.shift();
  return consistent;
}

function ghostBreadcrumb(
  s: GhostCheckSummary,
  game: string,
  sourceType: string,
  level: "info" | "warning",
  kind?: GhostFailKind,
  consistent?: boolean
): void {
  Sentry.addBreadcrumb({
    category: "drag",
    level,
    message: "drag.ghostCheck",
    data: {
      status: s.status,
      dx: r(s.deltaX),
      dy: r(s.deltaY),
      dmx: r(s.deltaMeasureX),
      dmy: r(s.deltaMeasureY),
      game,
      src: sourceType,
      ...(kind ? { kind } : {}),
      ...(consistent === undefined ? {} : { cons: consistent }),
    },
  });
}

/**
 * A drag's ghost check that passed (or could not measure the ghost): one
 * local breadcrumb, no event. Called from the JS end-of-drag hop the pan
 * already makes, so a passing drag costs no extra hop.
 */
export function recordGhostCheck(s: GhostCheckSummary, game: string, sourceType: string): void {
  ghostBreadcrumb(s, game, sourceType, "info");
}

/** Whether this process may send one more `drag.ghostOffset` event. */
function ghostOffsetAllowed(): boolean {
  if (!isStoreBuild()) return ghostEventsSent < GHOST_OFFSET_MAX_EVENTS_INTERNAL;
  if (ghostEventsSent >= GHOST_OFFSET_MAX_EVENTS_STORE) return false;
  if (ghostSampledIn === null) ghostSampledIn = Math.random() < GHOST_OFFSET_SAMPLE_RATE;
  return ghostSampledIn;
}

/**
 * The ghost check failed (#3528): a `fail` breadcrumb always, and a capped
 * `drag.ghostOffset` warning event. `render` and `transformIgnored` (real
 * visible bugs) share one budget; `measureSpace` has its own and is
 * internal-builds-only.
 */
export function recordGhostOffset(
  d: GhostOffsetReport,
  game: string,
  sourceType: string,
  tags: DragDiagnosticTags = {}
): void {
  const consistent = d.failKind === "measureSpace" ? noteMeasureSpace(d) : undefined;
  ghostBreadcrumb(
    {
      status: "fail",
      deltaX: d.deltaX,
      deltaY: d.deltaY,
      deltaMeasureX: d.deltaMeasureX,
      deltaMeasureY: d.deltaMeasureY,
    },
    game,
    sourceType,
    "warning",
    d.failKind,
    consistent
  );
  if (d.failKind === "measureSpace") {
    // Own budget: it must never use up the render-kind slot.
    if (isStoreBuild() || measureSpaceEventsSent >= GHOST_MEASURE_SPACE_MAX_EVENTS_INTERNAL) {
      return;
    }
    measureSpaceEventsSent += 1;
  } else {
    if (!ghostOffsetAllowed()) return;
    ghostEventsSent += 1;
  }

  const win = Dimensions.get("window");
  const screen = Dimensions.get("screen");
  // Launch-time insets: free (no hook, no new dependency) but not updated on
  // rotation. Null when the native module did not provide them.
  const insets = initialWindowMetrics?.insets ?? null;
  Sentry.captureMessage("drag.ghostOffset", {
    level: "warning",
    fingerprint: ["drag.ghostOffset", d.failKind, game, sourceType],
    tags: {
      subsystem: "drag",
      failKind: d.failKind,
      game,
      sourceType,
      platform: Platform.OS,
      ...(tags.cardSize ? { cardSize: tags.cardSize } : {}),
      ...(tags.drawMode ? { drawMode: tags.drawMode } : {}),
      ...(consistent === undefined ? {} : { measureSpaceConsistent: String(consistent) }),
    },
    extra: {
      deltaX: r(d.deltaX),
      deltaY: r(d.deltaY),
      deltaMeasureX: r(d.deltaMeasureX),
      deltaMeasureY: r(d.deltaMeasureY),
      failGesture: d.failGesture,
      failMeasure: d.failMeasure,
      fingerX: r(d.fingerX),
      fingerY: r(d.fingerY),
      ghostPageX: r(d.ghostPageX),
      ghostPageY: r(d.ghostPageY),
      expectedX: r(d.expectedX),
      expectedY: r(d.expectedY),
      grabX: r(d.grabX),
      grabY: r(d.grabY),
      cardX: r(d.cardX),
      cardY: r(d.cardY),
      containerPageX: r(d.containerPageX),
      containerPageY: r(d.containerPageY),
      containerUsedX: r(d.containerUsedX),
      containerUsedY: r(d.containerUsedY),
      cardSource: d.cardSource,
      containerSource: d.containerSource,
      cardMismatch: d.cardMismatch,
      cardMeasuredX: r(d.cardMeasuredX),
      cardMeasuredY: r(d.cardMeasuredY),
      surfaceOffsetX: r(d.surfaceOffsetX),
      surfaceOffsetY: r(d.surfaceOffsetY),
      ...(consistent === undefined ? {} : { measureSpaceConsistent: consistent }),
      fingerStepX: r(d.fingerStepX),
      fingerStepY: r(d.fingerStepY),
      tolX: r(d.tolX),
      tolY: r(d.tolY),
      velocityX: r(d.velocityX),
      velocityY: r(d.velocityY),
      msSinceStart: r(d.msSinceStart),
      measures: r(d.measures),
      at: d.at,
      windowWidth: r(win.width),
      windowHeight: r(win.height),
      screenWidth: r(screen.width),
      screenHeight: r(screen.height),
      orientation: win.width > win.height ? "landscape" : "portrait",
      insetsTop: insets ? r(insets.top) : -1,
      insetsBottom: insets ? r(insets.bottom) : -1,
      insetsLeft: insets ? r(insets.left) : -1,
      insetsRight: insets ? r(insets.right) : -1,
      trace: trace.slice(),
    },
  });
}

/**
 * Test-only: reset the per-process throttles, sampling decisions and trace.
 * @internal
 */
export function resetDragDiagnosticsForTests(): void {
  eventsSent = 0;
  sampledIn = null;
  trace.length = 0;
  ghostEventsSent = 0;
  measureSpaceEventsSent = 0;
  ghostSampledIn = null;
  measureSpaceDeltas.length = 0;
}

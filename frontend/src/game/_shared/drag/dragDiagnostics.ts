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
 */
import { Dimensions, Platform } from "react-native";
import * as Sentry from "@sentry/react-native";
import type { CardSource, ContainerSource } from "./dragGeometry";

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

/** Test-only: reset the per-process throttle, sampling decision and trace. */
export function resetDragDiagnosticsForTests(): void {
  eventsSent = 0;
  sampledIn = null;
  trace.length = 0;
}

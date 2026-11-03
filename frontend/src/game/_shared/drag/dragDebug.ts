/**
 * Drag debug overlay: its setting and its last-result store (#3529).
 *
 * Internal builds only. The setting is one boolean in AsyncStorage, written
 * once per toggle (no network, no telemetry). It defaults ON in test-hook
 * builds (Maestro), OFF otherwise. In a store build `isDragDebugEnabled()` is
 * false whatever is stored, so the overlay can never mount there.
 *
 * The result store is fed from the JS-side ghost-check path
 * (`recordGhostCheck` / `recordGhostOffset` in dragDiagnostics.ts, which the
 * pan already reaches on drag end or fail): no extra hop, and no work at all
 * while the overlay is off.
 */
import { useEffect, useState } from "react";

import { isStoreBuild } from "../buildFlavour";
import { areTestHooksEnabled } from "../envFlags";
import { createRecord } from "../storageSlot";

export const DRAG_DEBUG_RESULT_TEST_ID = "drag-debug-result";
/** The result's sequence line (`drag #N`), so an E2E flow can tell this
 *  drag's result from the previous drag's (#3532). */
export const DRAG_DEBUG_SEQ_TEST_ID = "drag-debug-seq";
/** The drop outcome line (`drop: accepted ...` / `drop: snapBack ...` /
 *  `drop: cancelled ...`), so a flow's failure log shows why a card didn't
 *  land (#3532). */
export const DRAG_DEBUG_DROP_TEST_ID = "drag-debug-drop";

const { load: loadDragDebug, save: saveDragDebug } = createRecord<boolean>({
  key: "drag_debug_overlay",
  subsystem: "drag.storage",
  ops: { load: "loadDragDebug", save: "saveDragDebug" },
  fallback: () => areTestHooksEnabled(),
  read: (raw) => raw === "1",
  write: (value) => (value ? "1" : "0"),
});

// --- Setting ---------------------------------------------------------------

// Lazy: the default reads the test-hooks flag, which is not safe at import time.
let enabled: boolean | null = null;
const isEnabled = (): boolean => (enabled ??= areTestHooksEnabled());
let loadStarted = false;
let chosen = false;
const enabledListeners = new Set<() => void>();

function setEnabledState(next: boolean): void {
  if (isEnabled() === next) return;
  enabled = next;
  for (const l of enabledListeners) l();
}

/** Whether the overlay may show: never in a store build, even if stored on. */
export function isDragDebugEnabled(): boolean {
  return !isStoreBuild() && isEnabled();
}

/** Reads the stored choice once per process (a choice made first wins). */
function ensureLoaded(): void {
  if (loadStarted || isStoreBuild()) return;
  loadStarted = true;
  void loadDragDebug().then((stored) => {
    if (!chosen) setEnabledState(stored);
  });
}

/** Stores the choice. A no-op in a store build. */
export function setDragDebugEnabled(value: boolean): void {
  if (isStoreBuild()) return;
  chosen = true;
  if (!value) clearDragDebugResult();
  setEnabledState(value);
  void saveDragDebug(value);
}

/** The setting for a component; false in a store build. */
export function useDragDebugEnabled(): boolean {
  const [, bump] = useState(0);
  useEffect(() => {
    ensureLoaded();
    const l = () => bump((n) => n + 1);
    enabledListeners.add(l);
    return () => {
      enabledListeners.delete(l);
    };
  }, []);
  return isDragDebugEnabled();
}

// --- Last result -----------------------------------------------------------

export interface DragDebugResult {
  status: "ok" | "fail" | "unmeasured" | "transformIgnored";
  /** Set for a fail. */
  failKind?: string;
  /** `unmeasured` only: why, shown after it (#3532), e.g.
   *  `notMounted a=3 m=0 mount=none end=+600ms`. */
  detail?: string;
  /** The delta shown after Δ; unused for "unmeasured". */
  dx: number;
  dy: number;
}

const rd = (n: number): number | "?" => (Number.isFinite(n) ? Math.round(n) : "?");

let result: DragDebugResult | null = null;
// How many results this process has recorded: one per drag whose check ran.
// Shown next to the result, so a Maestro step that asserts `drag #3` fails
// when its swipe never started a drag (the previous drag's `ok` would
// otherwise still be on screen, #3532).
let resultSeq = 0;
// The last drag's drop outcome, already formatted (drop: ...).
let drop: string | null = null;
// Bumped on every change to result or drop: the overlay's snapshot.
let version = 0;
const resultListeners = new Set<() => void>();

function emitResult(): void {
  version += 1;
  for (const l of resultListeners) l();
}

/** Changes whenever the result, its number or the drop outcome changes. */
export function getDragDebugVersion(): number {
  return version;
}

/** The last drag's drop outcome line, or null. */
export function getDragDebugDrop(): string | null {
  return drop;
}

export function getDragDebugResult(): DragDebugResult | null {
  return result;
}

/** The number of results recorded in this process; the latest one is this number. */
export function getDragDebugResultSeq(): number {
  return resultSeq;
}

export function subscribeDragDebugResult(listener: () => void): () => void {
  resultListeners.add(listener);
  return () => {
    resultListeners.delete(listener);
  };
}

/** Records a drag's check result for the overlay. Does nothing while it is off. */
export function noteDragDebugResult(r: DragDebugResult): void {
  if (!isDragDebugEnabled()) return;
  resultSeq += 1;
  result = r;
  emitResult();
}

/** Forgets the last result and drop outcome (a new drag started). */
export function clearDragDebugResult(): void {
  if (result === null && drop === null) return;
  result = null;
  drop = null;
  emitResult();
}

/** Bounds of a drop zone, window coordinates. */
export interface DropDebugBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How a drag ended, for the overlay's drop line. */
export type DragDebugDrop =
  | { kind: "accepted"; zone: string; snapped: boolean }
  | {
      kind: "snapBack";
      /** The zone the finger hit whose onDrop refused the card; null: none. */
      hit: string | null;
      zones: number;
      missing: number;
      fingerX: number;
      fingerY: number;
      /** The legal zone nearest the finger and its cached bounds; null: none. */
      near: { id: string; bounds: DropDebugBounds } | null;
    }
  | { kind: "cancelled"; reason: string };

/** `drop: accepted freecell-slot-0` / `drop: snapBack hit=none zones=16
 *  missing=0 finger=50,256 near=freecell-slot-0@16,207,64x91` /
 *  `drop: cancelled gesture`. */
export function formatDragDebugDrop(d: DragDebugDrop): string {
  if (d.kind === "accepted") return `drop: accepted ${d.zone}${d.snapped ? " (snap)" : ""}`;
  if (d.kind === "cancelled") return `drop: cancelled ${d.reason}`;
  const near = d.near
    ? `${d.near.id}@${rd(d.near.bounds.x)},${rd(d.near.bounds.y)},${rd(d.near.bounds.width)}x${rd(
        d.near.bounds.height
      )}`
    : "none";
  return (
    `drop: snapBack hit=${d.hit ?? "none"} zones=${d.zones} missing=${d.missing}` +
    ` finger=${rd(d.fingerX)},${rd(d.fingerY)} near=${near}`
  );
}

/** Records how the drag ended. JS end-of-drag path only; a no-op while the
 *  overlay is off. */
export function noteDragDebugDrop(d: DragDebugDrop): void {
  if (!isDragDebugEnabled()) return;
  drop = formatDragDebugDrop(d);
  emitResult();
}

/** `drag-check: ok Δ(1,-2)` / `drag-check: FAIL <kind> Δ(0,118)` / `drag-check: unmeasured`. */
export function formatDragDebugResult(r: DragDebugResult): string {
  if (r.status === "unmeasured") {
    return r.detail ? `drag-check: unmeasured ${r.detail}` : "drag-check: unmeasured";
  }
  const d = `Δ(${rd(r.dx)},${rd(r.dy)})`;
  if (r.status === "ok") return `drag-check: ok ${d}`;
  return `drag-check: FAIL ${r.failKind ?? r.status} ${d}`;
}

/** `drag #3`: the sequence line shown under the result. */
export function formatDragDebugSeq(seq: number): string {
  return `drag #${seq}`;
}

/** Test-only reset of the module state. @internal */
export function resetDragDebugForTests(): void {
  enabled = null;
  loadStarted = false;
  chosen = false;
  result = null;
  resultSeq = 0;
  drop = null;
  version = 0;
  enabledListeners.clear();
  resultListeners.clear();
}

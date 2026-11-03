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
  /** The delta shown after Δ; unused for "unmeasured". */
  dx: number;
  dy: number;
}

let result: DragDebugResult | null = null;
const resultListeners = new Set<() => void>();

function emitResult(): void {
  for (const l of resultListeners) l();
}

export function getDragDebugResult(): DragDebugResult | null {
  return result;
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
  result = r;
  emitResult();
}

/** Forgets the last result (a new drag started). */
export function clearDragDebugResult(): void {
  if (result === null) return;
  result = null;
  emitResult();
}

const rd = (n: number): number | "?" => (Number.isFinite(n) ? Math.round(n) : "?");

/** `drag-check: ok Δ(1,-2)` / `drag-check: FAIL <kind> Δ(0,118)` / `drag-check: unmeasured`. */
export function formatDragDebugResult(r: DragDebugResult): string {
  if (r.status === "unmeasured") return "drag-check: unmeasured";
  const d = `Δ(${rd(r.dx)},${rd(r.dy)})`;
  if (r.status === "ok") return `drag-check: ok ${d}`;
  return `drag-check: FAIL ${r.failKind ?? r.status} ${d}`;
}

/** Test-only reset of the module state. @internal */
export function resetDragDebugForTests(): void {
  enabled = null;
  loadStarted = false;
  chosen = false;
  result = null;
  enabledListeners.clear();
  resultListeners.clear();
}

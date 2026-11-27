/**
 * Test-build-only tap probe (#4098).
 *
 * e2e cannot time "a tap is taken at once" from outside the page: the Playwright round trips
 * (bounding box, mouse click over CDP) dwarf the app's own latency on a shared runner. So the
 * canvas records, on itself, how long the app took from the click event to having handled it,
 * on the event's own clock (`MouseEvent.timeStamp` shares `performance.now()`'s timeline), and
 * whether a match's burst was still flying when the tap was handled.
 *
 * Gated by `areTestHooksEnabled()`: in a store build `recordTap` returns before touching the
 * element or the clock.
 */

import { areTestHooksEnabled } from "../../game/_shared/envFlags";

/** Attributes e2e reads off the canvas (`mahjong-motion.spec.ts`). */
export const TAP_ATTR = {
  /** Count of taps handled so far, so a reader can tell a new tap from the last. */
  seq: "data-tap-seq",
  /** Milliseconds from the click event to the tap being handled (state change queued). */
  ms: "data-tap-ms",
  /** "true" if a match's ghost pair was still flying and bursting at that tap. */
  burst: "data-tap-burst",
} as const;

/**
 * Record one handled tap on `el`. Call after the tap's handler ran (the selection is queued
 * and React flushes a discrete event's update on exit), so `ms` is the app's whole latency for
 * the tap. No-op unless test hooks are on.
 */
export function recordTap(el: Element | null, eventTimeStamp: number, burstActive: boolean): void {
  if (!areTestHooksEnabled() || !el) return;
  const ms = performance.now() - eventTimeStamp;
  const seq = Number(el.getAttribute(TAP_ATTR.seq) ?? "0") + 1;
  el.setAttribute(TAP_ATTR.seq, String(seq));
  el.setAttribute(TAP_ATTR.ms, ms.toFixed(2));
  el.setAttribute(TAP_ATTR.burst, burstActive ? "true" : "false");
}

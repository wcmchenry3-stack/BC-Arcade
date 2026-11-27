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
import { MATCH_MS } from "../../game/mahjong/motion";

/**
 * When the last match was applied (`performance.now()`), or -Infinity. Written when the match
 * is applied, not when the burst's ghosts render, so a tap right behind a match sees the burst
 * even before React has re-rendered it (back-to-back clicks).
 */
let lastMatchAt = Number.NEGATIVE_INFINITY;

/** The board applied a match. A clock read and one write, test builds only. */
export function noteMatch(): void {
  if (areTestHooksEnabled()) lastMatchAt = performance.now();
}

/** True while the last match's flight and burst (MATCH_MS) is still playing. */
export function matchBurstActive(now: number = performance.now()): boolean {
  return areTestHooksEnabled() && now - lastMatchAt < MATCH_MS;
}

/** Test seam: forget any match. */
export function resetMatchProbe(): void {
  lastMatchAt = Number.NEGATIVE_INFINITY;
}

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
 * Record one handled tap on `el`. Call after the tap's handler ran (the selection is queued;
 * React flushes it after the handler, and paint follows), so `ms` is the input delay plus the
 * handler: event time to tap handled, not to paint. No-op unless test hooks are on.
 */
export function recordTap(el: Element | null, eventTimeStamp: number, burstActive: boolean): void {
  if (!areTestHooksEnabled() || !el) return;
  const ms = performance.now() - eventTimeStamp;
  const seq = Number(el.getAttribute(TAP_ATTR.seq) ?? "0") + 1;
  el.setAttribute(TAP_ATTR.seq, String(seq));
  el.setAttribute(TAP_ATTR.ms, ms.toFixed(2));
  el.setAttribute(TAP_ATTR.burst, burstActive ? "true" : "false");
}

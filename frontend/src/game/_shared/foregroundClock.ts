/**
 * foregroundClock — one app-wide running total of foreground time (#2684).
 *
 * `foregroundNow()` is a monotonic millisecond counter that only advances
 * while the app is in the foreground: `background` and `inactive` stop it,
 * `active` resumes it. The difference between two readings is the foreground
 * time between them, so `useGameSync` can time play without counting time the
 * app spent in the background — and without every hook instance keeping its
 * own `AppState` subscription.
 *
 * The single subscription is created lazily on the first reading, and the
 * current `AppState` is read at that moment, so there is no gap between
 * reading the state and subscribing. It uses `performance.now()` where it
 * exists (not affected by wall-clock changes), `Date.now()` otherwise.
 */

import { AppState, type AppStateStatus } from "react-native";

/** Only `background` and `inactive` stop the counter; anything else is foreground. */
function isForeground(state: unknown): boolean {
  return state !== "background" && state !== "inactive";
}

function monotonicNow(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === "function" ? perf.now() : Date.now();
}

let subscribed = false;
let subscription: { remove?: () => void } | undefined;
/** Foreground time banked from finished foreground segments. */
let banked = 0;
/** Start of the running foreground segment; null while in the background. */
let segmentStart: number | null = null;

function onChange(next: AppStateStatus): void {
  if (isForeground(next)) {
    if (segmentStart === null) segmentStart = monotonicNow();
    return;
  }
  if (segmentStart !== null) {
    banked += Math.max(0, monotonicNow() - segmentStart);
    segmentStart = null;
  }
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  let state: unknown = null;
  try {
    state = AppState.currentState;
  } catch {
    // Isolation: assume foreground.
  }
  segmentStart = isForeground(state) ? monotonicNow() : null;
  try {
    subscription = AppState.addEventListener("change", onChange);
  } catch {
    // Isolation: without the subscription the counter never pauses.
  }
}

/** Foreground milliseconds so far (monotonic; only differences are meaningful). */
export function foregroundNow(): number {
  ensureSubscribed();
  const running = segmentStart !== null ? Math.max(0, monotonicNow() - segmentStart) : 0;
  return banked + running;
}

/** Test-only: drop the subscription and the running total. */
export function __resetForegroundClockForTests(): void {
  try {
    subscription?.remove?.();
  } catch {
    // Isolation.
  }
  subscription = undefined;
  subscribed = false;
  banked = 0;
  segmentStart = null;
}

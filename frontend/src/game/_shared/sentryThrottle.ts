/**
 * Client-side Sentry throttle (#3293, epic #3273).
 *
 * Sentry quota is a cost that must not grow with free usage. Every reporter
 * that can fire per game or per flush (SyncWorker, the event recorder,
 * reportBug's Sentry path) goes through `captureThrottledMessage`:
 *   - one event per message key per app session (`perKeyWindowMs`, default
 *     Infinity), and
 *   - at most `maxPerHour` events in any rolling hour (sliding window of send
 *     timestamps), with `error`/`fatal` on their own budget so a burst of
 *     warnings cannot starve a new error.
 * A drop bumps a counter, never an event. The counter rides along as
 * `extra.sentryThrottleDropped` on the next event that does get through (it
 * is lost if no event follows).
 *
 * State is in memory only: no storage writes, nothing on the gameplay path.
 * "Per device per hour" is therefore per app session per hour; a relaunch
 * resets it. That is the cheapest option and still bounds one session.
 *
 * Messages must be fixed text (no ids). Put ids in `tags` / `extra`; the key
 * doubles as the fixed Sentry fingerprint so all games group in one issue.
 */

import * as Sentry from "@sentry/react-native";

export const DEFAULT_MAX_PER_HOUR = 10;
export const HOUR_MS = 60 * 60 * 1000;

export interface SentryThrottleOptions {
  now?: () => number;
  /** Min gap between two events with the same key. Default Infinity (once per session). */
  perKeyWindowMs?: number;
  /** Cap across all keys in any rolling hour; applies to each of the two level budgets. */
  maxPerHour?: number;
}

export type ThrottleLevel = "warning" | "error" | "info" | "fatal";

export class SentryThrottle {
  private readonly now: () => number;
  private readonly perKeyWindowMs: number;
  private readonly maxPerHour: number;
  private readonly lastByKey = new Map<string, number>();
  private readonly sent: Record<"high" | "low", number[]> = { high: [], low: [] };
  private dropped = 0;
  private droppedSinceLast = 0;

  constructor(opts: SentryThrottleOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.perKeyWindowMs = opts.perKeyWindowMs ?? Infinity;
    this.maxPerHour = opts.maxPerHour ?? DEFAULT_MAX_PER_HOUR;
  }

  /** Check-and-record. True means the caller may send one event for `key`. */
  allow(key: string, level: ThrottleLevel = "warning"): boolean {
    const t = this.now();
    const recent = this.sent[level === "error" || level === "fatal" ? "high" : "low"];
    while (recent.length > 0 && t - (recent[0] as number) >= HOUR_MS) recent.shift();
    const last = this.lastByKey.get(key);
    if (
      (last !== undefined && t - last < this.perKeyWindowMs) ||
      recent.length >= this.maxPerHour
    ) {
      this.dropped += 1;
      this.droppedSinceLast += 1;
      return false;
    }
    this.lastByKey.set(key, t);
    recent.push(t);
    return true;
  }

  /** Total drops this session. */
  get droppedCount(): number {
    return this.dropped;
  }

  /** Drops since the last call; the next sent event carries it. */
  takeDroppedSinceLast(): number {
    const n = this.droppedSinceLast;
    this.droppedSinceLast = 0;
    return n;
  }

  reset(): void {
    this.lastByKey.clear();
    this.sent.high = [];
    this.sent.low = [];
    this.dropped = 0;
    this.droppedSinceLast = 0;
  }
}

export const sentryThrottle = new SentryThrottle();

const resetHooks: Array<() => void> = [];

/** Register session state that should be cleared with the throttle (tests). */
export function onSentryThrottleReset(fn: () => void): void {
  resetHooks.push(fn);
}

/** Test hook: clear the shared throttle between tests. */
export function resetSentryThrottle(): void {
  sentryThrottle.reset();
  for (const fn of resetHooks) fn();
}

export interface ThrottledMessageOptions {
  level: "warning" | "error" | "info" | "fatal";
  /** Searchable, low-cardinality values (status, game type). Ids go in `extra`. */
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/**
 * Send `message` to Sentry once per `key`, fingerprinted by `key`.
 * Returns whether it was sent. `message` must not contain ids.
 */
export function captureThrottledMessage(
  key: string,
  message: string,
  opts: ThrottledMessageOptions,
  throttle: SentryThrottle = sentryThrottle
): boolean {
  if (!throttle.allow(key, opts.level)) return false;
  const dropped = throttle.takeDroppedSinceLast();
  Sentry.captureMessage(message, {
    level: opts.level,
    fingerprint: [key],
    tags: opts.tags,
    extra: dropped > 0 ? { ...opts.extra, sentryThrottleDropped: dropped } : opts.extra,
  });
  return true;
}

/**
 * The app's Sentry dial (#3437, epic #3273): the server's kill switch and
 * sample rate for frontend Sentry volume, so it can be turned down without an
 * app release.
 *
 * Carrier: `GET /games/catalog`, already fetched by replayDialSync.ts once per
 * launch and at most once an hour on a return to the foreground (never while
 * a game is played, and no new endpoint or poll). It serves
 * `client_sentry: {enabled, sample_rate}` from the backend env vars
 * `CLIENT_SENTRY_ENABLED` / `CLIENT_SENTRY_SAMPLE_RATE` (Render).
 *
 * Which dial applies, first that holds:
 *  1. one fetched this process (`acceptSentryDial`);
 *  2. the last good one, stored in AsyncStorage (`sentryDial.v1`, read once
 *     per process by `hydrateSentryDial`);
 *  3. the default, which is today's behaviour: on, every event.
 * A catalog with no `client_sentry`, a non-boolean `enabled`, or a rate that
 * is not a finite number in [0, 1] changes nothing; nor does a failed fetch.
 *
 * Applied by App.tsx's `Sentry.init` hooks, so it covers every JS reporter at
 * once (`captureException`, `captureMessage`, `captureThrottledMessage`, the
 * console.error forwarder) and metrics:
 *  - `beforeSend` → `sentryDialFilter`: an error/message event is dropped
 *    while the dial is off, else kept with probability `rate`;
 *  - `beforeSendMetric` → `sentryDialAllows()`: the same for metrics.
 * Kept whatever the dial says (keep-list): JS events at level `fatal` (an
 * unhandled crash), and what never reaches the JS hooks — native crashes and
 * App Hangs (sent by the native SDK), player-sent feedback
 * (`captureFeedback`, a `feedback` event, already rate-limited) and release
 * health sessions. Breadcrumbs cost nothing on their own: they only leave the
 * device inside an event, so a dropped event drops them too.
 *
 * Runs after the in-app throttles (#3293, #3313): the dial can only lower
 * volume below their caps, never raise it.
 *
 * Cost: one AsyncStorage read per launch, one write only when a fetched dial
 * differs from the held one, and per Sentry event one comparison and at most
 * one `random()`. Nothing on the frame or gesture path.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export interface SentryDial {
  readonly enabled: boolean;
  /** Share of events sent, 0..1. */
  readonly rate: number;
}

const STORAGE_KEY = "sentryDial.v1";
/** Today's behaviour: every event the throttles let through is sent. */
const SENTRY_DIAL_DEFAULT: SentryDial = { enabled: true, rate: 1 };

let held: SentryDial | null = null;
let hydrating: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseDial(enabled: unknown, rate: unknown): SentryDial | null {
  return typeof enabled === "boolean" && isRate(rate) ? { enabled, rate } : null;
}

/**
 * The dial in force now (see the header for the order).
 * @internal Exported for its tests; `sentryDialAllows` is the caller.
 */
export function sentryDial(): SentryDial {
  return held ?? SENTRY_DIAL_DEFAULT;
}

/**
 * Read the last good dial once per process. A dial fetched meanwhile is
 * fresher and wins. Never throws.
 */
export function hydrateSentryDial(): Promise<void> {
  if (!hydrating) {
    hydrating = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        const stored = isRecord(parsed) ? parseDial(parsed.e, parsed.r) : null;
        if (stored && held === null) held = stored;
      } catch {
        // Unreadable or corrupt: the default until a fetch succeeds.
      }
    })();
  }
  return hydrating;
}

/**
 * Take a fetched catalog body's `client_sentry` as the dial, and store it,
 * only when it is valid. Returns whether it was taken. Never throws.
 */
export async function acceptSentryDial(body: unknown): Promise<boolean> {
  const block = isRecord(body) ? body.client_sentry : undefined;
  const next = isRecord(block) ? parseDial(block.enabled, block.sample_rate) : null;
  if (next === null) return false;
  const same = held !== null && held.enabled === next.enabled && held.rate === next.rate;
  held = next;
  if (same) return true;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ e: next.enabled, r: next.rate }));
  } catch {
    // Kept in memory for this process; the next launch fetches again.
  }
  return true;
}

/** Whether one Sentry event or metric may go, under the dial in force. */
export function sentryDialAllows(random: () => number = Math.random): boolean {
  const { enabled, rate } = sentryDial();
  if (!enabled) return false;
  return rate >= 1 || random() < rate;
}

/**
 * `beforeSend` step: the event, or null when the dial drops it. A `fatal`
 * event (an unhandled JS crash) is always kept.
 */
export function sentryDialFilter<E extends { level?: string }>(
  event: E,
  random: () => number = Math.random
): E | null {
  if (event.level === "fatal") return event;
  return sentryDialAllows(random) ? event : null;
}

/**
 * Tests only: forget the held dial and the hydrate.
 * @internal
 */
export function __resetSentryDialForTests(): void {
  held = null;
  hydrating = null;
}

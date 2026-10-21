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
 *  1. one fetched this process (`acceptSentryDial`), or
 *  2. the last good one, stored in AsyncStorage (`sentryDial.v1`, read once
 *     per process by `hydrateSentryDial`),
 *     either only while a valid fetch confirmed it within
 *     `SENTRY_DIAL_MAX_AGE_MS` (7 days) and not in the future (clock skew);
 *  3. the default, which is today's behaviour: on, every event.
 * So a device that stops hearing from the server (an older backend without
 * `client_sentry`, a rollback, no network) returns to the default after 7
 * days, and an "off" can never outlive the server's word for long.
 * A catalog with no `client_sentry`, a non-boolean `enabled`, or a rate that
 * is not a finite number in [0, 1] changes nothing and confirms nothing; nor
 * does a failed fetch.
 *
 * Stored shape: `{e, r, t}` (`t`: when a valid fetch last confirmed it). A
 * stored value without a valid `t` (the first #3437 build wrote `{e, r}`) is
 * treated as expired: the default until the next fetch.
 *
 * Applied by App.tsx's `Sentry.init` hooks, so it covers every JS reporter at
 * once (`captureException`, `captureMessage`, `captureThrottledMessage`, the
 * console.error forwarder) and metrics:
 *  - `beforeSend` → `sentryDialFilter`: an error/message event is dropped
 *    while the dial is off, else kept with probability `rate`;
 *  - `beforeSendMetric` → `sentryDialAllows()`: the same for metrics.
 * Kept whatever the dial says (keep-list): JS events at level `fatal`, and
 * what never reaches the JS hooks — native crashes and App Hangs (sent by the
 * native SDK), player-sent feedback (`captureFeedback`, a `feedback` event,
 * already rate-limited) and release-health sessions. Breadcrumbs cost nothing
 * on their own: they only leave the device inside an event, so a dropped
 * event drops them too.
 *
 * Runs after the in-app throttles (#3293, #3313): the dial can only lower
 * volume below their caps, never raise it.
 *
 * Cost: one AsyncStorage read per launch; a write only when a fetched dial
 * differs from the held one or its confirmation is over a day old (at most
 * about one a day); per Sentry event one comparison and at most one
 * `random()`. Nothing on the frame or gesture path.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export interface SentryDial {
  readonly enabled: boolean;
  /** Share of events sent, 0..1. */
  readonly rate: number;
}

interface HeldDial extends SentryDial {
  /** When a valid fetch last confirmed it (ms since epoch). */
  readonly confirmedAt: number;
}

const STORAGE_KEY = "sentryDial.v1";
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A dial no valid fetch has confirmed for this long is dropped for the default.
 * @internal Exported for its tests; `sentryDial` is the reader.
 */
export const SENTRY_DIAL_MAX_AGE_MS = 7 * DAY_MS;
/** An unchanged dial's confirmation is rewritten only once it is older than this. */
const CONFIRM_WRITE_EVERY_MS = DAY_MS;
/** Today's behaviour: every event the throttles let through is sent. */
const SENTRY_DIAL_DEFAULT: SentryDial = { enabled: true, rate: 1 };

let held: HeldDial | null = null;
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

/** Confirmed within the max age and not in the future (the clock moved back). */
function isFresh(dial: HeldDial, now: number): boolean {
  const age = now - dial.confirmedAt;
  return age >= 0 && age < SENTRY_DIAL_MAX_AGE_MS;
}

/**
 * The dial in force at `now` (see the header for the order).
 * @internal Exported for its tests; `sentryDialAllows` is the caller.
 */
export function sentryDial(now: number = Date.now()): SentryDial {
  return held && isFresh(held, now)
    ? { enabled: held.enabled, rate: held.rate }
    : SENTRY_DIAL_DEFAULT;
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
        if (!isRecord(parsed)) return;
        const dial = parseDial(parsed.e, parsed.r);
        // No valid `t` (e.g. the first build's `{e, r}`): expired, so not held.
        const t = parsed.t;
        if (!dial || typeof t !== "number" || !Number.isFinite(t)) return;
        if (held === null) held = { ...dial, confirmedAt: t };
      } catch {
        // Unreadable or corrupt: the default until a fetch succeeds.
      }
    })();
  }
  return hydrating;
}

/**
 * Take a fetched catalog body's `client_sentry` as the dial, confirmed at
 * `now`, and store it, only when it is valid. Returns whether it was taken.
 * Never throws.
 */
export async function acceptSentryDial(body: unknown, now: number = Date.now()): Promise<boolean> {
  const block = isRecord(body) ? body.client_sentry : undefined;
  const next = isRecord(block) ? parseDial(block.enabled, block.sample_rate) : null;
  if (next === null) return false;
  const sinceConfirmed = held ? now - held.confirmedAt : -1;
  const recentlyConfirmed =
    held !== null &&
    held.enabled === next.enabled &&
    held.rate === next.rate &&
    sinceConfirmed >= 0 &&
    sinceConfirmed < CONFIRM_WRITE_EVERY_MS;
  // Same value, confirmed under a day ago: keep its (older) `t`, no write.
  if (recentlyConfirmed) return true;
  held = { ...next, confirmedAt: now };
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ e: next.enabled, r: next.rate, t: now })
    );
  } catch {
    // Kept in memory for this process; the next launch fetches again.
  }
  return true;
}

/** Whether one Sentry event or metric may go, under the dial in force. */
export function sentryDialAllows(
  random: () => number = Math.random,
  now: number = Date.now()
): boolean {
  const { enabled, rate } = sentryDial(now);
  if (!enabled) return false;
  return rate >= 1 || random() < rate;
}

/**
 * `beforeSend` step: the event, or null when the dial drops it. A `fatal`
 * event is always kept.
 */
export function sentryDialFilter<E extends { level?: string }>(
  event: E,
  random: () => number = Math.random,
  now: number = Date.now()
): E | null {
  if (event.level === "fatal") return event;
  return sentryDialAllows(random, now) ? event : null;
}

/**
 * Tests only: forget the held dial and the hydrate.
 * @internal
 */
export function __resetSentryDialForTests(): void {
  held = null;
  hydrating = null;
}

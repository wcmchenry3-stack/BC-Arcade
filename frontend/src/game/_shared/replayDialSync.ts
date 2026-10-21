/**
 * Fetching the replay dial (#3279): `GET /games/catalog`, whose per-game
 * `replay` block replayDial.ts holds and decides from.
 *
 *  - `startReplayDial()`: at launch (NetworkContext), the stored dial, then one
 *    fetch.
 *  - `refreshIfStale()`: on a return to the foreground, a fetch only once
 *    `REPLAY_DIAL_REFRESH_MS` (1 h) has passed since the last attempt, failed
 *    or not — so offline it does not retry in a loop.
 *
 * A response that is not a 2xx, or not a valid catalog, keeps the dial held
 * (the last-known one, else the default). The request goes through `SyncApi`,
 * which never throws and only breadcrumbs a network failure: nothing here
 * reports to Sentry. Cost: one cacheable GET (`Cache-Control: public,
 * max-age=300`) per launch, plus at most one an hour in the foreground.
 *
 * The same response carries the app's Sentry dial (#3437, `client_sentry`),
 * taken by utils/sentryDial.ts on its own: a catalog whose replay items are
 * invalid can still carry a valid Sentry dial, and the other way round.
 */

import { acceptSentryDial, hydrateSentryDial } from "../../utils/sentryDial";
import { REPLAY_DIAL_REFRESH_MS } from "./eventQueueConfig";
import { acceptCatalog, hydrate } from "./replayDial";
import { syncApi, type SyncApi } from "./syncApi";

const CATALOG_PATH = "/games/catalog";

let api: Pick<SyncApi, "request"> = syncApi;
let lastAttemptAt: number | null = null;

/**
 * Fetch the catalog and take its dial when it is valid. Returns whether the
 * dial changed. Never throws.
 * @internal Exported for its tests; `startReplayDial` and `refreshIfStale` are the callers.
 */
export async function refresh(now: number = Date.now()): Promise<boolean> {
  lastAttemptAt = now;
  try {
    const res = await api.request("GET", CATALOG_PATH, undefined, now);
    if (!res.ok) return false;
    const [changed] = await Promise.all([acceptCatalog(res.body, now), acceptSentryDial(res.body)]);
    return changed;
  } catch {
    return false;
  }
}

/**
 * `refresh()` unless one was tried in the last `REPLAY_DIAL_REFRESH_MS`. A
 * last attempt dated in the future (the clock moved back) counts as stale,
 * so it can never block refreshes until the clock catches up.
 */
export function refreshIfStale(now: number = Date.now()): Promise<boolean> {
  const elapsed = lastAttemptAt === null ? null : now - lastAttemptAt;
  if (elapsed !== null && elapsed >= 0 && elapsed < REPLAY_DIAL_REFRESH_MS) {
    return Promise.resolve(false);
  }
  return refresh(now);
}

/** The launch sequence: the stored dials (replay and Sentry), then one fetch. Never rejects. */
export function startReplayDial(): Promise<boolean> {
  return Promise.all([hydrate(), hydrateSentryDial()]).then(() => refresh());
}

/**
 * Tests only: the API the fetch goes through, and no attempt yet.
 * @internal
 */
export function __resetReplayDialSyncForTests(
  options: { api?: Pick<SyncApi, "request"> } = {}
): void {
  api = options.api ?? syncApi;
  lastAttemptAt = null;
}

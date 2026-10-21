/**
 * Low-level HTTP helper for the log-sync pipeline (367c).
 *
 * Unlike httpClient.createGameClient, this helper does NOT throw on
 * non-2xx. The SyncWorker state machine needs to inspect the status code
 * and Retry-After header to decide whether to delete, backoff, or
 * dead-letter rows. Throwing would lose that information.
 *
 * Fetch is injected so tests can drive every branch of the state machine
 * without touching the network.
 */

import * as Sentry from "@sentry/react-native";
import { Platform } from "react-native";

import { captureThrottledMessage } from "./sentryThrottle";
import { getOrCreateSessionId } from "./session";
import { CsprngUnavailableError } from "./uuid";

const isTestBuild = process.env.EXPO_PUBLIC_TEST_HOOKS === "1";

/** One Sentry report per launch when the session id can't be read (#3321). */
const SESSION_UNAVAILABLE_KEY = "syncApi.session.unavailable";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SyncResponse {
  status: number;
  ok: boolean;
  retryAfterMs: number | null;
  body: unknown;
}

/**
 * See httpClient.resolveBaseUrl for the rationale behind throwing rather
 * than silently falling back to localhost in non-dev builds (#511).
 */
function isLocalhost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function resolveBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_URL;
  if (raw) {
    const resolved = raw.startsWith("http") ? raw : `https://${raw}`;
    if (!__DEV__ && !isTestBuild && isLocalhost(resolved)) {
      const msg =
        "EXPO_PUBLIC_API_URL resolves to localhost in a non-dev build (syncApi). " +
        "Set EXPO_PUBLIC_API_URL to the production API URL on the Render service.";
      Sentry.captureMessage(msg, {
        level: "fatal",
        tags: { subsystem: "syncApi", issue: "localhost-in-prod" },
        extra: { raw },
      });
      throw new Error(msg);
    }
    return resolved;
  }
  if (__DEV__) {
    return "http://localhost:8000";
  }
  const msg =
    "EXPO_PUBLIC_API_URL is not set in a non-dev build (syncApi). " +
    "Expo bakes EXPO_PUBLIC_* vars into the bundle at export time. " +
    "Refusing to fall back to http://localhost:8000.";
  Sentry.captureMessage(msg, {
    level: "fatal",
    tags: { subsystem: "syncApi", issue: "missing-env" },
  });
  throw new Error(msg);
}

/** `/games/<uuid>/events` → `/games/{id}/events`, so breadcrumb text carries no id. */
function routeTemplate(path: string): string {
  return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "{id}");
}

function parseRetryAfter(headerValue: string | null, now: number): number | null {
  if (!headerValue) return null;
  const asInt = Number(headerValue);
  if (Number.isFinite(asInt)) return Math.max(0, asInt * 1000);
  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - now);
  return null;
}

export class SyncApi {
  constructor(
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly baseUrlResolver: () => string = resolveBaseUrl
  ) {}

  /** A `GET` passes `body` undefined and sends none (the replay dial's catalog read, #3279). */
  async request(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body: unknown,
    now: number = Date.now()
  ): Promise<SyncResponse> {
    const url = `${this.baseUrlResolver()}${path}`;
    let sessionId: string;
    try {
      sessionId = await getOrCreateSessionId();
    } catch (e) {
      // No session id: none can be minted (no CSPRNG, #3303) or storage
      // failed reading or writing it (#3321). Send nothing. Any id we made up
      // here would be rejected (a non-UUID is a 400) or belong to another
      // player (a 403), and the worker dead-letters both. A synthetic 0
      // status backs off like a network failure; rows stay queued.
      //
      // Any other error is handled the same way: AsyncStorage errors are plain
      // `Error`s, so a storage failure can't be told apart from a bug here, and
      // sending nothing is the one outcome that loses no rows. So that neither
      // goes unseen, the first one per launch is reported (session.ts already
      // reports the CSPRNG case).
      if (!(e instanceof CsprngUnavailableError)) {
        // Never the id or the error text: they can carry the id (a credential).
        const errorClass = e instanceof Error ? e.name : typeof e;
        Sentry.addBreadcrumb({
          category: "syncWorker.session",
          level: "warning",
          message: `${method} ${routeTemplate(path)} → no session id (storage error)`,
          data: { platform: Platform.OS, errorClass },
        });
        captureThrottledMessage(SESSION_UNAVAILABLE_KEY, "syncApi: session id unavailable", {
          level: "error",
          tags: { subsystem: "syncApi", errorClass },
          extra: { platform: Platform.OS },
        });
      }
      return { status: 0, ok: false, retryAfterMs: null, body: null };
    }
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Session-ID": sessionId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const retryAfterMs = parseRetryAfter(res.headers.get("Retry-After"), now);
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
      return {
        status: res.status,
        ok: res.ok,
        retryAfterMs,
        body: parsed,
      };
    } catch (e) {
      // Network failure — model as a synthetic 0 status so the state
      // machine treats it the same as 5xx (exponential backoff).
      Sentry.addBreadcrumb({
        category: "syncWorker.network",
        level: "warning",
        message: `${method} ${routeTemplate(path)} → network error: ${e instanceof Error ? e.message : String(e)}`,
        data: { platform: Platform.OS, path },
      });
      return { status: 0, ok: false, retryAfterMs: null, body: null };
    }
  }
}

export const syncApi = new SyncApi();

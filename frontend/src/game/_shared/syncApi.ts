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

import { getOrCreateSessionId } from "./session";

const isTestBuild = process.env.EXPO_PUBLIC_TEST_HOOKS === "1";

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

  async request(
    method: "POST" | "PATCH",
    path: string,
    body: unknown,
    now: number = Date.now()
  ): Promise<SyncResponse> {
    const url = `${this.baseUrlResolver()}${path}`;
    let sessionId: string;
    try {
      sessionId = await getOrCreateSessionId();
    } catch {
      sessionId = "unknown";
    }
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Session-ID": sessionId,
        },
        body: JSON.stringify(body),
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
        message: `${method} ${path} → network error: ${e instanceof Error ? e.message : String(e)}`,
        data: { platform: Platform.OS },
      });
      return { status: 0, ok: false, retryAfterMs: null, body: null };
    }
  }
}

export const syncApi = new SyncApi();

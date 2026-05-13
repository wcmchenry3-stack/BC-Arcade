/**
 * Shared HTTP client factory for all game API clients.
 *
 * Every game's per-request logic (BASE_URL derivation, Sentry breadcrumbs,
 * X-Session-ID injection, error shaping) is identical apart from the
 * Sentry `tags.api` value. This factory collapses the 5 duplicated
 * `request<T>()` functions into one.
 *
 * Phase 1 of offline-play support (#131) uses this for the score queue's
 * cascade submissions. Migration of the 5 existing *Client.ts files to
 * this factory is tracked separately in #153.
 */

import * as Sentry from "@sentry/react-native";
import { Platform } from "react-native";
import { getOrCreateSessionId } from "./session";

/** Error subclass that preserves the HTTP status code from the API response. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Resolves the base URL for API calls.
 *
 * `EXPO_PUBLIC_*` variables are inlined into the bundle by Expo's web/native
 * exporter at build time, so the value must be present when `npx expo export`
 * runs — not at runtime. If we ship a non-dev bundle without it, every
 * request will hit `http://localhost:8000` and fail with a `TypeError:
 * Failed to fetch`, which is exactly what #511 documented.
 *
 * Rather than silently fall back (and then have Sentry record a flood of
 * confusing per-request fetch errors), we throw at module load. That makes
 * the misconfiguration impossible to miss: the app fails fast on boot with
 * a clear message instead of pretending to work and then breaking on every
 * score submit.
 */
// Baked in at export time — true only in E2E test builds. Used to suppress
// Sentry noise from intentional localhost API usage during tests.
const isTestBuild = process.env.EXPO_PUBLIC_TEST_HOOKS === "1";

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
    if (!__DEV__ && isLocalhost(resolved)) {
      const msg = isTestBuild
        ? "EXPO_PUBLIC_TEST_HOOKS=1 is set and EXPO_PUBLIC_API_URL resolves to localhost. " +
          "If this is a production or staging build, remove EXPO_PUBLIC_TEST_HOOKS from the Render service env vars."
        : "EXPO_PUBLIC_API_URL resolves to localhost in a non-dev build. " +
          "This means the env var was set to a local address at bundle time. " +
          "Set EXPO_PUBLIC_API_URL to the production API URL on the Render service.";
      if (isTestBuild) {
        console.warn("[httpClient]", msg);
      } else {
        Sentry.captureMessage(msg, {
          level: "fatal",
          tags: { subsystem: "httpClient", issue: "localhost-in-prod" },
          extra: { raw },
        });
        throw new Error(msg);
      }
    }
    return resolved;
  }
  if (__DEV__) {
    return "http://localhost:8000";
  }
  const msg =
    "EXPO_PUBLIC_API_URL is not set in a non-dev build. " +
    "Expo bakes EXPO_PUBLIC_* vars into the bundle at export time, so this " +
    "must be present when `expo export` runs — set it on the Render service " +
    "(see render.yaml) or in the build environment. Refusing to fall back to " +
    "http://localhost:8000.";
  Sentry.captureMessage(msg, {
    level: "fatal",
    tags: { subsystem: "httpClient", issue: "missing-env" },
  });
  throw new Error(msg);
}

export interface HttpClientOptions {
  /** Sentry tag value, e.g. "cascade", "yacht". Used for per-game observability. */
  apiTag: string;
  /**
   * Probability (0..1) of escalating a 5xx response to a Sentry warning
   * `captureMessage`. 4xx is never escalated. Defaults to 0.1 so persistent
   * backend outages stay visible without flooding the dashboard. Tests
   * override this to make sampling deterministic.
   */
  serverErrorSampleRate?: number;
  /** Injection seam for deterministic sampling in tests. */
  random?: () => number;
}

export function createGameClient(options: HttpClientOptions) {
  const { apiTag, serverErrorSampleRate = 0.1, random = Math.random } = options;
  const BASE_URL = resolveBaseUrl();

  Sentry.addBreadcrumb({
    category: "api.config",
    message: `${apiTag} API: BASE_URL=${BASE_URL}, platform=${Platform.OS}`,
    level: "info",
  });

  return async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const method = options?.method ?? "GET";
    Sentry.addBreadcrumb({
      category: "api.request",
      message: `${method} ${url}`,
      level: "info",
    });
    try {
      const sessionId = await getOrCreateSessionId();
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json", "X-Session-ID": sessionId },
        ...options,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        const msg = err.detail ?? "Request failed";
        // 4xx and 5xx are HTTP-layer outcomes, not JS exceptions. Emit a
        // breadcrumb only — never `captureMessage` (which attaches a
        // synthetic stack and creates a grouped Sentry issue per status
        // code) and never `captureException`. See #513: a single 429
        // status used to spawn a 476-event Sentry issue grouped on the
        // ApiError constructor frame.
        Sentry.addBreadcrumb({
          category: "api.error",
          level: "warning",
          message: `${method} ${path} → ${res.status}`,
          data: { url, status: res.status, detail: msg, platform: Platform.OS, api: apiTag },
        });
        // 5xx only: optionally surface as a low-sample warning so a
        // sustained backend outage still leaves a trail in the dashboard
        // without flooding it. 4xx never escalates — those are client-
        // side / expected-recoverable.
        if (res.status >= 500 && random() < serverErrorSampleRate) {
          Sentry.captureMessage(`API ${apiTag} 5xx: ${method} ${path} → ${res.status}`, {
            level: "warning",
            tags: { api: apiTag, errorType: "http5xx", status: String(res.status) },
            extra: { url, detail: msg, platform: Platform.OS },
          });
        }
        throw new ApiError(msg, res.status);
      }
      return res.json();
    } catch (e) {
      if (e instanceof ApiError) {
        // Already breadcrumbed in the !res.ok branch above. Re-throw so
        // callers can inspect `.status` and decide how to react.
        throw e;
      }
      if (e instanceof TypeError) {
        // `fetch` throws TypeError for network-layer failures (offline,
        // DNS, CORS, "Failed to fetch"). These are recoverable and
        // distinct from a programming error — surface as a warning
        // message, not a captured exception with a stack. The synthetic
        // stack here would otherwise group every offline user under a
        // single misleading issue.
        //
        // In dev mode, network failures against localhost are expected
        // (backend not running) — skip Sentry to avoid flooding the
        // dashboard with dev noise (#571).
        if (!__DEV__ && !isTestBuild) {
          Sentry.captureMessage(`API ${apiTag} network failure: ${method} ${path}`, {
            level: "warning",
            tags: { api: apiTag, errorType: "network" },
            extra: { url, platform: Platform.OS, originalMessage: e.message },
          });
        }
        throw e;
      }
      // Anything else is a genuine JS error from the request-building
      // code (e.g. session-id read failure, unexpected throw inside a
      // mocked fetch). Capture with stack — this is exactly the case
      // where a stacktrace in Sentry is useful.
      Sentry.captureException(e, {
        extra: { url, platform: Platform.OS, method },
        tags: { api: apiTag, errorType: "unexpected" },
      });
      throw e;
    }
  };
}

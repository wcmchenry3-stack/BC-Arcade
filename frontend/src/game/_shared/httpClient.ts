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
import { CodedError } from "expo-modules-core";
import { Platform } from "react-native";
import { getOrCreateSessionId } from "./session";

/** Error subclass that preserves the HTTP status code from the API response. */
export class ApiError extends Error {
  readonly status: number;
  /**
   * The parsed JSON error body, when there was one (#2541). `message` stays
   * the bare `detail` code that call sites compare against; this carries any
   * structured fields alongside it, e.g. Daily Word's 403 `guesses_used`.
   */
  readonly body?: Readonly<Record<string, unknown>>;
  constructor(message: string, status: number, body?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * True for network-layer failures — recoverable connectivity problems
 * (offline, DNS, CORS), not bugs in our request-building code:
 *
 * - Web: `fetch` throws `TypeError` ("Failed to fetch").
 * - iOS / Android: Expo's native `fetch` catches the native module's
 *   `CodedError` and rethrows it as `FetchError extends Error` with the
 *   message `fetch failed: <native message>` (expo/src/winter/fetch) — so
 *   what reaches us is neither a `TypeError` nor a `CodedError` (#2428; the
 *   #2380 fix matched `CodedError` and never fired on a device). Matched by
 *   message prefix rather than class: `FetchError` is not part of Expo's
 *   public API, and a deep import of it would break on an SDK reshuffle.
 * - A bare `CodedError` stays matched in case a native failure ever escapes
 *   unwrapped. That arm is only safe because `fetch` is the sole Expo native
 *   module called inside `request`'s try block (session IDs come from
 *   AsyncStorage, which doesn't throw `CodedError`). Revisit if another Expo
 *   module call is ever added there.
 *
 * `FetchError` also covers aborts ("fetch failed: The operation was
 * aborted."). Nothing passes an `AbortSignal` today; exclude that message
 * here if a caller ever needs aborts kept distinct.
 */
export function isNetworkError(e: unknown): e is Error {
  return (
    e instanceof TypeError ||
    e instanceof CodedError ||
    (e instanceof Error && e.message.startsWith("fetch failed"))
  );
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
      if (isTestBuild) {
        // Expected in E2E test environments — localhost backend is intentional.
        // Sentry reporting suppressed; console.warn is enough for local debugging.
        console.warn("[httpClient] localhost API URL in test build:", resolved);
      } else {
        const msg =
          "EXPO_PUBLIC_API_URL resolves to localhost in a non-dev build. " +
          "This means the env var was set to a local address at bundle time. " +
          "Set EXPO_PUBLIC_API_URL to the production API URL on the Render service.";
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

/**
 * Minimum gap between Sentry reports of the same failing endpoint (#2430).
 *
 * Network failures are expected and low-severity, but a retry loop or a flaky
 * connection used to capture one event per attempt — one device sent 270,
 * one web client 1,045. Reporting each endpoint at most once per window keeps
 * the signal ("this endpoint is unreachable from this install") without
 * letting one client burn the quota. Per app session: the state is in memory,
 * so a fresh launch reports again.
 *
 * The count of swallowed failures rides on the *next* report for that
 * endpoint. A streak that ends without the endpoint failing again after the
 * window is never tallied, and neither is one cut short by the app closing —
 * so the count is a floor on how bad it was, not a total.
 */
export const NETWORK_FAILURE_REPORT_INTERVAL_MS = 10 * 60 * 1000;
/** Bound the map: keys are normalised, but paths are still not a closed set. */
export const NETWORK_FAILURE_MAX_TRACKED = 100;

// A path segment that is a record id: all digits, or a UUID (game ids are UUIDs).
const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Throttle key for one failing endpoint: the query string is dropped and id
 * segments collapse to `:id`, so `PATCH /games/<uuid-1>/complete` and
 * `PATCH /games/<uuid-2>/complete` are one endpoint. A raw-path key would give
 * a queue flush of N games N keys, defeating the throttle exactly when many
 * requests fail together. (The reported message keeps the real path, minus its query.)
 */
export function networkFailureKey(apiTag: string, method: string, path: string): string {
  const route = (path.split(/[?#]/, 1)[0] ?? "")
    .split("/")
    .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment))
    .join("/");
  return `${apiTag} ${method} ${route}`;
}

const networkFailureReports = new Map<string, { at: number; suppressed: number }>();

/**
 * Decide whether this failure should reach Sentry. Returns `null` to stay
 * quiet, or — when it should report — how many failures were swallowed since
 * the last report, so the event can say so.
 */
function claimNetworkFailureReport(key: string, now: number): number | null {
  const previous = networkFailureReports.get(key);
  const age = previous ? now - previous.at : Infinity;
  // A clock that moved backwards (age < 0) reports again rather than
  // suppressing until the wall clock catches up.
  if (previous && age >= 0 && age < NETWORK_FAILURE_REPORT_INTERVAL_MS) {
    previous.suppressed += 1;
    return null;
  }
  // Delete + set keeps Map insertion order == report recency, so the first
  // key is always the stalest one to evict.
  networkFailureReports.delete(key);
  if (networkFailureReports.size >= NETWORK_FAILURE_MAX_TRACKED) {
    const oldest = networkFailureReports.keys().next().value;
    if (oldest !== undefined) networkFailureReports.delete(oldest);
  }
  networkFailureReports.set(key, { at: now, suppressed: 0 });
  return previous?.suppressed ?? 0;
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
    // Query strings (tz offset, cursors, …) vary per user and would split one outage into
    // many Sentry issues, so grouped message text uses the route only. `extra.url` and the
    // breadcrumbs keep the full URL.
    const route = path.split(/[?#]/, 1)[0] ?? path;
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
          Sentry.captureMessage(`API ${apiTag} 5xx: ${method} ${route} → ${res.status}`, {
            level: "warning",
            tags: { api: apiTag, errorType: "http5xx", status: String(res.status) },
            extra: { url, detail: msg, platform: Platform.OS },
          });
        }
        const body =
          err !== null && typeof err === "object" && !Array.isArray(err)
            ? (err as Record<string, unknown>)
            : undefined;
        throw new ApiError(msg, res.status, body);
      }
      if (res.status === 204) {
        return undefined as unknown as T;
      }
      return res.json();
    } catch (e) {
      if (e instanceof ApiError) {
        // Already breadcrumbed in the !res.ok branch above. Re-throw so
        // callers can inspect `.status` and decide how to react.
        throw e;
      }
      if (isNetworkError(e)) {
        // Network-layer failures (offline, DNS, CORS, "Failed to fetch" —
        // or Expo's native "fetch failed: …" equivalent, see #2428) are
        // recoverable and distinct from a programming error — surface as
        // a warning message, not a captured exception with a stack. The
        // synthetic stack here would otherwise group every offline user
        // under a single misleading issue.
        //
        // In dev mode, network failures against localhost are expected
        // (backend not running) — skip Sentry to avoid flooding the
        // dashboard with dev noise (#571).
        //
        // Only the first failure per endpoint per window becomes a Sentry
        // event (#2430); every attempt is still recorded by the `api.request`
        // breadcrumb above. `isNetworkError` also matches a bare `TypeError`
        // thrown by request-building code (inherited behaviour), so a
        // repeating bug of that kind is throttled like any network failure.
        if (!__DEV__ && !isTestBuild) {
          const suppressed = claimNetworkFailureReport(
            networkFailureKey(apiTag, method, path),
            Date.now()
          );
          if (suppressed !== null) {
            Sentry.captureMessage(`API ${apiTag} network failure: ${method} ${route}`, {
              level: "warning",
              tags: { api: apiTag, errorType: "network" },
              extra: {
                url,
                platform: Platform.OS,
                originalMessage: e.message,
                suppressedSinceLastReport: suppressed,
              },
            });
          }
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

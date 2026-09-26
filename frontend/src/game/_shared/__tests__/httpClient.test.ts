/**
 * Tests for the shared HTTP client factory.
 *
 * Covers cross-cutting behavior that every game's API client inherits:
 * - BASE_URL derivation from EXPO_PUBLIC_API_URL (with protocol fallback)
 * - Error shaping (detail from body, statusText fallback)
 *
 * Per-game endpoint assertions (correct path / method / body for each
 * call) live in the respective game's api.test.ts.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

describe("httpClient — BASE_URL configuration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function loadClient() {
    const { createGameClient } = require("../httpClient") as typeof import("../httpClient");
    return createGameClient({ apiTag: "test" });
  }

  it("uses EXPO_PUBLIC_API_URL when it is a full https URL", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://dev-games-api.buffingchi.com";
    const request = loadClient();
    await request("/any/path");
    expect(global.fetch as jest.Mock).toHaveBeenCalledWith(
      "https://dev-games-api.buffingchi.com/any/path",
      expect.any(Object)
    );
  });

  it("prepends https:// when EXPO_PUBLIC_API_URL has no protocol", async () => {
    process.env.EXPO_PUBLIC_API_URL = "dev-games-api.buffingchi.com";
    const request = loadClient();
    await request("/any/path");
    expect(global.fetch as jest.Mock).toHaveBeenCalledWith(
      "https://dev-games-api.buffingchi.com/any/path",
      expect.any(Object)
    );
  });

  it("falls back to http://localhost:8000 when EXPO_PUBLIC_API_URL is not set in dev", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    // jest-expo sets __DEV__ = true by default; assert that explicitly
    // so this test fails loudly if the preset ever changes.
    expect((globalThis as { __DEV__?: boolean }).__DEV__).toBe(true);
    const request = loadClient();
    await request("/any/path");
    expect(global.fetch as jest.Mock).toHaveBeenCalledWith(
      "http://localhost:8000/any/path",
      expect.any(Object)
    );
  });

  it("throws at module load when EXPO_PUBLIC_API_URL is localhost in a non-dev build (#571)", () => {
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:8000";
    const g = globalThis as { __DEV__?: boolean };
    const originalDev = g.__DEV__;
    g.__DEV__ = false;
    try {
      expect(() => loadClient()).toThrow(/resolves to localhost/);

      const Sentry = require("@sentry/react-native");
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining("resolves to localhost"),
        expect.objectContaining({ level: "fatal" })
      );
    } finally {
      g.__DEV__ = originalDev;
    }
  });

  it("does not throw and suppresses Sentry when EXPO_PUBLIC_TEST_HOOKS=1 and localhost URL", () => {
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:8000";
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    const g = globalThis as { __DEV__?: boolean };
    const originalDev = g.__DEV__;
    g.__DEV__ = false;
    try {
      expect(() => loadClient()).not.toThrow();

      const Sentry = require("@sentry/react-native");
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    } finally {
      g.__DEV__ = originalDev;
    }
  });

  it("throws at module load when EXPO_PUBLIC_API_URL is not set in a non-dev build (#511)", () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    const g = globalThis as { __DEV__?: boolean };
    const originalDev = g.__DEV__;
    g.__DEV__ = false;
    try {
      // Module-level throw happens inside createGameClient because BASE_URL
      // is resolved eagerly. Verify both the throw and the Sentry breadcrumb.
      expect(() => loadClient()).toThrow(/EXPO_PUBLIC_API_URL is not set/);

      const Sentry = require("@sentry/react-native");
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining("EXPO_PUBLIC_API_URL is not set"),
        expect.objectContaining({ level: "fatal" })
      );
    } finally {
      g.__DEV__ = originalDev;
    }
  });

  it("does not throw for a dev-* URL in a non-dev build — URL is an infrastructure concern", () => {
    process.env.EXPO_PUBLIC_API_URL = "https://dev-games-api.buffingchi.com";
    const g = globalThis as { __DEV__?: boolean };
    const originalDev = g.__DEV__;
    g.__DEV__ = false;
    try {
      expect(() => loadClient()).not.toThrow();
    } finally {
      g.__DEV__ = originalDev;
    }
  });
});

describe("httpClient — error handling", () => {
  let request: (path: string, options?: RequestInit) => Promise<unknown>;
  const mockFetch = jest.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Sentry: any;

  beforeEach(() => {
    jest.resetModules();
    global.fetch = mockFetch;
    mockFetch.mockReset();

    Sentry = require("@sentry/react-native");
    Sentry.captureException.mockClear();
    Sentry.captureMessage.mockClear();
    Sentry.addBreadcrumb.mockClear();
    const { createGameClient } = require("../httpClient") as typeof import("../httpClient");
    // Default: never sample 5xx, so most tests can ignore the sampling path.
    request = createGameClient({ apiTag: "test", serverErrorSampleRate: 0 });
  });

  it("throws Error with detail when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Bad Request",
      json: () => Promise.resolve({ detail: "Invalid input" }),
    } as Response);
    await expect(request("/x")).rejects.toThrow("Invalid input");
  });

  it("falls back to statusText when error body has no detail", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Internal Server Error",
      json: () => Promise.reject(new Error("parse error")),
    } as Response);
    await expect(request("/x")).rejects.toThrow("Internal Server Error");
  });

  it("throws ApiError with status code on non-ok response", async () => {
    const { ApiError } = require("../httpClient") as typeof import("../httpClient");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: () => Promise.resolve({ detail: "No game in progress" }),
    } as Response);
    try {
      await request("/x");
      fail("expected request to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as InstanceType<typeof ApiError>).status).toBe(404);
      expect((e as Error).message).toBe("No game in progress");
    }
  });

  // #2541 — structured fields beside `detail` reach the caller, while
  // `message` stays the bare code every existing call site compares against.
  it("carries the parsed error body on ApiError", async () => {
    const { ApiError } = require("../httpClient") as typeof import("../httpClient");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: () => Promise.resolve({ detail: "already_solved", guesses_used: 5, solved: true }),
    } as Response);
    try {
      await request("/x");
      fail("expected request to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as InstanceType<typeof ApiError>;
      expect(err.message).toBe("already_solved");
      expect(err.body).toEqual({ detail: "already_solved", guesses_used: 5, solved: true });
    }
  });

  it("leaves ApiError.body as the statusText fallback when the body is not JSON", async () => {
    const { ApiError } = require("../httpClient") as typeof import("../httpClient");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: () => Promise.reject(new Error("parse error")),
    } as Response);
    try {
      await request("/x");
      fail("expected request to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as InstanceType<typeof ApiError>;
      expect(err.message).toBe("Bad Gateway");
      expect(err.body).toEqual({ detail: "Bad Gateway" });
    }
  });

  // #2541 review — `res.json()` resolving to `null` (a proxy or edge error
  // page) used to throw a TypeError reading `.detail`, so callers matching
  // `instanceof ApiError` never saw the status.
  it("throws ApiError, not a TypeError, when the error body is JSON null", async () => {
    const { ApiError } = require("../httpClient") as typeof import("../httpClient");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: () => Promise.resolve(null),
    } as Response);
    try {
      await request("/x");
      fail("expected request to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as InstanceType<typeof ApiError>;
      expect(err.status).toBe(403);
      expect(err.message).toBe("Request failed");
      expect(err.body).toBeUndefined();
    }
  });

  it("throws ApiError with status 500 for server errors", async () => {
    const { ApiError } = require("../httpClient") as typeof import("../httpClient");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.resolve({ detail: "Something broke" }),
    } as Response);
    try {
      await request("/x");
      fail("expected request to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as InstanceType<typeof ApiError>).status).toBe(500);
    }
  });

  it("sends Content-Type and X-Session-ID headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);
    await request("/x");
    const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Session-ID"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("httpClient — Sentry reporting (#513)", () => {
  const mockFetch = jest.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Sentry: any;
  // Fetched fresh via require() after jest.resetModules() below, so this is
  // the *same* module instance httpClient.ts itself sees — a CodedError
  // built from a stale, pre-reset import would fail `instanceof` against
  // httpClient's freshly-required class.
  let CodedError: typeof import("expo-modules-core").CodedError;

  beforeEach(() => {
    jest.resetModules();
    global.fetch = mockFetch;
    mockFetch.mockReset();

    Sentry = require("@sentry/react-native");
    Sentry.captureException.mockClear();
    Sentry.captureMessage.mockClear();
    Sentry.addBreadcrumb.mockClear();
    CodedError = require("expo-modules-core").CodedError;
  });

  function makeRequest(opts: { sampleRate?: number; random?: () => number } = {}) {
    const { createGameClient } = require("../httpClient") as typeof import("../httpClient");
    return createGameClient({
      apiTag: "test",
      serverErrorSampleRate: opts.sampleRate ?? 0,
      random: opts.random,
    });
  }

  it("4xx (429) emits a warning breadcrumb and never calls captureMessage or captureException", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: () => Promise.resolve({ detail: "rate limited" }),
    } as Response);
    const request = makeRequest();
    await expect(request("/cascade/score", { method: "POST" })).rejects.toThrow("rate limited");
    const apiErrorCrumb = Sentry.addBreadcrumb.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) => c[0]?.category === "api.error"
    );
    expect(apiErrorCrumb).toBeDefined();
    expect(apiErrorCrumb[0]).toMatchObject({
      category: "api.error",
      level: "warning",
      data: expect.objectContaining({ status: 429, api: "test" }),
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 404, 409, 422])(
    "%i 4xx never calls captureMessage or captureException",
    async (status) => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        statusText: "Bad",
        json: () => Promise.resolve({ detail: "nope" }),
      } as Response);
      const request = makeRequest();
      await expect(request("/x")).rejects.toThrow();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      expect(Sentry.captureException).not.toHaveBeenCalled();
    }
  );

  it("5xx always emits a breadcrumb but only escalates to captureMessage when sample fires", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.resolve({ detail: "boom" }),
    } as Response);
    // Sample miss: random() = 0.99 ≥ 0.1 → no captureMessage.
    const requestMiss = makeRequest({ sampleRate: 0.1, random: () => 0.99 });
    await expect(requestMiss("/x")).rejects.toThrow();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(
      Sentry.addBreadcrumb.mock.calls.some(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any[]) => c[0]?.category === "api.error"
      )
    ).toBe(true);

    Sentry.addBreadcrumb.mockClear();
    // Sample hit: random() = 0 < 0.1 → captureMessage fires once.
    const requestHit = makeRequest({ sampleRate: 0.1, random: () => 0 });
    await expect(requestHit("/x")).rejects.toThrow();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("5xx"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ errorType: "http5xx", status: "500" }),
      })
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("network failure (TypeError) skips captureMessage in dev mode (#571)", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const request = makeRequest();
    await expect(request("/x")).rejects.toThrow("Failed to fetch");
    expect(Sentry.captureException).not.toHaveBeenCalled();
    // __DEV__ is true in the test environment — network failures are
    // suppressed to avoid flooding Sentry with dev-mode localhost noise.
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("network failure skips captureMessage in test builds (EXPO_PUBLIC_TEST_HOOKS=1)", async () => {
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:8000";
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    const g = globalThis as { __DEV__?: boolean };
    const originalDev = g.__DEV__;
    g.__DEV__ = false;
    try {
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const request = makeRequest();
      await expect(request("/x")).rejects.toThrow("Failed to fetch");
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      expect(Sentry.captureException).not.toHaveBeenCalled();
    } finally {
      g.__DEV__ = originalDev;
      delete process.env.EXPO_PUBLIC_TEST_HOOKS;
      delete process.env.EXPO_PUBLIC_API_URL;
    }
  });

  it("network failure (TypeError) is classified as network, not unexpected, outside dev mode", async () => {
    const g = globalThis as { __DEV__?: boolean };
    const originalDev = g.__DEV__;
    g.__DEV__ = false;
    process.env.EXPO_PUBLIC_API_URL = "https://dev-games-api.buffingchi.com";
    try {
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const request = makeRequest();
      await expect(request("/x")).rejects.toThrow("Failed to fetch");
      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining("network failure"),
        expect.objectContaining({
          level: "warning",
          tags: expect.objectContaining({ errorType: "network" }),
        })
      );
    } finally {
      g.__DEV__ = originalDev;
      delete process.env.EXPO_PUBLIC_API_URL;
    }
  });

  it("keeps the query string out of the reported message text so one outage stays one issue", async () => {
    const g = globalThis as { __DEV__?: boolean };
    const originalDev = g.__DEV__;
    g.__DEV__ = false;
    process.env.EXPO_PUBLIC_API_URL = "https://dev-games-api.buffingchi.com";
    try {
      // Network failure.
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(makeRequest()("/stats/me?tz_offset_minutes=-300")).rejects.toThrow();
      const [netMessage, netOptions] = Sentry.captureMessage.mock.calls[0];
      expect(netMessage).toBe("API test network failure: GET /stats/me");
      expect(netOptions.extra.url).toContain("tz_offset_minutes=-300");

      // 5xx.
      Sentry.captureMessage.mockClear();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        json: () => Promise.resolve({ detail: "down" }),
      } as Response);
      await expect(
        makeRequest({ sampleRate: 1, random: () => 0 })("/stats/me?tz_offset_minutes=330")
      ).rejects.toThrow();
      const [fiveMessage, fiveOptions] = Sentry.captureMessage.mock.calls[0];
      expect(fiveMessage).toBe("API test 5xx: GET /stats/me → 503");
      expect(fiveOptions.extra.url).toContain("tz_offset_minutes=330");
    } finally {
      g.__DEV__ = originalDev;
      delete process.env.EXPO_PUBLIC_API_URL;
    }
  });

  it("Android offline failure surfacing as an Expo CodedError is classified as network, not unexpected (#2380)", async () => {
    // On Android, a DNS/connectivity failure (device offline) doesn't throw
    // a TypeError like web `fetch` does — Expo's native fetch layer wraps it
    // in a CodedError instead, e.g. exactly this shape from the Sentry event
    // that prompted #2380.
    const g = globalThis as { __DEV__?: boolean };
    const originalDev = g.__DEV__;
    g.__DEV__ = false;
    process.env.EXPO_PUBLIC_API_URL = "https://dev-games-api.buffingchi.com";
    try {
      mockFetch.mockRejectedValueOnce(
        new CodedError(
          "ERR_NETWORK",
          'fetch failed: java.net.UnknownHostException: Unable to resolve host "games-api.buffingchi.com"'
        )
      );
      const request = makeRequest();
      await expect(request("/x")).rejects.toBeInstanceOf(CodedError);
      // Must NOT be reported as an unexpected exception — that's the bug
      // this test guards against.
      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining("network failure"),
        expect.objectContaining({
          level: "warning",
          tags: expect.objectContaining({ errorType: "network" }),
        })
      );
    } finally {
      g.__DEV__ = originalDev;
      delete process.env.EXPO_PUBLIC_API_URL;
    }
  });

  it("Android offline CodedError skips captureMessage in dev mode, same as TypeError (#571)", async () => {
    mockFetch.mockRejectedValueOnce(new CodedError("ERR_NETWORK", "fetch failed"));
    const request = makeRequest();
    await expect(request("/x")).rejects.toBeInstanceOf(CodedError);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  describe("network-failure throttle (#2430)", () => {
    let WINDOW: number; // NETWORK_FAILURE_REPORT_INTERVAL_MS
    let MAX_TRACKED: number; // NETWORK_FAILURE_MAX_TRACKED
    let now: number;
    let dateSpy: jest.SpyInstance;
    let originalDev: boolean | undefined;

    beforeEach(() => {
      const throttle = require("../httpClient") as typeof import("../httpClient");
      WINDOW = throttle.NETWORK_FAILURE_REPORT_INTERVAL_MS;
      MAX_TRACKED = throttle.NETWORK_FAILURE_MAX_TRACKED;
      now = 1_700_000_000_000;
      dateSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
      // The report path only runs outside dev and test-hook builds.
      const g = globalThis as { __DEV__?: boolean };
      originalDev = g.__DEV__;
      g.__DEV__ = false;
      process.env.EXPO_PUBLIC_API_URL = "https://dev-games-api.buffingchi.com";
    });

    afterEach(() => {
      dateSpy.mockRestore();
      (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
      delete process.env.EXPO_PUBLIC_API_URL;
    });

    async function fail(request: ReturnType<typeof makeRequest>, path: string, method = "GET") {
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await expect(request(path, { method })).rejects.toThrow("Failed to fetch");
    }

    it("repeated failures of one endpoint inside the window produce one event", async () => {
      const request = makeRequest();
      for (let i = 0; i < 5; i++) {
        await fail(request, "/entitlements");
        now += 1_000;
      }
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      // The trail is not throttled: every attempt still leaves its api.request breadcrumb.
      const attempts = Sentry.addBreadcrumb.mock.calls.filter(
        ([b]: [{ category: string }]) => b.category === "api.request"
      );
      expect(attempts).toHaveLength(5);
    });

    it("a different endpoint, or the same path with another method, still reports", async () => {
      const request = makeRequest();
      await fail(request, "/entitlements");
      await fail(request, "/starswarm/leaderboard");
      await fail(request, "/entitlements", "POST");
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(3);
    });

    it("failures for different record ids of one endpoint share a key (a queue flush is one event)", async () => {
      const request = makeRequest();
      const uuid = (n: number) => `0b8f1c2e-4d5a-4e6f-8a9b-${String(n).padStart(12, "0")}`;
      for (let i = 0; i < 25; i++) {
        await fail(request, `/games/${uuid(i)}/complete`, "PATCH");
      }
      for (let i = 0; i < 25; i++) {
        await fail(request, `/games/${i}/events`, "POST"); // numeric ids too
      }
      // one event per endpoint shape — not one per id
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
      expect(Sentry.captureMessage.mock.calls[0][1].extra.suppressedSinceLastReport).toBe(0);
    });

    it("query strings do not create new keys", async () => {
      const request = makeRequest();
      await fail(request, "/games/me?limit=20&offset=0");
      await fail(request, "/games/me?limit=20&offset=20");
      await fail(request, "/games/me");
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    });

    it("ids collapse only where a whole segment is an id", async () => {
      const request = makeRequest();
      await fail(request, "/games/me");
      await fail(request, "/games/catalog");
      await fail(request, "/daily-word/today");
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(3);
    });

    it("reports again once the window has passed, saying how many were swallowed", async () => {
      const request = makeRequest();
      await fail(request, "/entitlements");
      await fail(request, "/entitlements");
      await fail(request, "/entitlements");
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage.mock.calls[0][1].extra.suppressedSinceLastReport).toBe(0);

      now += WINDOW; // exactly at the boundary counts as passed
      await fail(request, "/entitlements");
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
      expect(Sentry.captureMessage.mock.calls[1][1].extra.suppressedSinceLastReport).toBe(2);

      // and the count starts over for the next window
      now += WINDOW;
      await fail(request, "/entitlements");
      expect(Sentry.captureMessage.mock.calls[2][1].extra.suppressedSinceLastReport).toBe(0);
    });

    it("stays quiet one millisecond before the window closes", async () => {
      const request = makeRequest();
      await fail(request, "/entitlements");
      now += WINDOW - 1;
      await fail(request, "/entitlements");
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    });

    it("a clock that moves backwards reports again instead of muting the endpoint", async () => {
      const request = makeRequest();
      await fail(request, "/entitlements");
      now -= 60 * 60 * 1000;
      await fail(request, "/entitlements");
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
    });

    it("throttle state is shared by every client in the session", async () => {
      // Two game clients hitting the same tagged endpoint (e.g. a screen
      // remounting and building a fresh client) must not double-report.
      await fail(makeRequest(), "/entitlements");
      await fail(makeRequest(), "/entitlements");
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    });

    it("remembers a bounded number of endpoints, evicting the stalest", async () => {
      const request = makeRequest();
      await fail(request, "/first");
      for (let i = 0; i < MAX_TRACKED; i++) {
        await fail(request, `/route-${i}`); // ids collapse, so vary a non-id segment
      }
      Sentry.captureMessage.mockClear();
      await fail(request, "/first"); // evicted — reports again despite being inside the window
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      Sentry.captureMessage.mockClear();
      await fail(request, `/route-${MAX_TRACKED - 1}`); // recent — still remembered
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });
  });

  // #2428: what production actually throws. Expo's native `fetch` rethrows
  // every native failure as `FetchError extends Error` ("fetch failed: …") —
  // never the bare CodedError the #2380 cases above use. Built from Expo's own
  // class so an SDK bump that changes the shape fails here, not in Sentry.
  // Messages are the verbatim BC_GAMES-4W (Android) / BC_GAMES-4Y (iOS) titles.
  describe("Expo native FetchError (#2428)", () => {
    const { FetchError } = require("expo/src/winter/fetch/FetchErrors") as {
      FetchError: { createFromError(error: Error): Error };
    };
    const nativeFailures = [
      [
        "Android",
        'java.net.UnknownHostException: Unable to resolve host "games-api.buffingchi.com": No address associated with hostname',
      ],
      ["iOS", "UnexpectedException: A server with the specified hostname could not be found."],
    ];

    it.each(nativeFailures)(
      "%s offline failure is classified as network, not unexpected",
      async (_platform, nativeMessage) => {
        const g = globalThis as { __DEV__?: boolean };
        const originalDev = g.__DEV__;
        g.__DEV__ = false;
        process.env.EXPO_PUBLIC_API_URL = "https://dev-games-api.buffingchi.com";
        try {
          const thrown = FetchError.createFromError(new CodedError("ERR_NETWORK", nativeMessage));
          expect(thrown).not.toBeInstanceOf(CodedError);
          expect(thrown).not.toBeInstanceOf(TypeError);
          mockFetch.mockRejectedValueOnce(thrown);
          const request = makeRequest();
          await expect(request("/entitlements")).rejects.toBe(thrown);
          expect(Sentry.captureException).not.toHaveBeenCalled();
          expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
          expect(Sentry.captureMessage).toHaveBeenCalledWith(
            expect.stringContaining("network failure"),
            expect.objectContaining({
              level: "warning",
              tags: expect.objectContaining({ errorType: "network" }),
              extra: expect.objectContaining({ originalMessage: `fetch failed: ${nativeMessage}` }),
            })
          );
        } finally {
          g.__DEV__ = originalDev;
          delete process.env.EXPO_PUBLIC_API_URL;
        }
      }
    );

    it("skips captureMessage in dev mode, same as TypeError (#571)", async () => {
      mockFetch.mockRejectedValueOnce(FetchError.createFromError(new Error("offline")));
      const request = makeRequest();
      await expect(request("/x")).rejects.toThrow("fetch failed: offline");
      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("isNetworkError matches the fetch-failed shape and nothing broader", () => {
      const { isNetworkError } = require("../httpClient") as typeof import("../httpClient");
      expect(isNetworkError(FetchError.createFromError(new Error("offline")))).toBe(true);
      expect(isNetworkError(new Error("fetch failed: offline"))).toBe(true);
      expect(isNetworkError(new Error("boom"))).toBe(false);
      expect(isNetworkError(new Error("the fetch failed"))).toBe(false);
      expect(isNetworkError("fetch failed: not an Error")).toBe(false);
      expect(isNetworkError(null)).toBe(false);
    });
  });

  it("genuine unexpected JS error (non-Api, non-Type) is captured as an exception with stack", async () => {
    // A RangeError from inside fetch is the kind of thing we want loud
    // visibility on — it indicates a bug we wrote, not a network issue.
    mockFetch.mockRejectedValueOnce(new RangeError("oops"));
    const request = makeRequest();
    await expect(request("/x")).rejects.toThrow("oops");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(RangeError),
      expect.objectContaining({
        tags: expect.objectContaining({ errorType: "unexpected" }),
      })
    );
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});

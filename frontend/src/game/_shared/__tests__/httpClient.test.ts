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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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

  beforeEach(() => {
    jest.resetModules();
    global.fetch = mockFetch;
    mockFetch.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Sentry = require("@sentry/react-native");
    Sentry.captureException.mockClear();
    Sentry.captureMessage.mockClear();
    Sentry.addBreadcrumb.mockClear();
  });

  function makeRequest(opts: { sampleRate?: number; random?: () => number } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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

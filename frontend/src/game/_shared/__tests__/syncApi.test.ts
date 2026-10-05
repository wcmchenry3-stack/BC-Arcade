/**
 * Tests for SyncApi, the HTTP edge of the log-sync pipeline (#2957).
 *
 * Covers what the SyncWorker state machine relies on: base-URL resolution
 * (with the localhost guards for non-dev builds), the request headers and
 * body, Retry-After parsing, and the error mapping (a network failure becomes
 * a synthetic status 0; a non-2xx is returned, never thrown).
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import type { SyncApi as SyncApiType } from "../syncApi";

type SyncApiModule = typeof import("../syncApi");

const g = globalThis as { __DEV__?: boolean };

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name] ?? null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("SyncApi", () => {
  const originalEnv = process.env;
  const originalDev = g.__DEV__;
  let sentry: {
    captureMessage: jest.Mock;
    addBreadcrumb: jest.Mock;
  };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    sentry = require("@sentry/react-native");
    sentry.captureMessage.mockClear();
    sentry.addBreadcrumb.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
    g.__DEV__ = originalDev;
    jest.restoreAllMocks();
  });

  function load(): SyncApiModule {
    return require("../syncApi") as SyncApiModule;
  }

  /** A SyncApi on the real base-URL resolver and a fetch stub. */
  function apiWith(fetchImpl: jest.Mock): SyncApiType {
    const { SyncApi } = load();
    return new SyncApi(fetchImpl);
  }

  describe("base URL resolution", () => {
    async function requestedUrl(): Promise<string> {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, {}));
      await apiWith(fetchImpl).request("POST", "/games/events", {});
      return fetchImpl.mock.calls[0]![0] as string;
    }

    it("uses EXPO_PUBLIC_API_URL when it is a full https URL", async () => {
      process.env.EXPO_PUBLIC_API_URL = "https://dev-games-api.buffingchi.com";
      await expect(requestedUrl()).resolves.toBe(
        "https://dev-games-api.buffingchi.com/games/events"
      );
    });

    it("prepends https:// when EXPO_PUBLIC_API_URL has no protocol", async () => {
      process.env.EXPO_PUBLIC_API_URL = "dev-games-api.buffingchi.com";
      await expect(requestedUrl()).resolves.toBe(
        "https://dev-games-api.buffingchi.com/games/events"
      );
    });

    it("falls back to http://localhost:8000 when the variable is unset in dev", async () => {
      delete process.env.EXPO_PUBLIC_API_URL;
      expect(g.__DEV__).toBe(true);
      await expect(requestedUrl()).resolves.toBe("http://localhost:8000/games/events");
    });

    it("reports and throws on a localhost URL in a non-dev build", async () => {
      process.env.EXPO_PUBLIC_API_URL = "http://localhost:8000";
      g.__DEV__ = false;
      const fetchImpl = jest.fn();
      await expect(apiWith(fetchImpl).request("POST", "/x", {})).rejects.toThrow(
        /resolves to localhost/
      );
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining("resolves to localhost"),
        expect.objectContaining({
          level: "fatal",
          tags: { subsystem: "syncApi", issue: "localhost-in-prod" },
        })
      );
    });

    it("treats 127.0.0.1 as localhost in a non-dev build", async () => {
      process.env.EXPO_PUBLIC_API_URL = "http://127.0.0.1:8000";
      g.__DEV__ = false;
      await expect(apiWith(jest.fn()).request("POST", "/x", {})).rejects.toThrow(
        /resolves to localhost/
      );
    });

    it("does not flag a URL it cannot parse as localhost", async () => {
      process.env.EXPO_PUBLIC_API_URL = "http://";
      g.__DEV__ = false;
      await expect(requestedUrl()).resolves.toBe("http:///games/events");
      expect(sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("lets a localhost URL through in a test-hooks build", async () => {
      process.env.EXPO_PUBLIC_API_URL = "http://localhost:8000";
      process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
      g.__DEV__ = false;
      await expect(requestedUrl()).resolves.toBe("http://localhost:8000/games/events");
      expect(sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("does not treat a production host as localhost in a non-dev build", async () => {
      process.env.EXPO_PUBLIC_API_URL = "https://games-api.buffingchi.com";
      g.__DEV__ = false;
      await expect(requestedUrl()).resolves.toBe("https://games-api.buffingchi.com/games/events");
    });

    it("reports and throws when the variable is unset in a non-dev build", async () => {
      delete process.env.EXPO_PUBLIC_API_URL;
      g.__DEV__ = false;
      await expect(apiWith(jest.fn()).request("POST", "/x", {})).rejects.toThrow(
        /EXPO_PUBLIC_API_URL is not set/
      );
      expect(sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining("is not set"),
        expect.objectContaining({
          level: "fatal",
          tags: { subsystem: "syncApi", issue: "missing-env" },
        })
      );
    });

    it("uses an injected resolver instead of the environment", async () => {
      const { SyncApi } = load();
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, {}));
      await new SyncApi(fetchImpl, () => "https://sync.test").request("PATCH", "/a/b", {});
      expect(fetchImpl.mock.calls[0]![0]).toBe("https://sync.test/a/b");
    });
  });

  describe("request construction", () => {
    beforeEach(() => {
      process.env.EXPO_PUBLIC_API_URL = "https://api.test";
    });

    it("sends method, JSON headers with the session id, and the stringified body", async () => {
      const AsyncStorage = require("@react-native-async-storage/async-storage");
      await AsyncStorage.setItem("game_session_id", "session-abc");
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, {}));
      await apiWith(fetchImpl).request("PATCH", "/games/1", { score: 5 });

      expect(fetchImpl).toHaveBeenCalledWith("https://api.test/games/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Session-ID": "session-abc" },
        body: JSON.stringify({ score: 5 }),
      });
    });

    it("falls back to an 'unknown' session id when storage fails", async () => {
      const AsyncStorage = require("@react-native-async-storage/async-storage");
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("storage down"));
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, {}));
      await apiWith(fetchImpl).request("POST", "/games", {});

      const init = fetchImpl.mock.calls[0]![1] as RequestInit;
      expect((init.headers as Record<string, string>)["X-Session-ID"]).toBe("unknown");
    });

    it("uses the global fetch when none is injected", async () => {
      const fetchSpy = jest.fn().mockResolvedValue(jsonResponse(204, null));
      const original = global.fetch;
      global.fetch = fetchSpy as unknown as typeof fetch;
      try {
        const { SyncApi } = load();
        await new SyncApi().request("POST", "/games", { a: 1 });
      } finally {
        global.fetch = original;
      }
      expect(fetchSpy).toHaveBeenCalledWith("https://api.test/games", expect.any(Object));
    });
  });

  describe("response mapping", () => {
    beforeEach(() => {
      process.env.EXPO_PUBLIC_API_URL = "https://api.test";
    });

    it("maps a 2xx response with its parsed body", async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(201, { id: "g1" }));
      await expect(apiWith(fetchImpl).request("POST", "/games", {})).resolves.toEqual({
        status: 201,
        ok: true,
        retryAfterMs: null,
        body: { id: "g1" },
      });
    });

    it("returns a non-2xx response instead of throwing", async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(422, { detail: "bad" }));
      await expect(apiWith(fetchImpl).request("POST", "/games", {})).resolves.toEqual({
        status: 422,
        ok: false,
        retryAfterMs: null,
        body: { detail: "bad" },
      });
    });

    it("keeps the status and a null body when the body is not JSON", async () => {
      const res = {
        ...jsonResponse(502, null),
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      } as unknown as Response;
      const fetchImpl = jest.fn().mockResolvedValue(res);
      await expect(apiWith(fetchImpl).request("POST", "/games", {})).resolves.toEqual({
        status: 502,
        ok: false,
        retryAfterMs: null,
        body: null,
      });
    });

    it("maps a network failure to a synthetic status 0 and leaves a breadcrumb", async () => {
      const fetchImpl = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      await expect(apiWith(fetchImpl).request("POST", "/games", {})).resolves.toEqual({
        status: 0,
        ok: false,
        retryAfterMs: null,
        body: null,
      });
      expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "syncWorker.network",
          level: "warning",
          message: "POST /games → network error: Failed to fetch",
        })
      );
    });

    it("stringifies a non-Error rejection in the breadcrumb", async () => {
      const fetchImpl = jest.fn().mockRejectedValue("offline");
      const res = await apiWith(fetchImpl).request("PATCH", "/games/9", {});
      expect(res.status).toBe(0);
      expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({ message: "PATCH /games/9 → network error: offline" })
      );
    });
  });

  describe("Retry-After parsing", () => {
    beforeEach(() => {
      process.env.EXPO_PUBLIC_API_URL = "https://api.test";
    });

    async function retryAfter(header: string | undefined, now?: number): Promise<number | null> {
      const headers: Record<string, string> = header === undefined ? {} : { "Retry-After": header };
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(429, {}, headers));
      const res = await apiWith(fetchImpl).request("POST", "/games", {}, now);
      return res.retryAfterMs;
    }

    it("is null when the header is absent or empty", async () => {
      await expect(retryAfter(undefined)).resolves.toBeNull();
      await expect(retryAfter("")).resolves.toBeNull();
    });

    it("converts delta-seconds to milliseconds", async () => {
      await expect(retryAfter("30")).resolves.toBe(30_000);
      await expect(retryAfter("0")).resolves.toBe(0);
    });

    it("clamps a negative delta to zero", async () => {
      await expect(retryAfter("-5")).resolves.toBe(0);
    });

    it("converts an HTTP date to the wait from `now`", async () => {
      const now = Date.parse("2026-01-01T00:00:00Z");
      await expect(retryAfter("Thu, 01 Jan 2026 00:00:45 GMT", now)).resolves.toBe(45_000);
    });

    it("clamps an HTTP date in the past to zero", async () => {
      const now = Date.parse("2026-01-01T00:10:00Z");
      await expect(retryAfter("Thu, 01 Jan 2026 00:00:45 GMT", now)).resolves.toBe(0);
    });

    it("is null for an unparseable value", async () => {
      await expect(retryAfter("soon")).resolves.toBeNull();
    });
  });
});

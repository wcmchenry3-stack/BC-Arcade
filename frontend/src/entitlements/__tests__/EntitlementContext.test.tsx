/**
 * Tests for EntitlementContext.
 *
 * parseRawToken decodes the JWT payload without signature verification —
 * the server is the authoritative enforcer; the client only reads claims for
 * local UX decisions (lock icons, offline grace). All paths are exercised here
 * using real base64url-encoded token strings produced by makeToken().
 */

import React from "react";
import { AppState, AppStateStatus } from "react-native";
import { render, act } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockRequest = jest.fn();
jest.mock("../../game/_shared/httpClient", () => ({
  createGameClient: jest.fn(
    () =>
      (...args: unknown[]) =>
        mockRequest(...(args as Parameters<typeof mockRequest>))
  ),
}));

const mockClearHearts = jest.fn().mockResolvedValue(undefined);
const mockClearYacht = jest.fn().mockResolvedValue(undefined);
const mockClearSudoku = jest.fn().mockResolvedValue(undefined);
jest.mock("../../game/hearts/storage", () => ({ clearGame: () => mockClearHearts() }));
jest.mock("../../game/yacht/storage", () => ({ clearGame: () => mockClearYacht() }));
jest.mock("../../game/sudoku/storage", () => ({ clearGame: () => mockClearSudoku() }));
// cascade/storage was removed in v2 teardown (#1747); EntitlementContext uses an inline no-op.

const mockDropByGameType = jest.fn().mockResolvedValue(undefined);
jest.mock("../../game/_shared/scoreQueue", () => ({
  scoreQueue: { dropByGameType: (...args: unknown[]) => mockDropByGameType(...args) },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import {
  EntitlementProvider,
  useEntitlements,
  parseRawToken,
  PREMIUM_GAMES,
  OFFLINE_GRACE_MS,
  TOKEN_STORAGE_KEY,
  CACHED_AT_STORAGE_KEY,
} from "../EntitlementContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayload(
  entitled: string[],
  expOffsetMs = 3_600_000
): { sub: string; entitled_games: string[]; iat: number; exp: number } {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: "test-session",
    entitled_games: entitled,
    iat: now,
    exp: now + Math.floor(expOffsetMs / 1000),
  };
}

function makeToken(payload: object): string {
  const toBase64Url = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return `${toBase64Url({ alg: "RS256", typ: "JWT" })}.${toBase64Url(payload)}.fakesig`;
}

function getAppStateListener(): (s: AppStateStatus) => void {
  const mock = AppState.addEventListener as jest.Mock;
  const call = mock.mock.calls.find((c: unknown[]) => c[0] === "change");
  if (!call) throw new Error("AppState.addEventListener('change') not called");
  return call[1] as (s: AppStateStatus) => void;
}

let ctx: ReturnType<typeof useEntitlements>;
function Probe() {
  ctx = useEntitlements();
  return null;
}

const flushAsync = () =>
  act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

async function renderProvider() {
  render(
    <EntitlementProvider>
      <Probe />
    </EntitlementProvider>
  );
  await flushAsync();
  await flushAsync();
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockRequest.mockResolvedValue({
    token: makeToken(makePayload([])),
    expires_at: "2099-01-01T00:00:00Z",
  });
  mockClearHearts.mockResolvedValue(undefined);
  mockClearYacht.mockResolvedValue(undefined);
  mockClearSudoku.mockResolvedValue(undefined);
  mockDropByGameType.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Component / integration tests
// ---------------------------------------------------------------------------

describe("EntitlementProvider", () => {
  describe("canPlay — free vs premium", () => {
    it("returns false for a premium game when session has no entitlements", async () => {
      await renderProvider();
      expect(ctx.canPlay("cascade")).toBe(false);
    });

    it("returns true for free games regardless of entitlement state", async () => {
      await renderProvider();
      for (const slug of ["blackjack", "twenty48", "solitaire", "mahjong", "freecell"]) {
        expect(ctx.canPlay(slug)).toBe(true);
      }
    });

    it("returns true for each entitled premium game", async () => {
      mockRequest.mockResolvedValue({
        token: makeToken(makePayload(["cascade", "hearts"])),
        expires_at: "2099-01-01T00:00:00Z",
      });
      await renderProvider();
      expect(ctx.canPlay("cascade")).toBe(true);
      expect(ctx.canPlay("hearts")).toBe(true);
      expect(ctx.canPlay("sudoku")).toBe(false);
    });

    it("covers exactly the premium game slugs", () => {
      expect(PREMIUM_GAMES).toEqual(
        new Set(["yacht", "cascade", "hearts", "sudoku", "starswarm", "sort"])
      );
    });
  });

  describe("loading state", () => {
    it("resolves isLoading to false after initialization", async () => {
      await renderProvider();
      expect(ctx.isLoading).toBe(false);
    });

    it("sets lastRefreshed after a successful fetch", async () => {
      const before = new Date();
      await renderProvider();
      expect(ctx.lastRefreshed).not.toBeNull();
      expect(ctx.lastRefreshed!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe("token verification failure", () => {
    it("denies all premium games when token cannot be decoded", async () => {
      mockRequest.mockResolvedValue({
        token: "x.not-valid-base64-json.y",
        expires_at: "2099-01-01T00:00:00Z",
      });
      await renderProvider();
      for (const slug of PREMIUM_GAMES) {
        expect(ctx.canPlay(slug)).toBe(false);
      }
    });
  });

  describe("expired token + online", () => {
    it("re-fetches silently on app load and reflects fresh entitlements", async () => {
      mockRequest.mockResolvedValue({
        token: makeToken(makePayload(["cascade"])),
        expires_at: "2099-01-01T00:00:00Z",
      });
      await renderProvider();
      expect(ctx.canPlay("cascade")).toBe(true);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it("re-fetches on foreground transition", async () => {
      await renderProvider();
      const listener = getAppStateListener();
      mockRequest.mockClear();
      mockRequest.mockResolvedValue({
        token: makeToken(makePayload(["sudoku"])),
        expires_at: "2099-01-01T00:00:00Z",
      });

      await act(async () => {
        listener("active");
        await new Promise<void>((resolve) => setImmediate(resolve));
      });

      expect(ctx.canPlay("sudoku")).toBe(true);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe("offline grace period", () => {
    async function seedExpiredCache(entitled: string[], cachedAgoMs: number) {
      const expiredPayload = makePayload(entitled, -3_600_000);
      await AsyncStorage.setItem(TOKEN_STORAGE_KEY, makeToken(expiredPayload));
      await AsyncStorage.setItem(
        CACHED_AT_STORAGE_KEY,
        new Date(Date.now() - cachedAgoMs).toISOString()
      );
      mockRequest.mockRejectedValue(new TypeError("Network request failed"));
    }

    it("grants cached entitlements when offline within 7 days of last fetch", async () => {
      await seedExpiredCache(["cascade"], OFFLINE_GRACE_MS / 2);
      await renderProvider();
      expect(ctx.canPlay("cascade")).toBe(true);
    });

    it("denies premium games when offline beyond 7-day grace period", async () => {
      await seedExpiredCache(["cascade"], OFFLINE_GRACE_MS + 24 * 60 * 60 * 1000);
      await renderProvider();
      expect(ctx.canPlay("cascade")).toBe(false);
    });

    it("denies premium and allows free when no cache and fetch fails", async () => {
      mockRequest.mockRejectedValue(new TypeError("Network request failed"));
      await renderProvider();
      expect(ctx.canPlay("cascade")).toBe(false);
      expect(ctx.canPlay("blackjack")).toBe(true);
    });
  });

  describe("cache persistence", () => {
    it("writes token and cachedAt to AsyncStorage on successful fetch", async () => {
      await renderProvider();
      expect(await AsyncStorage.getItem(TOKEN_STORAGE_KEY)).not.toBeNull();
      expect(await AsyncStorage.getItem(CACHED_AT_STORAGE_KEY)).not.toBeNull();
    });

    it("loads from valid cached token when offline", async () => {
      const cachedPayload = makePayload(["starswarm"]);
      await AsyncStorage.setItem(TOKEN_STORAGE_KEY, makeToken(cachedPayload));
      await AsyncStorage.setItem(CACHED_AT_STORAGE_KEY, new Date().toISOString());
      mockRequest.mockRejectedValue(new TypeError("Network request failed"));

      await renderProvider();

      expect(ctx.canPlay("starswarm")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Dev-override cache persistence (regression: Sentry GAMESAPI-4D9816B4)
  //
  // When ENTITLEMENT_DEV_OVERRIDE was active in Render, the backend issued JWTs
  // listing all premium games. Devices cached those tokens. After the override was
  // removed, network failures prevented fetching a corrected token, so the stale
  // all-games cache remained in effect for up to 7 days.
  // ---------------------------------------------------------------------------

  describe("dev-override cache persistence (Sentry GAMESAPI-4D9816B4)", () => {
    const ALL_PREMIUM = ["yacht", "cascade", "hearts", "sudoku", "starswarm", "sort"];

    it("all-games token from dev-override period still grants access on cold-launch network failure within grace period", async () => {
      // Simulate a device that cached an all-games token while ENTITLEMENT_DEV_OVERRIDE was active
      await AsyncStorage.setItem(TOKEN_STORAGE_KEY, makeToken(makePayload(ALL_PREMIUM)));
      await AsyncStorage.setItem(CACHED_AT_STORAGE_KEY, new Date().toISOString());
      mockRequest.mockRejectedValue(new TypeError("Network request failed"));

      await renderProvider();

      // The cached token is still within its 7-day grace period, so all premium games unlock.
      // This is the expected (by-design) offline grace behavior — any change to deny access
      // here would break legitimate offline users. The fix is to ensure the server can be
      // reached so the stale token is replaced.
      for (const slug of ALL_PREMIUM) {
        expect(ctx.canPlay(slug)).toBe(true);
      }
    });

    it("foreground refresh network failure preserves fresh in-memory state and does not regress to stale cache", async () => {
      // Seed an all-games cache (simulates what a dev-override period left behind)
      await AsyncStorage.setItem(TOKEN_STORAGE_KEY, makeToken(makePayload(ALL_PREMIUM)));
      await AsyncStorage.setItem(CACHED_AT_STORAGE_KEY, new Date().toISOString());

      // First init succeeds with a clean no-entitlements token (override now off on server)
      mockRequest.mockResolvedValueOnce({
        token: makeToken(makePayload([])),
        expires_at: "2099-01-01T00:00:00Z",
      });

      await renderProvider();
      expect(ctx.canPlay("cascade")).toBe(false);

      // Foreground refresh fails at the network level
      mockRequest.mockRejectedValue(new TypeError("Network request failed"));
      const listener = getAppStateListener();
      await act(async () => {
        listener("active");
        await new Promise<void>((resolve) => setImmediate(resolve));
      });

      // refresh() preserves the last successful in-memory state; it does NOT re-load from cache
      expect(ctx.canPlay("cascade")).toBe(false);
    });

    it("all-games dev-override cache is denied once the 7-day grace period expires", async () => {
      const expiredPayload = makePayload(ALL_PREMIUM, -3_600_000); // token itself expired
      await AsyncStorage.setItem(TOKEN_STORAGE_KEY, makeToken(expiredPayload));
      await AsyncStorage.setItem(
        CACHED_AT_STORAGE_KEY,
        new Date(Date.now() - (OFFLINE_GRACE_MS + 24 * 60 * 60 * 1000)).toISOString()
      );
      mockRequest.mockRejectedValue(new TypeError("Network request failed"));

      await renderProvider();

      for (const slug of ALL_PREMIUM) {
        expect(ctx.canPlay(slug)).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests for parseRawToken
// ---------------------------------------------------------------------------

describe("parseRawToken", () => {
  it("returns valid+unexpired for a token with a future exp", async () => {
    const result = await parseRawToken(makeToken(makePayload(["cascade"])));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.expired).toBe(false);
  });

  it("returns valid+expired for a token with a past exp", async () => {
    const result = await parseRawToken(makeToken(makePayload(["cascade"], -3_600_000)));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.expired).toBe(true);
  });

  it("returns invalid when token payload cannot be decoded", async () => {
    const result = await parseRawToken("x.not-valid-json.y");
    expect(result.valid).toBe(false);
  });

  it("returns invalid for a token with wrong number of segments", async () => {
    const result = await parseRawToken("only.two");
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Revocation flow tests
// ---------------------------------------------------------------------------

describe("revocation flow", () => {
  async function renderAndGetListener() {
    render(
      <EntitlementProvider>
        <Probe />
      </EntitlementProvider>
    );
    await flushAsync();
    await flushAsync();
    return getAppStateListener();
  }

  async function triggerForegroundWith(entitled: string[]) {
    const listener = await renderAndGetListener();
    mockRequest.mockResolvedValue({
      token: makeToken(makePayload(entitled)),
      expires_at: "2099-01-01T00:00:00Z",
    });
    await act(async () => {
      listener("active");
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    await flushAsync();
  }

  it("clears storage for a revoked game on foreground refresh", async () => {
    mockRequest.mockResolvedValue({
      token: makeToken(makePayload(["hearts"])),
      expires_at: "2099-01-01T00:00:00Z",
    });
    await triggerForegroundWith([]);
    expect(mockClearHearts).toHaveBeenCalledTimes(1);
  });

  it("drops queue entries for the revoked game", async () => {
    mockRequest.mockResolvedValue({
      token: makeToken(makePayload(["sudoku"])),
      expires_at: "2099-01-01T00:00:00Z",
    });
    await triggerForegroundWith([]);
    expect(mockDropByGameType).toHaveBeenCalledWith("sudoku");
  });

  it("does not clear storage when entitlements are unchanged", async () => {
    mockRequest.mockResolvedValue({
      token: makeToken(makePayload(["cascade"])),
      expires_at: "2099-01-01T00:00:00Z",
    });
    await triggerForegroundWith(["cascade"]);
    expect(mockDropByGameType).not.toHaveBeenCalledWith("cascade");
  });

  it("does not clear storage on first load (no prior entitlements)", async () => {
    mockRequest.mockResolvedValue({
      token: makeToken(makePayload(["hearts", "yacht"])),
      expires_at: "2099-01-01T00:00:00Z",
    });
    render(
      <EntitlementProvider>
        <Probe />
      </EntitlementProvider>
    );
    await flushAsync();
    await flushAsync();
    expect(mockClearHearts).not.toHaveBeenCalled();
    expect(mockClearYacht).not.toHaveBeenCalled();
  });

  it("handles starswarm revocation gracefully (no storage clearer)", async () => {
    mockRequest.mockResolvedValue({
      token: makeToken(makePayload(["starswarm"])),
      expires_at: "2099-01-01T00:00:00Z",
    });
    await expect(triggerForegroundWith([])).resolves.toBeUndefined();
    expect(mockDropByGameType).toHaveBeenCalledWith("starswarm");
  });

  it("does not affect free games when premium revocation occurs", async () => {
    mockRequest.mockResolvedValue({
      token: makeToken(makePayload(["hearts"])),
      expires_at: "2099-01-01T00:00:00Z",
    });
    await triggerForegroundWith([]);
    expect(mockDropByGameType).not.toHaveBeenCalledWith("blackjack");
    expect(mockDropByGameType).not.toHaveBeenCalledWith("twenty48");
  });
});

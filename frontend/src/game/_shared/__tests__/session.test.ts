import AsyncStorage from "@react-native-async-storage/async-storage";

import { CACHED_AT_STORAGE_KEY, TOKEN_STORAGE_KEY } from "../../../entitlements/EntitlementContext";
import { legacyFallbackUuid, resetLegacyFallbackSeq } from "../../../test-utils/legacyFallbackUuid";
import { STATUS_KEY, UPCOMING_KEY } from "../../daily_challenge/offlineCache";
import { eventStore } from "../eventStore";
import { gameEventClient } from "../gameEventClient";
import { LAST_CONNECTED_KEY } from "../lastConnected";
import { LAST_KNOWN_STREAK_KEY } from "../lastKnownStreak";
import { LEGACY_SCORE_QUEUE_KEY } from "../legacyScoreQueue";
import { getOrCreateSessionId } from "../session";
import { DAILY_CHALLENGE_CACHE_KEYS, ENTITLEMENT_CACHE_KEYS } from "../sessionRekey";
import { CsprngUnavailableError, isLegacyFallbackId } from "../uuid";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("getOrCreateSessionId", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("returns a valid v4 UUID on first call", async () => {
    const sid = await getOrCreateSessionId();
    expect(sid).toMatch(UUID_RE);
  });

  it("returns the same ID on subsequent calls (persisted)", async () => {
    const first = await getOrCreateSessionId();
    const second = await getOrCreateSessionId();
    expect(second).toBe(first);
  });

  // -------------------------------------------------------------------------
  // generateUUID — crypto fallback (regression for Sentry issue: "Property
  // 'crypto' doesn't exist")
  // -------------------------------------------------------------------------

  describe("generateUUID crypto fallback", () => {
    let savedCrypto: typeof globalThis.crypto | undefined;

    beforeEach(async () => {
      savedCrypto = globalThis.crypto;
      await AsyncStorage.clear();
    });

    afterEach(() => {
      Object.defineProperty(globalThis, "crypto", {
        value: savedCrypto,
        configurable: true,
        writable: true,
      });
    });

    it("uses crypto.getRandomValues when randomUUID is absent", async () => {
      const getRandomValues = jest.fn((buf: Uint8Array) => {
        buf.fill(0xab);
        return buf;
      });
      Object.defineProperty(globalThis, "crypto", {
        value: { getRandomValues },
        configurable: true,
        writable: true,
      });
      const sid = await getOrCreateSessionId();
      expect(sid).toMatch(UUID_RE);
      expect(getRandomValues).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // #3303: the session id is a credential — CSPRNG only, fail closed.
  // -------------------------------------------------------------------------

  describe("CSPRNG only (#3303)", () => {
    let savedCrypto: typeof globalThis.crypto | undefined;
    // The native CoreModule's uuidv4 (jest.setup.ts points it at globalThis.crypto).
    const expoGlobal = (globalThis as unknown as { expo: { uuidv4?: () => unknown } }).expo;
    const origUuidv4 = expoGlobal.uuidv4;

    const removeCrypto = () =>
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
        writable: true,
      });

    beforeEach(async () => {
      savedCrypto = globalThis.crypto;
      await AsyncStorage.clear();
      jest.clearAllMocks();
    });

    afterEach(() => {
      Object.defineProperty(globalThis, "crypto", {
        value: savedCrypto,
        configurable: true,
        writable: true,
      });
      expoGlobal.uuidv4 = origUuidv4;
    });

    it("mints the session id from the native uuidv4 when there is no crypto global (release Hermes)", async () => {
      expoGlobal.uuidv4 = () => "12345678-1234-4123-8123-123456789abc";
      removeCrypto();
      const sid = await getOrCreateSessionId();
      expect(sid).toBe("12345678-1234-4123-8123-123456789abc");
      expect(await AsyncStorage.getItem("game_session_id")).toBe(sid);
    });

    it("throws and stores nothing when no CSPRNG is available", async () => {
      removeCrypto();
      await expect(getOrCreateSessionId()).rejects.toBeInstanceOf(CsprngUnavailableError);
      expect(await AsyncStorage.getItem("game_session_id")).toBeNull();
      // Still nothing on a retry: no predictable id is ever minted.
      await expect(getOrCreateSessionId()).rejects.toBeInstanceOf(CsprngUnavailableError);
      expect(await AsyncStorage.getItem("game_session_id")).toBeNull();
    });

    it("returns an already-stored session id unchanged, even with no CSPRNG (no rotation)", async () => {
      await AsyncStorage.setItem("game_session_id", "legacy-stored-id");
      removeCrypto();
      expect(await getOrCreateSessionId()).toBe("legacy-stored-id");
      expect(await AsyncStorage.getItem("game_session_id")).toBe("legacy-stored-id");
    });

    it("reports a missing CSPRNG to Sentry once per launch", async () => {
      let Sentry!: { captureException: jest.Mock };
      let fresh!: typeof import("../session");
      // A fresh module registry: a new app launch, so the once-per-launch flag is unset.
      jest.isolateModules(() => {
        /* eslint-disable @typescript-eslint/no-require-imports */
        Sentry = require("@sentry/react-native");
        fresh = require("../session");
        /* eslint-enable @typescript-eslint/no-require-imports */
      });
      removeCrypto();
      await expect(fresh.getOrCreateSessionId()).rejects.toThrow();
      await expect(fresh.getOrCreateSessionId()).rejects.toThrow();
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException.mock.calls[0]![0]).toBeInstanceOf(Error);
      expect(Sentry.captureException.mock.calls[0]![1]).toMatchObject({
        tags: { subsystem: "session", op: "mint" },
      });
    });

    it("records which CSPRNG minted the id, never the id itself", async () => {
      const Sentry = jest.requireMock("@sentry/react-native") as {
        addBreadcrumb: jest.Mock;
        captureMessage: jest.Mock;
      };
      const sid = await getOrCreateSessionId();
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "session",
          data: expect.objectContaining({ source: "expo-modules-core" }),
        })
      );
      expect(JSON.stringify(Sentry.addBreadcrumb.mock.calls)).not.toContain(sid);
      // A breadcrumb only: no Sentry event of its own for a normal mint.
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("concurrent first calls share one mint (one id stored)", async () => {
      const ids = await Promise.all([
        getOrCreateSessionId(),
        getOrCreateSessionId(),
        getOrCreateSessionId(),
      ]);
      expect(new Set(ids).size).toBe(1);
      expect(await AsyncStorage.getItem("game_session_id")).toBe(ids[0]);
    });
  });

  // -------------------------------------------------------------------------
  // #3325: an id stored by the old predictable fallback is re-keyed once.
  // -------------------------------------------------------------------------

  describe("legacy session id re-key (#3325)", () => {
    const origPerf = (globalThis as Record<string, unknown>).performance;
    let savedCrypto: typeof globalThis.crypto | undefined;
    let legacyId: string;
    const Sentry = jest.requireMock("@sentry/react-native") as {
      addBreadcrumb: jest.Mock;
      captureException: jest.Mock;
    };

    beforeEach(async () => {
      savedCrypto = globalThis.crypto;
      await AsyncStorage.clear();
      jest.clearAllMocks();
      resetLegacyFallbackSeq();
      Object.defineProperty(globalThis, "performance", {
        value: { now: () => 1234.567 },
        configurable: true,
      });
      legacyId = legacyFallbackUuid();
      Object.defineProperty(globalThis, "performance", { value: origPerf, configurable: true });
      expect(isLegacyFallbackId(legacyId)).toBe(true);
      await AsyncStorage.setItem("game_session_id", legacyId);
    });

    afterEach(() => {
      Object.defineProperty(globalThis, "crypto", {
        value: savedCrypto,
        configurable: true,
        writable: true,
      });
    });

    it("re-keys a stored legacy id once, and the new id persists", async () => {
      const first = await getOrCreateSessionId();
      expect(first).not.toBe(legacyId);
      expect(first).toMatch(UUID_RE);
      expect(isLegacyFallbackId(first)).toBe(false);
      expect(await AsyncStorage.getItem("game_session_id")).toBe(first);
      expect(await getOrCreateSessionId()).toBe(first);

      const rekeys = Sentry.addBreadcrumb.mock.calls.filter(
        ([b]) => (b as { message?: string }).message === "legacy session id re-keyed"
      );
      expect(rekeys).toHaveLength(1);
      // No ids in any breadcrumb.
      const crumbs = JSON.stringify(Sentry.addBreadcrumb.mock.calls);
      expect(crumbs).not.toContain(legacyId);
      expect(crumbs).not.toContain(first);
    });

    it("concurrent calls during a re-key all get the same new id", async () => {
      const ids = await Promise.all([getOrCreateSessionId(), getOrCreateSessionId()]);
      expect(ids[0]).toBe(ids[1]);
      expect(ids[0]).not.toBe(legacyId);
    });

    it("never touches a non-legacy stored id", async () => {
      const random = globalThis.crypto.randomUUID();
      await AsyncStorage.setItem("game_session_id", random);
      await AsyncStorage.setItem("entitlement_token", "kept");
      expect(await getOrCreateSessionId()).toBe(random);
      expect(await AsyncStorage.getItem("game_session_id")).toBe(random);
      expect(await AsyncStorage.getItem("entitlement_token")).toBe("kept");
    });

    it("with no CSPRNG: throws, stores nothing new and never returns the legacy id", async () => {
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      await AsyncStorage.setItem("entitlement_token", "kept");
      await expect(getOrCreateSessionId()).rejects.toBeInstanceOf(CsprngUnavailableError);
      await expect(getOrCreateSessionId()).rejects.toBeInstanceOf(CsprngUnavailableError);
      // Nothing re-keyed or purged: the stored value is the old one, and is never sent.
      expect(await AsyncStorage.getItem("game_session_id")).toBe(legacyId);
      expect(await AsyncStorage.getItem("entitlement_token")).toBe("kept");
    });

    it("drops the old player's queue and caches, and keeps device-level state", async () => {
      await eventStore.enqueueBugLog({
        bug_uuid: "bug-1",
        bug_level: "warn",
        bug_source: "test",
        payload: {},
      });
      expect(await eventStore.peek(10)).toHaveLength(1);
      const seeded: Record<string, string> = {
        [TOKEN_STORAGE_KEY]: "old.jwt.token",
        [CACHED_AT_STORAGE_KEY]: "2026-10-01T00:00:00.000Z",
        [LEGACY_SCORE_QUEUE_KEY]: "[]",
        [LAST_KNOWN_STREAK_KEY]: "3",
        [UPCOMING_KEY]: "{}",
        [STATUS_KEY]: "{}",
        pending_games_v1: "[]",
      };
      for (const [k, v] of Object.entries(seeded)) await AsyncStorage.setItem(k, v);
      await AsyncStorage.setItem("player_display_name", "Brave Otter");
      await AsyncStorage.setItem(LAST_CONNECTED_KEY, "1700000000000");

      await getOrCreateSessionId();

      expect(await eventStore.peek(10)).toHaveLength(0);
      for (const k of Object.keys(seeded)) expect(await AsyncStorage.getItem(k)).toBeNull();
      // Not session data on the device: refreshed from the server / about the device.
      expect(await AsyncStorage.getItem("player_display_name")).toBe("Brave Otter");
      expect(await AsyncStorage.getItem(LAST_CONNECTED_KEY)).toBe("1700000000000");
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it("purges before storing the new id, so a kill mid-way re-keys again next launch", async () => {
      const order: string[] = [];
      const setItem = AsyncStorage.setItem as jest.Mock;
      const removeMany = AsyncStorage.removeMany as jest.Mock;
      removeMany.mockImplementationOnce(async () => {
        order.push("purge");
        expect(await AsyncStorage.getItem("game_session_id")).toBe(legacyId);
      });
      const realSet = setItem.getMockImplementation()!;
      setItem.mockImplementation((k: string, v: string) => {
        if (k === "game_session_id") order.push("store");
        return realSet(k, v);
      });
      try {
        await getOrCreateSessionId();
      } finally {
        setItem.mockImplementation(realSet);
      }
      expect(order).toEqual(["purge", "store"]);
    });

    it.each([
      ["entitlementCache", TOKEN_STORAGE_KEY],
      ["dailyChallengeCache", UPCOMING_KEY],
      ["legacyScoreQueue", LEGACY_SCORE_QUEUE_KEY],
      ["lastKnownStreak", LAST_KNOWN_STREAK_KEY],
    ])(
      "a failed %s purge stores nothing, never returns the legacy id, and retries next call",
      async (step, key) => {
        const removeItem = AsyncStorage.removeItem as jest.Mock;
        const removeMany = AsyncStorage.removeMany as jest.Mock;
        const realRemoveItem = removeItem.getMockImplementation()!;
        const realRemoveMany = removeMany.getMockImplementation()!;
        let failOnce = true;
        const failing = () => {
          if (!failOnce) return false;
          failOnce = false;
          return true;
        };
        removeItem.mockImplementation((k: string) =>
          k === key && failing() ? Promise.reject(new Error("disk full")) : realRemoveItem(k)
        );
        removeMany.mockImplementation((ks: string[]) =>
          ks.includes(key) && failing()
            ? Promise.reject(new Error("disk full"))
            : realRemoveMany(ks)
        );
        await AsyncStorage.setItem(key, "old player's");
        try {
          await expect(getOrCreateSessionId()).rejects.toThrow("disk full");
          expect(await AsyncStorage.getItem("game_session_id")).toBe(legacyId);
          expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
            tags: { subsystem: "session", op: `rekey.${step}` },
          });

          // The next call retries the whole purge, and this time it completes.
          const sid = await getOrCreateSessionId();
          expect(sid).not.toBe(legacyId);
          expect(await AsyncStorage.getItem("game_session_id")).toBe(sid);
          expect(await AsyncStorage.getItem(key)).toBeNull();
        } finally {
          removeItem.mockImplementation(realRemoveItem);
          removeMany.mockImplementation(realRemoveMany);
        }
      }
    );

    it("a failed queue purge stores nothing, never returns the legacy id, and retries next call", async () => {
      const clearAll = jest
        .spyOn(gameEventClient, "clearAll")
        .mockRejectedValueOnce(new Error("disk full"));
      try {
        await expect(getOrCreateSessionId()).rejects.toThrow("disk full");
        expect(await AsyncStorage.getItem("game_session_id")).toBe(legacyId);
        expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
          tags: { subsystem: "session", op: "rekey.queue" },
        });
        expect(
          Sentry.addBreadcrumb.mock.calls.some(
            ([b]) => (b as { message?: string }).message === "legacy session id re-keyed"
          )
        ).toBe(false);

        // The next call retries the whole re-key, and this time it completes.
        const sid = await getOrCreateSessionId();
        expect(sid).not.toBe(legacyId);
        expect(isLegacyFallbackId(sid)).toBe(false);
        expect(await AsyncStorage.getItem("game_session_id")).toBe(sid);
        expect(clearAll).toHaveBeenCalledTimes(2);
      } finally {
        clearAll.mockRestore();
      }
    });

    it("the cleared cache keys are the ones their owners use", () => {
      expect([...ENTITLEMENT_CACHE_KEYS]).toEqual([TOKEN_STORAGE_KEY, CACHED_AT_STORAGE_KEY]);
      expect([...DAILY_CHALLENGE_CACHE_KEYS]).toEqual([UPCOMING_KEY, STATUS_KEY]);
    });
  });
});

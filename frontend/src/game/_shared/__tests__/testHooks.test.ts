/**
 * Tests for #479 — logstore test hooks.
 *
 * Asserts the hook lifecycle: nothing leaks onto `globalThis` unless
 * EXPO_PUBLIC_TEST_HOOKS === "1", hooks are installed + removed by the
 * register/cleanup pair, and the seed hooks actually mutate eventStore.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { registerLogstoreTestHooks, areTestHooksEnabled } from "../testHooks";
import { eventStore } from "../eventStore";
import { pendingGamesStore } from "../pendingGamesStore";
import { Priority, logConfig, resetLogConfig } from "../eventQueueConfig";

type G = Record<string, unknown>;

const HOOK_KEYS = [
  "__gameEventClient_getQueueStats",
  "__gameEventClient_clearAll",
  "__gameEventClient_enqueueEvent",
  "__gameEventClient_reportBug",
  "__gameEventClient_seedEvents",
  "__gameEventClient_seedBugLogs",
  "__gameEventClient_startGame",
  "__gameEventClient_completeGame",
  "__eventStore_sweepTTL",
  "__eventStore_setSyntheticDelay",
  "__syncWorker_flush",
  "__syncWorker_getBackoffUntil",
  "__logConfig_override",
  "__logConfig_reset",
  "__logstoreHooks_ready",
];

function clearHooks() {
  const g = globalThis as unknown as G;
  for (const k of HOOK_KEYS) delete g[k];
}

describe("logstore testHooks", () => {
  const originalEnv = process.env.EXPO_PUBLIC_TEST_HOOKS;

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetLogConfig();
    clearHooks();
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = originalEnv;
    clearHooks();
  });

  describe("gating", () => {
    it("areTestHooksEnabled reflects the env var", () => {
      process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
      expect(areTestHooksEnabled()).toBe(true);
      process.env.EXPO_PUBLIC_TEST_HOOKS = undefined;
      expect(areTestHooksEnabled()).toBe(false);
    });

    it("registerLogstoreTestHooks is a no-op when the env var is unset", () => {
      process.env.EXPO_PUBLIC_TEST_HOOKS = undefined;
      const cleanup = registerLogstoreTestHooks();
      const g = globalThis as unknown as G;
      for (const k of HOOK_KEYS) expect(g[k]).toBeUndefined();
      expect(typeof cleanup).toBe("function");
      cleanup(); // safe to call
    });

    it("installs every hook when the env var is '1' and removes them on cleanup", () => {
      process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
      const cleanup = registerLogstoreTestHooks();
      const g = globalThis as unknown as G;
      for (const k of HOOK_KEYS) {
        expect(g[k]).toBeDefined();
      }
      expect(g.__logstoreHooks_ready).toBe(true);
      cleanup();
      for (const k of HOOK_KEYS) {
        expect(g[k]).toBeUndefined();
      }
    });
  });

  describe("seed hooks", () => {
    let cleanup: () => void;

    beforeEach(() => {
      process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
      cleanup = registerLogstoreTestHooks();
    });

    afterEach(() => cleanup());

    it("seedEvents inserts the requested count at the inferred priority", async () => {
      const g = globalThis as unknown as {
        __gameEventClient_seedEvents: (spec: {
          count: number;
          eventType?: string;
        }) => Promise<void>;
      };
      await g.__gameEventClient_seedEvents({ count: 5, eventType: "move" });
      const stats = await eventStore.stats();
      expect(stats.totalRows).toBe(5);
      expect(stats.byPriority[Priority.GRANULAR]).toBe(5);
    });

    it("seedEvents honors an explicit priority override", async () => {
      const g = globalThis as unknown as {
        __gameEventClient_seedEvents: (spec: {
          count: number;
          priority: Priority;
        }) => Promise<void>;
      };
      await g.__gameEventClient_seedEvents({ count: 3, priority: Priority.LIFECYCLE });
      const stats = await eventStore.stats();
      expect(stats.byPriority[Priority.LIFECYCLE]).toBe(3);
    });

    it("seedEvents respects createdAt for TTL tests", async () => {
      const g = globalThis as unknown as {
        __gameEventClient_seedEvents: (spec: { count: number; createdAt: number }) => Promise<void>;
      };
      const ancient = Date.now() - 365 * 24 * 60 * 60 * 1000;
      await g.__gameEventClient_seedEvents({ count: 2, createdAt: ancient });
      const stats = await eventStore.stats();
      expect(stats.oldestAt).toBeGreaterThanOrEqual(ancient);
      expect(stats.oldestAt).toBeLessThan(ancient + 10);
    });

    it("seedBugLogs inserts bug logs at P0", async () => {
      const g = globalThis as unknown as {
        __gameEventClient_seedBugLogs: (spec: { count: number }) => Promise<void>;
      };
      await g.__gameEventClient_seedBugLogs({ count: 4 });
      const stats = await eventStore.stats();
      expect(stats.byPriority[Priority.BUG_LOG]).toBe(4);
      expect(stats.byLogType.bug_log).toBe(4);
    });

    // #2654: e2e specs expect a hook-started game to sync, so it is started at once.
    it("startGame opens a game already marked started", () => {
      const g = globalThis as unknown as {
        __gameEventClient_startGame: (gameType: string) => string;
      };
      const gameId = g.__gameEventClient_startGame("yacht");
      expect(pendingGamesStore.get(gameId)?.started).toBe(true);
    });

    it("seedEvents + eviction clamps to MAX_ROWS", async () => {
      const g = globalThis as unknown as {
        __gameEventClient_seedEvents: (spec: { count: number }) => Promise<void>;
        __logConfig_override: (p: Partial<typeof logConfig>) => void;
      };
      g.__logConfig_override({ MAX_ROWS: 50 });
      await g.__gameEventClient_seedEvents({ count: 500 });
      const stats = await eventStore.stats();
      expect(stats.totalRows).toBe(50);
    });
  });

  describe("logConfig hooks", () => {
    let cleanup: () => void;

    beforeEach(() => {
      process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
      cleanup = registerLogstoreTestHooks();
    });

    afterEach(() => cleanup());

    it("override mutates logConfig at runtime", () => {
      const g = globalThis as unknown as {
        __logConfig_override: (p: Partial<typeof logConfig>) => void;
      };
      g.__logConfig_override({ MAX_ROWS: 42 });
      expect(logConfig.MAX_ROWS).toBe(42);
    });

    it("reset restores defaults", () => {
      const g = globalThis as unknown as {
        __logConfig_override: (p: Partial<typeof logConfig>) => void;
        __logConfig_reset: () => void;
      };
      g.__logConfig_override({ MAX_ROWS: 42, TTL_MS: 1 });
      g.__logConfig_reset();
      expect(logConfig.MAX_ROWS).toBe(5000);
      expect(logConfig.TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe("syncWorker hook", () => {
    let cleanup: () => void;

    beforeEach(() => {
      process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
      cleanup = registerLogstoreTestHooks();
    });

    afterEach(() => cleanup());

    it("getBackoffUntil returns a number", () => {
      const g = globalThis as unknown as {
        __syncWorker_getBackoffUntil: () => number;
      };
      const v = g.__syncWorker_getBackoffUntil();
      expect(typeof v).toBe("number");
      expect(v).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // generateSeedId — crypto fallback (regression for Sentry issue: "Property
  // 'crypto' doesn't exist")
  // -------------------------------------------------------------------------

  describe("generateSeedId crypto fallback", () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    let cleanup: () => void;
    let savedCrypto: typeof globalThis.crypto | undefined;

    beforeEach(async () => {
      await AsyncStorage.clear();
      resetLogConfig();
      process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
      cleanup = registerLogstoreTestHooks();
      savedCrypto = globalThis.crypto;
    });

    afterEach(() => {
      cleanup();
      Object.defineProperty(globalThis, "crypto", {
        value: savedCrypto,
        configurable: true,
        writable: true,
      });
    });

    it("seedEvents produces UUID-formatted row IDs via getRandomValues", async () => {
      Object.defineProperty(globalThis, "crypto", {
        value: {
          getRandomValues: (buf: Uint8Array) => {
            buf.fill(0xcd);
            return buf;
          },
        },
        configurable: true,
        writable: true,
      });
      const g = globalThis as unknown as {
        __gameEventClient_seedEvents: (spec: { count: number }) => Promise<void>;
      };
      await g.__gameEventClient_seedEvents({ count: 3 });
      const rows = await eventStore.peek(10);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.id).toMatch(UUID_RE);
      }
    });

    it("seedEvents produces UUID-formatted row IDs when crypto is completely absent", async () => {
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const g = globalThis as unknown as {
        __gameEventClient_seedEvents: (spec: { count: number }) => Promise<void>;
      };
      await g.__gameEventClient_seedEvents({ count: 3 });
      const rows = await eventStore.peek(10);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.id).toMatch(UUID_RE);
      }
    });

    it("seedBugLogs produces UUID-formatted row and bug_uuid IDs via getRandomValues", async () => {
      Object.defineProperty(globalThis, "crypto", {
        value: {
          getRandomValues: (buf: Uint8Array) => {
            buf.fill(0xcd);
            return buf;
          },
        },
        configurable: true,
        writable: true,
      });
      const g = globalThis as unknown as {
        __gameEventClient_seedBugLogs: (spec: { count: number }) => Promise<void>;
      };
      await g.__gameEventClient_seedBugLogs({ count: 2 });
      const rows = await eventStore.peek(10);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.id).toMatch(UUID_RE);
        if (row.log_type === "bug_log") {
          expect(row.bug_uuid).toMatch(UUID_RE);
        }
      }
    });

    it("seedBugLogs produces UUID-formatted row and bug_uuid IDs when crypto is completely absent", async () => {
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const g = globalThis as unknown as {
        __gameEventClient_seedBugLogs: (spec: { count: number }) => Promise<void>;
      };
      await g.__gameEventClient_seedBugLogs({ count: 2 });
      const rows = await eventStore.peek(10);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.id).toMatch(UUID_RE);
        if (row.log_type === "bug_log") {
          expect(row.bug_uuid).toMatch(UUID_RE);
        }
      }
    });
  });
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOrCreateSessionId } from "../session";
import { CsprngUnavailableError } from "../uuid";

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
  });
});

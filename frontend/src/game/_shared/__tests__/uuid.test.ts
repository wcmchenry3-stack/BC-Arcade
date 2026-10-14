import { legacyFallbackUuid, resetLegacyFallbackSeq } from "../../../test-utils/legacyFallbackUuid";
import {
  CsprngUnavailableError,
  generateUUID,
  generateUUIDWithSource,
  isLegacyFallbackId,
} from "../uuid";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The native CoreModule's uuidv4 (jest.setup.ts points it at globalThis.crypto).
const expoGlobal = (globalThis as unknown as { expo: { uuidv4?: () => unknown } }).expo;

describe("generateUUID", () => {
  describe("tier 1: crypto.randomUUID", () => {
    it("returns a UUID-shaped string via the native implementation", () => {
      expect(generateUUID()).toMatch(UUID_V4_RE);
    });
  });

  describe("tier 2: crypto.getRandomValues", () => {
    const origCrypto = (global as Record<string, unknown>).crypto;

    afterEach(() => {
      Object.defineProperty(global, "crypto", { value: origCrypto, configurable: true });
    });

    it("falls through to getRandomValues when randomUUID is absent", () => {
      Object.defineProperty(global, "crypto", {
        value: {
          getRandomValues(b: Uint8Array) {
            b.fill(0xab);
            return b;
          },
        },
        configurable: true,
      });
      expect(generateUUID()).toMatch(UUID_V4_RE);
    });
  });

  // #3303: Hermes has no crypto global, so the native expo-modules-core uuidv4
  // is the source on iOS/Android.
  describe("expo-modules-core native source", () => {
    const origCrypto = (global as Record<string, unknown>).crypto;
    const origUuidv4 = expoGlobal.uuidv4;

    afterEach(() => {
      expoGlobal.uuidv4 = origUuidv4;
      Object.defineProperty(global, "crypto", { value: origCrypto, configurable: true });
    });

    it("uses the native uuidv4 even when there is no crypto global (release Hermes)", () => {
      Object.defineProperty(global, "crypto", { value: undefined, configurable: true });
      expoGlobal.uuidv4 = () => "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
      expect(generateUUIDWithSource()).toEqual({
        uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        source: "expo-modules-core",
      });
    });

    it("prefers the native uuidv4 over the crypto global", () => {
      const globalRandomUUID = jest.fn(() => "11111111-1111-4111-8111-111111111111");
      Object.defineProperty(global, "crypto", {
        value: { randomUUID: globalRandomUUID },
        configurable: true,
      });
      expoGlobal.uuidv4 = () => "22222222-2222-4222-8222-222222222222";
      expect(generateUUIDWithSource()).toEqual({
        uuid: "22222222-2222-4222-8222-222222222222",
        source: "expo-modules-core",
      });
      expect(globalRandomUUID).not.toHaveBeenCalled();
    });

    it("ignores a non-UUID value from the native uuidv4 and uses the next CSPRNG", () => {
      expoGlobal.uuidv4 = () => "not-a-uuid";
      const r = generateUUIDWithSource();
      expect(r.source).toBe("crypto.randomUUID");
      expect(r.uuid).toMatch(UUID_V4_RE);
    });

    it("falls back to the crypto global when the native uuidv4 is missing", () => {
      expoGlobal.uuidv4 = undefined;
      expect(generateUUIDWithSource().source).toBe("crypto.randomUUID");
    });
  });

  // #3325: the fingerprint of the removed tier-3 fallback.
  describe("isLegacyFallbackId", () => {
    const origPerf = (global as Record<string, unknown>).performance;

    beforeEach(() => resetLegacyFallbackSeq());

    afterEach(() => {
      Object.defineProperty(global, "performance", { value: origPerf, configurable: true });
      jest.restoreAllMocks();
    });

    const withPerformanceNow = (ms: number) =>
      Object.defineProperty(global, "performance", {
        value: { now: () => ms },
        configurable: true,
      });

    it.each([0.001, 1.5, 1234.567, 60_000.25, 3_600_000, 4_294_967.295, 86_400_000.5])(
      "matches ids from the performance.now branch (uptime %p ms)",
      (ms) => {
        withPerformanceNow(ms);
        for (let i = 0; i < 5; i++) {
          const id = legacyFallbackUuid();
          expect(id).toMatch(UUID_V4_RE);
          expect(isLegacyFallbackId(id)).toBe(true);
        }
      }
    );

    it.each([
      1_600_000_000_000, // 2020
      1_760_000_000_000, // 2025
      1_791_936_000_123, // 2026-10
      4_102_444_800_000, // 2100
    ])("matches ids from the Date.now branch (epoch %p ms)", (epochMs) => {
      Object.defineProperty(global, "performance", { value: undefined, configurable: true });
      jest.spyOn(Date, "now").mockReturnValue(epochMs);
      for (let i = 0; i < 5; i++) {
        const id = legacyFallbackUuid();
        expect(id).toMatch(UUID_V4_RE);
        expect(isLegacyFallbackId(id)).toBe(true);
      }
    });

    it("matches up to the last counter value that keeps group 4 at 8000", () => {
      withPerformanceNow(42);
      let id = "";
      for (let seq = 1; seq <= 16383; seq++) id = legacyFallbackUuid();
      expect(id.split("-")[3]).toBe("8000");
      expect(isLegacyFallbackId(id)).toBe(true);
    });

    it("matches counters past 8000 in group 4: seq 16384 and 2^22 - 1", () => {
      withPerformanceNow(42);
      const byseq = new Map<number, string>();
      for (let seq = 1; seq <= 2 ** 22 - 1; seq++) {
        const id = legacyFallbackUuid();
        if (seq === 16384 || seq === 2 ** 22 - 1) byseq.set(seq, id);
      }
      expect(byseq.get(16384)!.split("-")[3]).toBe("8001");
      expect(byseq.get(2 ** 22 - 1)!.split("-")[3]).toBe("80ff");
      for (const id of byseq.values()) expect(isLegacyFallbackId(id)).toBe(true);
    });

    it("matches an upper-case copy of a legacy id", () => {
      withPerformanceNow(5000);
      expect(isLegacyFallbackId(legacyFallbackUuid().toUpperCase())).toBe(true);
    });

    it("does not match 10,000 random v4 UUIDs from crypto.randomUUID", () => {
      for (let i = 0; i < 10_000; i++) {
        expect(isLegacyFallbackId(globalThis.crypto.randomUUID())).toBe(false);
      }
    });

    it("does not match non-UUID strings", () => {
      expect(isLegacyFallbackId("")).toBe(false);
      expect(isLegacyFallbackId("legacy-stored-id")).toBe(false);
      expect(isLegacyFallbackId("00000000-0000-0000-8000-000000000000")).toBe(false); // not v4
    });
  });

  describe("fail closed: no CSPRNG at all", () => {
    const origCrypto = (global as Record<string, unknown>).crypto;
    const origPerf = (global as Record<string, unknown>).performance;

    beforeEach(() => {
      Object.defineProperty(global, "crypto", { value: undefined, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(global, "crypto", { value: origCrypto, configurable: true });
      Object.defineProperty(global, "performance", { value: origPerf, configurable: true });
    });

    it("throws CsprngUnavailableError instead of a timestamp/counter id", () => {
      expect(() => generateUUID()).toThrow(CsprngUnavailableError);
    });

    it("throws even when performance.now is available (no deterministic fallback)", () => {
      Object.defineProperty(global, "performance", {
        value: { now: () => 1234.5 },
        configurable: true,
      });
      expect(() => generateUUID()).toThrow(CsprngUnavailableError);
    });

    it("throws when every crypto source itself fails", () => {
      Object.defineProperty(global, "crypto", {
        value: {
          randomUUID: () => {
            throw new Error("insecure context");
          },
          getRandomValues: () => {
            throw new Error("quota");
          },
        },
        configurable: true,
      });
      expect(() => generateUUID()).toThrow(CsprngUnavailableError);
    });
  });
});

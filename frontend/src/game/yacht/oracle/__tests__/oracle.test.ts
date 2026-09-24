/**
 * Oracle table codec round-trip (#2243, compact format #2246).
 *
 * Encodes synthetic data with the SAME function scripts/build-yacht-oracle.ts
 * uses and decodes it with the shipped runtime decoder — the actual code path
 * the app runs — without depending on the real generated table (pinnedEV.test.ts
 * covers that).
 */

import { ORACLE_TABLE_SCALE, decodeOracleTable, encodeOracleTable } from "../tableCodec";

const HALF_STEP = 0.5 / ORACLE_TABLE_SCALE;

describe("oracle table codec", () => {
  it("round-trips values to within half a storage step", () => {
    const original = [0, 1, 254.5896, 3.14159, 270.83, 0.004, 655.35];
    const decoded = decodeOracleTable(encodeOracleTable(original), original.length);

    expect(decoded.length).toBe(original.length);
    original.forEach((v, i) => expect(Math.abs(decoded[i]! - v)).toBeLessThanOrEqual(HALF_STEP));
    expect(decoded[0]).toBe(0);
  });

  it("round-trips a TABLE_SIZE-scale array without corruption", () => {
    // Synthetic, same size as the real table: catches large-buffer bugs
    // (base64 chunking, byte-length off-by-ones, inflate output size).
    const size = 786_432;
    const original = new Float32Array(size);
    for (let i = 0; i < size; i++) original[i] = i % 3 === 0 ? 0 : 100 + Math.sin(i) * 100;

    const decoded = decodeOracleTable(encodeOracleTable(original), size);

    expect(decoded.length).toBe(size);
    for (const i of [0, 1, 2, 1000, 393_216, 786_431]) {
      expect(Math.abs(decoded[i]! - original[i]!)).toBeLessThanOrEqual(HALF_STEP);
    }
  });

  it("rejects values outside the Uint16 range", () => {
    expect(() => encodeOracleTable([-1])).toThrow(/out of Uint16 range/);
    expect(() => encodeOracleTable([700])).toThrow(/out of Uint16 range/);
  });

  it("rejects a payload whose length doesn't match", () => {
    const base64 = encodeOracleTable([1, 2, 3]);
    expect(() => decodeOracleTable(base64, 4)).toThrow(/expected 8 bytes, got 6/);
  });
});

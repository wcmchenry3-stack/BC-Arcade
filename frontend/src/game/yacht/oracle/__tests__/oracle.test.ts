/**
 * oracle.ts round-trip test (#2243).
 *
 * Self-contained: encodes synthetic data with the SAME base64 method
 * scripts/build-yacht-oracle.ts uses (Buffer, Node-only, fine for a build
 * script and for this Jest test) and decodes it with the SHIPPED runtime
 * decoder (`decodeFloat32Table`, atob-based — the actual code path the app
 * runs) — verifying the two agree without depending on the real generated
 * table (a separate pinned-EV test covers that, once built).
 */

import { decodeFloat32Table } from "../oracle";

describe("decodeFloat32Table — round-trip against the build script's encoding", () => {
  it("recovers the original values (within Float32 precision) for a sample table", () => {
    const original = new Float32Array([0, 1, -1, 254.5896, 3.14159, 12345.678, 0.001, -9999.5]);
    const base64 = Buffer.from(original.buffer).toString("base64");

    const decoded = decodeFloat32Table(base64, original.length);

    expect(decoded.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i]).toBe(original[i]); // exact — same bytes, same Float32 representation
    }
  });

  it("round-trips a large, TABLE_SIZE-scale array without corruption", () => {
    // Not the real solve (way too slow for a unit test) — a synthetic array
    // of the same size, to catch any bugs specific to large buffers (base64
    // chunking, off-by-one in the byte length, etc.).
    const size = 786_432; // TABLE_SIZE
    const original = new Float32Array(size);
    for (let i = 0; i < size; i++) original[i] = Math.sin(i) * 100;

    const base64 = Buffer.from(original.buffer).toString("base64");
    const decoded = decodeFloat32Table(base64, size);

    expect(decoded.length).toBe(size);
    // Spot-check rather than a full 786K-entry loop (still fast, but keeps
    // the test's own runtime negligible).
    for (const i of [0, 1, 1000, 393216, 786431]) {
      expect(decoded[i]).toBe(original[i]);
    }
  });

  it("length parameter truncates correctly if the buffer has trailing padding", () => {
    const original = new Float32Array([1, 2, 3, 4, 5]);
    const base64 = Buffer.from(original.buffer).toString("base64");
    const decoded = decodeFloat32Table(base64, 3);
    expect(decoded.length).toBe(3);
    expect([...decoded]).toEqual([1, 2, 3]);
  });
});

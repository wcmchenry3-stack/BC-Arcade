/**
 * Compact encoding for the Yacht oracle table (#2246, #2869).
 *
 * The raw table is 786,432 Float32 values (3 MB, 4.2 MB as base64), which
 * alone would push the app's JS bundle past its 8 MB CI limit once the live
 * AI depends on it. Instead each value is stored as a Uint16 in hundredths
 * of a point (the largest value-to-go is ~271, well inside 655.35).
 *
 * Before compression the Uint16 stream is made easier for zlib (#2869):
 *   1. delta: each value minus the previous one (mod 2^16). Neighbouring keys
 *      differ only in the upper-section subtotal (see stateKey.ts), so most
 *      deltas are tiny;
 *   2. zigzag: maps small negative deltas to small unsigned numbers;
 *   3. byte planes: all low bytes, then all high bytes (almost all zero).
 * Then zlib level 9 and base64: ~450 KB compressed, ~0.6 MB as base64,
 * against ~672 KB / ~0.9 MB for the plain little-endian stream. The
 * transform is exact, so the decoded table is bit-identical either way.
 *
 * Precision: values are exact to ±0.005 points, so a decision can only
 * change where two options were already within 0.01 points of each other.
 * The optimal game-start EV moves by < 0.005.
 *
 * Shared by the offline build (scripts/build-yacht-oracle.ts, encode) and
 * the runtime oracle (oracle.ts, decode) so the two can't drift.
 */

import { unzlibSync, zlibSync } from "fflate";
import { base64ToBytes, bytesToBase64 } from "../../_shared/base64Bytes";

/** Stored value = round(VTG × ORACLE_TABLE_SCALE). */
export const ORACLE_TABLE_SCALE = 100;
const MAX_STORED = 0xffff;

/** Encode a value-to-go table (build-time only). */
export function encodeOracleTable(values: ArrayLike<number>): string {
  const n = values.length;
  const planes = new Uint8Array(n * 2);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const stored = Math.round(values[i]! * ORACLE_TABLE_SCALE);
    if (!(stored >= 0 && stored <= MAX_STORED)) {
      throw new Error(`encodeOracleTable: value ${values[i]} at ${i} is out of Uint16 range`);
    }
    // Signed 16-bit delta, then zigzag into 0..0xffff.
    const delta = (((stored - prev) & 0xffff) << 16) >> 16;
    const zig = ((delta << 1) ^ (delta >> 31)) & 0xffff;
    planes[i] = zig & 0xff;
    planes[n + i] = zig >>> 8;
    prev = stored;
  }
  return bytesToBase64(zlibSync(planes, { level: 9 }));
}

/** Decode a table produced by `encodeOracleTable`. */
export function decodeOracleTable(base64: string, length: number): Float32Array {
  const planes = unzlibSync(base64ToBytes(base64));
  if (planes.length !== length * 2) {
    throw new Error(`decodeOracleTable: expected ${length * 2} bytes, got ${planes.length}`);
  }
  const out = new Float32Array(length);
  let prev = 0;
  for (let i = 0; i < length; i++) {
    const zig = planes[i]! | (planes[length + i]! << 8);
    const delta = (zig >>> 1) ^ -(zig & 1);
    prev = (prev + delta) & 0xffff;
    out[i] = prev / ORACLE_TABLE_SCALE;
  }
  return out;
}

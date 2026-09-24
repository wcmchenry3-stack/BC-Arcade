/**
 * Compact encoding for the Yacht oracle table (#2246).
 *
 * The raw table is 786,432 Float32 values (3 MB, 4.2 MB as base64), which
 * alone would push the app's JS bundle past its 8 MB CI limit once the live
 * AI depends on it. Instead each value is stored as a little-endian Uint16
 * in hundredths of a point (the largest value-to-go is ~271, well inside
 * 655.35), and the byte stream is zlib-compressed: ~672 KB, ~0.9 MB as
 * base64. The ~207K unreachable (zero) slots compress to almost nothing.
 *
 * Precision: values are exact to ±0.005 points, so a decision can only
 * change where two options were already within 0.01 points of each other.
 * The optimal game-start EV moves by < 0.005.
 *
 * Shared by the offline build (scripts/build-yacht-oracle.ts, encode) and
 * the runtime oracle (oracle.ts, decode) so the two can't drift.
 */

import { unzlibSync, zlibSync } from "fflate";

/** Stored value = round(VTG × ORACLE_TABLE_SCALE). */
export const ORACLE_TABLE_SCALE = 100;
const MAX_STORED = 0xffff;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encode a value-to-go table (build-time only). */
export function encodeOracleTable(values: ArrayLike<number>): string {
  const raw = new Uint8Array(values.length * 2);
  const view = new DataView(raw.buffer);
  for (let i = 0; i < values.length; i++) {
    const stored = Math.round(values[i]! * ORACLE_TABLE_SCALE);
    if (!(stored >= 0 && stored <= MAX_STORED)) {
      throw new Error(`encodeOracleTable: value ${values[i]} at ${i} is out of Uint16 range`);
    }
    view.setUint16(i * 2, stored, true);
  }
  return toBase64(zlibSync(raw, { level: 9 }));
}

/** Decode a table produced by `encodeOracleTable`. */
export function decodeOracleTable(base64: string, length: number): Float32Array {
  const raw = unzlibSync(fromBase64(base64));
  if (raw.length !== length * 2) {
    throw new Error(`decodeOracleTable: expected ${length * 2} bytes, got ${raw.length}`);
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = view.getUint16(i * 2, true) / ORACLE_TABLE_SCALE;
  return out;
}

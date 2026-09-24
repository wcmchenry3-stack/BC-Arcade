/**
 * Renders oracleTable.generated.ts (build-only, #2243 / #2246). Used by
 * scripts/build-yacht-oracle.ts; the encoding itself lives in
 * oracle/tableCodec.ts so the runtime decoder can't drift from it.
 */

import { ORACLE_TABLE_SCALE, encodeOracleTable } from "../oracle/tableCodec";

export interface TableBuildInfo {
  readonly builtAt: string;
  readonly statesComputed: number;
  readonly buildSeconds: number;
  readonly optimalStartEV: number;
  /** Extra provenance line, e.g. when the table was re-encoded rather than re-solved. */
  readonly note?: string;
}

export function renderTableModule(values: ArrayLike<number>, info: TableBuildInfo): string {
  const base64 = encodeOracleTable(values);
  return `/**
 * GENERATED FILE — do not edit by hand.
 * Produced by scripts/build-yacht-oracle.ts (#2243). Re-run that script to
 * regenerate after any change to stateKey.ts's scoring/transition rules —
 * a rule change here without a regenerate silently stales the oracle.
 *
 * Format (oracle/tableCodec.ts): ORACLE_TABLE_SIZE little-endian Uint16
 * values in 1/${ORACLE_TABLE_SCALE}ths of a point, zlib-compressed, base64-encoded.
 * Index i is VTG(i) — expected additional score ("value to go") for
 * scorecard-state key i. See frontend/src/game/yacht/oracle/stateKey.ts for
 * the key encoding (mask, yachtStatus, upperCapped).
 *
 * Built:            ${info.builtAt}
 * States computed:  ${info.statesComputed}
 * Build time:       ${info.buildSeconds.toFixed(1)}s
 * Optimal EV (game start): ${info.optimalStartEV.toFixed(4)}${info.note ? `\n * ${info.note}` : ""}
 */

export const ORACLE_TABLE_SIZE = ${values.length};
export const ORACLE_TABLE_BASE64 =
  "${base64}";
`;
}

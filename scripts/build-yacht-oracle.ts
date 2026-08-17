/**
 * Offline build for the Yacht optimal-play EV oracle (#2243).
 *
 * Node/tsx only — NEVER run on-device. Computes the full retrograde solve
 * over every reachable scorecard state (~786K dense slots, pruned to the
 * reachable subset) and writes the generated data module the app ships as
 * frontend/src/game/yacht/oracle/oracleTable.generated.ts.
 *
 * Takes tens of minutes on typical dev hardware — this is expected and
 * matches published implementations of the same problem (Verhoeff, Glenn
 * 2006, and others solving the same joker/bonus-score variant).
 *
 * Usage: npx tsx scripts/build-yacht-oracle.ts
 */

import { writeFileSync } from "node:fs";
import { solveOracle } from "../frontend/src/game/yacht/oracleBuild/solver";
import {
  TABLE_SIZE,
  INITIAL_KEY,
} from "../frontend/src/game/yacht/oracle/stateKey";

const OUTPUT_PATH = "frontend/src/game/yacht/oracle/oracleTable.generated.ts";

console.log(`Solving Yacht oracle (${TABLE_SIZE} dense table slots)...`);
const start = Date.now();

const { vtg, stats } = solveOracle((remaining, statesSoFar) => {
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `  remaining=${remaining} statesSoFar=${statesSoFar} elapsedSec=${elapsed}`,
  );
});

console.log(
  `Solve complete: ${stats.statesComputed} states in ${(stats.buildMs / 1000).toFixed(1)}s`,
);

const optimalStartEV = vtg[INITIAL_KEY];
console.log(
  `Optimal EV at game start (nothing scored yet): ${optimalStartEV.toFixed(4)}`,
);
console.log(
  `Published reference (Verhoeff / Glenn 2006, joker+bonus rule): 254.5896`,
);

const float32 = Float32Array.from(vtg);
const base64 = Buffer.from(float32.buffer).toString("base64");

const content = `/**
 * GENERATED FILE — do not edit by hand.
 * Produced by scripts/build-yacht-oracle.ts (#2243). Re-run that script to
 * regenerate after any change to stateKey.ts's scoring/transition rules —
 * a rule change here without a regenerate silently stales the oracle.
 *
 * Format: a Float32Array of ORACLE_TABLE_SIZE entries, base64-encoded.
 * Index i is VTG(i) — expected additional score ("value to go") for
 * scorecard-state key i. See frontend/src/game/yacht/oracle/stateKey.ts for
 * the key encoding (mask, yachtStatus, upperCapped).
 *
 * Built:            ${new Date().toISOString()}
 * States computed:  ${stats.statesComputed}
 * Build time:       ${(stats.buildMs / 1000).toFixed(1)}s
 * Optimal EV (game start): ${optimalStartEV.toFixed(4)}
 */

export const ORACLE_TABLE_SIZE = ${TABLE_SIZE};
export const ORACLE_TABLE_BASE64 =
  "${base64}";
`;

writeFileSync(OUTPUT_PATH, content);

const sizeMB = (content.length / 1024 / 1024).toFixed(2);
console.log(`Wrote ${OUTPUT_PATH} (${sizeMB} MB as source text)`);

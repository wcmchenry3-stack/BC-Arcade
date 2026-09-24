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
import { renderTableModule } from "../frontend/src/game/yacht/oracleBuild/renderTableModule";
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

const content = renderTableModule(vtg, {
  builtAt: new Date().toISOString(),
  statesComputed: stats.statesComputed,
  buildSeconds: stats.buildMs / 1000,
  optimalStartEV,
});

writeFileSync(OUTPUT_PATH, content);

const sizeMB = (content.length / 1024 / 1024).toFixed(2);
console.log(`Wrote ${OUTPUT_PATH} (${sizeMB} MB as source text)`);

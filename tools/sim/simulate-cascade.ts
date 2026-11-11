/**
 * Cascade sim CLI (#2893): a thin wrapper over frontend/src/game/cascade/sim/.
 *
 * Usage (from the repo root, or `npm run sim:cascade -- <flags>` in frontend/):
 *   npx --prefix frontend tsx tools/sim/simulate-cascade.ts                 # smoke suite, prints the table
 *   npx --prefix frontend tsx tools/sim/simulate-cascade.ts --full          # 100 seeds x 3 bots x 60/120 Hz (~3 min)
 *   npx --prefix frontend tsx tools/sim/simulate-cascade.ts --full --gate   # ... and fail on a band / lid / step-budget violation
 *   npx --prefix frontend tsx tools/sim/simulate-cascade.ts --full --update-baseline   # rewrite baseline.json "full"
 *
 * Flags:
 *   --full               the long suite (default: the smoke suite)
 *   --seeds N            override the seed count
 *   --bots a,b           override the bots (heuristic, random, spam)
 *   --gate               compare with baseline.json and exit 1 on a violation
 *   --update-baseline    write this run's deterministic metrics and bands into baseline.json
 *   --md PATH            also write the table as Markdown
 *   --json PATH          also write the raw suite result as JSON
 *
 * Step cost is wall clock: printed, never part of the baseline.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FULL_PARAMS,
  SMOKE_PARAMS,
  checkSuite,
  formatTable,
  makeBaselineSuite,
  runSuite,
  type Baseline,
} from "../../frontend/src/game/cascade/sim/suite";

const BASELINE_PATH = resolve(
  __dirname,
  "../../frontend/src/game/cascade/sim/baseline.json",
);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(name);

function main(): number {
  const suiteName = has("--full") ? "full" : "smoke";
  const params = { ...(suiteName === "full" ? FULL_PARAMS : SMOKE_PARAMS) };
  const seeds = arg("--seeds");
  if (seeds !== undefined) {
    const n = Number(seeds);
    if (!Number.isInteger(n) || n < 1) {
      console.error("--seeds must be a positive integer");
      return 2;
    }
    params.seeds = n;
  }
  const bots = arg("--bots");
  if (bots !== undefined) params.bots = bots.split(",");

  const started = Date.now();
  const result = runSuite(params);
  const table = formatTable(result);
  console.log(
    `Cascade sim (${suiteName}: ${params.seeds} seeds, ${(Date.now() - started) / 1000} s)\n`,
  );
  console.log(table);

  const mdPath = arg("--md");
  if (mdPath)
    writeFileSync(mdPath, `## Cascade sim (${suiteName})\n\n${table}\n`);
  const jsonPath = arg("--json");
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(result, null, 2));

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  if (has("--update-baseline")) {
    baseline.suites[suiteName] = makeBaselineSuite(result);
    // One band per line keeps the file reviewable: { "value": v, "min": a, "max": b }.
    const text = JSON.stringify(baseline, null, 2)
      .replace(
        /\{\s+"value": ([^,\n]+),\s+"min": ([^,\n]+),\s+"max": ([^,\n]+)\s+\}/g,
        '{ "value": $1, "min": $2, "max": $3 }',
      )
      .replace(
        /\[\s+([^[\]{}]*?)\s+\]/g,
        (_m, inner: string) => `[${inner.split(/,\s*/).join(", ")}]`,
      );
    writeFileSync(BASELINE_PATH, text + "\n");
    console.log(`\nWrote ${suiteName} baseline to ${BASELINE_PATH}`);
    return 0;
  }
  if (has("--gate")) {
    const violations = checkSuite(result, baseline.suites[suiteName]);
    if (violations.length > 0) {
      console.error(`\nFAILED: ${violations.length} violation(s)`);
      for (const v of violations) console.error(`  ${v.where}: ${v.message}`);
      return 1;
    }
    console.log("\nGate passed: every metric inside its band.");
  }
  return 0;
}

process.exit(main());

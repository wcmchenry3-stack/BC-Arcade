/**
 * Cascade sim CLI (#2893): a thin wrapper over frontend/src/game/cascade/sim/.
 *
 * Usage (from the repo root, or `npm run sim:cascade -- <flags>` in frontend/):
 *   npx --prefix frontend tsx tools/sim/simulate-cascade.ts                 # smoke suite, prints the table
 *   npx --prefix frontend tsx tools/sim/simulate-cascade.ts --full          # 100 seeds x 3 bots x 60/120 Hz, plus the capstone runs (~10 min)
 *   npx --prefix frontend tsx tools/sim/simulate-cascade.ts --full --gate   # ... and fail on a band / lid / step-budget violation
 *   npx --prefix frontend tsx tools/sim/simulate-cascade.ts --full --update-baseline   # rewrite baseline.json "full"
 *
 * Flags:
 *   --full               the long suite (default: the smoke suite), with the capstone runs
 *                        (#3697: the skilled bot, 60 Hz, up to 10 simulated minutes
 *                        each, stopping at the win)
 *   --seeds N            override the seed count (the capstone runs' too)
 *   --no-capstone        skip the capstone runs (a quicker look; bands are then skipped)
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
import { BOTS } from "../../frontend/src/game/cascade/sim/bots";

const BASELINE_PATH = resolve(
  __dirname,
  "../../frontend/src/game/cascade/sim/baseline.json",
);

const VALUE_FLAGS = ["--seeds", "--bots", "--seed-offset", "--md", "--json"];

class UsageError extends Error {}

/** A flag's value; a flag with no value (or another flag next) is a usage error. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--"))
    throw new UsageError(`${name} needs a value`);
  return v;
}
const has = (name: string): boolean => process.argv.includes(name);

function intArg(name: string, min: number): number | undefined {
  const v = arg(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) {
    throw new UsageError(`${name} must be an integer >= ${min}`);
  }
  return n;
}

function main(): number {
  for (const f of process.argv.slice(2).filter((a) => a.startsWith("--"))) {
    const known = [
      "--full",
      "--gate",
      "--update-baseline",
      "--no-capstone",
      ...VALUE_FLAGS,
    ];
    if (!known.includes(f)) throw new UsageError(`unknown flag ${f}`);
  }
  const suiteName = has("--full") ? "full" : "smoke";
  const params = { ...(suiteName === "full" ? FULL_PARAMS : SMOKE_PARAMS) };
  const seeds = intArg("--seeds", 1);
  if (seeds !== undefined) params.seeds = seeds;
  if (params.capstone) {
    params.capstone = { ...params.capstone };
    if (seeds !== undefined) params.capstone.seeds = seeds;
    if (has("--no-capstone")) delete params.capstone;
  }
  const offset = intArg("--seed-offset", 0);
  if (offset !== undefined) params.seedOffset = offset;
  const bots = arg("--bots");
  if (bots !== undefined) {
    params.bots = bots.split(",");
    const unknown = params.bots.filter((b) => !(b in BOTS));
    if (unknown.length > 0) {
      throw new UsageError(
        `unknown bot ${unknown.join(", ")} (known: ${Object.keys(BOTS).join(", ")})`,
      );
    }
  }
  const custom =
    seeds !== undefined ||
    offset !== undefined ||
    bots !== undefined ||
    has("--no-capstone");
  if (has("--update-baseline") && custom) {
    throw new UsageError(
      "--update-baseline cannot be combined with --seeds, --seed-offset or --bots: it would overwrite the suite with a subset",
    );
  }

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
    // The bands assume the baseline's seed count, bots and time cap; any other run is a quick
    // look: the table prints and only the hard gates (lid, step budget) apply.
    const base = baseline.suites[suiteName];
    const comparable =
      base !== undefined &&
      base.params.seeds === params.seeds &&
      base.params.maxSimMs === params.maxSimMs &&
      base.params.bots.join() === params.bots.join() &&
      JSON.stringify(base.params.capstone ?? null) ===
        JSON.stringify(params.capstone ?? null);
    if (!comparable) {
      console.log(
        "\nNote: seeds/bots differ from the baseline; band checks skipped (hard gates only).",
      );
    }
    const violations = checkSuite(result, comparable ? base : undefined);
    if (violations.length > 0) {
      console.error(`\nFAILED: ${violations.length} violation(s)`);
      for (const v of violations) console.error(`  ${v.where}: ${v.message}`);
      return 1;
    }
    console.log("\nGate passed: every metric inside its band.");
  }
  return 0;
}

try {
  process.exit(main());
} catch (e) {
  if (e instanceof UsageError) {
    console.error(e.message);
    process.exit(2);
  }
  throw e;
}

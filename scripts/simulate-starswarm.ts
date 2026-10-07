/**
 * Star Swarm Buddy balance simulation CLI (#2880).
 *
 * The harness, variants and presets live in frontend/src/game/starswarm/sim/ (balance.ts,
 * engineVariant.ts, presets.ts, report.ts); this script is the command line around them. See
 * docs/games/starswarm.md → "Balance simulation" for the method.
 *
 *   npx --prefix frontend tsx scripts/simulate-starswarm.ts                                  # baseline, 200 seeds/cell
 *   npx --prefix frontend tsx scripts/simulate-starswarm.ts --preset offense --jobs 4        # fan/pierce/damage sweeps
 *   npx --prefix frontend tsx scripts/simulate-starswarm.ts --preset sensitivity --jobs 4    # one-at-a-time sweeps
 *   npx --prefix frontend tsx scripts/simulate-starswarm.ts --preset proposal --jobs 4       # pre-#2880 tuning vs the shipped one
 *   npx --prefix frontend tsx scripts/simulate-starswarm.ts --preset fast                    # the smoke cells (seconds)
 *   … --seeds 50 --diffs Captain,Ensign --scenarios boss-exposed --pilots duel --variants base,hp8
 *   … --json out.json --md out.md                                          # records + report files
 *   npx --prefix frontend tsx scripts/simulate-starswarm.ts --merge a.json,b.json --md all.md # re-report saved runs
 *
 * `--jobs N` forks N shard processes (seeds i % N) and merges their records.
 */
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  runCell,
  summarize,
  type RunRecord,
} from "../frontend/src/game/starswarm/sim/balance";
import { PRESETS, engineFor } from "../frontend/src/game/starswarm/sim/presets";
import {
  formatOffense,
  formatReport,
  formatSweep,
} from "../frontend/src/game/starswarm/sim/report";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const list = (v: string | undefined) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

function report(records: RunRecord[]): string {
  const cells = summarize(records);
  return (
    `${formatReport(cells)}\n\n### Sweep view\n\n${formatSweep(cells)}\n` +
    `\n### Offensive output view\n\n${formatOffense(cells)}\n`
  );
}

function emit(records: RunRecord[]): void {
  const json = arg("json");
  const md = report(records);
  if (json) {
    fs.writeFileSync(
      json,
      JSON.stringify({ records, cells: summarize(records) }),
    );
  }
  const mdOut = arg("md");
  if (mdOut) fs.writeFileSync(mdOut, md);
  process.stdout.write(md);
}

function readRecords(file: string): RunRecord[] {
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { records: RunRecord[] })
    .records;
}

function simulate(shard: number, shards: number): RunRecord[] {
  const presetName = arg("preset") ?? "baseline";
  const preset = PRESETS[presetName];
  if (!preset)
    throw new Error(
      `unknown --preset ${presetName} (${Object.keys(PRESETS).join(", ")})`,
    );
  const seeds = Number(arg("seeds") ?? preset.seeds);
  const seedBase = Number(arg("seed-base") ?? 0);
  const diffs = list(arg("diffs"));
  const scen = list(arg("scenarios"));
  const pilots = list(arg("pilots"));
  const variants = list(arg("variants"));
  const records: RunRecord[] = [];
  for (const g of preset.groups) {
    for (const v of g.variants) {
      if (variants && !variants.includes(v.name)) continue;
      const E = engineFor(v);
      for (const pilot of g.pilots) {
        if (pilots && !pilots.includes(pilot.name)) continue;
        for (const scenario of g.scenarios) {
          if (scen && !scen.includes(scenario)) continue;
          for (const difficulty of g.difficulties) {
            if (diffs && !diffs.includes(difficulty)) continue;
            records.push(
              ...runCell(E, {
                scenario,
                difficulty,
                pilot,
                variant: v.name,
                seeds,
                seedBase,
                shard,
                shards,
              }),
            );
          }
        }
      }
    }
  }
  return records;
}

async function forkShards(jobs: number): Promise<RunRecord[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "starswarm-sim-"));
  // every flag but the ones the parent owns (--jobs, --json, --md and their values)
  const passthrough: string[] = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (["--jobs", "--json", "--md"].includes(args[i]!)) i++;
    else passthrough.push(args[i]!);
  }
  const outs = Array.from({ length: jobs }, (_, i) =>
    path.join(dir, `shard${i}.json`),
  );
  await Promise.all(
    outs.map(
      (out, i) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              ...process.execArgv,
              process.argv[1]!,
              ...passthrough,
              "--shard",
              `${i}/${jobs}`,
              "--json",
              out,
              "--quiet",
            ],
            { stdio: ["ignore", "ignore", "inherit"] },
          );
          child.on("exit", (code) =>
            code === 0
              ? resolve()
              : reject(new Error(`shard ${i} exited ${code}`)),
          );
        }),
    ),
  );
  const records = outs.flatMap(readRecords);
  fs.rmSync(dir, { recursive: true, force: true });
  return records;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const merge = list(arg("merge"));
  let records: RunRecord[];
  if (merge) {
    records = merge.flatMap(readRecords);
  } else if (Number(arg("jobs") ?? 1) > 1) {
    records = await forkShards(Number(arg("jobs")));
  } else {
    const [shard, shards] = (arg("shard") ?? "0/1").split("/").map(Number) as [
      number,
      number,
    ];
    records = simulate(shard, shards);
  }
  if (process.argv.includes("--quiet")) {
    const json = arg("json");
    if (json) fs.writeFileSync(json, JSON.stringify({ records }));
    return;
  }
  emit(records);
  process.stderr.write(
    `starswarm sim: ${records.length} runs, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(
    `${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
  );
  process.exit(1);
});

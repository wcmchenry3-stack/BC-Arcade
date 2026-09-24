/**
 * Yacht AI simulation CLI — a thin wrapper over the shared harness in
 * frontend/src/game/yacht/sim/ (#2245). It has no bands of its own: the
 * calibration bands live in sim/gate.ts, and this script and
 * ai.calibrate.test.ts both read them from there (#2213 disposition — the
 * old stale bands table was retired).
 *
 * Usage (from the repo root):
 *   npx tsx scripts/simulate-yacht.ts --a hard --b medium            # ad-hoc matchup
 *   npx tsx scripts/simulate-yacht.ts --a hard --b hard --blocks 500 --mode independent
 *   npx tsx scripts/simulate-yacht.ts --gate                         # every gate matchup + bands
 *   npx tsx scripts/simulate-yacht.ts --gate --matchup hard-vs-medium --games 800
 *   npx tsx scripts/simulate-yacht.ts --a easy --b easy --json out.json   # raw per-game records
 *
 * Flags:
 *   --a, --b      easy | medium | hard (ad-hoc mode; default hard vs medium)
 *   --blocks N    four-game blocks to play (ad-hoc default 250 = 1,000 games)
 *   --games N     games instead of blocks (rounded up to a multiple of 4)
 *   --mode M      paired (default) | independent
 *   --seed N      base seed (default 1)
 *   --gate        run the calibration gate matchups and check their bands
 *   --matchup ID  with --gate: only this matchup (repeatable)
 *   --group NAME  with --gate: only this CI group's matchups (repeatable)
 *   --json PATH   write the raw run (and the report) as JSON
 *
 * One game takes about a second (the AI's two-roll EV search dominates),
 * so a full gate run takes a while — see docs/TESTING.md.
 */

import { writeFileSync } from "node:fs";
import {
  difficultyPolicy,
  runMatchup,
  type DiceMode,
  type MatchupRun,
} from "../frontend/src/game/yacht/sim/harness";
import {
  formatReport,
  summarize,
  type MatchupReport,
} from "../frontend/src/game/yacht/sim/stats";
import {
  GATE_BANDS,
  GATE_GROUPS,
  GATE_MATCHUPS,
  checkBands,
  formatBandResults,
  gateBlocks,
} from "../frontend/src/game/yacht/sim/gate";
import {
  AI_DIFFICULTIES,
  type AiDifficulty,
} from "../frontend/src/game/yacht/types";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function flags(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((arg, i) => {
    if (arg === name && process.argv[i + 1]) out.push(process.argv[i + 1]!);
  });
  return out;
}

function intFlag(name: string): number | undefined {
  const raw = flag(name);
  if (raw === undefined) return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    console.error(`${name} must be a positive integer (got "${raw}")`);
    process.exit(2);
  }
  return n;
}

function difficultyFlag(name: string, fallback: AiDifficulty): AiDifficulty {
  const raw = flag(name) ?? fallback;
  if (!(AI_DIFFICULTIES as readonly string[]).includes(raw)) {
    console.error(
      `${name} must be one of ${AI_DIFFICULTIES.join(", ")} (got "${raw}")`,
    );
    process.exit(2);
  }
  return raw as AiDifficulty;
}

const mode = (flag("--mode") ?? "paired") as DiceMode;
if (mode !== "paired" && mode !== "independent") {
  console.error(`--mode must be paired or independent (got "${mode}")`);
  process.exit(2);
}
const games = intFlag("--games");
const blocksFlag = intFlag("--blocks");
const jsonPath = flag("--json");

function timed(label: string, fn: () => MatchupRun): MatchupRun {
  const start = Date.now();
  const run = fn();
  const secs = (Date.now() - start) / 1000;
  const n = run.blocks.length * 4;
  console.log(
    `${label}: ${n} games in ${secs.toFixed(0)}s (${((secs * 1000) / n).toFixed(0)}ms/game)`,
  );
  return run;
}

const output: { runs: MatchupRun[]; reports: MatchupReport[] } = {
  runs: [],
  reports: [],
};

if (process.argv.includes("--gate")) {
  const groups = flags("--group");
  const unknownGroups = groups.filter((g) => !GATE_GROUPS[g]);
  if (unknownGroups.length) {
    console.error(
      `unknown --group ${unknownGroups.join(", ")}; known: ${Object.keys(GATE_GROUPS).join(", ")}`,
    );
    process.exit(2);
  }
  const only = [
    ...flags("--matchup"),
    ...groups.flatMap((g) => GATE_GROUPS[g]!),
  ];
  const unknown = only.filter((id) => !GATE_MATCHUPS.some((m) => m.id === id));
  if (unknown.length) {
    console.error(
      `unknown --matchup ${unknown.join(", ")}; known: ${GATE_MATCHUPS.map((m) => m.id).join(", ")}`,
    );
    process.exit(2);
  }
  const reports: Record<string, MatchupReport> = {};
  for (const m of GATE_MATCHUPS) {
    if (only.length && !only.includes(m.id)) continue;
    const blocks = games ? Math.ceil(games / 4) : (blocksFlag ?? gateBlocks(m));
    const run = timed(m.id, () =>
      runMatchup({
        a: difficultyPolicy(m.a),
        b: difficultyPolicy(m.b),
        blocks,
        mode,
        seed: m.seed,
      }),
    );
    const report = summarize(run);
    reports[m.id] = report;
    output.runs.push(run);
    output.reports.push(report);
    console.log(formatReport(report) + "\n");
  }
  // Only the bands this run can evaluate: a --group/--matchup subset leaves
  // the other groups' bands to their own jobs rather than listing them as skipped.
  const ran = Object.keys(reports);
  const results = checkBands(
    reports,
    GATE_BANDS.filter((band) => band.matchups.every((id) => ran.includes(id))),
  );
  console.log(formatBandResults(results));
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(output));
  process.exit(results.some((r) => r.status === "fail") ? 1 : 0);
}

const a = difficultyFlag("--a", "hard");
const b = difficultyFlag("--b", "medium");
const blocks = games ? Math.ceil(games / 4) : (blocksFlag ?? 250);
const seed = intFlag("--seed") ?? 1;
const run = timed(`${a} vs ${b}`, () =>
  runMatchup({
    a: difficultyPolicy(a),
    b: difficultyPolicy(b),
    blocks,
    mode,
    seed,
  }),
);
const report = summarize(run);
console.log(formatReport(report));
if (jsonPath) {
  output.runs.push(run);
  output.reports.push(report);
  writeFileSync(jsonPath, JSON.stringify(output));
}

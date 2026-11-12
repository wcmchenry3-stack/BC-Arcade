/**
 * Cascade physics spike CLI (#3696): current vs A (Matter.js tuned) vs B (planck.js).
 *
 * Usage (from the repo root):
 *   npx --prefix frontend tsx tools/sim/cascade-physics-spike.ts                  # 100 seeds, all three
 *   npx --prefix frontend tsx tools/sim/cascade-physics-spike.ts --seeds 10 --candidates A,B
 *   ... --json out.json --md out.md
 *   node --jitless --import tsx tools/sim/cascade-physics-spike.ts --bench-only   # step cost only
 *
 * Every candidate runs the harness's full suite (heuristic, random, spam x 60 / 120 Hz, the same
 * seeds, the same queue) through the `SimConfig.createEngine` seam, plus a step-cost bench with
 * 60+ pieces on the board. Spike tooling: nothing here ships.
 */
import { writeFileSync } from "node:fs";
import {
  CANDIDATE_IDS,
  candidateConfig,
  makeCandidate,
  type CandidateId,
} from "../../frontend/src/game/cascade/sim/candidates/candidates";
import {
  FULL_PARAMS,
  runSuite,
  type SuiteResult,
} from "../../frontend/src/game/cascade/sim/suite";
import { streamRng } from "../../frontend/src/game/cascade/sim/config";
import {
  WALL_THICKNESS,
  WORLD_WIDTH,
} from "../../frontend/src/game/cascade/constants";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

interface CandidateRun {
  suite: SuiteResult;
  /** Per "bot@hz": guard-rail-free counters from the candidate engine. */
  stats: Record<
    string,
    {
      railBeyondTolerancePerMin: number;
      railStrictPerMin: number;
      nearMissPairStepsPerMin: number;
      railBeyond3PxPerMin: number;
      railMaxDepthPx: number;
      escapesTotal: number;
      maxPieces: number;
    }
  >;
  bench: BenchResult;
  wallS: number;
}

interface BenchResult {
  pieces: number;
  meanStepMs: number;
  p95StepMs: number;
  maxStepMs: number;
}

const nowMs = (): number => performance.now();

/**
 * Step cost with 60+ pieces: merges and the lid off, 64 Cherries and Blueberries (alternating)
 * dropped every 250 ms across the bin, timed from the 60th piece to 3 s after the last.
 * Best of `repeats` runs (the least disturbed by the machine), per frame at 60 Hz.
 */
function bench(id: CandidateId, repeats = 5): BenchResult {
  const runs: BenchResult[] = [];
  for (let r = 0; r < repeats; r++) {
    const e = makeCandidate(id, { bench: { noMerges: true, noLid: true } });
    const rng = streamRng(1000 + r, "bot");
    const frameMs = 1000 / 60;
    const costs: number[] = [];
    let dropped = 0;
    let tailFrames = 0;
    for (let f = 0; tailFrames < 180; f++) {
      if (dropped < 64 && f % 15 === 0) {
        const tier = dropped % 2;
        const x =
          WALL_THICKNESS + 30 + rng() * (WORLD_WIDTH - 2 * WALL_THICKNESS - 60);
        e.drop(tier, x);
        dropped++;
      }
      const t0 = nowMs();
      e.step(frameMs);
      const c = nowMs() - t0;
      if (e.getState().pieces.length >= 60) costs.push(c);
      if (dropped >= 64) tailFrames++;
    }
    const pieces = e.getState().pieces.length;
    e.destroy();
    costs.sort((a, b) => a - b);
    runs.push({
      pieces,
      meanStepMs: costs.reduce((a, b) => a + b, 0) / Math.max(1, costs.length),
      p95StepMs: costs[Math.floor(costs.length * 0.95)] ?? 0,
      maxStepMs: costs[costs.length - 1] ?? 0,
    });
  }
  runs.sort((a, b) => a.meanStepMs - b.meanStepMs);
  return runs[0]!;
}

function runCandidate(id: CandidateId, seeds: number): CandidateRun {
  const params = { ...FULL_PARAMS, seeds };
  const cfg = candidateConfig(id, { tuning: { measureNearMiss: true } });
  const started = Date.now();
  const suite = runSuite(params, cfg);
  const wallS = (Date.now() - started) / 1000;
  // runSuite makes one engine per game, in order: bots x hzs x seeds.
  const stats: CandidateRun["stats"] = {};
  let i = 0;
  for (const bot of params.bots) {
    for (const hz of params.hzs) {
      const engines = cfg.engines.slice(i, i + seeds);
      i += seeds;
      const minutes = engines.reduce(
        (a, e) => a + (e.stats.fixedSteps * (1000 / 60)) / 60000,
        0,
      );
      stats[`${bot}@${hz}`] = {
        railBeyondTolerancePerMin:
          engines.reduce((a, e) => a + e.stats.railBeyondTolerance, 0) /
          minutes,
        railStrictPerMin:
          engines.reduce((a, e) => a + e.stats.railStrict, 0) / minutes,
        nearMissPairStepsPerMin:
          engines.reduce((a, e) => a + e.stats.nearMissPairSteps, 0) / minutes,
        railBeyond3PxPerMin:
          engines.reduce((a, e) => a + e.stats.railBeyond3Px, 0) / minutes,
        railMaxDepthPx: Math.max(...engines.map((e) => e.stats.railMaxDepthPx)),
        escapesTotal: engines.reduce((a, e) => a + e.stats.escapes, 0),
        maxPieces: Math.max(...engines.map((e) => e.stats.maxPieces)),
      };
    }
  }
  return { suite, stats, bench: bench(id), wallS };
}

const fmt = (v: number | null | undefined, d = 2): string =>
  v === null || v === undefined || !isFinite(v) ? "n/a" : v.toFixed(d);

function tables(
  results: Partial<Record<CandidateId, CandidateRun>>,
  bots: string[],
): string {
  const ids = CANDIDATE_IDS.filter((id) => results[id]);
  const hzs = FULL_PARAMS.hzs;
  const out: string[] = [];
  for (const bot of bots) {
    const cols = hzs.flatMap((hz) =>
      ids.map((id) => ({ id, hz, key: `${bot}@${hz}` })),
    );
    const run = (c: (typeof cols)[number]) => results[c.id]!.suite.runs[c.key]!;
    const st = (c: (typeof cols)[number]) => results[c.id]!.stats[c.key]!;
    const cost = (c: (typeof cols)[number]) =>
      results[c.id]!.suite.cost[c.key]!;
    const rows: [string, (c: (typeof cols)[number]) => string][] = [
      ["games", (c) => fmt(run(c)["games"], 0)],
      ["game length s (mean)", (c) => fmt(run(c)["simS.mean"], 1)],
      ["score (mean)", (c) => fmt(run(c)["score.mean"], 0)],
      ["packing density", (c) => fmt(run(c)["feel.packingDensity"], 3)],
      ["visible gap mean px", (c) => fmt(run(c)["feel.gapMeanPx"])],
      [
        "deepest overlap px (mean of games)",
        (c) => fmt(run(c)["feel.overlapMaxPx.mean"]),
      ],
      ["settle after drop ms", (c) => fmt(run(c)["feel.settleAfterDropMs"], 0)],
      [
        "settle after 3+ chain ms",
        (c) => fmt(run(c)["feel.settleAfterChainMs"], 0),
      ],
      [
        "chain episodes (total)",
        (c) => fmt(run(c)["feel.chainEpisodes.total"], 0),
      ],
      [
        "settle cut off by next drop",
        (c) => fmt(run(c)["feel.settleCensoredFraction"]),
      ],
      [
        "same-tier pairs resting 0-2 px apart, unmerged (pair-steps / min)",
        (c) => fmt(st(c).nearMissPairStepsPerMin, 0),
      ],
      ["jitter px/s", (c) => fmt(run(c)["feel.jitterPxPerS"])],
      ["rail (today's predicate) / min", (c) => fmt(st(c).railStrictPerMin, 0)],
      [
        "penetration > 1 px past rail / min",
        (c) => fmt(st(c).railBeyondTolerancePerMin, 0),
      ],
      [
        "penetration > 3 px past rail / min",
        (c) => fmt(st(c).railBeyond3PxPerMin, 0),
      ],
      [
        "deepest penetration past rail px (any game)",
        (c) => fmt(st(c).railMaxDepthPx, 1),
      ],
      ["escapes (tunnelled out), total", (c) => fmt(st(c).escapesTotal, 0)],
      ["most pieces on board", (c) => fmt(st(c).maxPieces, 0)],
      ["step ms, 20+ pieces (mean)", (c) => fmt(cost(c).meanStepMsGe20, 3)],
      ["step ms, worst game p95", (c) => fmt(cost(c).worstGameP95StepMs, 3)],
      [
        "ended by overflow / hard stop / cap",
        (c) =>
          `${fmt(run(c)["endedBy.overflowRate"])} / ${fmt(run(c)["endedBy.hardStopRate"])} / ${fmt(run(c)["endedBy.capRate"])}`,
      ],
      ["top tier (mean)", (c) => fmt(run(c)["topTier.mean"], 2)],
      ...[6, 7, 8, 9, 10, 11].map(
        (t) =>
          [
            `reached tier ${t}`,
            (c: (typeof cols)[number]) => fmt(run(c)[`reachedRate.t${t}`]),
          ] as [string, (c: (typeof cols)[number]) => string],
      ),
    ];
    out.push(`### ${bot}`, "");
    out.push(
      `| metric | ${cols.map((c) => `${c.id} ${c.hz} Hz`).join(" | ")} |`,
    );
    out.push(`| --- | ${cols.map(() => "---:").join(" | ")} |`);
    for (const [label, get] of rows)
      out.push(`| ${label} | ${cols.map(get).join(" | ")} |`);
    out.push("");
  }
  out.push(
    "### Step cost bench (64 pieces, merges and lid off, 60 Hz frames, best of 5)",
    "",
  );
  out.push(
    "| candidate | pieces | mean ms | p95 ms | max ms | suite wall time s |",
  );
  out.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const id of ids) {
    const b = results[id]!.bench;
    out.push(
      `| ${id} | ${b.pieces} | ${fmt(b.meanStepMs, 3)} | ${fmt(b.p95StepMs, 3)} | ${fmt(b.maxStepMs, 3)} | ${fmt(results[id]!.wallS, 0)} |`,
    );
  }
  return out.join("\n");
}

function main(): void {
  const seeds = Number(arg("--seeds") ?? FULL_PARAMS.seeds);
  const ids = (arg("--candidates")?.split(",") ?? [
    ...CANDIDATE_IDS,
  ]) as CandidateId[];
  if (process.argv.includes("--bench-only")) {
    // Step cost alone, e.g. under `node --jitless` (an interpreter-only proxy for Hermes).
    console.log("| candidate | pieces | mean ms | p95 ms | max ms |");
    console.log("| --- | ---: | ---: | ---: | ---: |");
    for (const id of ids) {
      const b = bench(id);
      console.log(
        `| ${id} | ${b.pieces} | ${fmt(b.meanStepMs, 3)} | ${fmt(b.p95StepMs, 3)} | ${fmt(b.maxStepMs, 3)} |`,
      );
    }
    return;
  }
  const results: Partial<Record<CandidateId, CandidateRun>> = {};
  for (const id of ids) {
    if (!CANDIDATE_IDS.includes(id)) throw new Error(`unknown candidate ${id}`);
    results[id] = runCandidate(id, seeds);
    console.error(`${id}: ${results[id]!.wallS} s`);
  }
  const md = tables(results, FULL_PARAMS.bots);
  console.log(md);
  const mdPath = arg("--md");
  if (mdPath) writeFileSync(mdPath, md + "\n");
  const jsonPath = arg("--json");
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(results, null, 2));
}

main();

/**
 * Cascade feel proposals CLI (#3697, phase 1): today's engine, the spike's B and the three planck
 * tunings (`frontend/src/game/cascade/sim/proposals/tunings.ts`) on the same seeds and bots.
 *
 * Usage (from the repo root):
 *   # one shard of games, written as JSON (shards run in parallel; see --part)
 *   npx --prefix frontend tsx tools/sim/cascade-feel-proposals.ts run --config balanced \
 *     --part suite:heuristic@60 --seeds 100 --out shard.json
 *   npx --prefix frontend tsx tools/sim/cascade-feel-proposals.ts run --config tight \
 *     --part long:heuristic@60 --seeds 100 --cap 600 --out long.json
 *   # step cost with 64 pieces (run under `node --jitless` as a Hermes stand-in)
 *   node --jitless --import ./frontend/node_modules/tsx/dist/loader.mjs \
 *     tools/sim/cascade-feel-proposals.ts bench --config current,B,tight,balanced,lively [--pieces 90]
 *   # the tables, from every shard in a directory
 *   npx --prefix frontend tsx tools/sim/cascade-feel-proposals.ts report --dir out/ --md out.md
 *
 * Configs: `current` (today's Matter physics on the ported rules), and the proposal ids `B`
 * (the spike's planck B), `tight`, `balanced`, `lively`. `--override '<json>'` merges
 * `{ planck, engine, difficulty }` into a proposal for an ablation.
 *
 * A "suite" part plays the harness's suite cell (heuristic / random 180 s, spam 120 s, as in the
 * spike). A "long" part plays to a longer cap (default 600 s) and stops at the capstone: that is
 * where time to the capstone comes from. Spike tooling: nothing here ships.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOTS } from "../../frontend/src/game/cascade/sim/bots";
import {
  streamRng,
  type SimConfig,
} from "../../frontend/src/game/cascade/sim/config";
import {
  runGame,
  type GameMetrics,
} from "../../frontend/src/game/cascade/sim/runGame";
import { SPAM_GAME_OVER_BOUND_MS } from "../../frontend/src/game/cascade/sim/suite";
import { candidateConfig } from "../../frontend/src/game/cascade/sim/candidates/candidates";
import type {
  CandidateEngine,
  CandidateStats,
} from "../../frontend/src/game/cascade/sim/candidates/candidateEngine";
import {
  PROPOSALS,
  makeProposalEngine,
  proposalConfig,
  resolveProposal,
  type ProposalId,
  type ProposalOverrides,
} from "../../frontend/src/game/cascade/sim/proposals/tunings";
import { ladderRadius } from "../../frontend/src/game/cascade/sim/proposals/difficulty";
import { skilledBot } from "../../frontend/src/game/cascade/sim/proposals/skilledBot";
import { makeCandidate } from "../../frontend/src/game/cascade/sim/candidates/candidates";
import { CAPSTONE_TIER } from "../../frontend/src/game/cascade/tiers";
import {
  FIXED_STEP_MS,
  WALL_THICKNESS,
  WORLD_WIDTH,
} from "../../frontend/src/game/cascade/constants";

type ConfigId = "current" | ProposalId;
const CONFIG_IDS: ConfigId[] = ["current", "B", "tight", "balanced", "lively"];
const LABEL: Record<ConfigId, string> = {
  current: "current (Matter)",
  B: PROPOSALS.B.label,
  tight: PROPOSALS.tight.label,
  balanced: PROPOSALS.balanced.label,
  lively: PROPOSALS.lively.label,
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

function makeConfig(
  id: ConfigId,
  o: ProposalOverrides,
): SimConfig & { engines: CandidateEngine[] } {
  if (id === "current") return candidateConfig("current");
  return proposalConfig(PROPOSALS[id], o);
}

/** One game: the harness's metrics (no per-frame arrays) and the engine's counters. */
interface GameRecord {
  m: Omit<GameMetrics, "cost"> & { cost: GameMetrics["cost"] };
  stats: CandidateStats;
}

interface Shard {
  config: ConfigId;
  override: ProposalOverrides;
  part: string;
  kind: "suite" | "long";
  bot: string;
  hz: number;
  capMs: number;
  games: GameRecord[];
}

function runPart(
  id: ConfigId,
  part: string,
  seeds: number,
  offset: number,
  o: ProposalOverrides,
  capS: number,
): Shard {
  const [kind, cell] = part.split(":") as ["suite" | "long", string];
  const [botName, hzS] = cell.split("@") as [string, string];
  const bot = botName === "skilled" ? skilledBot : BOTS[botName];
  if (!bot) throw new Error(`unknown bot ${botName}`);
  const hz = Number(hzS) as 60 | 120;
  const capMs =
    kind === "long"
      ? capS * 1000
      : botName === "spam"
        ? SPAM_GAME_OVER_BOUND_MS
        : 180_000;
  const games: GameRecord[] = [];
  for (let i = 1; i <= seeds; i++) {
    const cfg = makeConfig(id, o);
    const m = runGame({
      seed: offset + i,
      hz,
      bot,
      maxSimMs: capMs,
      config: cfg,
      stopOnWin: kind === "long",
    });
    games.push({ m, stats: cfg.engines[0]!.stats });
  }
  return {
    config: id,
    override: o,
    part,
    kind,
    bot: botName,
    hz,
    capMs,
    games,
  };
}

interface BenchResult {
  pieces: number;
  meanStepMs: number;
  p95StepMs: number;
  maxStepMs: number;
}

/**
 * The spike's bench: merges and the lid off, `total` (default 64) tier-0 / tier-1 pieces dropped
 * every 250 ms, timed from the (total - 4)th piece to 3 s after the last; best of `repeats`.
 */
function bench(id: ConfigId, total = 64, repeats = 5): BenchResult {
  const runs: BenchResult[] = [];
  const opts = { noMerges: true, noLid: true };
  for (let r = 0; r < repeats; r++) {
    const e =
      id === "current"
        ? makeCandidate("current", { bench: opts })
        : makeProposalEngine(resolveProposal(PROPOSALS[id]), opts);
    const rng = streamRng(1000 + r, "bot");
    const costs: number[] = [];
    let dropped = 0;
    let tail = 0;
    for (let f = 0; tail < 180; f++) {
      if (dropped < total && f % 15 === 0) {
        e.drop(
          dropped % 2,
          WALL_THICKNESS + 30 + rng() * (WORLD_WIDTH - 2 * WALL_THICKNESS - 60),
        );
        dropped++;
      }
      const t0 = performance.now();
      e.step(1000 / 60);
      const c = performance.now() - t0;
      if (e.getState().pieces.length >= total - 4) costs.push(c);
      if (dropped >= total) tail++;
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

// ---------------------------------------------------------------------------------- report

const avg = (xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => typeof x === "number" && isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
/** Order statistic over all games (a game that never got there counts as +Infinity). */
function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? Infinity;
}
const fmt = (v: number | null | undefined, d = 2): string =>
  v === null || v === undefined ? "n/a" : !isFinite(v) ? "never" : v.toFixed(d);

type Row = [string, (games: GameRecord[], s: Shard) => string];

function minutes(games: GameRecord[]): number {
  return sum(games.map((g) => (g.stats.fixedSteps * FIXED_STEP_MS) / 60000));
}

const SUITE_ROWS: Row[] = [
  ["games", (g) => String(g.length)],
  ["game length s (mean)", (g) => fmt(avg(g.map((x) => x.m.simMs / 1000)), 1)],
  ["score (mean)", (g) => fmt(avg(g.map((x) => x.m.score)), 0)],
  [
    "merges per drop",
    (g) => fmt(sum(g.map((x) => x.m.merges)) / sum(g.map((x) => x.m.drops))),
  ],
  ["visible gap mean px", (g) => fmt(avg(g.map((x) => x.m.feel.gapMeanPx)))],
  [
    "deepest overlap px (mean of games)",
    (g) => fmt(avg(g.map((x) => x.m.feel.overlapMaxPx))),
  ],
  ["jitter px/s", (g) => fmt(avg(g.map((x) => x.m.feel.jitterPxPerS)))],
  [
    "packing density",
    (g) => fmt(avg(g.map((x) => x.m.feel.packingDensity)), 3),
  ],
  [
    "settle after drop ms",
    (g) => fmt(avg(g.map((x) => x.m.feel.settleAfterDropMs)), 0),
  ],
  [
    "settle after 3+ chain ms",
    (g) => fmt(avg(g.map((x) => x.m.feel.settleAfterChainMs)), 0),
  ],
  [
    "chain episodes (total)",
    (g) => String(sum(g.map((x) => x.m.feel.chainEpisodes))),
  ],
  [
    "chain merge latency ms, median / p90 (touching products)",
    (g) => {
      const l = g
        .flatMap((x) => x.stats.chainLatencySteps)
        .map((s) => s * FIXED_STEP_MS);
      return l.length
        ? `${fmt(quantile(l, 0.5), 0)} / ${fmt(quantile(l, 0.9), 0)}`
        : "n/a";
    },
  ],
  [
    "touching products merged < 150 ms / never (1 s)",
    (g) => {
      const l = g.flatMap((x) => x.stats.chainLatencySteps);
      const miss = sum(g.map((x) => x.stats.chainMisses));
      const n = l.length + miss;
      if (n === 0) return "n/a";
      const fast = l.filter((s) => s * FIXED_STEP_MS < 150).length;
      return `${fmt(fast / n)} / ${fmt(miss / n)} (n=${n})`;
    },
  ],
  [
    "guard-rail events / min",
    (g) => fmt(avg(g.map((x) => x.m.feel.guardRailPerMin)), 0),
  ],
  [
    "wall penetration > 1 px / > 3 px, per min",
    (g) => {
      const min = minutes(g);
      return `${fmt(sum(g.map((x) => x.stats.railBeyondTolerance)) / min, 0)} / ${fmt(sum(g.map((x) => x.stats.railBeyond3Px)) / min, 0)}`;
    },
  ],
  [
    "deepest wall penetration px",
    (g) => fmt(Math.max(...g.map((x) => x.stats.railMaxDepthPx)), 1),
  ],
  ["escapes (total)", (g) => String(sum(g.map((x) => x.stats.escapes)))],
  [
    "most pieces on board",
    (g) => String(Math.max(...g.map((x) => x.stats.maxPieces))),
  ],
  [
    "ended by overflow / hard stop / cap / win",
    (g) => {
      const r = (k: string) =>
        fmt(g.filter((x) => x.m.endedBy === k && !x.m.won).length / g.length);
      return `${r("overflow")} / ${r("hardStop")} / ${r("cap")} / ${fmt(g.filter((x) => x.m.won).length / g.length)}`;
    },
  ],
  ["top tier (mean)", (g) => fmt(avg(g.map((x) => x.m.topTier)))],
  ...[7, 8, 9, 10, 11].map((t): Row => [
    `reached tier ${t}`,
    (g) => fmt(g.filter((x) => x.m.topTier >= t).length / g.length),
  ]),
  [
    "step ms, 20+ pieces (mean)",
    (g) => fmt(avg(g.map((x) => x.m.cost.meanStepMsGe20)), 3),
  ],
];

const LONG_ROWS: Row[] = [
  ["games", (g) => String(g.length)],
  [
    "reached the capstone (tier 11) within the cap",
    (g) =>
      fmt(
        g.filter((x) => x.m.tierFirstMs[CAPSTONE_TIER] !== null).length /
          g.length,
      ),
  ],
  [
    "time to capstone s, p25 / median / p75",
    (g) => {
      const t = g.map(
        (x) => (x.m.tierFirstMs[CAPSTONE_TIER] ?? Infinity) / 1000,
      );
      return `${fmt(quantile(t, 0.25), 0)} / ${fmt(quantile(t, 0.5), 0)} / ${fmt(quantile(t, 0.75), 0)}`;
    },
  ],
  [
    "...among the games that made it: p25 / median / p75",
    (g) => {
      const t = g
        .map((x) => x.m.tierFirstMs[CAPSTONE_TIER])
        .filter((v): v is number => v !== null)
        .map((v) => v / 1000);
      if (t.length === 0) return "n/a";
      return `${fmt(quantile(t, 0.25), 0)} / ${fmt(quantile(t, 0.5), 0)} / ${fmt(quantile(t, 0.75), 0)}`;
    },
  ],
  [
    "time to tier 10 s, p25 / median / p75",
    (g) => {
      const t = g.map((x) => (x.m.tierFirstMs[10] ?? Infinity) / 1000);
      return `${fmt(quantile(t, 0.25), 0)} / ${fmt(quantile(t, 0.5), 0)} / ${fmt(quantile(t, 0.75), 0)}`;
    },
  ],
  [
    "reached tier 9 / 10",
    (g) =>
      `${fmt(g.filter((x) => x.m.topTier >= 9).length / g.length)} / ${fmt(g.filter((x) => x.m.topTier >= 10).length / g.length)}`,
  ],
  [
    "ended by overflow / hard stop / cap / capstone",
    (g) => {
      const r = (k: string) =>
        fmt(
          g.filter(
            (x) => x.m.endedBy === k && x.m.tierFirstMs[CAPSTONE_TIER] === null,
          ).length / g.length,
        );
      return `${r("overflow")} / ${r("hardStop")} / ${r("cap")} / ${fmt(g.filter((x) => x.m.tierFirstMs[CAPSTONE_TIER] !== null).length / g.length)}`;
    },
  ],
  [
    "game length s (mean; a capstone ends the run)",
    (g) => fmt(avg(g.map((x) => x.m.simMs / 1000)), 0),
  ],
  [
    "merges per drop",
    (g) => fmt(sum(g.map((x) => x.m.merges)) / sum(g.map((x) => x.m.drops))),
  ],
  ["drops (mean)", (g) => fmt(avg(g.map((x) => x.m.drops)), 0)],
];

/** Shards of the same config and part (split by --seed-offset) are joined into one. */
function report(dir: string): string {
  const joined = new Map<string, Shard>();
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()) {
    const s = JSON.parse(readFileSync(join(dir, f), "utf8")) as Shard;
    const key = `${s.config}|${s.part}`;
    const prev = joined.get(key);
    if (prev) prev.games.push(...s.games);
    else joined.set(key, s);
  }
  const shards = [...joined.values()];
  const ids = CONFIG_IDS.filter((id) => shards.some((s) => s.config === id));
  const out: string[] = [];
  const cells = [...new Set(shards.map((s) => s.part))].sort();
  for (const cell of cells) {
    const kind = cell.split(":")[0];
    const rows = kind === "long" ? LONG_ROWS : SUITE_ROWS;
    const cols = ids
      .map((id) => shards.find((s) => s.config === id && s.part === cell))
      .filter((s): s is Shard => !!s);
    out.push(
      `### ${cell}${kind === "long" ? ` (cap ${cols[0]!.capMs / 1000} s, stops at the capstone)` : ""}`,
      "",
    );
    out.push(`| metric | ${cols.map((s) => LABEL[s.config]).join(" | ")} |`);
    out.push(`| --- | ${cols.map(() => "---:").join(" | ")} |`);
    for (const [label, get] of rows)
      out.push(
        `| ${label} | ${cols.map((s) => get(s.games, s)).join(" | ")} |`,
      );
    out.push("");
  }
  return out.join("\n");
}

function main(): void {
  const cmd = process.argv[2];
  const o = JSON.parse(arg("--override") ?? "{}") as ProposalOverrides;
  if (cmd === "run") {
    const id = arg("--config") as ConfigId;
    if (!CONFIG_IDS.includes(id)) throw new Error(`unknown config ${id}`);
    const shard = runPart(
      id,
      arg("--part")!,
      Number(arg("--seeds") ?? 100),
      Number(arg("--seed-offset") ?? 0),
      o,
      Number(arg("--cap") ?? 600),
    );
    const out = arg("--out");
    if (out) writeFileSync(out, JSON.stringify(shard));
    else console.log(JSON.stringify(shard));
    return;
  }
  if (cmd === "bench") {
    const ids = (arg("--config") ?? CONFIG_IDS.join(",")).split(
      ",",
    ) as ConfigId[];
    console.log("| config | pieces | mean ms | p95 ms | max ms |");
    console.log("| --- | ---: | ---: | ---: | ---: |");
    const total = Number(arg("--pieces") ?? 64);
    for (const id of ids) {
      const b = bench(id, total);
      console.log(
        `| ${LABEL[id]} | ${b.pieces} | ${fmt(b.meanStepMs, 3)} | ${fmt(b.p95StepMs, 3)} | ${fmt(b.maxStepMs, 3)} |`,
      );
    }
    return;
  }
  if (cmd === "report") {
    const md = report(arg("--dir")!);
    console.log(md);
    const mdPath = arg("--md");
    if (mdPath) writeFileSync(mdPath, md + "\n");
    return;
  }
  if (cmd === "radii") {
    for (const id of CONFIG_IDS.filter(
      (i): i is ProposalId => i !== "current",
    )) {
      const r = ladderRadius(PROPOSALS[id].difficulty);
      console.log(
        LABEL[id],
        Array.from({ length: CAPSTONE_TIER + 1 }, (_, t) => r(t)).join(" "),
      );
    }
    return;
  }
  throw new Error("usage: run | bench | report | radii (see the file header)");
}

main();

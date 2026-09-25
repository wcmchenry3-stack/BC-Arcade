/**
 * Hearts AI simulation CLI (#1273, #2204; sim gate v2 #2238).
 *
 * The game runner, metrics and gate live in frontend/src/game/hearts/sim/
 * (harness.ts, metrics.ts, sprt.ts, gate.ts); this script is the command
 * line around them. See docs/TESTING.md for the methodology.
 *
 * Modes:
 *   npx tsx scripts/simulate-hearts.ts                        # descriptive report, 3000 games per matchup
 *   npx tsx scripts/simulate-hearts.ts --count 900             # ... 900 games per matchup
 *   npx tsx scripts/simulate-hearts.ts --gate                  # full SPRT gate, every group
 *   npx tsx scripts/simulate-hearts.ts --gate --group field    # one group (as CI's matrix does)
 *   npx tsx scripts/simulate-hearts.ts --gate --json out.json  # also write machine-readable results
 *   npx tsx scripts/simulate-hearts.ts --update-baseline --reason "why"   # re-measure baseline.json
 *   npx tsx scripts/simulate-hearts.ts --regret                # per-decision regret vs the reference (#2239)
 *   npx tsx scripts/simulate-hearts.ts --regret --blocks 40 --sample-every 4 --oracle-player
 *   npx tsx scripts/simulate-hearts.ts --regret --pimc 16          # also grade the PIMC engine (16 deals/move)
 *   npx tsx scripts/simulate-hearts.ts --log-games 10          # 10 fully-logged games (NDJSON)
 *   npx tsx scripts/simulate-hearts.ts --log-games 10 --difficulties cautious,schemer,daring,schemer
 *
 * `--count` is games per matchup (rounded up to whole blocks), aligned with
 * scripts/simulate-yacht.ts (#2204). `--seed` overrides the deal seed for
 * the report and the gate. NDJSON game logs (`--log-games`, used by
 * hearts-analysis/main.py's /api/simulate) keep their format.
 */

import {
  commitPass,
  createSeededRng,
  dealGame,
  dealNextHand,
  playCard,
  selectPassCard,
  setRng,
} from "../frontend/src/game/hearts/engine";
import {
  selectCardToPlay,
  selectCardsToPass,
} from "../frontend/src/game/hearts/ai";
import type {
  AiPersona,
  Card,
  HeartsState,
} from "../frontend/src/game/hearts/types";
import { pimcPolicy, runBlocks } from "../frontend/src/game/hearts/sim/harness";
import { DEFAULT_PIMC_CONFIG } from "../frontend/src/game/hearts/pimc/engine";
import {
  REGRET_PERSONAS,
  formatRegretReport,
  regretMatchup,
  runRegretBlocks,
} from "../frontend/src/game/hearts/sim/regret";
import {
  GATE_GROUPS,
  GATE_MATCHUPS,
  GATE_SEED,
  describeMatchup,
  formatCheck,
  formatGroupRun,
  measureBaseline,
  runGroup,
  type GroupRun,
} from "../frontend/src/game/hearts/sim/gate";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Difficulties = [AiPersona, AiPersona, AiPersona, AiPersona];

// ---------------------------------------------------------------------------
// Diagnostic game logging (#1502)
// ---------------------------------------------------------------------------

interface TrickLog {
  trickNumber: number;
  leader: number;
  plays: Array<{ player: number; card: Card }>;
  winner: number;
}

interface HandLog {
  handNumber: number;
  passDirection: string;
  initialDeal: Card[][];
  passed: Card[][];
  received: Card[][];
  tricks: TrickLog[];
}

interface GameLog {
  seed: number;
  difficulties: string[];
  winner: number;
  finalScores: number[];
  hands: HandLog[];
}

function simulateGameLogged(difficulties: Difficulties, seed: number): GameLog {
  setRng(createSeededRng(seed));
  let state: HeartsState = dealGame(difficulties[0]);

  const hands: HandLog[] = [];
  let currentHand: HandLog = {
    handNumber: state.handNumber,
    passDirection: state.passDirection,
    initialDeal: state.playerHands.map((h) => [...h]),
    passed: [[], [], [], []],
    received: [[], [], [], []],
    tricks: [],
  };
  let trickPlays: Array<{ player: number; card: Card }> = [];
  let trickLeader = -1;
  let trickNumber = 0;
  let pendingPasses: Card[][] = [[], [], [], []];

  while (state.phase !== "game_over") {
    if (state.phase === "passing") {
      for (let i = 0; i < 4; i++) {
        const diff = difficulties[i]!;
        const hand = [...(state.playerHands[i] ?? [])];
        const cards = selectCardsToPass(hand, state.passDirection, diff, i);
        pendingPasses[i] = cards;
        for (const card of cards) {
          state = selectPassCard(state, i, card);
        }
      }
      const handsBeforeCommit = state.playerHands.map(
        (h) => new Set(h.map((c) => `${c.suit}:${c.rank}`)),
      );
      state = commitPass(state);
      currentHand.passed = pendingPasses.map((p) => [...p]);
      for (let i = 0; i < 4; i++) {
        currentHand.received[i] = (state.playerHands[i] ?? []).filter(
          (c) => !handsBeforeCommit[i]!.has(`${c.suit}:${c.rank}`),
        );
      }
    } else if (state.phase === "playing") {
      const playerIndex = state.currentPlayerIndex;
      const diff = difficulties[playerIndex]!;
      const hand = [...(state.playerHands[playerIndex] ?? [])];
      const trick = [...state.currentTrick];
      const card = selectCardToPlay(hand, trick, state, playerIndex, diff);

      if (trick.length === 0) {
        trickLeader = playerIndex;
        trickNumber++;
      }

      const prevTricksPlayed = state.tricksPlayedInHand;
      trickPlays.push({ player: playerIndex, card });
      state = playCard(state, playerIndex, card);

      if (state.tricksPlayedInHand > prevTricksPlayed) {
        currentHand.tricks.push({
          trickNumber,
          leader: trickLeader,
          plays: trickPlays,
          winner: state.currentLeaderIndex,
        });
        trickPlays = [];
      }
    } else if (state.phase === "dealing") {
      hands.push(currentHand);
      state = dealNextHand(state);
      currentHand = {
        handNumber: state.handNumber,
        passDirection: state.passDirection,
        initialDeal: state.playerHands.map((h) => [...h]),
        passed: [[], [], [], []],
        received: [[], [], [], []],
        tricks: [],
      };
      trickPlays = [];
      trickLeader = -1;
      trickNumber = 0;
      pendingPasses = [[], [], [], []];
    }
  }

  hands.push(currentHand);

  return {
    seed,
    difficulties: [...difficulties],
    winner: state.winnerIndex ?? -1,
    finalScores: [...state.cumulativeScores],
    hands,
  };
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

const VALID_DIFFICULTIES = new Set<AiPersona>([
  "cautious",
  "schemer",
  "daring",
]);

function parseCount(args: string[], flag: string): number | null {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const n = parseInt(args[idx + 1] ?? "", 10);
  return isNaN(n) ? null : n;
}

function parseDifficulties(args: string[]): Difficulties | null {
  const idx = args.indexOf("--difficulties");
  if (idx === -1) return null;
  const parts = (args[idx + 1] ?? "").split(",");
  if (parts.length !== 4) return null;
  for (const p of parts) {
    if (!VALID_DIFFICULTIES.has(p as AiPersona)) return null;
  }
  return parts as unknown as Difficulties;
}

// --log-games N: emit N NDJSON game logs and exit (optionally with --difficulties).
// This is a distinct mode from aggregate-stats --count below (#2204) — it is used
// by hearts-analysis/main.py's /api/simulate endpoint, so the flag name and the
// NDJSON-per-line output format must stay stable even though --count no longer
// triggers it.
const logCount = parseCount(process.argv, "--log-games");
if (logCount !== null) {
  if (logCount < 1) {
    process.stderr.write(
      "Error: --log-games count must be a positive integer\n",
    );
    process.exit(1);
  }
  const difficultiesArg = parseDifficulties(process.argv);
  if (process.argv.includes("--difficulties") && difficultiesArg === null) {
    process.stderr.write(
      "Error: --difficulties must be 4 comma-separated values of cautious/schemer/daring\n" +
        "  Example: --difficulties cautious,schemer,daring,schemer\n",
    );
    process.exit(1);
  }
  const logDifficulties: Difficulties = difficultiesArg ?? [
    "schemer",
    "schemer",
    "schemer",
    "schemer",
  ];
  for (let i = 0; i < logCount; i++) {
    const log = simulateGameLogged(logDifficulties, i);
    process.stdout.write(JSON.stringify(log) + "\n");
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Aggregate modes (#2238)
// ---------------------------------------------------------------------------

function argValue(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx === -1 ? null : (args[idx + 1] ?? null);
}

function fail(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

const argv = process.argv;
const seedArg = parseCount(argv, "--seed");
const BASELINE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../frontend/src/game/hearts/sim/baseline.json",
);

if (argv.includes("--update-baseline")) {
  // Re-measure baseline.json. Only for a deliberate behaviour change: the
  // PR that runs this must say why, and reviewers read the JSON diff.
  const reason = argValue(argv, "--reason");
  if (!reason)
    fail('--update-baseline needs --reason "<the behaviour change behind it>"');
  const blocks = parseCount(argv, "--blocks") ?? undefined;
  const t0 = Date.now();
  const baseline = measureBaseline(reason, blocks, (group, n) =>
    console.log(
      `measured group ${group}: ${n} blocks (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
    ),
  );
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`wrote ${BASELINE_PATH}`);
  for (const [key, e] of Object.entries(baseline.metrics)) {
    console.log(
      `  ${key}: ${e.value.toFixed(4)} ± ${e.se.toFixed(4)} (${e.num.toFixed(1)}/${e.den})`,
    );
  }
  for (const [id, e] of Object.entries(baseline.separations)) {
    console.log(`  ${id}: ${e.mean.toFixed(4)} ± ${e.se.toFixed(4)}`);
  }
  process.exit(0);
}

if (argv.includes("--regret")) {
  // Per-decision regret vs the perfect-information reference (#2239). A
  // report, not a gate: it always exits 0.
  const blocks = parseCount(argv, "--blocks") ?? 100;
  const sampleEvery = parseCount(argv, "--sample-every") ?? 1;
  if (blocks < 1 || sampleEvery < 1)
    fail("--blocks and --sample-every must be positive integers");
  const withOracle = argv.includes("--oracle-player");
  const pimcSamples = parseCount(argv, "--pimc");
  if (argv.includes("--pimc") && !(pimcSamples !== null && pimcSamples >= 1))
    fail("--pimc needs a positive number of deals per move");
  const pimc =
    pimcSamples !== null
      ? pimcPolicy("pimc", {
          ...DEFAULT_PIMC_CONFIG,
          samples: pimcSamples,
          horizon: "hand",
        })
      : undefined;
  const seed = seedArg ?? GATE_SEED;
  const t0 = Date.now();
  const results = runRegretBlocks(
    regretMatchup(withOracle, pimc),
    seed,
    0,
    blocks,
    { sampleEvery },
  );
  const secs = (Date.now() - t0) / 1000;
  const roles = [
    ...REGRET_PERSONAS,
    ...(pimc ? ["pimc"] : []),
    ...(withOracle ? ["oracle"] : []),
  ];
  console.log(
    `Hearts regret report — test seat vs a Schemer field, seed ${seed}, ${blocks} blocks, every ${sampleEvery === 1 ? "" : `${sampleEvery}th `}play graded (${secs.toFixed(0)}s)\n`,
  );
  console.log(formatRegretReport(results, roles, sampleEvery));
  process.exit(0);
}

if (argv.includes("--gate")) {
  const only = argValue(argv, "--group");
  if (only !== null && !GATE_GROUPS[only]) {
    fail(
      `unknown --group ${only} (groups: ${Object.keys(GATE_GROUPS).join(", ")})`,
    );
  }
  const groups = only ? [only] : Object.keys(GATE_GROUPS);
  const maxBlocks = parseCount(argv, "--max-blocks") ?? undefined;
  if (
    argv.includes("--max-blocks") &&
    !(maxBlocks !== undefined && maxBlocks >= 1)
  ) {
    fail("--max-blocks must be a positive integer");
  }
  const runs: GroupRun[] = [];
  for (const group of groups) {
    const t0 = Date.now();
    const run = runGroup(group, {
      ...(seedArg !== null ? { seed: seedArg } : {}),
      ...(maxBlocks !== undefined ? { maxBlocks } : {}),
      onLook: (blocks, results) => {
        const open = results.filter((r) => r.status === "continue").length;
        console.log(
          `[${group}] ${blocks} blocks, ${((Date.now() - t0) / 1000).toFixed(0)}s: ${open} undecided`,
        );
      },
    });
    runs.push(run);
    console.log(formatGroupRun(run));
    console.log();
  }
  const jsonPath = argValue(argv, "--json");
  if (jsonPath) {
    const json = runs.map((run) => ({
      group: run.group,
      seed: run.seed,
      blocks: run.blocks,
      results: run.results.map((r) => ({
        id: r.check.id,
        kind: r.check.kind,
        status: r.status,
        truncated: r.truncated,
        estimate: r.estimate,
        target: r.target,
        num: r.num,
        den: r.den,
        llr: r.sprt.map((x) => x.llr),
        message: formatCheck(r),
      })),
    }));
    writeFileSync(jsonPath, JSON.stringify(json, null, 2) + "\n");
  }
  const failed = runs
    .flatMap((r) => r.results)
    .filter((r) => r.status !== "pass");
  if (failed.length > 0) {
    console.log(`${failed.length} check(s) failed.`);
    process.exit(1);
  }
  process.exit(0);
}

// Descriptive report: every matchup at a fixed sample size, all metrics
// with their logged denominators. No pass/fail — that is --gate's job.
const GAMES_PER_MATCHUP = parseCount(argv, "--count") ?? 3000;
if (GAMES_PER_MATCHUP < 1) fail("--count must be a positive integer");
const seed = seedArg ?? GATE_SEED;
console.log(
  "Hearts AI simulation report (duplicate deals; values are mean [95% CI over blocks])",
);
console.log(`seed ${seed}, ~${GAMES_PER_MATCHUP} games per matchup\n`);
for (const [id, matchup] of Object.entries(GATE_MATCHUPS)) {
  const blocks = Math.ceil(GAMES_PER_MATCHUP / matchup.lineups.length);
  console.log(describeMatchup(id, runBlocks(matchup, seed, 0, blocks)));
  console.log();
}
// Keep the baseline file's provenance visible next to the numbers.
const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as {
  generated: string;
  reason: string;
};
console.log(
  `baseline.json: generated ${baseline.generated} — ${baseline.reason}`,
);

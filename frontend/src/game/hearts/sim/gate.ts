/**
 * Hearts sim gate v2 (#2238): which matchups run, what is checked, and how.
 * `scripts/simulate-hearts.ts --gate` runs it, locally and in
 * .github/workflows/hearts-sim-gate.yml. See docs/TESTING.md.
 *
 * Two kinds of check, both sequential tests (sprt.ts) on per-block series
 * from duplicate-deal replay (harness.ts):
 *
 * - Regression checks hold one conditional metric (metrics.ts) of one role
 *   at the checked-in last-known-good value in baseline.json: H0 "equals
 *   the baseline" against H1 "moved by δ", in either direction.
 * - Separation checks are pre-registered, signed hypotheses about two
 *   metrics: "left − right is about +m" (H0) against "the difference has
 *   gone" (H1: 0). The expected sign and size are written below, before any
 *   run, from the measurements quoted beside them. A reversed or vanished
 *   separation fails; a larger one passes.
 *
 * All checks form one family: each runs at α = 0.05 / (number of checks)
 * (Bonferroni), so a behaviour-neutral change fails the whole gate with
 * probability at most 0.05. β = 0.05 per check. The reported confidence
 * intervals use the same Bonferroni-adjusted level.
 */

import baselineJson from "./baseline.json";
import {
  fieldMatchup,
  personaPolicy,
  presetMatchup,
  runBlocks,
  type BlockRecord,
  type Matchup,
} from "./harness";
import {
  METRICS,
  differenceSeries,
  meanEstimate,
  observations,
  ratioEstimate,
  ratioSeries,
  type Estimate,
  type MetricId,
} from "./metrics";
import { twoSidedSprt, sprt, type CheckStatus, type SprtResult } from "./sprt";

// ---------------------------------------------------------------------------
// Matchups
// ---------------------------------------------------------------------------

const cautious = personaPolicy("cautious");
const schemer = personaPolicy("schemer");
const daring = personaPolicy("daring");

/**
 * The human stand-in at seat 0 of every preset table. Schemer is the app's
 * default persona and the middle of the three noise levels (35/10/0%). Its settings are left
 * alone by persona tuning (#2555) so the stand-in never moves.
 */
const PROXY = schemer;

export const GATE_MATCHUPS: Readonly<Record<string, Matchup>> = {
  "table-cautious": presetMatchup("table-cautious", PROXY, [cautious, cautious, cautious]),
  "table-schemer": presetMatchup("table-schemer", PROXY, [schemer, schemer, schemer]),
  "table-daring": presetMatchup("table-daring", PROXY, [daring, daring, daring]),
  "table-mixed": presetMatchup("table-mixed", PROXY, [cautious, schemer, daring]),
  "field-schemer": fieldMatchup("field-schemer", schemer, [cautious, schemer, daring]),
};

export interface GateGroup {
  readonly matchups: readonly string[];
  /** Blocks added to every matchup between looks. */
  readonly lookEvery: number;
  /** No decision before this many blocks (the variance estimate needs them). */
  readonly minBlocks: number;
  /** Block cap: undecided checks are truncated here. */
  readonly maxBlocks: number;
  /** Fixed-N block count for `--update-baseline`. */
  readonly baselineBlocks: number;
}

/**
 * Matchups that advance together and run as one CI job (the workflow's
 * matrix runs the groups in parallel). A check may only read matchups from
 * one group — enforced by gate.test.ts. Games per block: presets 6
 * (1+1+1+3), field 9; ~7 ms a game under tsx.
 */
export const GATE_GROUPS: Readonly<Record<string, GateGroup>> = {
  presets: {
    matchups: ["table-cautious", "table-schemer", "table-daring", "table-mixed"],
    lookEvery: 200,
    minBlocks: 400,
    // The Cautious-vs-Schemer table step (pre-registered +2.5pp, per-block
    // SD ~0.58) can need ~7,000 blocks to decide (#2235).
    maxBlocks: 12000,
    baselineBlocks: 12000,
  },
  field: {
    matchups: ["field-schemer"],
    lookEvery: 200,
    minBlocks: 400,
    maxBlocks: 6000,
    baselineBlocks: 6000,
  },
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export interface MetricRef {
  readonly matchup: string;
  readonly role: string;
  readonly metric: MetricId;
}

export function refKey(ref: MetricRef): string {
  return `${ref.matchup}/${ref.role}/${ref.metric}`;
}

export interface RegressionCheck {
  readonly kind: "regression";
  readonly id: string;
  readonly ref: MetricRef;
  /** The smallest move either way the check must catch (β = 0.05). */
  readonly delta: number;
}

export interface SeparationCheck {
  readonly kind: "separation";
  readonly id: string;
  readonly description: string;
  readonly left: MetricRef;
  readonly right: MetricRef;
  /** Pre-registered left − right: its sign is the expected direction. */
  readonly expected: number;
}

export type GateCheck = RegressionCheck | SeparationCheck;

function regression(
  matchup: string,
  role: string,
  metric: MetricId,
  delta: number
): RegressionCheck {
  return {
    kind: "regression",
    id: `${matchup}/${role}/${metric}`,
    ref: { matchup, role, metric },
    delta,
  };
}

export const REGRESSION_CHECKS: readonly RegressionCheck[] = [
  // How hard each preset is for the human (the stand-in's win share).
  regression("table-cautious", "proxy", "win_share", 0.03),
  regression("table-schemer", "proxy", "win_share", 0.03),
  regression("table-daring", "proxy", "win_share", 0.03),
  regression("table-mixed", "proxy", "win_share", 0.03),
  // Persona strength where the app seats all three together.
  regression("table-mixed", "cautious", "win_share", 0.03),
  regression("table-mixed", "schemer", "win_share", 0.03),
  regression("table-mixed", "daring", "win_share", 0.03),
  // Moon play: attempts per hand, and the PAIRED success rate (#2204, HRT-1).
  regression("table-daring", "daring", "moon_attempt", 0.02),
  regression("table-daring", "daring", "moon_success", 0.025),
  // Where dumped Q♠s land: Daring aims them at the human.
  regression("table-daring", "daring", "qs_dump_on_human", 0.04),
  regression("table-schemer", "schemer", "qs_dump_on_human", 0.04),
  // Passing: how often a pass that could void a suit does.
  regression("table-cautious", "cautious", "void_created", 0.04),
  regression("table-schemer", "schemer", "void_created", 0.04),
  regression("table-daring", "daring", "void_created", 0.04),
];

function winShare(matchup: string, role: string): MetricRef {
  return { matchup, role, metric: "win_share" };
}

/**
 * Pre-registered persona separations: the difficulty ladder (#2555).
 * Strength runs Daring > Schemer > Cautious, so the human wins most at the
 * Cautious table and least at the Daring table. Each `expected` is the
 * lower 95% bound of the value measured on the baseline seed
 * (baseline.json `separations`: mean − 2·SE), fixed before any gate run —
 * the smallest separation the evidence supports. A point estimate would
 * overshoot the truth half the time and turn noise into gate failures
 * (#2235: a +3.5pp estimate failed at +1.7pp on the gate seed). A
 * deliberate re-tune updates them here with new evidence.
 *
 * Both adjacent persona steps are checked head to head in the field
 * matchup and at the mixed table the app actually deals, and both table
 * steps are checked for the human (Cautious > Schemer > Daring tables).
 *
 * The Schemer-vs-Daring table step became checkable with #2234: Daring's
 * moon commitment moved the human's win share at its table from 23.9% to
 * 19.3% (it was +1.5pp, too small for an SPRT within the cap).
 *
 * History: before #2555 (Cautious noise 25%) the ladder was inverted at the
 * bottom — Cautious was the strongest persona (field +2.75pp over Schemer)
 * and the all-Cautious table the hardest for the human (21.9% vs 25.5%).
 */
export const SEPARATION_CHECKS: readonly SeparationCheck[] = [
  {
    kind: "separation",
    id: "field:daring-over-schemer",
    description: "Daring outwins Schemer in the same seat, cards and field",
    left: winShare("field-schemer", "daring"),
    right: winShare("field-schemer", "schemer"),
    expected: 0.045,
  },
  {
    kind: "separation",
    id: "field:schemer-over-cautious",
    description: "Schemer outwins Cautious in the same seat, cards and field",
    left: winShare("field-schemer", "schemer"),
    right: winShare("field-schemer", "cautious"),
    expected: 0.039,
  },
  {
    kind: "separation",
    id: "mixed:daring-over-schemer",
    description: "at the mixed table, Daring outwins Schemer",
    left: winShare("table-mixed", "daring"),
    right: winShare("table-mixed", "schemer"),
    expected: 0.072,
  },
  {
    kind: "separation",
    id: "mixed:schemer-over-cautious",
    description: "at the mixed table, Schemer outwins Cautious",
    left: winShare("table-mixed", "schemer"),
    right: winShare("table-mixed", "cautious"),
    expected: 0.038,
  },
  {
    kind: "separation",
    id: "presets:cautious-table-easier-than-schemer",
    description: "the human wins more at the Cautious table than at the Schemer table",
    left: winShare("table-cautious", "proxy"),
    right: winShare("table-schemer", "proxy"),
    expected: 0.025,
  },
  {
    kind: "separation",
    id: "presets:schemer-table-easier-than-daring",
    description: "the human wins more at the Schemer table than at the Daring table",
    left: winShare("table-schemer", "proxy"),
    right: winShare("table-daring", "proxy"),
    expected: 0.04,
  },
];

export const GATE_CHECKS: readonly GateCheck[] = [...REGRESSION_CHECKS, ...SEPARATION_CHECKS];

export const FAMILY_ALPHA = 0.05;
export const BETA = 0.05;
/** Per-check α after Bonferroni over the whole gate. */
export const CHECK_ALPHA = FAMILY_ALPHA / GATE_CHECKS.length;

export function checkRefs(check: GateCheck): MetricRef[] {
  return check.kind === "regression" ? [check.ref] : [check.left, check.right];
}

/** The group whose matchups a check reads (gate.test.ts: exactly one). */
export function groupOf(check: GateCheck): string {
  const matchups = new Set(checkRefs(check).map((r) => r.matchup));
  const groups = Object.entries(GATE_GROUPS)
    .filter(([, g]) => [...matchups].every((m) => g.matchups.includes(m)))
    .map(([id]) => id);
  if (groups.length !== 1) throw new Error(`check ${check.id} must read exactly one group`);
  return groups[0]!;
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

export interface BaselineEntry {
  readonly value: number;
  readonly num: number;
  readonly den: number;
  readonly se: number;
}

export interface Baseline {
  readonly version: 1;
  /** Why the baseline was last regenerated (the behaviour change behind it). */
  readonly reason: string;
  readonly generated: string;
  readonly seed: number;
  readonly blocks: Readonly<Record<string, number>>;
  readonly metrics: Readonly<Record<string, BaselineEntry>>;
  /** Separation estimates at baseline time — informational, not read by the gate. */
  readonly separations: Readonly<Record<string, { readonly mean: number; readonly se: number }>>;
}

export const BASELINE = baselineJson as Baseline;

/** Seeds: the gate and the baseline use disjoint deal streams. */
export const GATE_SEED = 2238;
export const BASELINE_SEED = 0x42415345; // "BASE"

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export type Runs = Readonly<Record<string, readonly BlockRecord[]>>;

export interface CheckResult {
  readonly check: GateCheck;
  readonly status: CheckStatus;
  /** Decided by the block cap rather than an SPRT boundary. */
  readonly truncated: boolean;
  /** Bonferroni-adjusted CI (1 − CHECK_ALPHA). */
  readonly estimate: Estimate;
  /** What the check tested against: the baseline value or the expected separation. */
  readonly target: number;
  readonly sprt: readonly SprtResult[];
  /** Logged counts behind a regression check's rate. */
  readonly num?: number;
  readonly den?: number;
  readonly note?: string;
}

function refObservations(runs: Runs, ref: MetricRef) {
  return observations(runs[ref.matchup] ?? [], ref.role, METRICS[ref.metric]);
}

export function evaluateCheck(
  check: GateCheck,
  runs: Runs,
  baseline: Baseline,
  final: boolean
): CheckResult {
  if (check.kind === "regression") {
    const entry = baseline.metrics[refKey(check.ref)];
    if (!entry) throw new Error(`baseline.json has no entry for ${refKey(check.ref)}`);
    const obs = refObservations(runs, check.ref);
    const est = ratioEstimate(obs, CHECK_ALPHA);
    const series = ratioSeries(obs);
    if (series.length === 0) {
      // Zero denominator: the behaviour the rate is conditioned on never happened.
      return {
        check,
        status: final ? "fail" : "continue",
        truncated: final,
        estimate: est,
        target: entry.value,
        sprt: [],
        num: est.num,
        den: est.den,
        note: "denominator is 0 — the conditioning event never occurred",
      };
    }
    const r = twoSidedSprt(series, entry.value, check.delta, CHECK_ALPHA, BETA, final);
    return {
      check,
      status: r.status,
      truncated: r.low.truncated || r.high.truncated,
      estimate: est,
      target: entry.value,
      sprt: [r.low, r.high],
      num: est.num,
      den: est.den,
    };
  }

  const series = differenceSeries(
    refObservations(runs, check.left),
    refObservations(runs, check.right)
  );
  const est = meanEstimate(series, CHECK_ALPHA);
  if (series.length === 0) {
    return {
      check,
      status: final ? "fail" : "continue",
      truncated: final,
      estimate: est,
      target: check.expected,
      sprt: [],
      note: "no observations on one side",
    };
  }
  const r = sprt(series, { mu0: check.expected, mu1: 0, alpha: CHECK_ALPHA, beta: BETA }, final);
  const status: CheckStatus =
    r.decision === "h1" ? "fail" : r.decision === "h0" ? "pass" : "continue";
  return {
    check,
    status,
    truncated: r.truncated,
    estimate: est,
    target: check.expected,
    sprt: [r],
  };
}

export interface GroupRun {
  readonly group: string;
  readonly seed: number;
  readonly blocks: number;
  readonly runs: Runs;
  readonly results: readonly CheckResult[];
}

export interface RunOptions {
  readonly seed?: number;
  /** Override the group's block cap (smoke runs). */
  readonly maxBlocks?: number;
  readonly minBlocks?: number;
  readonly lookEvery?: number;
  readonly baseline?: Baseline;
  /** Called after every look. */
  readonly onLook?: (blocks: number, results: readonly CheckResult[]) => void;
}

/**
 * The results after one more look: a check that has already reached a
 * decision keeps it (a sequential test stops at its boundary — testing it
 * again at later looks would inflate its error rates), and only undecided
 * checks are evaluated again.
 */
export function nextResults(
  checks: readonly GateCheck[],
  previous: readonly CheckResult[],
  evaluate: (check: GateCheck) => CheckResult
): CheckResult[] {
  return checks.map((check, i) => {
    const prior = previous[i];
    return prior && prior.status !== "continue" ? prior : evaluate(check);
  });
}

/**
 * Run one group sequentially: add `lookEvery` blocks to each matchup, then
 * evaluate every still-undecided check of the group; stop once all have
 * decided, or at the block cap (truncating the rest). Each check's decision
 * is final when reached. All matchups use the same seed, so block b of
 * every matchup replays the same deals.
 */
export function runGroup(groupId: string, options: RunOptions = {}): GroupRun {
  const group = GATE_GROUPS[groupId];
  if (!group) throw new Error(`unknown gate group ${groupId}`);
  const seed = options.seed ?? GATE_SEED;
  const baseline = options.baseline ?? BASELINE;
  const maxBlocks = options.maxBlocks ?? group.maxBlocks;
  const minBlocks = Math.min(options.minBlocks ?? group.minBlocks, maxBlocks);
  const lookEvery = options.lookEvery ?? group.lookEvery;
  // A cap below 1 would run no blocks and report an empty, passing gate.
  if (!(maxBlocks >= 1) || !(lookEvery >= 1)) {
    throw new RangeError(`runGroup: maxBlocks and lookEvery must be >= 1`);
  }
  const checks = GATE_CHECKS.filter((c) => groupOf(c) === groupId);

  const runs: Record<string, BlockRecord[]> = {};
  for (const id of group.matchups) runs[id] = [];
  let blocks = 0;
  let results: CheckResult[] = [];
  while (blocks < maxBlocks) {
    const step = Math.min(lookEvery, maxBlocks - blocks);
    for (const id of group.matchups)
      runs[id]!.push(...runBlocks(GATE_MATCHUPS[id]!, seed, blocks, step));
    blocks += step;
    if (blocks < minBlocks) continue;
    const final = blocks >= maxBlocks;
    results = nextResults(checks, results, (c) => evaluateCheck(c, runs, baseline, final));
    options.onLook?.(blocks, results);
    if (results.every((r) => r.status !== "continue")) break;
  }
  return { group: groupId, seed, blocks, runs, results };
}

/**
 * Measure a fresh baseline at a fixed sample size on the baseline seed:
 * every regression check's metric, plus the separation estimates for the
 * record. Run by `scripts/simulate-hearts.ts --update-baseline`.
 */
export function measureBaseline(
  reason: string,
  blocksOverride?: number,
  onGroup?: (group: string, blocks: number) => void
): Baseline {
  const metrics: Record<string, BaselineEntry> = {};
  const separations: Record<string, { mean: number; se: number }> = {};
  const blocks: Record<string, number> = {};
  for (const [groupId, group] of Object.entries(GATE_GROUPS)) {
    const n = blocksOverride ?? group.baselineBlocks;
    const runs: Record<string, BlockRecord[]> = {};
    for (const id of group.matchups) runs[id] = runBlocks(GATE_MATCHUPS[id]!, BASELINE_SEED, 0, n);
    blocks[groupId] = n;
    onGroup?.(groupId, n);
    for (const check of GATE_CHECKS) {
      if (groupOf(check) !== groupId) continue;
      if (check.kind === "regression") {
        const e = ratioEstimate(refObservations(runs, check.ref));
        metrics[refKey(check.ref)] = { value: e.mean, num: e.num, den: e.den, se: e.se };
      } else {
        const e = meanEstimate(
          differenceSeries(refObservations(runs, check.left), refObservations(runs, check.right))
        );
        separations[check.id] = { mean: e.mean, se: e.se };
      }
    }
  }
  return {
    version: 1,
    reason,
    generated: new Date().toISOString().slice(0, 10),
    seed: BASELINE_SEED,
    blocks,
    metrics,
    separations,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function fmt(x: number, percent: boolean): string {
  if (Number.isNaN(x)) return "n/a";
  return percent ? `${(x * 100).toFixed(2)}%` : x.toFixed(3);
}

function checkPercent(check: GateCheck): boolean {
  const ref = check.kind === "regression" ? check.ref : check.left;
  return METRICS[ref.metric].percent;
}

export function formatCheck(r: CheckResult): string {
  const pct = checkPercent(r.check);
  const e = r.estimate;
  const ci = `${fmt(e.mean, pct)} [${fmt(e.ciLow, pct)}, ${fmt(e.ciHigh, pct)}]`;
  const verdict = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "UNDECIDED";
  const trunc = r.truncated ? " (truncated at the block cap)" : ` (decided at ${e.blocks} blocks)`;
  const llr = r.sprt.map((s) => s.llr.toFixed(2)).join(" / ");
  if (r.check.kind === "regression") {
    const m = METRICS[r.check.ref.metric];
    return (
      `${verdict} ${r.check.id}${trunc}: ${ci} vs baseline ${fmt(r.target, pct)} ± δ ${fmt(r.check.delta, pct)}` +
      ` — ${m.description} = ${r.num?.toFixed(m.id === "win_share" ? 1 : 0)}/${r.den}` +
      ` — LLR low/high ${llr || "n/a"}${r.note ? ` — ${r.note}` : ""}`
    );
  }
  return (
    `${verdict} ${r.check.id}${trunc}: left − right ${ci}, pre-registered ${fmt(r.target, pct)}` +
    ` — ${r.check.description} — LLR ${llr || "n/a"}${r.note ? ` — ${r.note}` : ""}`
  );
}

export function formatGroupRun(run: GroupRun): string {
  const failed = run.results.filter((r) => r.status === "fail").length;
  const lines = [
    `=== Hearts sim gate — group ${run.group}: ${run.results.length - failed} passed, ${failed} failed ` +
      `after ${run.blocks} blocks (seed ${run.seed}; per-check α ${CHECK_ALPHA.toPrecision(3)}, β ${BETA}; ` +
      `CIs at ${((1 - CHECK_ALPHA) * 100).toFixed(2)}%) ===`,
    ...run.results.map(formatCheck),
  ];
  return lines.join("\n");
}

/** Every role × metric of a matchup's blocks, with logged counts (descriptive). */
export function describeMatchup(id: string, blocks: readonly BlockRecord[]): string {
  const roles = Object.keys(blocks[0]?.roles ?? {});
  const lines = [`--- ${id}: ${blocks.length} blocks ---`];
  for (const role of roles) {
    lines.push(`  ${role}`);
    for (const m of Object.values(METRICS)) {
      const e = ratioEstimate(observations(blocks, role, m));
      if (e.den === 0) {
        lines.push(`    ${m.id.padEnd(17)} n/a (0 = ${m.description.split(" | ")[1]})`);
        continue;
      }
      lines.push(
        `    ${m.id.padEnd(17)} ${fmt(e.mean, m.percent)} [${fmt(e.ciLow, m.percent)}, ${fmt(e.ciHigh, m.percent)}]` +
          `  ${e.num.toFixed(m.id === "win_share" ? 1 : 0)}/${e.den}  (${m.description})`
      );
    }
  }
  return lines.join("\n");
}

/**
 * Yacht calibration gate definition (#2245): which matchups run, how many
 * games each, and the bands their reports must satisfy. The single source
 * of truth for bands — `scripts/simulate-yacht.ts --gate` runs it, locally
 * and in .github/workflows/yacht-sim-gate.yml.
 *
 * These are REGRESSION bands, centred on the current AI as measured with
 * this harness on 2026-09-24 (numbers in the comments below). They catch a
 * change that moves the AI's strength; they don't assert the design
 * targets in #2157 (Easy ~160 / Medium ~215 / Hard ~245 mean score). The
 * current AI doesn't meet those — Hard and Medium are close to even — and
 * reshaping the tiers to meet them is #2246, which should re-centre these
 * bands when it lands.
 *
 * Sizing (details and the power calculation in docs/TESTING.md): the
 * per-block SD of a win rate or order effect is ~0.25, so 500 blocks
 * (2,000 games) gives a 95% CI of about ±2.2pp against ±5pp bands, and
 * 250 blocks of self-play gives about ±2.2pp on the first-mover rate.
 * Score floors sit ~2.5 CI half-widths below the observed means.
 */

import type { AiDifficulty } from "../types";
import { difference, formatEstimate, type Estimate, type MatchupReport } from "./stats";

export interface GateMatchup {
  readonly id: string;
  readonly a: AiDifficulty;
  readonly b: AiDifficulty;
  readonly seed: number;
  /** Default game count (a multiple of 4) — see the power notes on GATE_BANDS. */
  readonly games: number;
}

export const GATE_MATCHUPS: readonly GateMatchup[] = [
  { id: "hard-vs-easy", a: "hard", b: "easy", seed: 11, games: 2000 },
  { id: "hard-vs-medium", a: "hard", b: "medium", seed: 12, games: 2000 },
  { id: "easy-self", a: "easy", b: "easy", seed: 13, games: 1000 },
  { id: "medium-self", a: "medium", b: "medium", seed: 14, games: 1000 },
  { id: "hard-self", a: "hard", b: "hard", seed: 15, games: 1000 },
];

/**
 * Matchups that run together in one CI job (the workflow's matrix runs the
 * groups in parallel). A band may only read matchups from a single group,
 * so every group can be checked on its own — enforced by gate.test.ts.
 */
export const GATE_GROUPS: Readonly<Record<string, readonly string[]>> = {
  "hard-vs-easy": ["hard-vs-easy"],
  "hard-vs-medium": ["hard-vs-medium"],
  "self-play": ["easy-self", "medium-self", "hard-self"],
};

export function gateBlocks(matchup: GateMatchup): number {
  return Math.ceil(matchup.games / 4);
}

export type Reports = Readonly<Record<string, MatchupReport>>;

export interface Band {
  readonly id: string;
  readonly description: string;
  /** Matchup ids whose reports the metric reads; skipped if any is missing. */
  readonly matchups: readonly string[];
  readonly metric: (reports: Reports) => Estimate;
  readonly min?: number;
  readonly max?: number;
  /** Require mean > min rather than mean >= min (orderings). */
  readonly strictMin?: boolean;
  readonly percent?: boolean;
}

const report = (reports: Reports, id: string): MatchupReport => reports[id]!;
const a = (id: string) => (r: Reports) => report(r, id).players.a;
const b = (id: string) => (r: Reports) => report(r, id).players.b;
const pooled = (id: string) => (r: Reports) => report(r, id).players.pooled;

/** Win-rate and order-effect bands for an A-vs-B matchup (±5pp around the measured win rate). */
function matchupBands(id: string, winMin: number, winMax: number, note: string): Band[] {
  return [
    {
      id: `${id}:win-rate`,
      description: `${note}; ties count half, both turn orders`,
      matchups: [id],
      metric: (r) => report(r, id).aWinRate,
      min: winMin,
      max: winMax,
      percent: true,
    },
    {
      id: `${id}:order-effect`,
      description: "A's win rate moving first minus moving second (#2200-class artifacts)",
      matchups: [id],
      metric: (r) => report(r, id).orderEffect,
      min: -0.05,
      max: 0.05,
      percent: true,
    },
  ];
}

function firstMoverBand(id: string, measured: string): Band {
  return {
    id: `${id}:first-mover`,
    description: `self-play first-mover win rate (measured ${measured}; #2200)`,
    matchups: [id],
    metric: (r) => report(r, id).firstMoverWinRate,
    min: 0.45,
    max: 0.55,
    percent: true,
  };
}

/** `left` beats `right` on a self-play metric (difference of two independent runs > 0). */
function ordering(
  id: string,
  description: string,
  left: string,
  right: string,
  metric: (p: ReturnType<ReturnType<typeof pooled>>) => Estimate,
  percent = false
): Band {
  return {
    id,
    description,
    matchups: [left, right],
    metric: (r) => difference(metric(pooled(left)(r)), metric(pooled(right)(r))),
    min: 0,
    strictMin: true,
    percent,
  };
}

export const GATE_BANDS: readonly Band[] = [
  // hard-vs-easy — measured: Hard 61.9% [59.5, 64.4], order −0.1pp,
  // scores 202.6 / 182.0, bonus rates 46.6% / 5.0%.
  ...matchupBands("hard-vs-easy", 0.57, 0.67, "Hard beats Easy (measured 61.9%)"),
  {
    id: "hard-vs-easy:hard-score",
    description: "Hard's mean score (measured 202.6)",
    matchups: ["hard-vs-easy"],
    metric: (r) => a("hard-vs-easy")(r).meanScore,
    min: 195,
  },
  {
    id: "hard-vs-easy:easy-score",
    description: "Easy's mean score stays in its tier (measured 182.0)",
    matchups: ["hard-vs-easy"],
    metric: (r) => b("hard-vs-easy")(r).meanScore,
    min: 172,
    max: 192,
  },
  {
    id: "hard-vs-easy:hard-bonus",
    description: "Hard's upper-bonus rate (measured 46.6%)",
    matchups: ["hard-vs-easy"],
    metric: (r) => a("hard-vs-easy")(r).bonusRate,
    min: 0.4,
    percent: true,
  },
  {
    id: "hard-vs-easy:easy-bonus",
    description: "Easy's upper-bonus rate stays low (measured 5.0%)",
    matchups: ["hard-vs-easy"],
    metric: (r) => b("hard-vs-easy")(r).bonusRate,
    max: 0.1,
    percent: true,
  },

  // hard-vs-medium — measured: Hard 51.9% [49.7, 54.1], order −0.7pp,
  // Medium score 197.1, Medium bonus 37.1%.
  ...matchupBands("hard-vs-medium", 0.47, 0.57, "Hard vs Medium (measured 51.9%)"),
  {
    id: "hard-vs-medium:medium-score",
    description: "Medium's mean score (measured 197.1)",
    matchups: ["hard-vs-medium"],
    metric: (r) => b("hard-vs-medium")(r).meanScore,
    min: 190,
  },
  {
    id: "hard-vs-medium:medium-bonus",
    description: "Medium's upper-bonus rate (measured 37.1%)",
    matchups: ["hard-vs-medium"],
    metric: (r) => b("hard-vs-medium")(r).bonusRate,
    min: 0.3,
    max: 0.45,
    percent: true,
  },

  // self-play — measured first-mover rates: Easy 48.8%, Medium 50.8%,
  // Hard 48.3%. Pooled: scores 184.3 / 195.5 / 199.4, bonus 5.4% / 35.0% /
  // 42.6%, below-par fills 3.91 / 2.30 / 2.38.
  firstMoverBand("easy-self", "48.8%"),
  firstMoverBand("medium-self", "50.8%"),
  firstMoverBand("hard-self", "48.3%"),
  ordering(
    "order:medium-over-easy-score",
    "Medium outscores Easy (measured +11.2)",
    "medium-self",
    "easy-self",
    (p) => p.meanScore
  ),
  ordering(
    "order:medium-over-easy-bonus",
    "Medium makes the upper bonus more often than Easy (measured +29.6pp)",
    "medium-self",
    "easy-self",
    (p) => p.bonusRate,
    true
  ),
  ordering(
    "order:easy-over-medium-below-par",
    "Easy burns more upper boxes below par than Medium (measured +1.61)",
    "easy-self",
    "medium-self",
    (p) => p.belowParMean
  ),
  ordering(
    "order:hard-over-medium-bonus",
    "Hard makes the upper bonus more often than Medium (measured +7.6pp; the only " +
      "ordering that currently separates Hard from Medium — see #2246)",
    "hard-self",
    "medium-self",
    (p) => p.bonusRate,
    true
  ),
];

export type BandStatus = "pass" | "fail" | "skipped";

export interface BandResult {
  readonly band: Band;
  readonly status: BandStatus;
  readonly estimate?: Estimate;
  /** The 95% CI crosses a bound, so this run can't tell pass from fail reliably. */
  readonly inconclusive: boolean;
  readonly message: string;
}

function boundsText(band: Band): string {
  const f = (x: number) => (band.percent ? `${(x * 100).toFixed(1)}%` : String(x));
  const lo = band.min === undefined ? "" : `${band.strictMin ? ">" : "≥"} ${f(band.min)}`;
  const hi = band.max === undefined ? "" : `≤ ${f(band.max)}`;
  return [lo, hi].filter(Boolean).join(" and ");
}

export function checkBand(band: Band, reports: Reports): BandResult {
  const missing = band.matchups.filter((id) => !reports[id]);
  if (missing.length) {
    return {
      band,
      status: "skipped",
      inconclusive: false,
      message: `SKIP ${band.id}: needs ${missing.join(", ")}`,
    };
  }
  const est = band.metric(reports);
  const aboveMin =
    band.min === undefined || (band.strictMin ? est.mean > band.min : est.mean >= band.min);
  const belowMax = band.max === undefined || est.mean <= band.max;
  const pass = aboveMin && belowMax;
  const inconclusive =
    (band.min !== undefined && est.ciLow < band.min && est.ciHigh > band.min) ||
    (band.max !== undefined && est.ciLow < band.max && est.ciHigh > band.max);
  const observed = formatEstimate(est, band.percent);
  const message =
    `${pass ? "PASS" : "FAIL"} ${band.id}: observed ${observed} (95% CI), ` +
    `band ${boundsText(band)} — ${band.description}` +
    (inconclusive ? " [CI crosses the bound: inconclusive at this sample size]" : "");
  return { band, status: pass ? "pass" : "fail", estimate: est, inconclusive, message };
}

export function checkBands(reports: Reports, bands: readonly Band[] = GATE_BANDS): BandResult[] {
  return bands.map((band) => checkBand(band, reports));
}

export function formatBandResults(results: readonly BandResult[]): string {
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const header =
    `=== Yacht calibration gate: ${results.length - failed - skipped} passed, ` +
    `${failed} failed, ${skipped} skipped ===`;
  return [header, ...results.map((r) => r.message)].join("\n");
}

/** Re-exported so band metrics can compare separate matchup runs. */
export { difference };

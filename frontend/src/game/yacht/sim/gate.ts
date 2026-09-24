/**
 * Yacht calibration gate definition (#2245): which matchups run, how many
 * games each, and the bands their reports must satisfy. The single source
 * of truth for bands — `scripts/simulate-yacht.ts --gate` runs it, locally
 * and in .github/workflows/yacht-sim-gate.yml.
 *
 * The bands encode the tier design from #2246 (ai.ts): mean scores around
 * the #2157 targets — Easy ~160, Medium ~215, Hard ~250 (near-optimal;
 * perfect play is ~254.5) — and a strictly ordered ladder. Win-rate and
 * bonus bands are centred on the values measured on 2026-09-24 (in the
 * comments below), so they also catch drift inside a tier.
 *
 * The tiers ignore the opponent entirely, so each player's game depends only
 * on their own dice and noise streams: the order effect is exactly 0 and the
 * first-mover rate exactly 50%. Those bands stay as a guard in case an
 * opponent-aware layer (#2200-class risk) is ever added.
 *
 * Sizing (details and the power calculation in docs/TESTING.md): 500 blocks
 * (2,000 games) gives a win-rate 95% CI of about ±1.6–2.4pp against ±5pp
 * bands; mean-score CIs are ±2.4–4.9 points against ±10-point bands.
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

/** A tier's pooled self-play mean score (the tiers are opponent-blind, so this is its solitaire score). */
function tierScoreBand(id: string, min: number, max: number, note: string): Band {
  return {
    id: `${id}:score`,
    description: note,
    matchups: [id],
    metric: (r) => pooled(id)(r).meanScore,
    min,
    max,
  };
}

export const GATE_BANDS: readonly Band[] = [
  // hard-vs-easy — measured: Hard 92.3% [90.7, 93.9], order 0,
  // scores 249.6 / 163.9, bonus rates 65.4% / 0.6%.
  ...matchupBands("hard-vs-easy", 0.87, 0.97, "Hard beats Easy (measured 92.3%)"),
  {
    id: "hard-vs-easy:hard-bonus",
    description: "Hard's upper-bonus rate (measured 65.4%)",
    matchups: ["hard-vs-easy"],
    metric: (r) => a("hard-vs-easy")(r).bonusRate,
    min: 0.58,
    percent: true,
  },
  {
    id: "hard-vs-easy:easy-bonus",
    description: "Easy almost never plans for the upper bonus (measured 0.6%)",
    matchups: ["hard-vs-easy"],
    metric: (r) => b("hard-vs-easy")(r).bonusRate,
    max: 0.05,
    percent: true,
  },

  // hard-vs-medium — measured: Hard 71.9% [69.4, 74.3], order 0,
  // scores 251.6 / 215.6, Medium bonus 16.5%.
  ...matchupBands("hard-vs-medium", 0.67, 0.77, "Hard beats Medium (measured 71.9%)"),
  {
    id: "hard-vs-medium:medium-bonus",
    description: "Medium's upper-bonus rate (measured 16.5%)",
    matchups: ["hard-vs-medium"],
    metric: (r) => b("hard-vs-medium")(r).bonusRate,
    min: 0.1,
    max: 0.23,
    percent: true,
  },

  // self-play — measured pooled scores 161.6 / 211.8 / 245.2, bonus
  // 0.6% / 13.4% / 63.0%, below-par fills 5.12 / 4.05 / 2.14.
  tierScoreBand("easy-self", 150, 172, "Easy's mean score, target ~160 (measured 161.6)"),
  tierScoreBand("medium-self", 205, 225, "Medium's mean score, target ~215 (measured 211.8)"),
  tierScoreBand("hard-self", 240, 260, "Hard's mean score, target ~250 (measured 245.2)"),
  firstMoverBand("easy-self", "50.0%"),
  firstMoverBand("medium-self", "50.0%"),
  firstMoverBand("hard-self", "50.0%"),
  ordering(
    "order:hard-over-medium-score",
    "Hard outscores Medium (measured +33.4)",
    "hard-self",
    "medium-self",
    (p) => p.meanScore
  ),
  ordering(
    "order:medium-over-easy-score",
    "Medium outscores Easy (measured +50.2)",
    "medium-self",
    "easy-self",
    (p) => p.meanScore
  ),
  ordering(
    "order:hard-over-medium-bonus",
    "Hard makes the upper bonus more often than Medium (measured +49.6pp)",
    "hard-self",
    "medium-self",
    (p) => p.bonusRate,
    true
  ),
  ordering(
    "order:medium-over-easy-bonus",
    "Medium makes the upper bonus more often than Easy (measured +12.8pp)",
    "medium-self",
    "easy-self",
    (p) => p.bonusRate,
    true
  ),
  ordering(
    "order:easy-over-medium-below-par",
    "Easy burns more upper boxes below par than Medium (measured +1.07)",
    "easy-self",
    "medium-self",
    (p) => p.belowParMean
  ),
  ordering(
    "order:medium-over-hard-below-par",
    "Medium burns more upper boxes below par than Hard (measured +1.91)",
    "medium-self",
    "hard-self",
    (p) => p.belowParMean
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

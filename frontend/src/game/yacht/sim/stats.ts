/**
 * Statistics for Yacht simulation runs (#2245).
 *
 * The statistical unit is the four-game block from `harness.ts`, not the
 * single game: games inside a paired block share dice, so they are not
 * independent, but blocks are. Every estimate is a mean of per-block
 * values with a Student-t 95% CI over blocks. In paired mode the block
 * mean has much lower variance than a single game because the dice luck
 * cancels, so the CI is narrower for the same number of games; in
 * independent mode it reduces to the ordinary binomial/mean CI.
 */

import { CATEGORIES, type Category } from "../engine";
import { studentTCritical95 } from "../oracle/regretAggregate";
import type { BlockRecord, DiceMode, GameRecord, MatchupRun, PlayerResult } from "./harness";

export interface Estimate {
  readonly mean: number;
  /** Standard error of the mean. */
  readonly se: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  /** Number of independent units (blocks) behind the estimate. */
  readonly n: number;
}

export interface CategoryStats {
  readonly meanScore: number;
  /** Fraction of games where the category was scored above zero. */
  readonly hitRate: number;
}

export interface PlayerStats {
  readonly label: string;
  readonly meanScore: Estimate;
  /** Game-level standard deviation of final score (descriptive). */
  readonly scoreSd: number;
  readonly bonusRate: Estimate;
  readonly upperMean: Estimate;
  readonly belowParMean: Estimate;
  readonly categories: Readonly<Record<Category, CategoryStats>>;
}

export interface MatchupReport {
  readonly a: string;
  readonly b: string;
  readonly mode: DiceMode;
  readonly seed: number;
  readonly blocks: number;
  readonly games: number;
  /** A's result, win = 1, tie = 0.5, loss = 0, over all games. */
  readonly aWinRate: Estimate;
  readonly aWinRateWhenFirst: Estimate;
  readonly aWinRateWhenSecond: Estimate;
  /** aWinRateWhenFirst − aWinRateWhenSecond, paired within each block. */
  readonly orderEffect: Estimate;
  /** Result for whoever moved first, over all games (0.5 = no order effect). */
  readonly firstMoverWinRate: Estimate;
  readonly tieRate: number;
  readonly players: {
    readonly a: PlayerStats;
    readonly b: PlayerStats;
    /** Both seats pooled. Use for self-play, where A and B are the same policy. */
    readonly pooled: PlayerStats;
  };
}

/** Per-category par for the upper section (3 × face); below it is "below par". */
const UPPER_PAR: Readonly<Partial<Record<Category, number>>> = {
  ones: 3,
  twos: 6,
  threes: 9,
  fours: 12,
  fives: 15,
  sixes: 18,
};

export function estimate(values: readonly number[]): Estimate {
  const n = values.length;
  if (n === 0) return { mean: 0, se: 0, ciLow: 0, ciHigh: 0, n: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (n < 2) return { mean, se: 0, ciLow: mean, ciHigh: mean, n };
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  const half = studentTCritical95(n - 1) * se;
  return { mean, se, ciLow: mean - half, ciHigh: mean + half, n };
}

/** Difference of two independent estimates (e.g. two separate matchup runs). */
export function difference(left: Estimate, right: Estimate): Estimate {
  const mean = left.mean - right.mean;
  const se = Math.sqrt(left.se ** 2 + right.se ** 2);
  const n = Math.min(left.n, right.n);
  const half = (n >= 2 ? studentTCritical95(n - 1) : 0) * se;
  return { mean, se, ciLow: mean - half, ciHigh: mean + half, n };
}

/** A's result in one game: 1 win, 0.5 tie, 0 loss. */
export function aOutcome(game: GameRecord): number {
  if (game.a.score > game.b.score) return 1;
  if (game.a.score < game.b.score) return 0;
  return 0.5;
}

export function belowParFills(player: PlayerResult): number {
  let n = 0;
  for (const cat of CATEGORIES) {
    const par = UPPER_PAR[cat];
    if (par !== undefined && player.categories[cat] < par) n++;
  }
  return n;
}

function avg(values: readonly number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function playerStats(
  label: string,
  blocks: readonly BlockRecord[],
  pick: (game: GameRecord) => readonly PlayerResult[]
): PlayerStats {
  const perBlock = (metric: (p: PlayerResult) => number) =>
    estimate(blocks.map((blk) => avg(blk.games.flatMap((g) => pick(g).map(metric)))));

  const all = blocks.flatMap((blk) => blk.games.flatMap(pick));
  const scores = all.map((p) => p.score);
  const scoreMean = avg(scores);
  const scoreSd =
    scores.length > 1
      ? Math.sqrt(scores.reduce((s, v) => s + (v - scoreMean) ** 2, 0) / (scores.length - 1))
      : 0;

  const categories = {} as Record<Category, CategoryStats>;
  for (const cat of CATEGORIES) {
    const values = all.map((p) => p.categories[cat]);
    categories[cat] = {
      meanScore: avg(values),
      hitRate: avg(values.map((v) => (v > 0 ? 1 : 0))),
    };
  }

  return {
    label,
    meanScore: perBlock((p) => p.score),
    scoreSd,
    bonusRate: perBlock((p) => (p.bonus ? 1 : 0)),
    upperMean: perBlock((p) => p.upperSubtotal),
    belowParMean: perBlock(belowParFills),
    categories,
  };
}

export function summarize(run: MatchupRun): MatchupReport {
  const { blocks } = run;
  const firstGames = (blk: BlockRecord) => blk.games.filter((g) => g.aFirst);
  const secondGames = (blk: BlockRecord) => blk.games.filter((g) => !g.aFirst);

  const aWin = blocks.map((blk) => avg(blk.games.map(aOutcome)));
  const aFirst = blocks.map((blk) => avg(firstGames(blk).map(aOutcome)));
  const aSecond = blocks.map((blk) => avg(secondGames(blk).map(aOutcome)));
  const order = aFirst.map((v, i) => v - aSecond[i]!);
  const firstMover = aFirst.map((v, i) => (v + (1 - aSecond[i]!)) / 2);

  const allGames = blocks.flatMap((blk) => blk.games);
  const ties = allGames.filter((g) => g.a.score === g.b.score).length;

  return {
    a: run.a,
    b: run.b,
    mode: run.mode,
    seed: run.seed,
    blocks: blocks.length,
    games: allGames.length,
    aWinRate: estimate(aWin),
    aWinRateWhenFirst: estimate(aFirst),
    aWinRateWhenSecond: estimate(aSecond),
    orderEffect: estimate(order),
    firstMoverWinRate: estimate(firstMover),
    tieRate: allGames.length ? ties / allGames.length : 0,
    players: {
      a: playerStats(run.a, blocks, (g) => [g.a]),
      b: playerStats(run.b, blocks, (g) => [g.b]),
      pooled: playerStats(`${run.a}+${run.b}`, blocks, (g) => [g.a, g.b]),
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function formatEstimate(e: Estimate, asPercent = false): string {
  const f = asPercent ? pct : (x: number) => x.toFixed(2);
  return `${f(e.mean)} [${f(e.ciLow)}, ${f(e.ciHigh)}]`;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

export function formatReport(report: MatchupReport): string {
  const { a, b } = report.players;
  const lines: string[] = [];
  lines.push(
    `=== ${report.a} (A) vs ${report.b} (B) — ${report.mode} dice, ` +
      `${report.blocks} blocks × 4 = ${report.games} games, seed ${report.seed} ===`
  );
  lines.push("Values are mean [95% CI over blocks]; ties count as half a win.");
  lines.push(`A win rate           ${formatEstimate(report.aWinRate, true)}`);
  lines.push(`  A moving first     ${formatEstimate(report.aWinRateWhenFirst, true)}`);
  lines.push(`  A moving second    ${formatEstimate(report.aWinRateWhenSecond, true)}`);
  lines.push(`  order effect (1st−2nd) ${formatEstimate(report.orderEffect, true)}`);
  lines.push(`First-mover win rate ${formatEstimate(report.firstMoverWinRate, true)}`);
  lines.push(`Tie rate             ${pct(report.tieRate)}`);
  lines.push("");
  const w = 22;
  const row = (name: string, va: string, vb: string) => `${pad(name, w)}${pad(va, 30)}${vb}`;
  lines.push(row("", `A: ${a.label}`, `B: ${b.label}`));
  lines.push(row("mean score", formatEstimate(a.meanScore), formatEstimate(b.meanScore)));
  lines.push(row("score SD", a.scoreSd.toFixed(1), b.scoreSd.toFixed(1)));
  lines.push(
    row("upper bonus rate", formatEstimate(a.bonusRate, true), formatEstimate(b.bonusRate, true))
  );
  lines.push(row("upper subtotal", formatEstimate(a.upperMean), formatEstimate(b.upperMean)));
  lines.push(
    row("below-par upper fills", formatEstimate(a.belowParMean), formatEstimate(b.belowParMean))
  );
  lines.push("");
  lines.push(row("category (mean / hit%)", "A", "B"));
  for (const cat of CATEGORIES) {
    const ca = a.categories[cat];
    const cb = b.categories[cat];
    const cell = (c: CategoryStats) => `${c.meanScore.toFixed(1)} / ${pct(c.hitRate)}`;
    lines.push(row(`  ${cat}`, cell(ca), cell(cb)));
  }
  return lines.join("\n");
}

/**
 * Per-wave score ledger (#2837).
 *
 * Every point the engine awards goes through `award` / `addScore` here, so a finished run can
 * say where its score came from, wave by wave. The ledger lives on `StarSwarmState`
 * (`scoreLedger`), so it is saved and restored with a paused run and never counts a point
 * twice. `summarizeScoreLedger` turns it into the compact `score_breakdown` block of the
 * completed result (backend `StarSwarmScoreBreakdown`).
 *
 * Sources are keyed by the engine's own enemy tier id (`e.tier`), plus an optional modifier:
 * `"<tier>"` (a shot kill in formation), `"<tier>:dive"` (a shot kill of a diving or circling
 * ship, 2×), `"<tier>:rout"` (a shot kill of a fleeing grunt, 2×), `"<tier>:bomb"` (a Smart
 * Bomb kill), `"<tier>:ram"` (a diver that rammed the ship), and `"clear"` (the wave-clear
 * bonus). Keying by the tier id means a renamed tier (e.g. Boss → Guardian) needs no change
 * here, and readers must treat the source set as open.
 *
 * Bounded twice: the ledger keeps at most `LEDGER_DETAIL_WAVES` waves in detail and folds
 * older ones into one `earlier` bucket, and the summary folds further until its JSON fits
 * `BREAKDOWN_MAX_BYTES` — well inside the backend's 8 KiB result limit.
 */

import type { EnemyTier, StarSwarmState } from "./types";

/** Points by source. */
export type ScorePoints = Record<string, number>;

export interface WaveScore {
  readonly wave: number;
  readonly pts: Readonly<ScorePoints>;
}

/** Waves folded out of the detailed list: `first`..`last` inclusive, points summed. */
export interface EarlierScore {
  readonly first: number;
  readonly last: number;
  readonly pts: Readonly<ScorePoints>;
}

export interface ScoreLedger {
  /** Waves that scored, ascending by wave number; at most LEDGER_DETAIL_WAVES. */
  readonly waves: readonly WaveScore[];
  /** Everything folded out of `waves`, or null while nothing has been. */
  readonly earlier: EarlierScore | null;
}

export type KillModifier = "dive" | "rout" | "bomb" | "ram";

/** The wave-clear bonus source. */
export const WAVE_CLEAR_SOURCE = "clear";
/** Waves the ledger keeps in detail; older ones fold into `earlier`. */
export const LEDGER_DETAIL_WAVES = 20;
/** Serialized size cap for the `score_breakdown` block (backend result limit is 8192). */
export const BREAKDOWN_MAX_BYTES = 4096;
export const BREAKDOWN_VERSION = 1;

export function emptyScoreLedger(): ScoreLedger {
  return { waves: [], earlier: null };
}

/** The source key for a kill of `tier`, with an optional modifier. */
export function scoreSource(tier: EnemyTier, mod?: KillModifier): string {
  return mod ? `${tier}:${mod}` : tier;
}

/** Adds `points` to `awards[source]` (a per-tick collector) and returns `points`. */
export function award(awards: ScorePoints, source: string, points: number): number {
  if (points !== 0) awards[source] = (awards[source] ?? 0) + points;
  return points;
}

function addPts(into: ScorePoints, from: Readonly<ScorePoints>): ScorePoints {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
  return into;
}

function sumPts(pts: Readonly<ScorePoints>): number {
  let total = 0;
  for (const v of Object.values(pts)) total += v;
  return total;
}

function foldOldest(ledger: ScoreLedger, count: number): ScoreLedger {
  const folded = ledger.waves.slice(0, Math.max(0, count));
  const head = folded[0];
  const tail = folded[folded.length - 1];
  if (!head || !tail) return ledger;
  const pts: ScorePoints = addPts({}, ledger.earlier?.pts ?? {});
  for (const w of folded) addPts(pts, w.pts);
  return {
    waves: ledger.waves.slice(folded.length),
    earlier: { first: ledger.earlier?.first ?? head.wave, last: tail.wave, pts },
  };
}

/** The ledger with this tick's `awards` credited to `wave`. Returns `ledger` if there were none. */
export function recordScore(
  ledger: ScoreLedger,
  wave: number,
  awards: Readonly<ScorePoints>
): ScoreLedger {
  if (Object.keys(awards).length === 0) return ledger;
  const last = ledger.waves[ledger.waves.length - 1];
  let waves: WaveScore[];
  if (last && last.wave === wave) {
    waves = [...ledger.waves.slice(0, -1), { wave, pts: addPts({ ...last.pts }, awards) }];
  } else {
    waves = [...ledger.waves, { wave, pts: addPts({}, awards) }];
  }
  const next: ScoreLedger = { waves, earlier: ledger.earlier };
  return foldOldest(next, waves.length - LEDGER_DETAIL_WAVES);
}

/** Commits a tick's collected awards to the state's ledger (score is already updated). */
export function commitAwards(state: StarSwarmState, awards: Readonly<ScorePoints>): StarSwarmState {
  const scoreLedger = recordScore(state.scoreLedger, state.wave, awards);
  return scoreLedger === state.scoreLedger ? state : { ...state, scoreLedger };
}

/** Adds `points` from `source` to both the score and the ledger, credited to the current wave. */
export function addScore(state: StarSwarmState, source: string, points: number): StarSwarmState {
  if (points === 0) return state;
  return {
    ...state,
    score: state.score + points,
    scoreLedger: recordScore(state.scoreLedger, state.wave, { [source]: points }),
  };
}

// ---------------------------------------------------------------------------
// Result summary
// ---------------------------------------------------------------------------

export interface WaveBreakdown {
  readonly wave: number;
  readonly start: number;
  readonly end: number;
  readonly total: number;
  readonly pts: ScorePoints;
}

export interface EarlierBreakdown {
  readonly first: number;
  readonly last: number;
  readonly total: number;
  readonly pts: ScorePoints;
}

/**
 * The `score_breakdown` result block. The run starts at 0; waves that scored nothing are
 * absent. `earlier.total` + every `waves[].total` + `unattributed` = the final score, and each
 * wave's `start` is the score before it (`end` = `start` + `total`).
 */
export interface ScoreBreakdown {
  readonly v: number;
  readonly earlier?: EarlierBreakdown;
  readonly waves: WaveBreakdown[];
  /** Final score minus everything the ledger saw; present only when not 0. */
  readonly unattributed?: number;
}

function build(ledger: ScoreLedger, finalScore: number): ScoreBreakdown {
  let running = 0;
  let earlier: EarlierBreakdown | undefined;
  if (ledger.earlier) {
    const total = sumPts(ledger.earlier.pts);
    earlier = {
      first: ledger.earlier.first,
      last: ledger.earlier.last,
      total,
      pts: { ...ledger.earlier.pts },
    };
    running = total;
  }
  const waves = ledger.waves.map((w) => {
    const total = sumPts(w.pts);
    const start = running;
    running += total;
    return { wave: w.wave, start, end: running, total, pts: { ...w.pts } };
  });
  const unattributed = finalScore - running;
  return {
    v: BREAKDOWN_VERSION,
    ...(earlier ? { earlier } : {}),
    waves,
    ...(unattributed !== 0 ? { unattributed } : {}),
  };
}

/** The ledger as a result block, folded until it fits BREAKDOWN_MAX_BYTES. */
export function summarizeScoreLedger(ledger: ScoreLedger, finalScore: number): ScoreBreakdown {
  let l = ledger;
  let summary = build(l, finalScore);
  while (JSON.stringify(summary).length > BREAKDOWN_MAX_BYTES && l.waves.length > 0) {
    l = foldOldest(l, 1);
    summary = build(l, finalScore);
  }
  return summary;
}

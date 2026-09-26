/**
 * #2491: roll a finished run's counters into one Sentry breadcrumb so real play data comes back
 * for tuning. Counts only — no identifiers, no free text from the player. The screen calls
 * `reportRunStats` once per run at game over; the breadcrumb builder is pure so tests can pin
 * its shape without a Sentry client.
 */
import * as Sentry from "@sentry/react-native";
import { dodgeRateByTier } from "./engine";
import type { EnemyTier, StarSwarmState } from "./types";

export const RUN_STATS_BREADCRUMB = "starswarm.run_stats";

export interface RunStatsTierData {
  /** Effective dodge chance at this run's difficulty, rounded to 3 places. */
  readonly effective: number;
  readonly rolls: number;
  readonly dodged: number;
  readonly struck: number;
  readonly flak: number;
}

export interface RunStatsBreadcrumbData {
  readonly wave: number;
  readonly difficulty: StarSwarmState["difficulty"];
  readonly score: number;
  readonly reinforced: number;
  readonly armorDeflects: number;
  readonly beamHits: number;
  readonly routCaught: number;
  readonly routEscaped: number;
  readonly rocksSpawned: number;
  readonly rocksBrokenByPlayer: number;
  readonly rocksBrokenByEnemy: number;
  readonly tiers: Readonly<Record<EnemyTier, RunStatsTierData>>;
}

export function runStatsBreadcrumbData(state: StarSwarmState): RunStatsBreadcrumbData {
  const tiers = {} as Record<EnemyTier, RunStatsTierData>;
  for (const row of dodgeRateByTier(state)) {
    tiers[row.tier] = {
      effective: Math.round(row.effective * 1000) / 1000,
      rolls: row.rolls,
      dodged: row.dodged,
      struck: row.struck,
      flak: row.flak,
    };
  }
  return {
    wave: state.wave,
    difficulty: state.difficulty,
    score: state.score,
    ...state.runStats,
    tiers,
  };
}

export function reportRunStats(state: StarSwarmState): void {
  Sentry.addBreadcrumb({
    category: RUN_STATS_BREADCRUMB,
    message: "run ended",
    level: "info",
    data: runStatsBreadcrumbData(state),
  });
}

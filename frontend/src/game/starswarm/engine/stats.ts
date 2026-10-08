/**
 * Star Swarm engine — run statistics (#2988).
 *
 * The per-tier dodge/flak counters (#2487) and the run-wide counters (#2491) that the dev panel
 * and the `starswarm.run_stats` breadcrumb read, with their copy-on-write bump helpers. Both
 * carry across waves and reset on a new game.
 */
import type { EnemyTier, RunStats, StarSwarmState, TierStats } from "../types";
import { DODGE_BASE, DODGE_CAP, difficultyParamScale } from "./tuning";

// ---------------------------------------------------------------------------
// Enemy asteroid response (#2487)
// ---------------------------------------------------------------------------

export const ZERO_TIER_STATS: TierStats = {
  rolls: 0,
  dodged: 0,
  pathRolls: 0,
  pathDodged: 0,
  struck: 0,
  flak: 0,
};

export function emptyTierStats(): Record<EnemyTier, TierStats> {
  return {
    Grunt: ZERO_TIER_STATS,
    Elite: ZERO_TIER_STATS,
    Guardian: ZERO_TIER_STATS,
    Carrier: ZERO_TIER_STATS,
  };
}

export function bumpStat(
  stats: Record<EnemyTier, TierStats>,
  tier: EnemyTier,
  patch: Partial<Record<keyof TierStats, number>>
): void {
  const cur = stats[tier];
  stats[tier] = {
    rolls: cur.rolls + (patch.rolls ?? 0),
    dodged: cur.dodged + (patch.dodged ?? 0),
    pathRolls: cur.pathRolls + (patch.pathRolls ?? 0),
    pathDodged: cur.pathDodged + (patch.pathDodged ?? 0),
    struck: cur.struck + (patch.struck ?? 0),
    flak: cur.flak + (patch.flak ?? 0),
  };
}

export const ZERO_RUN_STATS: RunStats = {
  reinforced: 0,
  armorDeflects: 0,
  beamHits: 0,
  routCaught: 0,
  routEscaped: 0,
  rocksSpawned: 0,
  rocksBrokenByPlayer: 0,
  rocksBrokenByEnemy: 0,
  buddyLaunched: 0, // #2845
  buddyLost: 0,
  buddyShotsDrawn: 0,
};

/** #2491: a fresh run's counters. */
export function emptyRunStats(): RunStats {
  return ZERO_RUN_STATS;
}

export function bumpRun(stats: RunStats, patch: Partial<Record<keyof RunStats, number>>): RunStats {
  const next = { ...stats };
  for (const key of Object.keys(patch) as (keyof RunStats)[]) {
    next[key] = stats[key] + (patch[key] ?? 0);
  }
  return next;
}

/** #2487: chance a ship of this tier sidesteps a rock — base × difficulty, capped. Carrier never rolls. */
export function dodgeChance(tier: EnemyTier, paramScale: number): number {
  return Math.min(DODGE_CAP, DODGE_BASE[tier] * paramScale);
}

export const TIER_ORDER: readonly EnemyTier[] = ["Grunt", "Elite", "Guardian", "Carrier"];

/** #2491: one dev-panel row per tier — the configured dodge odds next to what actually happened. */
export interface TierDodgeRow {
  readonly tier: EnemyTier;
  /** Base dodge chance for the tier (before difficulty). */
  readonly base: number;
  /** Effective dodge chance at this run's difficulty (base × paramScale, capped). */
  readonly effective: number;
  readonly rolls: number;
  readonly dodged: number;
  readonly struck: number;
  readonly flak: number;
}

/** #2491: pure selector over `state.tierStats` — used by the dev panel and the breadcrumb. */
export function dodgeRateByTier(state: StarSwarmState): TierDodgeRow[] {
  const paramScale = difficultyParamScale(state.difficulty);
  return TIER_ORDER.map((tier) => {
    const t = state.tierStats[tier];
    return {
      tier,
      base: DODGE_BASE[tier],
      effective: dodgeChance(tier, paramScale),
      rolls: t.rolls,
      dodged: t.dodged,
      struck: t.struck,
      flak: t.flak,
    };
  });
}

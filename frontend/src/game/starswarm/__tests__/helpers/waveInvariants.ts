/**
 * The per-wave stats invariants (#3252), shared by `waveStats.invariants.test.ts` (seeded runs at
 * every difficulty tier) and `goldenReplay.test.ts` (the seed-42 replay's closed waves). Not a
 * test file. See docs/games/starswarm.md#per-wave-stats.
 */
import {
  ASTEROID_KINDS,
  BUDDY_HIT_CAUSES,
  ENEMY_TIERS,
  HIT_CAUSES,
  HIT_RESULTS,
  POWERUP_SOURCES,
  POWERUP_TYPES,
  emptyWaveStats,
  type WaveStats,
  type WaveStatsSnapshot,
  type WaveStatsWire,
} from "../../engine";
import type { StarSwarmState } from "../../types";

export const sumOf = <K extends string>(
  keys: readonly K[],
  t: Readonly<Record<K, number>>
): number => keys.reduce((n, k) => n + t[k], 0);

/** Lives a wave's hits cost. */
export const lifeHits = (w: WaveStats): number =>
  HIT_CAUSES.reduce((t, c) => t + w.damage.hits[c].life, 0);

/** Every key of `template`, from `v` where it has one (a sparse wire table), else the template's. */
function fill(template: unknown, v: unknown): unknown {
  if (template === null || typeof template !== "object") return v ?? template;
  const src = (v ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, t] of Object.entries(template)) out[k] = fill(t, src[k]);
  return out;
}

/** The dense snapshot a `wave_completed` wire payload came from (a left-out counter is 0). */
export function fromWire(wire: WaveStatsWire): WaveStatsSnapshot {
  const dense = fill(emptyWaveStats(wire.pacing.start), wire) as WaveStats;
  return {
    ...dense,
    v: wire.v,
    wave: wire.wave,
    difficulty: wire.difficulty,
    outcome: wire.outcome,
    pacing: wire.pacing,
    score: wire.score,
  };
}

/**
 * What must hold inside any wave, open or closed: the paired counters agree across sections, and
 * the rout and shot counts stay in bounds.
 */
export function expectPairedCounters(w: WaveStats): void {
  for (const r of HIT_RESULTS) expect(w.rocks.playerHits[r]).toBe(w.damage.hits.rock[r]);
  expect(w.rocks.buddyHits).toBe(w.buddy.hits.rock);
  expect(w.rocks.buddyDestroyed).toBe(w.buddy.destroyed.rock);
  for (const tier of ENEMY_TIERS) {
    expect(w.rocks.enemiesDestroyed[tier]).toBe(w.combat.kills[tier].rock);
    expect(w.buddy.kills[tier]).toBe(w.combat.kills[tier].buddy);
  }
  for (const c of BUDDY_HIT_CAUSES) {
    expect(w.buddy.destroyed[c]).toBeLessThanOrEqual(w.buddy.hits[c]);
  }
  expect(w.carrier.gruntsLaunched).toBeLessThanOrEqual(w.combat.spawned.Grunt);
  expect(w.combat.shotsHit).toBeLessThanOrEqual(w.combat.shotsFired);
  expect(w.rout.caught + w.rout.escaped).toBeLessThanOrEqual(w.rout.grunts);
  // a fleeing grunt shot down is a `rout` kill and is caught; a bombed one is caught as a `bomb`
  expect(w.combat.kills.Grunt.rout).toBeLessThanOrEqual(w.rout.caught);
  if (w.rout.grunts > 0) expect(w.rout.triggered).toBe(true);
}

/**
 * What must hold for a closed wave: the paired counters, power-up conservation per type, and —
 * with `lives` (off when the caller topped the lives up outside the engine) — the lives it lost.
 */
export function expectClosedWave(w: WaveStatsSnapshot, { lives = true } = {}): void {
  expectPairedCounters(w);
  for (const type of POWERUP_TYPES) {
    const p = w.powerUps;
    expect(`${type} ${sumOf(POWERUP_SOURCES, p.spawned[type])}`).toBe(
      `${type} ${p.collected[type] + p.missed[type] + p.leftover[type]}`
    );
  }
  if (lives) {
    expect(w.pacing.start.lives - lifeHits(w) + w.pacing.bonusLives).toBe(w.pacing.end.lives);
  }
}

/**
 * Σ over every wave of a run (`waves`: each one from the run's first, the open one included) =
 * the run-wide `RunStats` / `TierStats` at `end`, for every counter they share.
 */
export function expectRunTotals(waves: readonly WaveStats[], end: StarSwarmState): void {
  const sum = (f: (w: WaveStats) => number) => waves.reduce((t, w) => t + f(w), 0);
  expect({
    reinforced: sum((w) => w.carrier.gruntsLaunched),
    armorDeflects: sum((w) => w.carrier.armorDeflects),
    beamHits: sum((w) => w.carrier.beamHits),
    routCaught: sum((w) => w.rout.caught),
    routEscaped: sum((w) => w.rout.escaped),
    rocksSpawned: sum((w) => sumOf(ASTEROID_KINDS, w.rocks.spawned)),
    rocksBrokenByPlayer: sum((w) => w.rocks.broken.player),
    rocksBrokenByEnemy: sum((w) => w.rocks.broken.enemy),
    buddyLaunched: sum((w) => w.buddy.launched),
    buddyLost: sum((w) => sumOf(BUDDY_HIT_CAUSES, w.buddy.destroyed)),
    buddyShotsDrawn: sum((w) => w.buddy.shotsDrawn),
  }).toEqual(end.runStats);
  for (const tier of ENEMY_TIERS) {
    expect({
      tier,
      rolls: sum((w) => w.rocks.dodge[tier].rolls),
      dodged: sum((w) => w.rocks.dodge[tier].dodged),
      pathRolls: sum((w) => w.rocks.dodge[tier].pathRolls),
      pathDodged: sum((w) => w.rocks.dodge[tier].pathDodged),
      struck: sum((w) => w.rocks.enemiesStruck[tier]),
      flak: sum((w) => w.rocks.dodge[tier].flak),
    }).toEqual({ tier, ...end.tierStats[tier] });
  }
}

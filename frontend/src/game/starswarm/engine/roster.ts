/**
 * Star Swarm engine — roster reads and the per-tick context (#2988).
 *
 * Pure questions about `state.enemies`: which tiers are leaders, whether the Carrier is armored
 * and what stage it is in (#2484, #2843), plus `TickCtx` (#2963) — the alive-roster tallies
 * `tick()` derives once and hands to the sub-ticks — and the identity-preserving `mapKeep` /
 * `mapFilterKeep` passes every sub-tick uses so an unchanged array stays the same object (the
 * renderer's `sameFrame` gate relies on it).
 */
import type { CarrierStage, Enemy, EnemyTier, StarSwarmState } from "../types";
import { difficultyParamScale, isBossWave } from "./tuning";

/** #2484: Guardian and Carrier sit out the Grunt/Elite "non-leader" thresholds (35% / ≤3 remaining). */
export function isLeaderTier(tier: EnemyTier): boolean {
  return tier === "Guardian" || tier === "Carrier";
}

export function carrierArmoredIn(enemies: readonly Enemy[]): boolean {
  return enemies.some((e) => e.isAlive && e.tier === "Guardian");
}

/**
 * #2484: the Carrier is armored while any of its four Guardian escorts is alive. Ordinary player
 * shots are spent on the force field (ring plays, no damage); only armor-piercing shots
 * (Lightning, #2845) go through — Buddy's piercing burst does not.
 * False when there is no live Carrier, so renderers can key an indicator off this alone.
 */
export function isCarrierArmored(state: StarSwarmState): boolean {
  return (
    state.enemies.some((e) => e.isAlive && e.tier === "Carrier") && carrierArmoredIn(state.enemies)
  );
}

/**
 * #2484: true on the exact tick the Carrier's armor drops — its last Guardian escort died while the
 * Carrier itself is still alive. A Carrier killed *through* its armor (piercing shots) also stops
 * reading as armored, but nothing was exposed, so that edge is excluded. Shared by both renderers
 * so the announcement can't drift between native and web.
 */
export function carrierJustExposed(prev: StarSwarmState, next: StarSwarmState): boolean {
  const carrierAlive = next.enemies.some((e) => e.isAlive && e.tier === "Carrier");
  return carrierAlive && isCarrierArmored(prev) && !isCarrierArmored(next);
}

export const STAGE_RANK: Readonly<Record<CarrierStage, number>> = {
  protected: 0,
  exposed: 1,
  finalStand: 2,
};

/** #2843: the stage of the Carrier in this roster; null when no Carrier is alive. */
export function carrierStageIn(enemies: readonly Enemy[]): CarrierStage | null {
  if (!enemies.some((e) => e.isAlive && e.tier === "Carrier")) return null;
  if (carrierArmoredIn(enemies)) return "protected";
  // a fleeing grunt has left the fight — it doesn't hold the Carrier out of its final stand
  const others = enemies.some((e) => e.isAlive && e.tier !== "Carrier" && e.phase !== "Fleeing");
  return others ? "exposed" : "finalStand";
}

/**
 * #2843: the Carrier's live aggression stage (see CarrierStage), or null with no Carrier alive.
 * Exposed begins the moment the last Guardian dies; final stand once nothing else meaningful
 * is left. The stage only ever escalates within a wave.
 */
export function carrierStage(state: StarSwarmState): CarrierStage | null {
  return carrierStageIn(state.enemies);
}

/**
 * #2843: true on the tick the Carrier's final stand begins after its armor was already down.
 * A boss wave's lone Carrier goes from protected straight to final stand on the last Guardian
 * kill; that tick is announced as the armor drop (`carrierJustExposed`) instead, not twice.
 */
export function carrierFinalStandJustStarted(prev: StarSwarmState, next: StarSwarmState): boolean {
  return (
    next.wave === prev.wave &&
    carrierStage(prev) === "exposed" &&
    carrierStage(next) === "finalStand"
  );
}

/**
 * #2963: what several sub-ticks need to know about the tick's starting roster and settings,
 * derived in one pass in `tick()` instead of each sub-tick re-walking `enemies`.
 *
 * `alive` and `armored` describe the roster as the tick began. They are shared only with the
 * sub-ticks that run before anything can change who is alive, their tier or their phase:
 * `tickPlayer` never touches enemies and `tickAsteroidThreats` only adjusts timers, dodges and
 * paths, so `tickAsteroidThreats` and the opening checks of `tickEnemies` see exactly this
 * roster. Everything after `tickEnemies` (kills, reinforcements, routs) re-derives from its own
 * state, as before.
 */
export interface TickCtx {
  readonly alive: AliveRoster;
  /** `difficultyParamScale(state.difficulty)` — the difficulty never changes mid-tick. */
  readonly paramScale: number;
  /** `isBossWave(state.wave)` — the wave changes only in `checkPhaseTransitions`, last. */
  readonly bossWave: boolean;
  /** `carrierArmoredIn(roster)`: a Guardian escort is alive. */
  readonly armored: boolean;
}

/** #2963: alive-roster tallies, one pass over `enemies`. */
export interface AliveRoster {
  /** Alive Grunts and Elites (`!isLeaderTier`). */
  readonly nonLeader: number;
  /** Alive ships other than the Carrier. */
  readonly nonCarrier: number;
  readonly grunts: number;
  readonly nonGrunts: number;
  /** Alive ships other than the Carrier that are not fleeing (they hold off its final stand). */
  readonly holdouts: number;
  /** Index of the first alive Carrier (what `enemies.find` would return), or -1. */
  readonly carrierIdx: number;
}

export function tickCtx(state: StarSwarmState): TickCtx {
  let nonLeader = 0;
  let nonCarrier = 0;
  let grunts = 0;
  let holdouts = 0;
  let guardians = 0;
  let alive = 0;
  let carrierIdx = -1;
  const { enemies } = state;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i]!;
    if (!e.isAlive) continue;
    alive++;
    if (e.tier === "Carrier") {
      if (carrierIdx < 0) carrierIdx = i;
      continue;
    }
    nonCarrier++;
    if (e.phase !== "Fleeing") holdouts++;
    if (e.tier === "Guardian") guardians++;
    else nonLeader++;
    if (e.tier === "Grunt") grunts++;
  }
  return {
    alive: { nonLeader, nonCarrier, grunts, nonGrunts: alive - grunts, holdouts, carrierIdx },
    paramScale: difficultyParamScale(state.difficulty),
    bossWave: isBossWave(state.wave),
    armored: guardians > 0,
  };
}

/** #2963: `carrierStageIn` for the roster `ctx` was derived from. */
export function carrierStageOf(ctx: TickCtx): CarrierStage | null {
  if (ctx.alive.carrierIdx < 0) return null;
  if (ctx.armored) return "protected";
  return ctx.alive.holdouts > 0 ? "exposed" : "finalStand";
}

/** #2963: `arr.map(fn)`, handing back `arr` itself when `fn` returned every element unchanged. */
export function mapKeep<T>(arr: readonly T[], fn: (x: T) => T): readonly T[] {
  let out: T[] | null = null;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i]!;
    const y = fn(x);
    if (out) out.push(y);
    else if (y !== x) {
      out = arr.slice(0, i);
      out.push(y);
    }
  }
  return out ?? arr;
}

/**
 * #2963: `arr.map(fn).filter(keep)` in one pass, handing back `arr` itself when `fn` changed
 * nothing and `keep` dropped nothing (an empty list, every tick it is empty).
 */
export function mapFilterKeep<T>(
  arr: readonly T[],
  fn: (x: T) => T,
  keep: (x: T) => boolean
): readonly T[] {
  let out: T[] | null = null;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i]!;
    const y = fn(x);
    const kept = keep(y);
    if (out) {
      if (kept) out.push(y);
    } else if (y !== x || !kept) {
      out = arr.slice(0, i);
      if (kept) out.push(y);
    }
  }
  return out ?? arr;
}

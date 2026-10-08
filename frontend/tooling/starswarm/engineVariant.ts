/**
 * #2880 balance sim — a *sim-only* engine variant: the real Star Swarm engine with a tuning
 * override set injected (#2988).
 *
 * The engine's sweepable tunables are a `Tuning` object (`engine/tuning.ts`); `tick`,
 * `initStarSwarm` and `applyPowerUp` take one and default to `DEFAULT_TUNING`, the shipped game.
 * A variant is the engine module with those entry points bound to `DEFAULT_TUNING` plus the
 * overrides, and the overridden constants re-exported with their new values — no source is
 * read, patched or re-evaluated, and the rng and id counters are the real module's (the harness
 * seeds and restores them per run). An override naming something that is not a `Tuning` key
 * throws, so a prototype can never silently measure the unmodified engine. With no overrides the
 * variant is the real engine (a smoke test holds that it replays a seeded run identically).
 */
import * as realEngine from "../../src/game/starswarm/engine";
import type { Tuning } from "../../src/game/starswarm/engine";

export type Engine = typeof realEngine;

/** A tuning override set: `Tuning` key → replacement value. */
export type TuningOverrides = Readonly<Partial<Tuning>>;

/** A variant's spec is its overrides; an empty object is the shipped engine. */
export type EngineVariantSpec = TuningOverrides;

const cache = new Map<string, Engine>();

/** `DEFAULT_TUNING` with `spec` applied; throws on a key that is not a tunable. */
export function resolveTuning(spec: EngineVariantSpec): Tuning {
  const base = realEngine.DEFAULT_TUNING;
  for (const key of Object.keys(spec)) {
    if (!(key in base)) throw new Error(`engineVariant: ${key} is not a Tuning key`);
  }
  return { ...base, ...spec };
}

/** The engine with `spec` applied, bound once. Cached per spec. */
export function loadEngineVariant(spec: EngineVariantSpec = {}): Engine {
  const key = JSON.stringify(spec, (_k, v: unknown) => (v === Infinity ? "Infinity" : v));
  const hit = cache.get(key);
  if (hit) return hit;
  const tuning = resolveTuning(spec);
  const bound = {
    ...realEngine,
    ...spec, // the overridden constants read back with their variant values (BUDDY_HP, …)
    DEFAULT_TUNING: tuning,
    tick: (...[state, dtMs, input, t = tuning]: Parameters<Engine["tick"]>) =>
      realEngine.tick(state, dtMs, input, t),
    initStarSwarm: (
      ...[canvasW, canvasH, wave, seed, difficulty, straggler, t = tuning]: Parameters<
        Engine["initStarSwarm"]
      >
    ) => realEngine.initStarSwarm(canvasW, canvasH, wave, seed, difficulty, straggler, t),
    applyPowerUp: (...[state, type, t = tuning]: Parameters<Engine["applyPowerUp"]>) =>
      realEngine.applyPowerUp(state, type, t),
  };
  // the module's constants have literal types (`BUDDY_HP: 9`); a variant widens the overridden
  // ones to their `Tuning` types, which is exactly what the harness reads them as
  const engine = bound as unknown as Engine;
  cache.set(key, engine);
  return engine;
}

/**
 * Cascade physics spike (#3696): the candidates, as `SimConfig`s for the sim harness.
 *
 *   current  production physics on the ported rules (bit-identical to `CascadeEngine`).
 *   A        Matter.js tuned: per-tier density (max mass ratio <= 10:1), merge grow-in, no
 *            restitution, more iterations, smaller slop, thick walls, no guard-rail teleports.
 *   B        planck.js (Box2D) with the same rules and the same density, grow-in and
 *            restitution as A.
 *
 * Each factory also keeps the engines it made (`engines`), so the spike CLI can read their
 * `stats` after a suite (the harness destroys an engine but its stats stay readable).
 */
import { TIERS, tierRadius } from "../../tiers";
import type { SimConfig } from "../config";
import { CandidateEngine, type BenchOptions, type CandidateTuning } from "./candidateEngine";
import { CURRENT_MATTER, createMatterBackend, type MatterTuning } from "./matterBackend";
import { createPlanckBackend, type PlanckTuning } from "./planckBackend";

/**
 * Density per tier for A and B: (r0 / r)^0.5, so mass grows as r^1.5. The ladder's radius ratio
 * capstone : cherry is 101 / 22 = 4.59, so the largest mass ratio on the board is
 * 4.59^1.5 = 9.8 : 1 (at density 1 it is 4.59^2 = 21 : 1).
 */
export const DENSITY_EXPONENT = 0.5;
export function tunedDensity(tier: number): number {
  return (tierRadius(0) / tierRadius(tier)) ** DENSITY_EXPONENT;
}

/** Largest mass ratio between two tiers for a density rule (mass = density x r^2). */
export function maxMassRatio(density: (tier: number) => number): number {
  const masses = TIERS.map((t) => density(t.tier) * t.radius * t.radius);
  return Math.max(...masses) / Math.min(...masses);
}

export const GROW_IN_STEPS = 8;
/** A's and B's walls: 200 px thick outward, and 600 px above the canvas. */
const THICK = 200;
const ABOVE = 600;

export const CURRENT_TUNING: CandidateTuning = { growInSteps: 0, guardRail: "teleport" };
export const SPIKE_TUNING: CandidateTuning = { growInSteps: GROW_IN_STEPS, guardRail: "observe" };

export const MATTER_A: MatterTuning = {
  positionIterations: 20,
  velocityIterations: 12,
  slop: 0.01,
  restitution: 0,
  density: tunedDensity,
  boundaryThickness: THICK,
  wallsAbove: ABOVE,
};

export const PLANCK_B: PlanckTuning = {
  velocityIterations: 10,
  positionIterations: 8,
  restitution: 0,
  density: tunedDensity,
  boundaryThickness: THICK,
  wallsAbove: ABOVE,
};

export type CandidateId = "current" | "A" | "B";
export const CANDIDATE_IDS: readonly CandidateId[] = ["current", "A", "B"];

export interface CandidateOverrides {
  matter?: Partial<MatterTuning>;
  planck?: Partial<PlanckTuning>;
  tuning?: Partial<CandidateTuning>;
  bench?: BenchOptions;
}

export function makeCandidate(id: CandidateId, o: CandidateOverrides = {}): CandidateEngine {
  if (id === "B") {
    return new CandidateEngine(
      createPlanckBackend({ ...PLANCK_B, ...o.planck }),
      { ...SPIKE_TUNING, ...o.tuning },
      o.bench
    );
  }
  const base = id === "A" ? MATTER_A : CURRENT_MATTER;
  const tuning = id === "A" ? SPIKE_TUNING : CURRENT_TUNING;
  return new CandidateEngine(
    createMatterBackend({ ...base, ...o.matter }),
    { ...tuning, ...o.tuning },
    o.bench
  );
}

export interface CandidateConfig extends SimConfig {
  createEngine: () => CandidateEngine;
  engines: CandidateEngine[];
}

/** A `SimConfig` whose factory makes `id` and remembers every engine it made. */
export function candidateConfig(id: CandidateId, o: CandidateOverrides = {}): CandidateConfig {
  const engines: CandidateEngine[] = [];
  return {
    engines,
    createEngine: () => {
      const e = makeCandidate(id, o);
      engines.push(e);
      return e;
    },
  };
}

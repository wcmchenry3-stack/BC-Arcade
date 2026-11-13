/**
 * Cascade feel proposals (#3697, phase 1): three planck.js tunings for the owner to choose from.
 *
 * Each proposal is the spike's candidate B (planck.js, `../candidates/`) with its own physics
 * numbers, merge rules and difficulty (`./difficulty.ts`). They run behind the sim harness's seam
 * (`SimConfig`), so the same seeds, bots and metrics compare them with today's engine and with
 * the spike's B. `tools/sim/cascade-feel-proposals.ts` prints the comparison.
 *
 *   tight     high friction and rolling damping, 1.5x gravity, no merge pop, a 4-step grow-in:
 *             the calmest board and the quickest settle. It makes the fewest accidental merges,
 *             so its danger mode helps more (see `TIGHT`).
 *   balanced  today's friction, 1.25x gravity, a small merge pop, a 0.5 px merge gap.
 *   lively    low friction, some bounce (restitution 0.2), free rolling, today's gravity and
 *             pop, a 1.5 px merge gap: pieces shuffle into gaps and meet by accident more often.
 *
 * Common to all three: planck.js 1.4.2, density (r0 / r)^0.5, thick walls with an observing
 * guard rail (no teleports), merge grow-in from the parents' radius with the spawn clamped so
 * the full-size piece is inside the walls (#3697: grow-in pushed pieces into the walls), a chain
 * reach so a merge product touching a same-tier piece merges at once instead of after its
 * grow-in, and the eased difficulty `EASED`.
 *
 * Sim-only: nothing in the app imports this (it lives under `sim/`).
 */
import { CAPSTONE_TIER } from "../../tiers";
import type { SimConfig, SimConstants } from "../config";
import {
  CandidateEngine,
  type BenchOptions,
  type CandidateTuning,
} from "../candidates/candidateEngine";
import { PLANCK_B, SPIKE_TUNING, tunedDensity } from "../candidates/candidates";
import { createPlanckBackend, type PlanckTuning } from "../candidates/planckBackend";
import {
  PRODUCTION_DIFFICULTY,
  droppableTiers,
  ladderRadius,
  makeSelector,
  type Difficulty,
} from "./difficulty";

export interface Proposal {
  /** Shown in tables and clips. */
  label: string;
  planck: PlanckTuning;
  engine: CandidateTuning;
  difficulty: Difficulty;
}

/**
 * The spike's B with today's difficulty: the reference the proposals are measured against. Its
 * engine is the spike's (no grow-in clamp, no chain reach); only the planck pin differs (1.4.2).
 */
export const SPIKE_B: Proposal = {
  label: "B (spike)",
  planck: PLANCK_B,
  engine: SPIKE_TUNING,
  difficulty: PRODUCTION_DIFFICULTY,
};

const COMMON_ENGINE: CandidateTuning = {
  ...SPIKE_TUNING,
  growInClamp: true,
  emitWin: true,
};

/**
 * The difficulty all three share (#3697 goal: the capstone reachable in one session). Today a
 * Watermelon plus the staircase of smaller pieces the second one is built from (one piece of
 * each tier 0-10) cover about 53 % of the bin under the lid, and a pile packs at about 0.65.
 * Smaller radii on a flatter ladder (r0 16, r10 52: ratio 3.25 instead of 4) bring that to
 * about 21 %, and tier 5 joins the drops with the weights moved up the ladder, so a session
 * has enough material: 2048 Cherries make a capstone and a drop now carries about 9.8 of them
 * (3.8 today). The danger mode also favours the small tiers (x1.5) when the pile is near the
 * lid. Tier 5 (r 29) spawns with its top edge at y = 80 - 58 - 5 = 17, on the canvas.
 */
export const EASED: Difficulty = {
  ...PRODUCTION_DIFFICULTY,
  r0Px: 16,
  r10Px: 52,
  maxDroppableTier: 5,
  weights: { 0: 2, 1: 3, 2: 3, 3: 3, 4: 3, 5: 2 },
  dangerSmallBoost: 1.5,
};

export const TIGHT: Proposal = {
  label: "1 tight",
  planck: {
    ...PLANCK_B,
    friction: 0.8,
    angularDamping: 2,
    gravityScale: 1.5,
  },
  engine: {
    ...COMMON_ENGINE,
    growInSteps: 4,
    chainReachPx: 1,
    mergePopImpulse: 0,
    angularDamping: 0.3,
  },
  // The calm board makes the fewest accidental merges and fills up first: in danger it also
  // holds back tier 2 and offers the two smallest tiers twice as often.
  difficulty: { ...EASED, dangerTierThreshold: 2, dangerSmallBoost: 2 },
};

export const BALANCED: Proposal = {
  label: "2 balanced",
  planck: {
    ...PLANCK_B,
    friction: 0.5,
    gravityScale: 1.25,
  },
  engine: {
    ...COMMON_ENGINE,
    growInSteps: 6,
    chainReachPx: 1,
    mergeGapPx: 0.5,
    mergePopImpulse: 0.2,
    angularDamping: 0.2,
  },
  difficulty: EASED,
};

export const LIVELY: Proposal = {
  label: "3 lively",
  planck: {
    ...PLANCK_B,
    friction: 0.2,
    restitution: 0.2,
  },
  engine: {
    ...COMMON_ENGINE,
    growInSteps: 8,
    chainReachPx: 2,
    mergeGapPx: 1.5,
    mergePopImpulse: 0.4,
    angularDamping: 0,
  },
  // Its shuffling board survives mindless play so well that on `EASED` the spam bot outlived the
  // lid's 120 s bound in 6-10 % of games (#3694's gate): radii a little larger (r0 18, r10 56)
  // put its longest spam game back at 107 s, about where today's is (98-100 s).
  difficulty: { ...EASED, r0Px: 18, r10Px: 56 },
};

export type ProposalId = "B" | "tight" | "balanced" | "lively";
export const PROPOSALS: Readonly<Record<ProposalId, Proposal>> = {
  B: SPIKE_B,
  tight: TIGHT,
  balanced: BALANCED,
  lively: LIVELY,
};
export const PROPOSAL_IDS = Object.keys(PROPOSALS) as ProposalId[];

export interface ProposalOverrides {
  planck?: Partial<PlanckTuning>;
  engine?: Partial<CandidateTuning>;
  difficulty?: Partial<Difficulty>;
  bench?: BenchOptions;
}

/** The proposal with overrides applied (for ablations). */
export function resolveProposal(p: Proposal, o: ProposalOverrides = {}): Proposal {
  return {
    label: p.label,
    planck: { ...p.planck, ...o.planck },
    engine: { ...p.engine, ...o.engine },
    difficulty: { ...p.difficulty, ...o.difficulty },
  };
}

/** The sim constants a proposal's metrics need (its radii; everything else as today). */
export function proposalConstants(p: Proposal): Partial<SimConstants> {
  const r = ladderRadius(p.difficulty);
  return {
    physicsRadius: r,
    drawnRadius: r,
    maxTier: CAPSTONE_TIER,
    droppableTiers: droppableTiers(p.difficulty),
  };
}

export function makeProposalEngine(p: Proposal, bench?: BenchOptions): CandidateEngine {
  const radius = ladderRadius(p.difficulty);
  // Density follows the proposal's own radii: (r0 / r)^0.5, as in the spike.
  const density =
    p.planck.density === tunedDensity
      ? (t: number) => (radius(0) / radius(t)) ** 0.5
      : p.planck.density;
  return new CandidateEngine(
    createPlanckBackend({ ...p.planck, density }),
    { ...p.engine, radius },
    bench
  );
}

export interface ProposalConfig extends SimConfig {
  createEngine: () => CandidateEngine;
  engines: CandidateEngine[];
}

/** A `SimConfig` for the proposal; it remembers every engine it made (for their `stats`). */
export function proposalConfig(p: Proposal, o: ProposalOverrides = {}): ProposalConfig {
  const resolved = resolveProposal(p, o);
  const engines: CandidateEngine[] = [];
  return {
    engines,
    constants: proposalConstants(resolved),
    selectNextTier: makeSelector(resolved.difficulty),
    createEngine: () => {
      const e = makeProposalEngine(resolved, o.bench);
      engines.push(e);
      return e;
    },
  };
}

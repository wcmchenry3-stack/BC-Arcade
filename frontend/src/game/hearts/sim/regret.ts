/**
 * Hearts regret metric (#2239): per-decision points lost against the
 * perfect-information reference in `oracle.ts`, per persona.
 *
 * Win share mixes a persona's own play with its opponents'. Regret grades
 * each card play on its own — how many points worse (by the reference) the
 * chosen card was than the best one — so a persona can lose more points per
 * decision and still win more games, or the reverse. The two numbers come
 * from separate counters and are reported side by side.
 *
 * Runs on the harness's duplicate-deal blocks: in a field matchup every
 * persona plays the same cards, seats and opponents, so per-block
 * differences in regret are paired like the gate's win-share differences.
 *
 * Only card plays are graded; passes are not (a pass's value depends on the
 * whole hand that follows, which a single rollout can't score fairly).
 */

import { selectCardsToPass } from "../ai";
import { NOISE_RATE } from "../aiWeights";
import { getRng, setRng } from "../engine";
import { deriveSeed } from "../../_shared/simRandom";
import type { AiPersona, Card } from "../types";
import {
  addCounters,
  emptyCounters,
  fieldMatchup,
  personaPolicy,
  playGame,
  type BlockRecord,
  type HeartsPolicy,
  type Matchup,
  type Policies,
  type SeatCounters,
} from "./harness";
import { meanEstimate, type Estimate } from "./metrics";
import {
  DEFAULT_ORACLE_CONFIG,
  DEFAULT_REGRET_BANDS,
  REGRET_BANDS,
  decisionRegret,
  evaluatePlays,
  type OracleConfig,
  type RegretBand,
  type RegretBands,
} from "./oracle";

const SAMPLE_TAG = 0x53414d50; // "SAMP"

export interface RegretTally {
  /** Card plays graded. */
  decisions: number;
  /** Summed regret over those plays, in points. */
  regret: number;
  /** Hands in which this role's plays were graded (sampling-adjusted, see `RegretOptions`). */
  hands: number;
  bands: Record<RegretBand, number>;
  /** Of the graded plays, those the persona's noise picked at random (ai.ts NOISE_RATE). */
  noiseDecisions: number;
  /** Summed regret over the noise plays. */
  noiseRegret: number;
}

export function emptyTally(): RegretTally {
  return {
    decisions: 0,
    regret: 0,
    hands: 0,
    bands: { optimal: 0, minor: 0, mistake: 0, blunder: 0 },
    noiseDecisions: 0,
    noiseRegret: 0,
  };
}

export function addTally(into: RegretTally, from: RegretTally): void {
  into.decisions += from.decisions;
  into.regret += from.regret;
  into.hands += from.hands;
  into.noiseDecisions += from.noiseDecisions;
  into.noiseRegret += from.noiseRegret;
  for (const b of REGRET_BANDS) into.bands[b] += from.bands[b];
}

export interface RegretOptions {
  /** Roles whose plays are graded (default: every role but `field`). */
  readonly graded?: ReadonlySet<string>;
  /**
   * Grade about one play in `sampleEvery` (default 1 = every play), picked
   * pseudo-randomly per play — a fixed stride would lock onto the same trick
   * of every hand when it divides 13. Points lost per 100 hands is scaled
   * back up by the same factor.
   */
  readonly sampleEvery?: number;
  readonly bands?: RegretBands;
  readonly oracle?: OracleConfig;
}

/**
 * Wrap a persona policy so each play records whether its noise fired. ai.ts
 * draws `rng() < NOISE_RATE[persona]` once per play (after any forced-card
 * early return), so the play's first draw from the engine RNG decides it.
 * The draws pass straight through: the game is unchanged.
 */
function tagNoise(policy: HeartsPolicy, onTag: (noise: boolean) => void): HeartsPolicy {
  const rate = policy.persona ? NOISE_RATE[policy.persona] : 0;
  if (rate <= 0) return policy;
  return {
    ...policy,
    play: (hand, trick, state, seat) => {
      const inner = getRng();
      let first: number | undefined;
      setRng(() => {
        const v = inner();
        first ??= v;
        return v;
      });
      try {
        return policy.play(hand, trick, state, seat);
      } finally {
        setRng(inner);
        onTag(first !== undefined && first < rate);
      }
    },
  };
}

/**
 * Whether a seat's `play`-th card play of a game is graded: about one in
 * `every`, picked by hash rather than a fixed stride (see `sampleEvery`).
 */
export function sampled(
  every: number,
  seed: number,
  block: number,
  lineup: number,
  seat: number,
  play: number
): boolean {
  return every <= 1 || deriveSeed(SAMPLE_TAG, seed, block, lineup, seat, play) % every === 0;
}

export interface RegretBlock extends BlockRecord {
  readonly regret: Readonly<Record<string, RegretTally>>;
}

/** One duplicate-deal block of a matchup, with the graded roles' plays scored. */
export function runRegretBlock(
  matchup: Matchup,
  seed: number,
  block: number,
  options: RegretOptions = {}
): RegretBlock {
  const every = Math.max(1, Math.floor(options.sampleEvery ?? 1));
  const bands = options.bands ?? DEFAULT_REGRET_BANDS;
  const oracle = options.oracle ?? DEFAULT_ORACLE_CONFIG;
  const roles: Record<string, SeatCounters> = {};
  const regret: Record<string, RegretTally> = {};
  matchup.lineups.forEach((lineup, lineupIndex) => {
    const graded = lineup.roles.map((r) =>
      options.graded ? options.graded.has(r) : r !== "field"
    );
    const seen = [0, 0, 0, 0];
    let noise = false;
    const policies = lineup.policies.map((p, seat) =>
      graded[seat] ? tagNoise(p, (n) => (noise = n)) : p
    ) as unknown as Policies;
    const game = playGame(policies, seed, block, {
      onPlay: (state, seat, card) => {
        const wasNoise = noise;
        noise = false;
        if (!graded[seat]) return;
        const play = seen[seat]!++;
        if (!sampled(every, seed, block, lineupIndex, seat, play)) return;
        const r = decisionRegret(state, card, bands, oracle);
        const t = (regret[lineup.roles[seat]!] ??= emptyTally());
        t.decisions++;
        t.regret += r.regret;
        t.bands[r.band]++;
        if (wasNoise) {
          t.noiseDecisions++;
          t.noiseRegret += r.regret;
        }
      },
    });
    game.seats.forEach((counters, seat) => {
      addCounters((roles[lineup.roles[seat]!] ??= emptyCounters()), counters);
      if (graded[seat])
        (regret[lineup.roles[seat]!] ??= emptyTally()).hands += counters.handsPlayed;
    });
  });
  return { index: block, roles, regret };
}

export function runRegretBlocks(
  matchup: Matchup,
  seed: number,
  from: number,
  count: number,
  options: RegretOptions = {}
): RegretBlock[] {
  const out: RegretBlock[] = [];
  for (let b = from; b < from + count; b++) out.push(runRegretBlock(matchup, seed, b, options));
  return out;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/** Which plays a points-lost figure counts: all of them, only noise, or only deliberate ones. */
export type RegretPart = "all" | "noise" | "deliberate";

/** Points lost per 100 hands, scaled up for sampling. */
export function pointsLostPer100(
  t: RegretTally,
  sampleEvery = 1,
  part: RegretPart = "all"
): number {
  const lost =
    part === "all" ? t.regret : part === "noise" ? t.noiseRegret : t.regret - t.noiseRegret;
  return t.hands > 0 ? (100 * lost * sampleEvery) / t.hands : 0;
}

export interface RoleRegret {
  readonly role: string;
  readonly decisions: number;
  /** Mean regret per graded play, in points. */
  readonly perDecision: number;
  readonly per100Hands: number;
  /** Share of graded plays in each band. */
  readonly bandShares: Readonly<Record<RegretBand, number>>;
  /** Share of graded plays that were noise. */
  readonly noiseShare: number;
  /** Mean regret of a noise play, and of a deliberate (non-noise) play. */
  readonly perNoiseDecision: number;
  readonly perDeliberateDecision: number;
  /** Points lost per 100 hands to noise plays alone. */
  readonly noisePer100Hands: number;
  /** Outcome, from the harness's own counters: share of games won. */
  readonly winShare: number;
}

export function summarizeRole(
  blocks: readonly RegretBlock[],
  role: string,
  sampleEvery = 1
): RoleRegret {
  const t = emptyTally();
  const c = emptyCounters();
  for (const b of blocks) {
    const r = b.regret[role];
    if (r) addTally(t, r);
    const k = b.roles[role];
    if (k) addCounters(c, k);
  }
  const shares = {} as Record<RegretBand, number>;
  for (const band of REGRET_BANDS) shares[band] = t.decisions > 0 ? t.bands[band] / t.decisions : 0;
  return {
    role,
    decisions: t.decisions,
    perDecision: t.decisions > 0 ? t.regret / t.decisions : 0,
    per100Hands: pointsLostPer100(t, sampleEvery),
    bandShares: shares,
    noiseShare: t.decisions > 0 ? t.noiseDecisions / t.decisions : 0,
    perNoiseDecision: t.noiseDecisions > 0 ? t.noiseRegret / t.noiseDecisions : 0,
    perDeliberateDecision:
      t.decisions > t.noiseDecisions
        ? (t.regret - t.noiseRegret) / (t.decisions - t.noiseDecisions)
        : 0,
    noisePer100Hands: pointsLostPer100(t, sampleEvery, "noise"),
    winShare: c.seatGames > 0 ? c.winShare / c.seatGames : 0,
  };
}

/**
 * left − right in points lost per 100 hands, paired by block: each block's
 * difference is one observation, so shared deals cancel as in the gate.
 */
export function regretDifference(
  blocks: readonly RegretBlock[],
  left: string,
  right: string,
  sampleEvery = 1,
  part: RegretPart = "all"
): Estimate {
  const series = blocks.map((b) => {
    const l = b.regret[left] ?? emptyTally();
    const r = b.regret[right] ?? emptyTally();
    return pointsLostPer100(l, sampleEvery, part) - pointsLostPer100(r, sampleEvery, part);
  });
  return meanEstimate(series);
}

/**
 * A player that cheats: it sees every hand and plays the reference's best
 * card. Not a product feature — it checks that the reference is stronger
 * than the personas it grades (docs/TESTING.md). Passes like Schemer.
 */
export function oraclePolicy(
  label = "oracle",
  config: OracleConfig = DEFAULT_ORACLE_CONFIG
): HeartsPolicy {
  return {
    label,
    pass: (hand, direction, _state, seat) => selectCardsToPass(hand, direction, "schemer", seat),
    play: (_hand, _trick, state): Card => {
      const values = evaluatePlays(state, config);
      return values.reduce((b, v) => (v.cost < b.cost ? v : b)).card;
    },
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export const REGRET_PERSONAS: readonly AiPersona[] = ["cautious", "schemer", "daring"];

/**
 * The regret report's matchup: each persona (and, with `withOracle`, the
 * cheating reference player) takes the test seat against a Schemer field,
 * on the same deals.
 */
export function regretMatchup(withOracle = false): Matchup {
  const tests: HeartsPolicy[] = REGRET_PERSONAS.map((p) => personaPolicy(p));
  if (withOracle) tests.push(oraclePolicy());
  return fieldMatchup("regret", personaPolicy("schemer"), tests);
}

export interface LadderStep {
  readonly left: AiPersona;
  readonly right: AiPersona;
  readonly part: RegretPart;
  /** left − right points lost per 100 hands, paired by block. */
  readonly estimate: Estimate;
  /** The step goes the expected way: left loses more, beyond the 95% interval. */
  readonly holds: boolean;
}

/**
 * The noise-ladder sanity check (#2239): Cautious (the noisiest persona, NOISE_RATE) should lose
 * more points than Schemer (10%), and Schemer more than Daring (0%) — both
 * in total and on noise plays alone.
 */
export function noiseLadder(blocks: readonly RegretBlock[], sampleEvery = 1): LadderStep[] {
  const steps: LadderStep[] = [];
  for (const part of ["all", "noise"] as const) {
    for (let i = 0; i + 1 < REGRET_PERSONAS.length; i++) {
      const left = REGRET_PERSONAS[i]!;
      const right = REGRET_PERSONAS[i + 1]!;
      const estimate = regretDifference(blocks, left, right, sampleEvery, part);
      steps.push({ left, right, part, estimate, holds: estimate.ciLow > 0 });
    }
  }
  return steps;
}

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

export function formatRegretReport(
  blocks: readonly RegretBlock[],
  roles: readonly string[],
  sampleEvery = 1
): string {
  const lines = [
    `role      plays   lost/100 hands   per play   noise plays (mean)   deliberate   optimal / minor / mistake / blunder   win share`,
  ];
  for (const role of roles) {
    const r = summarizeRole(blocks, role, sampleEvery);
    const b = r.bandShares;
    lines.push(
      [
        role.padEnd(9),
        String(r.decisions).padStart(6),
        r.per100Hands.toFixed(0).padStart(16),
        r.perDecision.toFixed(3).padStart(10),
        `${pct(r.noiseShare)} (${r.perNoiseDecision.toFixed(2)})`.padStart(20),
        r.perDeliberateDecision.toFixed(3).padStart(12),
        `${pct(b.optimal)} / ${pct(b.minor)} / ${pct(b.mistake)} / ${pct(b.blunder)}`.padStart(38),
        pct(r.winShare).padStart(11),
      ].join(" ")
    );
  }
  lines.push("", "Noise ladder (points lost per 100 hands, paired by block, 95% CI):");
  for (const s of noiseLadder(blocks, sampleEvery)) {
    const e = s.estimate;
    lines.push(
      `  ${s.part.padEnd(5)} ${s.left} − ${s.right}: ${e.mean.toFixed(0)} [${e.ciLow.toFixed(0)}, ${e.ciHigh.toFixed(0)}] ${s.holds ? "holds" : "NOT shown"}`
    );
  }
  return lines.join("\n");
}

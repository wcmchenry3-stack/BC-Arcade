/**
 * #2880 balance sim — engine variants (sim-only tuning overrides and behaviour prototypes) and
 * the run presets the runner knows. Nothing here changes the shipped engine: a variant is a
 * `Tuning` override set (data), applied by engineVariant.ts to the real engine's entry points.
 */
import * as realEngine from "../../src/game/starswarm/engine";
import type { BuddyTargeting } from "../../src/game/starswarm/engine";
import { DEFAULT_TUNING, type Tuning } from "../../src/game/starswarm/engine/tuning";
import type { DifficultyTier, EnemyTier } from "../../src/game/starswarm/types";
import { PILOTS, SCENARIOS, type PilotConfig, type Scenario } from "./balance";
import { loadEngineVariant, type Engine, type EngineVariantSpec } from "./engineVariant";

// ---------------------------------------------------------------------------
// Override helpers (each builds a `Tuning` value)
// ---------------------------------------------------------------------------

const BASE_TARGETING: Readonly<Record<EnemyTier, BuddyTargeting>> = {
  Grunt: { divert: 0.12, speed: 0.28, aimError: 0.22, lead: 0 },
  Elite: { divert: 0.25, speed: 0.35, aimError: 0.12, lead: 0.4 },
  Guardian: { divert: 0.4, speed: 0.46, aimError: 0.06, lead: 0.75 },
  Carrier: { divert: 0.55, speed: 0.52, aimError: 0.02, lead: 1 },
};

/** BUDDY_TARGETING with the Carrier row patched. */
function targeting(carrier: Partial<BuddyTargeting>): Tuning["BUDDY_TARGETING"] {
  return { ...BASE_TARGETING, Carrier: { ...BASE_TARGETING.Carrier, ...carrier } };
}

function notice(shot: number, beam: number, rock: number): Tuning["BUDDY_NOTICE"] {
  return { shot, beam, rock };
}

/** CARRIER_CADENCE with the twin-laser ranges scaled by `k` (the floor still applies). */
function twinCadence(k: number): Tuning["CARRIER_CADENCE"] {
  const r = (min: number, max: number) => ({ min: Math.round(min * k), max: Math.round(max * k) });
  return {
    beam: {
      protected: { min: 6000, max: 9000 },
      exposed: { min: 4000, max: 6500 },
      finalStand: { min: 2600, max: 4200 },
    },
    twin: { exposed: r(900, 1500), finalStand: r(600, 1000) },
    reinforce: { protected: { min: 6500, max: 10_000 }, exposed: { min: 5000, max: 8000 } },
    attackRun: { exposed: { min: 7000, max: 11_000 }, finalStand: { min: 4200, max: 7000 } },
  };
}

// ---------------------------------------------------------------------------
// Behaviour prototypes (the `Tuning` knobs that are no-ops in the shipped game)
// ---------------------------------------------------------------------------

/** Each Buddy shot is spent after hitting `n` ships (shipped: BUDDY_PIERCE_HITS; Infinity = the pre-#2880 unlimited pierce). */
function pierceCap(n: number): EngineVariantSpec {
  return { BUDDY_PIERCE_HITS: n };
}

/** The exposed Carrier aims its attack run at Buddy's column (when it would shoot at Buddy). */
const RUN_AT_BUDDY: EngineVariantSpec = { CARRIER_RUN_AT_BUDDY: true };

/**
 * The exposed Carrier slides its station toward an on-station Buddy at `speed` px/ms (and back
 * to centre once Buddy is gone), so its beam lane and twin fire follow Buddy instead of sitting
 * still while Buddy strafes underneath.
 */
function carrierTracksBuddy(speed: number): EngineVariantSpec {
  return { CARRIER_TRACK_BUDDY_SPEED: speed };
}

/** Each Buddy shot deals `dmg` (today 1) — fractional damage makes a 1-HP Grunt take two hits. */
function shotDamage(dmg: number): EngineVariantSpec {
  return { BUDDY_SHOT_DAMAGE: dmg };
}

/** Buddy notices shots aimed at it (a deliberate, leading shot) with `chance` instead of BUDDY_NOTICE.shot. */
function aimedNotice(chance: number): EngineVariantSpec {
  return { BUDDY_NOTICE_AIMED: chance };
}

/** Buddy's lane floor (today 40% of the canvas height) — lets a smaller standoff take effect. */
function laneFloor(frac: number): EngineVariantSpec {
  return { BUDDY_LANE_FLOOR: frac };
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export interface Variant {
  readonly name: string;
  /** Empty spec = the shipped engine (the runner then uses the real module). */
  readonly spec: EngineVariantSpec;
}

export const BASE: Variant = { name: "base", spec: {} };

/** A variant that overrides nothing is the shipped engine itself. */
export function isShipped(v: Variant): boolean {
  return Object.keys(v.spec).length === 0;
}

/** The real module's public surface plus its `DEFAULT_TUNING` (what an `Engine` carries). */
const SHIPPED_ENGINE: Engine = { ...realEngine, DEFAULT_TUNING };

/** The engine a variant runs on: the real module, or its sim-only tuned copy. */
export function engineFor(v: Variant): Engine {
  return isShipped(v) ? SHIPPED_ENGINE : loadEngineVariant(v.spec);
}

/**
 * The Buddy tuning before the #2880 rebalance (fan 5–7, unlimited pierce, 10 HP, 0.2 px/ms evade,
 * 140 ms replan, 0.8 notice for shots aimed at Buddy), as a sim-only override. The shipped engine
 * (BASE) carries the rebalanced values, so the investigation's sweeps and candidate search are
 * rebuilt as deltas on THIS, not on BASE: they reproduce the documented search.
 */
const LEGACY_CONSTS: EngineVariantSpec = {
  BUDDY_BULLET_COUNT_MIN: 5,
  BUDDY_BULLET_COUNT_MAX: 7,
  BUDDY_HP: 10,
  BUDDY_SPEED: 0.2,
  BUDDY_REPLAN_MS: 140,
};
const LEGACY_AIMED = 0.8;

interface LegacyDelta {
  consts?: EngineVariantSpec;
  /** Hits per Buddy shot (default Infinity: the pre-#2880 unlimited pierce). */
  pierce?: number;
  /** Notice chance for shots aimed at Buddy (default 0.8; a BUDDY_NOTICE override does not reach it). */
  aimed?: number;
  patches?: readonly EngineVariantSpec[];
}

/** The pre-#2880 Buddy with `d` applied on top. */
function legacy(name: string, d: LegacyDelta = {}): Variant {
  return {
    name,
    spec: {
      ...LEGACY_CONSTS,
      ...d.consts,
      ...pierceCap(d.pierce ?? Infinity),
      ...aimedNotice(d.aimed ?? LEGACY_AIMED),
      ...Object.assign({}, ...(d.patches ?? [])),
    },
  };
}

const LEGACY: Variant = legacy("legacy (pre-#2880)");

/** One-at-a-time sensitivity sweeps (#2880 candidates). */
export const SWEEPS: readonly Variant[] = [
  LEGACY,
  legacy("hp6", { consts: { BUDDY_HP: 6 } }),
  legacy("hp8", { consts: { BUDDY_HP: 8 } }),
  legacy("hp12", { consts: { BUDDY_HP: 12 } }),
  legacy("notice50", { consts: { BUDDY_NOTICE: notice(0.5, 0.6, 0.6) }, aimed: 0.5 }),
  legacy("noEvade", { consts: { BUDDY_NOTICE: notice(0, 0, 0) }, aimed: 0 }),
  legacy("evadeSpd0.1", { consts: { BUDDY_SPEED: 0.1 } }),
  legacy("replan300", { consts: { BUDDY_REPLAN_MS: 300 } }),
  legacy("maxIn5", { consts: { BUDDY_MAX_INCOMING: 5 } }),
  legacy("maxIn8", { consts: { BUDDY_MAX_INCOMING: 8 } }),
  legacy("divert30", { consts: { BUDDY_TARGETING: targeting({ divert: 0.3 }) } }),
  legacy("divert85", { consts: { BUDDY_TARGETING: targeting({ divert: 0.85 }) } }),
  legacy("divert100+maxIn8", {
    consts: { BUDDY_TARGETING: targeting({ divert: 1 }), BUDDY_MAX_INCOMING: 8 },
  }),
  legacy("twin×0.6", { consts: { CARRIER_CADENCE: twinCadence(0.6) } }),
  legacy("burst3", { consts: { BUDDY_BULLET_COUNT_MIN: 3, BUDDY_BULLET_COUNT_MAX: 3 } }),
  legacy("burst3-4", { consts: { BUDDY_BULLET_COUNT_MIN: 3, BUDDY_BULLET_COUNT_MAX: 4 } }),
  legacy("bursts2", { consts: { BUDDY_BURSTS: 2 } }),
  legacy("pierce2", { pierce: 2 }),
  legacy("standoff220", { consts: { BUDDY_STANDOFF: 220 } }),
  legacy("standoff90+lane.28", { consts: { BUDDY_STANDOFF: 90 }, patches: [laneFloor(0.28)] }),
  legacy("strafe20", { consts: { BUDDY_STRAFE: 20 } }),
  legacy("runAtBuddy", { patches: [RUN_AT_BUDDY] }),
  legacy("track0.06", { patches: [carrierTracksBuddy(0.06)] }),
  legacy("track0.12", { patches: [carrierTracksBuddy(0.12)] }),
];

/**
 * A small sweep around the shipped tuning (BASE), for re-checking it after changes: HP, evade
 * speed and the aimed-notice chance, one at a time.
 */
const SHIPPED_SWEEP: readonly Variant[] = [
  BASE,
  { name: "ship+hp8", spec: { BUDDY_HP: 8 } },
  { name: "ship+hp10", spec: { BUDDY_HP: 10 } },
  { name: "ship+spd0.12", spec: { BUDDY_SPEED: 0.12 } },
  { name: "ship+spd0.16", spec: { BUDDY_SPEED: 0.16 } },
  { name: "ship+aimed50", spec: aimedNotice(0.5) },
  { name: "ship+aimed70", spec: aimedNotice(0.7) },
];

/** The per-run output the offense sweep picked: a 3–4-shot fan whose shots pierce at most 2 ships. */
function core(name: string, d: LegacyDelta = {}): Variant {
  return legacy(name, {
    ...d,
    consts: { BUDDY_BULLET_COUNT_MIN: 3, BUDDY_BULLET_COUNT_MAX: 4, ...d.consts },
    pierce: 2,
  });
}

/** Survivability candidates layered on the offense core (the proposal search), on the legacy engine. */
export const CANDIDATES: readonly Variant[] = [
  LEGACY,
  core("core (fan3-4 pierce2)"),
  core("core+track0.08", { patches: [carrierTracksBuddy(0.08)] }),
  core("core+hp8", { consts: { BUDDY_HP: 8 } }),
  core("core+aimed60", { aimed: 0.6 }),
  core("core+hp8+track0.08", { consts: { BUDDY_HP: 8 }, patches: [carrierTracksBuddy(0.08)] }),
  core("core+hp8+aimed60", { consts: { BUDDY_HP: 8 }, aimed: 0.6 }),
  core("core+track0.08+aimed60", { aimed: 0.6, patches: [carrierTracksBuddy(0.08)] }),
  core("core+hp8+track0.08+aimed60", {
    consts: { BUDDY_HP: 8 },
    aimed: 0.6,
    patches: [carrierTracksBuddy(0.08)],
  }),
  core("core+hp8+track0.08+aimed60+divert85+maxIn5", {
    consts: {
      BUDDY_HP: 8,
      BUDDY_TARGETING: targeting({ divert: 0.85 }),
      BUDDY_MAX_INCOMING: 5,
    },
    aimed: 0.6,
    patches: [carrierTracksBuddy(0.08)],
  }),
  core("core+hp6+track0.08+aimed60", {
    consts: { BUDDY_HP: 6 },
    aimed: 0.6,
    patches: [carrierTracksBuddy(0.08)],
  }),
  // round 2: tracking backfires (the Carrier slides out of the player's aim), and HP alone barely
  // moves survival, so these soften the evasion itself: speed, reaction time, noticing
  core("core+hp8+spd0.12", { consts: { BUDDY_HP: 8, BUDDY_SPEED: 0.12 } }),
  core("core+hp8+spd0.12+aimed60", { consts: { BUDDY_HP: 8, BUDDY_SPEED: 0.12 }, aimed: 0.6 }),
  core("core+hp8+replan250+aimed60", {
    consts: { BUDDY_HP: 8, BUDDY_REPLAN_MS: 250 },
    aimed: 0.6,
  }),
  core("core+hp8+spd0.14+replan220+aimed60", {
    consts: { BUDDY_HP: 8, BUDDY_SPEED: 0.14, BUDDY_REPLAN_MS: 220 },
    aimed: 0.6,
  }),
  core("core+hp8+spd0.12+replan220+aimed50", {
    consts: { BUDDY_HP: 8, BUDDY_SPEED: 0.12, BUDDY_REPLAN_MS: 220 },
    aimed: 0.5,
  }),
  core("core+hp6+spd0.14+aimed60", { consts: { BUDDY_HP: 6, BUDDY_SPEED: 0.14 }, aimed: 0.6 }),
  // BUDDY_NOTICE.shot 0.6 also covered shots aimed at Buddy in the original run
  core("core+hp8+notice60/75", {
    consts: { BUDDY_HP: 8, BUDDY_NOTICE: notice(0.6, 0.75, 0.85) },
    aimed: 0.6,
  }),
];

/**
 * Per-run offensive output sweeps (#2880 follow-up), with the sortie fixed at 3 attack runs:
 * fan size × piercing (unlimited / at most 2 ships / 1 = off), per-shot damage, and the old
 * single pass as a reference.
 */
const FANS: readonly (readonly [string, number, number])[] = [
  ["fan5-7", 5, 7],
  ["fan4", 4, 4],
  ["fan3-4", 3, 4],
  ["fan3", 3, 3],
  ["fan2-4", 2, 4],
  ["fan2", 2, 2],
];
const PIERCE: readonly (readonly [string, number])[] = [
  ["pierce∞", Infinity],
  ["pierce2", 2],
  ["pierce1", 1],
];
const fanConsts = (min: number, max: number): EngineVariantSpec => ({
  BUDDY_BULLET_COUNT_MIN: min,
  BUDDY_BULLET_COUNT_MAX: max,
});
const OFFENSE: readonly Variant[] = [
  ...FANS.flatMap(([fan, min, max]) =>
    PIERCE.map(([pierce, hits]) =>
      legacy(`${fan} ${pierce}`, { consts: fanConsts(min, max), pierce: hits })
    )
  ),
  ...FANS.filter(([fan]) => ["fan5-7", "fan4", "fan2-4"].includes(fan)).map(([fan, min, max]) =>
    legacy(`${fan} pierce∞ dmg0.5`, { consts: fanConsts(min, max), patches: [shotDamage(0.5)] })
  ),
  // the pre-#2845 Buddy: one 5–7-shot piercing fan (±30°) per sortie
  legacy("old single pass (1 run, ±30°)", {
    consts: { BUDDY_BURSTS: 1, BUDDY_SPREAD_HALF: Math.PI / 6 },
  }),
];

export const VARIANTS: readonly Variant[] = [
  ...SWEEPS,
  ...SHIPPED_SWEEP,
  ...OFFENSE,
  ...CANDIDATES,
];

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface JobGroup {
  readonly variants: readonly Variant[];
  readonly pilots: readonly PilotConfig[];
  readonly scenarios: readonly Scenario[];
  readonly difficulties: readonly DifficultyTier[];
}

const ALL_DIFFICULTIES: readonly DifficultyTier[] = [
  "Ensign",
  "LieutenantJG",
  "Lieutenant",
  "LieutenantCommander",
  "Commander",
  "Captain",
  "RearAdmiral",
  "ViceAdmiral",
  "Admiral",
  "FleetAdmiral",
];
const SWEEP_DIFFICULTIES: readonly DifficultyTier[] = [
  "Ensign",
  "LieutenantJG",
  "Captain",
  "FleetAdmiral",
];

export interface Preset {
  /** Seeds per cell (the CLI's --seeds overrides it). */
  readonly seeds: number;
  readonly groups: readonly JobGroup[];
}

/**
 * The fast smoke cells (jest, a few seconds): one boss-wave and one normal-wave cell, both
 * scored with the full metric set.
 */
export const FAST: Preset = {
  seeds: 3,
  groups: [
    {
      variants: [BASE],
      pilots: [PILOTS.normal],
      scenarios: ["boss-exposed", "normal-start"],
      difficulties: ["Captain"],
    },
  ],
};

/** @public Used by tools/sim/simulate-starswarm.ts (outside knip's workspace; #2969). */
export const PRESETS: Readonly<Record<string, Preset>> = {
  fast: FAST,
  /** The shipped tuning: every scenario × difficulty, autoplay and invincible; duels on exposure. */
  baseline: {
    seeds: 200,
    groups: [
      {
        variants: [BASE],
        pilots: [PILOTS.normal, PILOTS.invincible],
        scenarios: SCENARIOS,
        difficulties: ALL_DIFFICULTIES,
      },
      {
        variants: [BASE],
        pilots: [PILOTS.duel],
        scenarios: ["boss-exposed", "normal-exposed", "normal-start"],
        difficulties: ALL_DIFFICULTIES,
      },
    ],
  },
  /** Per-run offensive output: fan × pierce × damage with 3 runs fixed, vs the full fleet. */
  offense: {
    seeds: 200,
    groups: [
      {
        variants: OFFENSE,
        pilots: [PILOTS.normal, PILOTS.duel],
        scenarios: ["normal-start"],
        difficulties: ["LieutenantJG", "Captain"],
      },
      {
        variants: OFFENSE,
        pilots: [PILOTS.normal],
        scenarios: ["normal-mid"],
        difficulties: ["Captain"],
      },
    ],
  },
  /** One-at-a-time sweeps: the exposed boss Carrier (autoplay + duel), and mid-wave shredding. */
  sensitivity: {
    seeds: 200,
    groups: [
      {
        variants: SWEEPS,
        pilots: [PILOTS.normal, PILOTS.duel],
        scenarios: ["boss-exposed"],
        difficulties: SWEEP_DIFFICULTIES,
      },
      {
        variants: SWEEPS.filter((v) =>
          [
            LEGACY.name,
            "hp8",
            "notice50",
            "burst3",
            "burst3-4",
            "bursts2",
            "pierce2",
            "maxIn5",
          ].includes(v.name)
        ),
        pilots: [PILOTS.normal],
        scenarios: ["normal-mid"],
        difficulties: ["LieutenantJG", "Captain"],
      },
    ],
  },
  /** The proposal search: survivability candidates on the offense core. */
  candidates: {
    seeds: 200,
    groups: [
      {
        variants: CANDIDATES,
        pilots: [PILOTS.normal, PILOTS.duel],
        scenarios: ["boss-exposed", "boss-start", "normal-start"],
        difficulties: ["Ensign", "LieutenantJG", "Captain", "FleetAdmiral"],
      },
    ],
  },
  /** A small sweep around the shipped tuning: duels and autoplay on the exposed boss Carrier. */
  shipped: {
    seeds: 200,
    groups: [
      {
        variants: SHIPPED_SWEEP,
        pilots: [PILOTS.normal, PILOTS.duel],
        scenarios: ["boss-exposed"],
        difficulties: SWEEP_DIFFICULTIES,
      },
    ],
  },
  /** Shipped tuning (baseline) vs the pre-#2880 tuning on the same seeds, every scenario × difficulty. */
  proposal: {
    seeds: 200,
    groups: [
      {
        variants: [LEGACY, BASE],
        pilots: [PILOTS.normal],
        scenarios: SCENARIOS,
        difficulties: ALL_DIFFICULTIES,
      },
      {
        variants: [LEGACY, BASE],
        pilots: [PILOTS.duel],
        scenarios: ["boss-exposed", "normal-exposed", "normal-start"],
        difficulties: ALL_DIFFICULTIES,
      },
    ],
  },
};

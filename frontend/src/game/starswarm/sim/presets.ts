/**
 * #2880 balance sim — engine variants (sim-only tuning overrides and behaviour prototypes) and
 * the run presets the runner knows. Nothing here changes the shipped engine: each variant is
 * applied to a private copy by engineVariant.ts.
 */
import * as realEngine from "../engine";
import type { DifficultyTier } from "../types";
import { PILOTS, SCENARIOS, type PilotConfig, type Scenario } from "./balance";
import {
  loadEngineVariant,
  type Engine,
  type EngineVariantSpec,
  type SourcePatch,
} from "./engineVariant";

// ---------------------------------------------------------------------------
// Override helpers (the expressions are TypeScript source for engine.ts)
// ---------------------------------------------------------------------------

interface Targeting {
  divert: number;
  speed: number;
  aimError: number;
  lead: number;
}
const BASE_TARGETING: Record<"Grunt" | "Elite" | "Guardian" | "Carrier", Targeting> = {
  Grunt: { divert: 0.12, speed: 0.28, aimError: 0.22, lead: 0 },
  Elite: { divert: 0.25, speed: 0.35, aimError: 0.12, lead: 0.4 },
  Guardian: { divert: 0.4, speed: 0.46, aimError: 0.06, lead: 0.75 },
  Carrier: { divert: 0.55, speed: 0.52, aimError: 0.02, lead: 1 },
};

/** BUDDY_TARGETING with the Carrier row patched. */
function targeting(carrier: Partial<Targeting>): string {
  const t = { ...BASE_TARGETING, Carrier: { ...BASE_TARGETING.Carrier, ...carrier } };
  return JSON.stringify(t).replace(/"(\w+)":/g, "$1:");
}

function notice(shot: number, beam: number, rock: number): string {
  return `{ shot: ${shot}, beam: ${beam}, rock: ${rock} } as const`;
}

/** CARRIER_CADENCE with the twin-laser ranges scaled by `k` (the floor still applies). */
function twinCadence(k: number): string {
  const r = (min: number, max: number) =>
    `{ min: ${Math.round(min * k)}, max: ${Math.round(max * k)} }`;
  return `{
  beam: { protected: { min: 6000, max: 9000 }, exposed: { min: 4000, max: 6500 }, finalStand: { min: 2600, max: 4200 } },
  twin: { exposed: ${r(900, 1500)}, finalStand: ${r(600, 1000)} },
  reinforce: { protected: { min: 6500, max: 10_000 }, exposed: { min: 5000, max: 8000 } },
  attackRun: { exposed: { min: 7000, max: 11_000 }, finalStand: { min: 4200, max: 7000 } },
}`;
}

// ---------------------------------------------------------------------------
// Behaviour prototypes (exact-snippet patches; each throws if its anchor moved)
// ---------------------------------------------------------------------------

/** Each Buddy shot is spent after piercing `n` ships (today: unlimited). */
export function pierceCap(n: number): SourcePatch {
  return {
    find: `        else newPiercingHits.set(b.id, [enemy.id]);`,
    replace: `        else newPiercingHits.set(b.id, [enemy.id]);
        if (b.source === "buddy" && (b.hitEnemyIds?.length ?? 0) + (newPiercingHits.get(b.id)?.length ?? 0) >= ${n}) hitBulletIds.add(b.id);`,
  };
}

/** The exposed Carrier aims its attack run at Buddy's column (when it would shoot at Buddy). */
export const RUN_AT_BUDDY: SourcePatch = {
  find: `diveTargetX: ctx.playerX,`,
  replace: `diveTargetX: ctx.buddy ? ctx.buddy.x : ctx.playerX,`,
};

/**
 * The exposed Carrier slides its station toward an on-station Buddy at `speed` px/ms (and back
 * to centre once Buddy is gone), so its beam lane and twin fire follow Buddy instead of sitting
 * still while Buddy strafes underneath.
 */
export function carrierTracksBuddy(speed: number): SourcePatch {
  return {
    find: `      e = { ...e, x: e.formationX + clampSway(e.tier, swayX) + dodgeOffset(e) }; // #2487 sidestep`,
    replace: `      if (e.tier === "Carrier" && stage && stage !== "protected" && state.phase === "Playing") {
        const tb = state.buddyShips.find((bb) => bb.hp > 0 && bb.phase === "OnStation");
        const aim = Math.max(60, Math.min(state.canvasW - 60, tb ? tb.x : state.canvasW / 2));
        const step = Math.max(-${speed} * dtMs, Math.min(${speed} * dtMs, aim - e.formationX));
        e = { ...e, formationX: e.formationX + step };
      }
      e = { ...e, x: e.formationX + clampSway(e.tier, swayX) + dodgeOffset(e) }; // #2487 sidestep`,
  };
}

/** Each Buddy shot deals `dmg` (today 1) — fractional damage makes a 1-HP Grunt take two hits. */
export function shotDamage(dmg: number): SourcePatch {
  return {
    find: `      damage: 1,
      piercing: true, // multi-hit through ordinary hulls…`,
    replace: `      damage: ${dmg},
      piercing: true, // multi-hit through ordinary hulls…`,
  };
}

/** Buddy's lane floor (today 40% of the canvas height) — lets a smaller standoff take effect. */
/** Buddy notices shots aimed at it (a deliberate, leading shot) with `chance` instead of BUDDY_NOTICE.shot. */
export function aimedNotice(chance: number): SourcePatch {
  return {
    find: `if (!buddyNotices(b.id, e.id, BUDDY_NOTICE.shot)) continue;`,
    replace: `if (!buddyNotices(b.id, e.id, e.target === "buddy" ? ${chance} : BUDDY_NOTICE.shot)) continue;`,
  };
}

export function laneFloor(frac: number): SourcePatch {
  return { find: `canvasH * 0.4, standoffY`, replace: `canvasH * ${frac}, standoffY` };
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
  return Object.keys(v.spec.consts ?? {}).length === 0 && (v.spec.patches ?? []).length === 0;
}

/** The engine a variant runs on: the real module, or its sim-only patched copy. */
export function engineFor(v: Variant): Engine {
  return isShipped(v) ? realEngine : loadEngineVariant(v.spec);
}

/** One-at-a-time sensitivity sweeps (#2880 candidates). */
export const SWEEPS: readonly Variant[] = [
  BASE,
  { name: "hp6", spec: { consts: { BUDDY_HP: "6" } } },
  { name: "hp8", spec: { consts: { BUDDY_HP: "8" } } },
  { name: "hp12", spec: { consts: { BUDDY_HP: "12" } } },
  { name: "notice50", spec: { consts: { BUDDY_NOTICE: notice(0.5, 0.6, 0.6) } } },
  { name: "noEvade", spec: { consts: { BUDDY_NOTICE: notice(0, 0, 0) } } },
  { name: "evadeSpd0.1", spec: { consts: { BUDDY_SPEED: "0.1" } } },
  { name: "replan300", spec: { consts: { BUDDY_REPLAN_MS: "300" } } },
  { name: "maxIn5", spec: { consts: { BUDDY_MAX_INCOMING: "5" } } },
  { name: "maxIn8", spec: { consts: { BUDDY_MAX_INCOMING: "8" } } },
  { name: "divert30", spec: { consts: { BUDDY_TARGETING: targeting({ divert: 0.3 }) } } },
  { name: "divert85", spec: { consts: { BUDDY_TARGETING: targeting({ divert: 0.85 }) } } },
  {
    name: "divert100+maxIn8",
    spec: { consts: { BUDDY_TARGETING: targeting({ divert: 1 }), BUDDY_MAX_INCOMING: "8" } },
  },
  { name: "twin×0.6", spec: { consts: { CARRIER_CADENCE: twinCadence(0.6) } } },
  {
    name: "burst3",
    spec: { consts: { BUDDY_BULLET_COUNT_MIN: "3", BUDDY_BULLET_COUNT_MAX: "3" } },
  },
  {
    name: "burst3-4",
    spec: { consts: { BUDDY_BULLET_COUNT_MIN: "3", BUDDY_BULLET_COUNT_MAX: "4" } },
  },
  { name: "bursts2", spec: { consts: { BUDDY_BURSTS: "2" } } },
  { name: "pierce2", spec: { patches: [pierceCap(2)] } },
  { name: "standoff220", spec: { consts: { BUDDY_STANDOFF: "220" } } },
  {
    name: "standoff90+lane.28",
    spec: { consts: { BUDDY_STANDOFF: "90" }, patches: [laneFloor(0.28)] },
  },
  { name: "strafe20", spec: { consts: { BUDDY_STRAFE: "20" } } },
  { name: "runAtBuddy", spec: { patches: [RUN_AT_BUDDY] } },
  { name: "track0.06", spec: { patches: [carrierTracksBuddy(0.06)] } },
  { name: "track0.12", spec: { patches: [carrierTracksBuddy(0.12)] } },
];

/**
 * The proposed tuning set (#2880), applied here as a sim-only override. See the report on the
 * issue for how it was chosen.
 */
/** The per-run output the offense sweep picked: a 3–4-shot fan whose shots pierce at most 2 ships. */
const CORE_CONSTS = { BUDDY_BULLET_COUNT_MIN: "3", BUDDY_BULLET_COUNT_MAX: "4" };
const CORE_PATCHES: readonly SourcePatch[] = [pierceCap(2)];
function core(
  name: string,
  consts: Record<string, string> = {},
  patches: SourcePatch[] = []
): Variant {
  return {
    name,
    spec: { consts: { ...CORE_CONSTS, ...consts }, patches: [...CORE_PATCHES, ...patches] },
  };
}

/** Survivability candidates layered on the offense core (the proposal search). */
export const CANDIDATES: readonly Variant[] = [
  BASE,
  core("core (fan3-4 pierce2)"),
  core("core+track0.08", {}, [carrierTracksBuddy(0.08)]),
  core("core+hp8", { BUDDY_HP: "8" }),
  core("core+aimed60", {}, [aimedNotice(0.6)]),
  core("core+hp8+track0.08", { BUDDY_HP: "8" }, [carrierTracksBuddy(0.08)]),
  core("core+hp8+aimed60", { BUDDY_HP: "8" }, [aimedNotice(0.6)]),
  core("core+track0.08+aimed60", {}, [carrierTracksBuddy(0.08), aimedNotice(0.6)]),
  core("core+hp8+track0.08+aimed60", { BUDDY_HP: "8" }, [
    carrierTracksBuddy(0.08),
    aimedNotice(0.6),
  ]),
  core(
    "core+hp8+track0.08+aimed60+divert85+maxIn5",
    { BUDDY_HP: "8", BUDDY_TARGETING: targeting({ divert: 0.85 }), BUDDY_MAX_INCOMING: "5" },
    [carrierTracksBuddy(0.08), aimedNotice(0.6)]
  ),
  core("core+hp6+track0.08+aimed60", { BUDDY_HP: "6" }, [
    carrierTracksBuddy(0.08),
    aimedNotice(0.6),
  ]),
  // round 2: tracking backfires (the Carrier slides out of the player's aim), and HP alone barely
  // moves survival, so these soften the evasion itself: speed, reaction time, noticing
  core("core+hp8+spd0.12", { BUDDY_HP: "8", BUDDY_SPEED: "0.12" }),
  core("core+hp8+spd0.12+aimed60", { BUDDY_HP: "8", BUDDY_SPEED: "0.12" }, [aimedNotice(0.6)]),
  core("core+hp8+replan250+aimed60", { BUDDY_HP: "8", BUDDY_REPLAN_MS: "250" }, [aimedNotice(0.6)]),
  core(
    "core+hp8+spd0.14+replan220+aimed60",
    { BUDDY_HP: "8", BUDDY_SPEED: "0.14", BUDDY_REPLAN_MS: "220" },
    [aimedNotice(0.6)]
  ),
  core(
    "core+hp8+spd0.12+replan220+aimed50",
    { BUDDY_HP: "8", BUDDY_SPEED: "0.12", BUDDY_REPLAN_MS: "220" },
    [aimedNotice(0.5)]
  ),
  core("core+hp6+spd0.14+aimed60", { BUDDY_HP: "6", BUDDY_SPEED: "0.14" }, [aimedNotice(0.6)]),
  core("core+hp8+notice60/75", { BUDDY_HP: "8", BUDDY_NOTICE: notice(0.6, 0.75, 0.85) }),
];

/**
 * The proposed set (#2880), applied here as a sim-only override. See the report on the issue
 * for how it was chosen.
 */
export const PROPOSAL: Variant = {
  ...core(
    "core+hp8+spd0.14+replan220+aimed60",
    { BUDDY_HP: "8", BUDDY_SPEED: "0.14", BUDDY_REPLAN_MS: "220" },
    [aimedNotice(0.6)]
  ),
  name: "proposal",
};

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
const PIERCE: readonly (readonly [string, SourcePatch | null])[] = [
  ["pierce∞", null],
  ["pierce2", pierceCap(2)],
  ["pierce1", pierceCap(1)],
];
const fanConsts = (min: number, max: number) => ({
  BUDDY_BULLET_COUNT_MIN: String(min),
  BUDDY_BULLET_COUNT_MAX: String(max),
});
export const OFFENSE: readonly Variant[] = [
  ...FANS.flatMap(([fan, min, max]) =>
    PIERCE.map(([pierce, patch]) => ({
      name: `${fan} ${pierce}`,
      spec: { consts: fanConsts(min, max), patches: patch ? [patch] : [] },
    }))
  ).map((v) => (v.name === "fan5-7 pierce∞" ? { ...BASE, name: "base (fan5-7 pierce∞)" } : v)),
  ...FANS.filter(([fan]) => ["fan5-7", "fan4", "fan2-4"].includes(fan)).map(([fan, min, max]) => ({
    name: `${fan} pierce∞ dmg0.5`,
    spec: { consts: fanConsts(min, max), patches: [shotDamage(0.5)] },
  })),
  {
    // the pre-#2845 Buddy: one 5–7-shot piercing fan (±30°) per sortie
    name: "old single pass (1 run, ±30°)",
    spec: { consts: { BUDDY_BURSTS: "1", BUDDY_SPREAD_HALF: "Math.PI / 6" } },
  },
];

export const VARIANTS: readonly Variant[] = [...SWEEPS, ...OFFENSE, ...CANDIDATES, PROPOSAL];

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface JobGroup {
  readonly variants: readonly Variant[];
  readonly pilots: readonly PilotConfig[];
  readonly scenarios: readonly Scenario[];
  readonly difficulties: readonly DifficultyTier[];
}

export const ALL_DIFFICULTIES: readonly DifficultyTier[] = [
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
            "base",
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
  /** Baseline vs the proposal on the same seeds, every scenario × difficulty. */
  proposal: {
    seeds: 200,
    groups: [
      {
        variants: [BASE, PROPOSAL],
        pilots: [PILOTS.normal],
        scenarios: SCENARIOS,
        difficulties: ALL_DIFFICULTIES,
      },
      {
        variants: [BASE, PROPOSAL],
        pilots: [PILOTS.duel],
        scenarios: ["boss-exposed", "normal-exposed", "normal-start"],
        difficulties: ALL_DIFFICULTIES,
      },
    ],
  },
};

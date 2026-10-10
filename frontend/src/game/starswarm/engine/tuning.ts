/**
 * Star Swarm engine — tuning (#2988).
 *
 * Every tunable the engine reads lives here: canvas and entity sizes, timings, cadences, tier
 * tables and the difficulty tiers (#1037). Most are plain module constants, read directly by the
 * module that owns the behaviour. The subset the balance simulator sweeps (#2880) is also
 * carried on a `Tuning` object — `DEFAULT_TUNING` is the shipped game, and `tick()` takes a
 * `Tuning` so the simulator can run a variant without patching source (see
 * `tooling/starswarm/engineVariant.ts`). Nothing here allocates per tick: a variant is one
 * object built once and threaded through the sub-ticks that read it.
 */
import type {
  AsteroidKind,
  CarrierStage,
  DifficultyTier,
  EnemyTier,
  GunsLevel,
  HullLevel,
} from "../types";

/** The pre-wave countdown the screen runs with the engine frozen (ms). */
export const WAVE_COUNTDOWN_MS = 3000;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CANVAS_W = 360;
export const CANVAS_H = 640;

export const PLAYER_W = 34;
export const PLAYER_H = 34;
export const PLAYER_Y_FROM_BOTTOM = 72;
export const PLAYER_SHOOT_COOLDOWN = 280; // ms
export const PLAYER_INVINCIBLE_MS = 2600; // ms of post-spawn invincibility

export const BULLET_P_W = 5;
export const BULLET_P_H = 14;
export const BULLET_P_VY = -0.56; // px/ms upward

// #2334: hard cap on simultaneous player bullets. Lightning's 4x fire rate combined with
// piercing bullets (never consumed on enemy hit — only removed off-screen, see tickBullets)
// has no other bound; this guards against runaway growth feeding the O(enemies × bullets)
// collision scan in tickCollisions. #2488: raised from 20 to 40 — gun level 3 fires four
// bullets a volley, and sustained Lightning at L3 sits around 30 in flight; ordinary L1 play
// never gets near either number.
//
// Deliberately flat (not wave/difficulty-scaled like bulletCap() below): bulletCap() bounds
// enemy bullet *density* as a gameplay-difficulty knob that should get harder with wave/
// paramScale. This cap instead bounds a technical worst-case (fire-rate × piercing bullets
// never despawning on hit) that doesn't grow with wave, so it stays a plain constant.
export const MAX_PLAYER_BULLETS = 40;

export const BULLET_C_W = 12; // super-state bullet — wider
export const BULLET_C_H = 22;

export const BULLET_E_W = 5;
export const BULLET_E_H = 10;
export const BULLET_E_VY = 0.35; // px/ms downward

export const FORMATION_COLS = 8;
export const FORMATION_COL_W = 44; // #950: was 38 — Guardian (36 px) had only 1 px margin/side
export const FORMATION_ROW_H = 42; // #2484: was 46 — the Carrier row has to fit above the player lane
export const FORMATION_TOP = 90;

export const SWOOP_DURATION = 1400; // ms per enemy traversal
export const SWOOP_STAGGER = 55; // ms delay between successive enemies

export const DIVE_SPEED = 0.27; // px/ms (kept for reference; Bézier path duration derived below)
export const CIRCLE_RADIUS = 42;
export const CIRCLE_SPEED = 0.0032; // rad/ms
export const RETURN_DURATION = 1900; // ms for return path

// #975: pre-dive wiggle telegraph
export const WIGGLE_DURATION = 350; // ms
export const WIGGLE_AMPLITUDE = 6; // px horizontal oscillation

// #977: Bézier arc dive paths
export const DIVE_PATH_DURATION = 1800; // ms (non-Guardian)
export const GUARDIAN_DIVE_PATH_DURATION = Math.round(DIVE_PATH_DURATION * (DIVE_SPEED / 0.22)); // ~2210ms

// #978: Guardian dive eligibility threshold
export const GUARDIAN_DIVE_THRESHOLD = 0.35; // Guardians unlocked when ≤35% non-leader remain

// #979: Guardian burst-fire
export const BURST_INTERVAL = 200; // ms between shots within a burst
export const BURST_PAUSE_BASE = 2000; // ms cooldown after burst completes
export const BURST_PAUSE_JITTER = 1000; // ms random addend to pause
export const GUARDIAN_BULLET_VY = 0.46; // px/ms — faster than Elite (0.35) so Guardian shots are harder to dodge
export const GUARDIAN_MAX_SWAY = 20; // px — Guardian sways ±20px vs ±40px for other tiers
// #2484: the Carrier is the heaviest hull in the formation and barely drifts.
export const CARRIER_MAX_SWAY = 12; // px

export const DIVE_INTERVAL_BASE = 3200; // ms between dive triggers
export const DIVE_INTERVAL_MIN = 900; // floor regardless of wave

// Times the purely-cosmetic "MISSION COMPLETE" banner, set on the wave's last kill. It never
// blocks or slows anything down (#2352); the #2842 extraction runs underneath it.
export const MISSION_COMPLETE_BANNER_MS = 1200;

// #2842: wave-clear extraction. After the last kill the AI flies the ship: it holds the lane
// (dodging) while the surviving hazards resolve, then climbs off the top. The hard transient
// reset happens once it is off-screen, or at EXTRACTION_MAX_MS whatever happens.
export const EXTRACTION_HOLD_MIN_MS = 500; // the ship holds the lane at least this long…
export const EXTRACTION_HOLD_MAX_MS = 2500; // …and climbs by here even if hazards remain
export const EXTRACTION_MAX_MS = 6000; // hard cap on the whole extraction

// #3132: a cleared wave with pickups still on screen waits for them (ClearAwaitingPickups), the
// player flying, before the extraction. Nothing new spawns after the last kill and every pickup
// leaves by its own despawn timer (never more than powerUpDespawnMs(canvasH)), so the wait ends
// on its own. The safety cap (`pickupWaitMaxMs` in extraction.ts) is that longest despawn time
// plus this slack, for a pickup that somehow never leaves.
export const PICKUP_WAIT_SLACK_MS = 1000;
export const PILOT_SPEED = 0.3; // px/ms lateral autopilot speed (a brisk drag)
export const PILOT_CLIMB_ACCEL = 0.0015; // px/ms² climb acceleration
export const PILOT_CLIMB_MAX = 0.9; // px/ms climb speed cap
export const PILOT_LOOKAHEAD_MS = [0, 100, 200, 350, 500, 700] as const;
export const PILOT_MARGIN = 10; // px of slack the autopilot keeps from a hazard
export const PILOT_STEP = 6; // px between candidate lanes the autopilot scores
// ms the banner takes to fade out at the end of its life — shared by both renderers so
// native/web can't drift out of sync with each other or with MISSION_COMPLETE_BANNER_MS.
export const MISSION_COMPLETE_FADE_MS = 300;

export const SHOOT_INTERVAL_BASE = 2600; // ms base
export const SHOOT_INTERVAL_JITTER = 1400; // ms random addend

export const EXPLOSION_FRAME_MS = 28;
export const EXPLOSION_FRAMES = 20;

export const WAVE_CLEAR_BONUS_BASE = 500;
/** #2490: a boss wave's clear bonus is doubled — the stage's whole payout, no perfect bonus. */
export const BOSS_WAVE_CLEAR_MULT = 2;

/** Points for clearing `wave` at `difficulty`: base × wave (× 2 on a boss wave) × multiplier. */
export function waveClearBonusPoints(wave: number, difficulty: DifficultyTier): number {
  const mult = isBossWave(wave) ? BOSS_WAVE_CLEAR_MULT : 1;
  return Math.round(wave * WAVE_CLEAR_BONUS_BASE * mult * difficultyMultiplier(difficulty));
}

// Score diving enemies get a 2× multiplier.
export const DIVE_SCORE_MULT = 2;

// #2489: grunt rout — once no Elite, Guardian or Carrier is left alive, surviving grunts break and run
// for the top edge. Catch one on the way out for 2× (the dive multiplier); an escape pays nothing.
export const FLEE_DURATION_MIN = 1500; // ms along the flee path
export const FLEE_DURATION_MAX = 2100;
export const FLEE_STAGGER_MAX = 375; // ms a grunt hesitates before bolting
export const FLEE_ENSIGN_SCALE = 1.4; // slower on Ensign — easier to catch

// #944 Dive/circle shooting
export const DIVE_SHOOT_INTERVAL = 1500; // ms between shots while Diving or Circling

// #923 Formation sway
export const SWAY_SPEED_BASE = 0.03; // px/ms
export const MAX_SWAY = 40; // max offset from center in px

// #924 Aimed shots — start gentle from wave 1, ramp +5%/wave, cap 60%
export const AIMED_SHOT_WAVE_START = 1;
export const AIMED_SHOT_FRACTION = 0.1; // 10% aimed at wave 1, +5% per wave, cap 60%

// #945 Bonus lives (#1078 #1079)
export const BONUS_LIFE_BASE = 30_000;
export const MAX_LIVES = 5;
export const BONUS_LIFE_SLOW_MO_SCALE = 0.35; // #1078: time scale during slow-mo window
export const BONUS_LIFE_SLOW_MO_DURATION = 800; // ms of slow-mo after bonus life
export const BONUS_LIFE_INVINCIBLE_MS = 600; // ms of invincibility after bonus life

// #980: power-up entity
export const POWERUP_W = 24;
export const POWERUP_H = 24;
export const POWERUP_VY = 0.08; // px/ms fall speed
export const POWERUP_DURATION = 5000; // ms of super state (lightning / shield)

// #1034: Smart Bomb flash
export const BOMB_FLASH_DURATION = 300; // ms

// #1035/#2845: Buddy — a durable, targetable allied ship
/** #2845: Buddy's hit points. Tuning range 8–12; #2880 rebalance settled on 9 (offense was the problem, not toughness). */
export const BUDDY_HP = 9;
export const BUDDY_HURT_RADIUS = 11; // px — Buddy's hit circle (a bigger hull than the player's forgiveness circle)
export const BUDDY_SPEED = 0.14; // px/ms — the bound on its evasive and station-keeping moves
export const BUDDY_TRANSIT_SPEED = 0.34; // px/ms — flying in and peeling off
export const BUDDY_STATION_MS = 9000; // ms on station before it peels off
export const BUDDY_BURSTS = 3; // attack runs per sortie — one spread burst each
export const BUDDY_FIRST_BURST_MS = 700; // ms after reaching station before the first burst
export const BUDDY_BURST_INTERVAL = 2200; // ms between bursts
export const BUDDY_RUN_MS = 700; // the attack run: it lines up under its target this long before a burst
export const BUDDY_RUN_RISE = 24; // px it climbs toward the target on an attack run (never inside the standoff)
export const BUDDY_BULLET_SPEED = 0.5; // px/ms
export const BUDDY_BULLET_COUNT_MIN = 3; // #2880: was 5–7
export const BUDDY_BULLET_COUNT_MAX = 4;
/** #2880: a Buddy shot is spent after hitting this many ships (was unlimited pierce). */
export const BUDDY_PIERCE_HITS = 2;
export const BUDDY_SPREAD_HALF = Math.PI / 9; // ±20° fan
/** #2845: Buddy never closes inside this distance of the Carrier on station — no point-blank passes. */
export const BUDDY_STANDOFF = 150; // px
export const BUDDY_FORMATION_GAP = 55; // px Buddy keeps below the lowest ship holding formation
export const BUDDY_PLAYER_GAP = 90; // px Buddy keeps above the player lane (its floor)
export const BUDDY_STRAFE = 55; // px either side of its target line while strafing
export const BUDDY_STRAFE_PERIOD = 3200; // ms per strafe cycle
export const BUDDY_REPLAN_MS = 220; // ms reaction latency between evasion re-plans (imperfection)
// sampled every 40 ms so even a fast shot (0.5 px/ms) can't slip between samples of a ~22 px reach
export const BUDDY_LOOKAHEAD_MS = Array.from({ length: 19 }, (_, i) => i * 40); // 0 … 720 ms
export const BUDDY_MARGIN = 6; // px of slack its evasion keeps from a hazard
export const BUDDY_ROCK_LOOKAHEAD_MS = 900; // rock threat window (asteroidThreatens)
/**
 * #2845: the chance Buddy notices a given hostile at all — decided per hazard by a stateless hash
 * of its id, so it is deterministic and never draws from the seeded rng. An unnoticed shot or rock
 * is simply not dodged: strong, readable, imperfect.
 */
export const BUDDY_NOTICE = { shot: 0.8, beam: 0.9, rock: 0.85 } as const;
/** #2880: notice chance for a shot aimed at Buddy (a deliberate, leading shot); other shots keep BUDDY_NOTICE.shot. */
export const BUDDY_NOTICE_AIMED = 0.6;
export const BUDDY_BEAM_DAMAGE = 3; // a released Carrier beam is heavy
export const BUDDY_ROCK_DAMAGE = 2; // per rock (one hit per rock, like any ship)
/** #2845: at most this many enemy shots may be in flight at Buddy — it draws fire, it isn't focus-fired. */
export const BUDDY_MAX_INCOMING = 3;
export const BUDDY_TARGET_RANGE = 380; // px — a ship only diverts to a Buddy within this range…
export const BUDDY_TARGET_BELOW = 20; // …and at least this far below it (enemy guns point down)

/** #2845: how a tier treats Buddy as a target. Grunt → Elite → Guardian → Carrier, weakest to strongest. */
export interface BuddyTargeting {
  /** Chance a shot this ship is about to fire at the player goes to Buddy instead. */
  readonly divert: number;
  /** Speed of a shot at Buddy, px/ms. */
  readonly speed: number;
  /** Max aim error, radians (uniform ±). */
  readonly aimError: number;
  /** Fraction of Buddy's motion it leads (0 = aims where Buddy is). */
  readonly lead: number;
}
export const BUDDY_TARGETING: Readonly<Record<EnemyTier, BuddyTargeting>> = {
  Grunt: { divert: 0.12, speed: 0.28, aimError: 0.22, lead: 0 },
  Elite: { divert: 0.25, speed: 0.35, aimError: 0.12, lead: 0.4 },
  Guardian: { divert: 0.4, speed: 0.46, aimError: 0.06, lead: 0.75 },
  Carrier: { divert: 0.55, speed: 0.52, aimError: 0.02, lead: 1 }, // exposed only
};
// Time for a powerup to fall from spawn (y = POWERUP_H/2) to just past the player, plus a

export const SUPER_SHOOT_COOLDOWN = 70; // ms (4× fire rate during super)
export const SUPER_DAMAGE = 4;

// #974: small circle around the player sprite centre — forgiveness hitbox
export const PLAYER_HURT_RADIUS = 7; // px

// #1310: duration of the shield-ring hit flash on non-lethal Elite/Guardian hits
export const HIT_FLASH_DURATION = 250; // ms

// #2485/#2843: Carrier actions — traveling beam, twin lasers, reinforcements, attack runs
export const BOSS_WAVE_BEAM_SCALE = 1.5; // #2490: beams come this much faster on a boss wave
export const BEAM_CHARGE_MS = 600; // telegraph: wiggle + glow — the same in every stage (#2843)
export const BEAM_HALF_WIDTH = 12; // px either side of the released beam's column
export const BEAM_LENGTH = 140; // px, the released bolt's length
export const BEAM_SPEED = 1.1; // px/ms — fast: a bolt crosses the lane in ~0.4 s
export const BEAM_WIGGLE_AMPLITUDE = 3; // px, during charge
export const TWIN_FIRE_OFFSET = 14; // px either side of centre for the twin lasers
export const CARRIER_CADENCE_CAP = 1.6; // paramScale is capped here for every Carrier cadence
export const ATTACK_RUN_BRACE_MS = 800; // #2843: attack-run telegraph — the Carrier rears back
export const ATTACK_RUN_BRACE_LIFT = 8; // px the Carrier rears up while bracing
/** #2843: how long the heavy attack run takes, and how deep it reaches (fraction of canvasH). */
export const ATTACK_RUN: Readonly<
  Record<Exclude<CarrierStage, "protected">, { readonly ms: number; readonly depth: number }>
> = {
  exposed: { ms: 3400, depth: 0.46 },
  finalStand: { ms: 2800, depth: 0.56 },
};
/**
 * #3131: commit-time path vetting. A Carrier run or an Elite/Guardian dive is checked against
 * on-screen rocks' straight-line projections before it is committed (see `pathStrikesRock`).
 */
export const PATH_CHECK_STEP_MS = 100; // path sample spacing; each segment is swept exactly
export const PATH_CHECK_MARGIN = 4; // px of slack around the circle enclosing the hitbox (half-diagonal)
/** Shallower alternative run: this fraction of the stage's ATTACK_RUN depth. */
export const ATTACK_RUN_SHALLOW_FACTOR = 0.75;
/** Longest a braced Carrier holds for a clear run before it stands down and re-rolls its timer. */
export const ATTACK_RUN_HOLD_MAX_MS = 1500;
/** Longest an Elite/Guardian keeps wiggling for a clear dive before it settles back into formation. */
export const DIVE_HOLD_MAX_MS = 700;

/** A bounded random interval (or count): uniform in [min, max]. */
export interface CadenceRange {
  readonly min: number;
  readonly max: number;
}

/** #2843: the Carrier's randomized cadences. */
export type CarrierCadence = "beam" | "twin" | "reinforce" | "attackRun";

/**
 * #2843: base cadence ranges (ms) per stage, before difficulty (÷ min(1.6, paramScale)) and, for
 * the beam only, the boss-wave factor (÷ 1.5). A stage missing from a row means the action does
 * not happen in that stage: no twin fire or attack run while protected, and no reinforcements
 * once the Carrier makes its final stand. Every later stage is shorter on average than the one
 * before (tests hold this), so each stage is more aggressive than the last.
 */
export const CARRIER_CADENCE: Readonly<
  Record<CarrierCadence, Readonly<Partial<Record<CarrierStage, CadenceRange>>>>
> = {
  beam: {
    protected: { min: 6000, max: 9000 },
    exposed: { min: 4000, max: 6500 },
    finalStand: { min: 2600, max: 4200 },
  },
  twin: {
    exposed: { min: 900, max: 1500 },
    finalStand: { min: 600, max: 1000 },
  },
  reinforce: {
    protected: { min: 6500, max: 10_000 },
    exposed: { min: 5000, max: 8000 },
  },
  attackRun: {
    exposed: { min: 7000, max: 11_000 },
    finalStand: { min: 4200, max: 7000 },
  },
};

/**
 * #2843: fair minimum spacing — no scaling ever brings a cadence below this. The beam floor is
 * the idle gap between one release and the next charge, so the 600 ms telegraph always follows
 * at least this much quiet.
 */
export const CARRIER_CADENCE_FLOOR: Readonly<Record<CarrierCadence, number>> = {
  beam: 1500,
  twin: 400,
  reinforce: 4000,
  attackRun: 3000,
};

/** #2843: what a cadence roll returns for an action its stage doesn't have (~11.5 days). */
export const CADENCE_INACTIVE_MS = 1e9;

/** #2843: grunts per reinforcement launch, by stage (still bounded by vacant slots and caps). */
export const REINFORCE_COUNT: Readonly<Partial<Record<CarrierStage, CadenceRange>>> = {
  protected: { min: 2, max: 3 },
  exposed: { min: 2, max: 4 },
};

// #2488: in-run ship upgrades — never persisted, never sold
export const GUNS_MAX: GunsLevel = 3;
export const HULL_MAX: HullLevel = 2;
export const TWIN_OFFSET = 7; // px either side of centre for the twin guns (L2+)
export const SPREAD_OFFSET = 12; // px either side for the L3 spread pair
export const SPREAD_VX = 0.14; // px/ms sideways drift of the L3 spread pair
export const SALVAGE_DROP_CHANCE = 0.4; // per large asteroid destroyed, whoever broke it
export const HULL_INVINCIBLE_MS = 600; // grace after plating takes a hit (same as a bonus life)

// #2487: how enemies respond to asteroids — dodge rolls by tier, and flak at approaching rocks
export const DODGE_BASE: Record<EnemyTier, number> = {
  Grunt: 0.25,
  Elite: 0.55,
  Guardian: 0.8,
  Carrier: 0,
};
export const DODGE_CAP = 0.97;
export const DODGE_LOOKAHEAD_MS = [200, 400, 700] as const; // sampled rock positions for the threat check
export const DODGE_MARGIN = 6; // px of slack around the ship's hitbox
export const DODGE_SIDESTEP = 22; // px, formation sidestep amplitude
export const DODGE_SIDESTEP_MS = 600; // sine out-and-back
export const DODGE_PATH_NUDGE = 40; // px, control-point shift for ships on a path
// #2881: diving ships stay committed but visibly react. One opportunity per rock per phase.
/** Phases (other than Formation, which has its own flak/sidestep) that get the #2881 reactions. */
export const REACTION_PHASES: ReadonlySet<string> = new Set([
  "Diving",
  "Returning",
  "Fleeing",
  "Wiggling",
  "Circling",
]);
export const FLINCH_CHANCE: Record<EnemyTier, number> = {
  Grunt: 1,
  Elite: 0.85,
  Guardian: 0.6,
  Carrier: 0,
};
export const FLINCH_MS = 450; // evade window (aim degrade) and wobble cue length
export const FLINCH_WOBBLE_PX = 3; // peak lateral jitter of the wobble cue
export const FLINCH_WOBBLE_TILT = 0.22; // peak tilt, radians
export const FLINCH_WOBBLE_PERIOD_MS = 90;
export const DIVER_FLAK_FACTOR = 0.8; // x FLAK_BASE x difficulty scale, for non-formation flak
export const LATE_NUDGE_CHANCE: Record<EnemyTier, number> = {
  Grunt: 0.35,
  Elite: 0.5,
  Guardian: 0.6,
  Carrier: 0,
};
export const LATE_NUDGE_PX = 60; // control-point shift; the dive endpoint (p3) stays fixed
export const FLAK_BASE: Record<EnemyTier, number> = {
  Grunt: 0.3,
  Elite: 0.7,
  Guardian: 0.9,
  Carrier: 1,
};
export const FLAK_SCALE_CAP = 1.3;
export const FLAK_RANGE = 120; // px
export const FLAK_COOLDOWN = 900; // ms per ship
export const FLAK_LEAD_MS = 300; // aim at where the rock will be
export const FLAK_SPEED = 0.42; // px/ms
export const CARRIER_FLAK_RANGE = 180; // px — the Carrier is big, so it reaches further than a fighter

/**
 * #2844: what answering an asteroid costs a ship, by tier — the finite-combat-capacity rule.
 * Every figure is "how much of this ship's offence it gives up", so the ordering is the design:
 * Grunt is the most distracted, then Elite, then Guardian, then Carrier (the least).
 *  - threatMs: a rock bearing down on the ship — a mild local distraction, added to the ship's
 *    next-shot timer (once per rock).
 *  - flakMs: firing flak at a rock — added to the same timer, so the gun that shot the rock is not
 *    also shooting at the player. Flak itself stays outside bulletCap(); this is what pays for it.
 *  - aimSpread: while evading, the ship's player-directed shots stray sideways by
 *    (0.5–1 × aimSpread × the shot's speed).
 */
export interface AsteroidAttention {
  readonly threatMs: number;
  readonly flakMs: number;
  readonly aimSpread: number;
}
export const ASTEROID_ATTENTION: Readonly<Record<EnemyTier, AsteroidAttention>> = {
  Grunt: { threatMs: 350, flakMs: 1200, aimSpread: 0.6 },
  Elite: { threatMs: 220, flakMs: 800, aimSpread: 0.4 },
  Guardian: { threatMs: 120, flakMs: 450, aimSpread: 0.22 },
  Carrier: { threatMs: 60, flakMs: 250, aimSpread: 0.1 },
};

// #2486: errant asteroids — a neutral hazard that damages both sides and absorbs bullets
export const MAX_ASTEROIDS = 2; // timed spawns stop at this many in flight; a split may briefly exceed it
export const ASTEROID_MIN_WAVE = 2;
export const ASTEROID_INTERVAL_MIN = 12_000; // ms between timed spawns (Playing phase only)
export const ASTEROID_INTERVAL_MAX = 20_000;
export const ASTEROID_SPEED_MIN = 0.15; // px/ms
export const ASTEROID_SPEED_MAX = 0.22;
// #2844: entry geometry — where a rock may come from and how its crossing is vetted
export const ASTEROID_ENTRY_EDGE = 6; // px of clearance beyond the radius, so a rock starts fully off-screen
export const ASTEROID_ENTRY_ATTEMPTS = 8; // candidate trajectories tried per spawn before giving up
export const ASTEROID_MIN_CROSS_FRAC = 0.5; // in-field path length, as a fraction of canvas width
export const ASTEROID_MIN_REACTION_MS = 1500; // on-screen time before a rock can reach the player row
export const ASTEROID_MIN_ANGLE = 0.3; // rad below horizontal — never a flat skim along the top
export const ASTEROID_LARGE_CHANCE = 0.65;
export const ASTEROID_HIT_FLASH_MS = 120;
export const ASTEROID_STATS: Record<AsteroidKind, { radius: number; hp: number }> = {
  large: { radius: 22, hp: 6 },
  small: { radius: 12, hp: 2 },
};

// #2484: Carrier — one per wave, never dives, armored while its four Guardian escorts live.
export const TIER_SCORE: Record<EnemyTier, number> = {
  Grunt: 100,
  Elite: 200,
  Guardian: 400,
  Carrier: 1000,
};
export const TIER_HP: Record<EnemyTier, number> = { Grunt: 1, Elite: 2, Guardian: 4, Carrier: 8 };

// ---------------------------------------------------------------------------
// Difficulty tier system (#1037)
// ---------------------------------------------------------------------------

export const DIFFICULTY_SCORE_MULT: Record<DifficultyTier, number> = {
  Ensign: 1,
  LieutenantJG: 1.5,
  Lieutenant: 2,
  LieutenantCommander: 2.5,
  Commander: 3,
  Captain: 4,
  RearAdmiral: 5,
  ViceAdmiral: 6,
  Admiral: 8,
  FleetAdmiral: 10,
};

// Scales AI aggression: dive interval floor, bullet cap, aimed-shot cap, sway speed.
export const DIFFICULTY_PARAM_SCALE: Record<DifficultyTier, number> = {
  Ensign: 0.7,
  LieutenantJG: 1.0,
  Lieutenant: 1.15,
  LieutenantCommander: 1.3,
  Commander: 1.5,
  Captain: 1.7,
  RearAdmiral: 1.9,
  ViceAdmiral: 2.15,
  Admiral: 2.5,
  FleetAdmiral: 3.0,
};

export const DIFFICULTY_LABEL: Record<DifficultyTier, string> = {
  Ensign: "Ensign",
  LieutenantJG: "Lieutenant J.G.",
  Lieutenant: "Lieutenant",
  LieutenantCommander: "Lieutenant Cmdr",
  Commander: "Commander",
  Captain: "Captain",
  RearAdmiral: "Rear Admiral",
  ViceAdmiral: "Vice Admiral",
  Admiral: "Admiral",
  FleetAdmiral: "Fleet Admiral",
};

/** All tiers from easiest to hardest — use for UI selector ordering. */
export const DIFFICULTY_TIERS: readonly DifficultyTier[] = [
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

/** Score multiplier applied to every point award for this tier. */
export function difficultyMultiplier(tier: DifficultyTier): number {
  return DIFFICULTY_SCORE_MULT[tier];
}

/** AI parameter scale factor (dive rate, bullet density, aimed-shot fraction). */
export function difficultyParamScale(tier: DifficultyTier): number {
  return DIFFICULTY_PARAM_SCALE[tier];
}

/** Human-readable display label for a difficulty tier. */
export function difficultyLabel(tier: DifficultyTier): string {
  return DIFFICULTY_LABEL[tier];
}

/** Points per bonus life at the given difficulty (scales with score multiplier). */
export function bonusLifeThreshold(difficulty: DifficultyTier): number {
  return BONUS_LIFE_BASE * difficultyMultiplier(difficulty);
}
export const TIER_SIZE: Record<EnemyTier, { w: number; h: number }> = {
  Grunt: { w: 24, h: 24 },
  Elite: { w: 28, h: 28 },
  Guardian: { w: 36, h: 32 },
  Carrier: { w: 54, h: 48 }, // #2484 — matches the 172×151 sprite's aspect so it isn't squashed
};

// ---------------------------------------------------------------------------
// Wave helpers
// ---------------------------------------------------------------------------

export function diveInterval(wave: number, paramScale = 1): number {
  const base = DIVE_INTERVAL_BASE * Math.pow(0.88, wave - 1);
  // Higher difficulty → lower floor → more frequent dives
  const floor = Math.max(300, Math.round(DIVE_INTERVAL_MIN / paramScale));
  return Math.max(floor, base);
}

/** #2490: boss-wave cadence — wave 5, then every 4th (5, 9, 13, …). */
export function isBossWave(wave: number): boolean {
  return wave >= 5 && (wave - 5) % 4 === 0;
}

// #980: kills needed to trigger a power-up drop (before jitter is applied)
export function triggerKills(wave: number): number {
  return Math.min(12 + Math.floor((wave - 1) * 1.5), 20);
}

// #926: how many enemies may dive simultaneously at a given wave
export function maxDivers(wave: number): number {
  if (wave <= 2) return 1;
  if (wave <= 4) return 2;
  if (wave <= 6) return 3;
  return 4;
}

/** #3139: the boss wave's four Guardians are all active from the first tick, so all four may dive. */
const BOSS_WAVE_MAX_DIVERS = 4;

/** Concurrent-diver cap for a wave: `maxDivers`, lifted to `BOSS_WAVE_MAX_DIVERS` on a boss wave. */
export function diveCap(wave: number): number {
  return isBossWave(wave) ? Math.max(BOSS_WAVE_MAX_DIVERS, maxDivers(wave)) : maxDivers(wave);
}

// #972: max enemy bullets on screen — 3 at wave 1, +1 every 2 waves; scaled by difficulty
export function bulletCap(wave: number, paramScale = 1): number {
  return Math.min(24, Math.round((3 + Math.floor((wave - 1) / 2)) * paramScale));
}

// ---------------------------------------------------------------------------
// Injectable tuning (#2988)
// ---------------------------------------------------------------------------

/**
 * The tunables a run can be played with — the subset the balance simulator (#2880) sweeps and
 * prototypes, each defaulting to the shipped constant of the same name. `tick`, `initStarSwarm`
 * and `applyPowerUp` take one (default `DEFAULT_TUNING`) and thread it to the sub-ticks that
 * read it; the module constants above remain the single source of the shipped values.
 *
 * The four knobs without a module constant are behaviour prototypes the simulator used to patch
 * into the source. At their defaults they are no-ops, so the shipped game never sees them.
 */
export interface Tuning {
  readonly BUDDY_HP: number;
  readonly BUDDY_SPEED: number;
  readonly BUDDY_REPLAN_MS: number;
  readonly BUDDY_BURSTS: number;
  readonly BUDDY_BULLET_COUNT_MIN: number;
  readonly BUDDY_BULLET_COUNT_MAX: number;
  /** Hits per Buddy shot; `Infinity` is the pre-#2880 unlimited pierce. */
  readonly BUDDY_PIERCE_HITS: number;
  /** Damage per Buddy shot (shipped: 1; fractional damage makes a 1-HP Grunt take two hits). */
  readonly BUDDY_SHOT_DAMAGE: number;
  readonly BUDDY_SPREAD_HALF: number;
  readonly BUDDY_STANDOFF: number;
  readonly BUDDY_STRAFE: number;
  /** Buddy's lane floor as a fraction of the canvas height (shipped: 0.4). */
  readonly BUDDY_LANE_FLOOR: number;
  readonly BUDDY_NOTICE: { readonly shot: number; readonly beam: number; readonly rock: number };
  readonly BUDDY_NOTICE_AIMED: number;
  readonly BUDDY_MAX_INCOMING: number;
  readonly BUDDY_TARGETING: Readonly<Record<EnemyTier, BuddyTargeting>>;
  readonly CARRIER_CADENCE: Readonly<
    Record<CarrierCadence, Readonly<Partial<Record<CarrierStage, CadenceRange>>>>
  >;
  /** Prototype: the exposed Carrier aims its attack run at Buddy's column when it would shoot at Buddy. */
  readonly CARRIER_RUN_AT_BUDDY: boolean;
  /** Prototype: the exposed Carrier slides its station toward an on-station Buddy at this px/ms (0 = off). */
  readonly CARRIER_TRACK_BUDDY_SPEED: number;
}

/** The shipped tuning — every field is the module constant of the same name (or a no-op). */
export const DEFAULT_TUNING: Tuning = {
  BUDDY_HP,
  BUDDY_SPEED,
  BUDDY_REPLAN_MS,
  BUDDY_BURSTS,
  BUDDY_BULLET_COUNT_MIN,
  BUDDY_BULLET_COUNT_MAX,
  BUDDY_PIERCE_HITS,
  BUDDY_SHOT_DAMAGE: 1,
  BUDDY_SPREAD_HALF,
  BUDDY_STANDOFF,
  BUDDY_STRAFE,
  BUDDY_LANE_FLOOR: 0.4,
  BUDDY_NOTICE,
  BUDDY_NOTICE_AIMED,
  BUDDY_MAX_INCOMING,
  BUDDY_TARGETING,
  CARRIER_CADENCE,
  CARRIER_RUN_AT_BUDDY: false,
  CARRIER_TRACK_BUDDY_SPEED: 0,
};

import type {
  StarSwarmState,
  Enemy,
  Bullet,
  BuddyShip,
  Explosion,
  Player,
  PowerUp,
  PowerUpType,
  Vec2,
  CubicBezier,
  EnemyTier,
  StarSwarmInput,
  DifficultyTier,
  Asteroid,
  AsteroidKind,
  BeamPhase,
  TierStats,
  RunStats,
  GunsLevel,
  HullLevel,
  UpgradeEvent,
  Extraction,
  CarrierBeam,
  CarrierStage,
} from "./types";
import {
  WAVE_CLEAR_SOURCE,
  addScore,
  award,
  commitAwards,
  emptyScoreLedger,
  recordScore,
  scoreSource,
  type ScorePoints,
} from "./scoreLedger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CANVAS_W = 360;
export const CANVAS_H = 640;

export const PLAYER_W = 34;
const PLAYER_H = 34;
const PLAYER_Y_FROM_BOTTOM = 72;
const PLAYER_SHOOT_COOLDOWN = 280; // ms
const PLAYER_INVINCIBLE_MS = 2600; // ms of post-spawn invincibility

const BULLET_P_W = 5;
const BULLET_P_H = 14;
const BULLET_P_VY = -0.56; // px/ms upward

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
const BULLET_C_H = 22;

const BULLET_E_W = 5;
const BULLET_E_H = 10;
export const BULLET_E_VY = 0.35; // px/ms downward

const FORMATION_COLS = 8;
const FORMATION_COL_W = 44; // #950: was 38 — Guardian (36 px) had only 1 px margin/side
const FORMATION_ROW_H = 42; // #2484: was 46 — the Carrier row has to fit above the player lane
const FORMATION_TOP = 90;

const SWOOP_DURATION = 1400; // ms per enemy traversal
const SWOOP_STAGGER = 55; // ms delay between successive enemies

const DIVE_SPEED = 0.27; // px/ms (kept for reference; Bézier path duration derived below)
const CIRCLE_RADIUS = 42;
const CIRCLE_SPEED = 0.0032; // rad/ms
const RETURN_DURATION = 1900; // ms for return path

// #975: pre-dive wiggle telegraph
export const WIGGLE_DURATION = 350; // ms
const WIGGLE_AMPLITUDE = 6; // px horizontal oscillation

// #977: Bézier arc dive paths
export const DIVE_PATH_DURATION = 1800; // ms (non-Guardian)
const GUARDIAN_DIVE_PATH_DURATION = Math.round(DIVE_PATH_DURATION * (DIVE_SPEED / 0.22)); // ~2210ms

// #978: Guardian dive eligibility threshold
export const GUARDIAN_DIVE_THRESHOLD = 0.35; // Guardians unlocked when ≤35% non-leader remain

// #979: Guardian burst-fire
export const BURST_INTERVAL = 200; // ms between shots within a burst
export const BURST_PAUSE_BASE = 2000; // ms cooldown after burst completes
const BURST_PAUSE_JITTER = 1000; // ms random addend to pause
export const GUARDIAN_BULLET_VY = 0.46; // px/ms — faster than Elite (0.35) so Guardian shots are harder to dodge
const GUARDIAN_MAX_SWAY = 20; // px — Guardian sways ±20px vs ±40px for other tiers
// #2484: the Carrier is the heaviest hull in the formation and barely drifts.
const CARRIER_MAX_SWAY = 12; // px

const DIVE_INTERVAL_BASE = 3200; // ms between dive triggers
const DIVE_INTERVAL_MIN = 900; // floor regardless of wave

// Times the purely-cosmetic "MISSION COMPLETE" banner, set on the wave's last kill. It never
// blocks or slows anything down (#2352); the #2842 extraction runs underneath it.
export const MISSION_COMPLETE_BANNER_MS = 1200;

// #2842: wave-clear extraction. After the last kill the AI flies the ship: it holds the lane
// (dodging) while the surviving hazards resolve, then climbs off the top. The hard transient
// reset happens once it is off-screen, or at EXTRACTION_MAX_MS whatever happens.
export const EXTRACTION_HOLD_MIN_MS = 500; // the ship holds the lane at least this long…
export const EXTRACTION_HOLD_MAX_MS = 2500; // …and climbs by here even if hazards remain (#2945: unless chasing a pickup)
export const EXTRACTION_MAX_MS = 6000; // hard cap on the whole extraction
// #2945: a pickup the last kill left behind is worth holding the lane for — but only until here,
// leaving the climb enough of the EXTRACTION_MAX_MS cap to clear the top.
export const EXTRACTION_PICKUP_HOLD_MAX_MS = 4000;
export const PILOT_SPEED = 0.3; // px/ms lateral autopilot speed (a brisk drag)
const PILOT_CLIMB_ACCEL = 0.0015; // px/ms² climb acceleration
const PILOT_CLIMB_MAX = 0.9; // px/ms climb speed cap
const PILOT_LOOKAHEAD_MS = [0, 100, 200, 350, 500, 700] as const;
const PILOT_MARGIN = 10; // px of slack the autopilot keeps from a hazard
const PILOT_STEP = 6; // px between candidate lanes the autopilot scores
// ms the banner takes to fade out at the end of its life — shared by both renderers so
// native/web can't drift out of sync with each other or with MISSION_COMPLETE_BANNER_MS.
export const MISSION_COMPLETE_FADE_MS = 300;

/** Decay `missionCompleteTimer` by real elapsed time. Used by `tick()` below, and directly
 * by both renderers' RAF loops during the pre-wave countdown freeze — tick() (the only other
 * place this timer is touched) is skipped entirely while that freeze is active, so without
 * this the banner would stay pinned at full opacity instead of fading on its own schedule.
 * Kept as one shared function so native/web can't drift out of sync with each other. */
export function decayMissionCompleteTimer(timer: number, dtMs: number): number {
  return Math.max(0, timer - dtMs);
}

/** Whether the cosmetic "MISSION COMPLETE" banner should render this frame. Suppressed during
 * GameOver (would ghost under the game-over overlay) — a real phase this timer can still be
 * counting down through. Also suppressed while the pre-wave countdown overlay is showing (a
 * short extraction can hand over to the next wave's countdown before the banner has faded, and
 * both overlays render full-screen and centered) — countdownActive is passed in since the
 * countdown lives in the renderer's ref state, not the engine state. */
export function showMissionCompleteBanner(
  state: StarSwarmState,
  countdownActive: boolean
): boolean {
  return state.missionCompleteTimer > 0 && state.phase !== "GameOver" && !countdownActive;
}

const SHOOT_INTERVAL_BASE = 2600; // ms base
const SHOOT_INTERVAL_JITTER = 1400; // ms random addend

const EXPLOSION_FRAME_MS = 28;
const EXPLOSION_FRAMES = 20;

export const WAVE_CLEAR_BONUS_BASE = 500;
/** #2490: a boss wave's clear bonus is doubled — the stage's whole payout, no perfect bonus. */
export const BOSS_WAVE_CLEAR_MULT = 2;

/** Points for clearing `wave` at `difficulty`: base × wave (× 2 on a boss wave) × multiplier. */
export function waveClearBonusPoints(wave: number, difficulty: DifficultyTier): number {
  const mult = isBossWave(wave) ? BOSS_WAVE_CLEAR_MULT : 1;
  return Math.round(wave * WAVE_CLEAR_BONUS_BASE * mult * difficultyMultiplier(difficulty));
}

// Score diving enemies get a 2× multiplier.
const DIVE_SCORE_MULT = 2;

// #2489: grunt rout — once no Elite, Guardian or Carrier is left alive, surviving grunts break and run
// for the top edge. Catch one on the way out for 2× (the dive multiplier); an escape pays nothing.
export const FLEE_DURATION_MIN = 1500; // ms along the flee path
export const FLEE_DURATION_MAX = 2100;
export const FLEE_STAGGER_MAX = 375; // ms a grunt hesitates before bolting
export const FLEE_ENSIGN_SCALE = 1.4; // slower on Ensign — easier to catch

// #944 Dive/circle shooting
const DIVE_SHOOT_INTERVAL = 1500; // ms between shots while Diving or Circling

// #923 Formation sway
const SWAY_SPEED_BASE = 0.03; // px/ms
const MAX_SWAY = 40; // max offset from center in px

// #924 Aimed shots — start gentle from wave 1, ramp +5%/wave, cap 60%
const AIMED_SHOT_WAVE_START = 1;
const AIMED_SHOT_FRACTION = 0.1; // 10% aimed at wave 1, +5% per wave, cap 60%

// #945 Bonus lives (#1078 #1079)
const BONUS_LIFE_BASE = 30_000;
const MAX_LIVES = 5;
const BONUS_LIFE_SLOW_MO_SCALE = 0.35; // #1078: time scale during slow-mo window
const BONUS_LIFE_SLOW_MO_DURATION = 800; // ms of slow-mo after bonus life
const BONUS_LIFE_INVINCIBLE_MS = 600; // ms of invincibility after bonus life

// #980: power-up entity
const POWERUP_W = 24;
const POWERUP_H = 24;
const POWERUP_VY = 0.08; // px/ms fall speed
export const POWERUP_DURATION = 5000; // ms of super state (lightning / shield)

// #1034: Smart Bomb flash
const BOMB_FLASH_DURATION = 300; // ms

// #1035/#2845: Buddy — a durable, targetable allied ship
/** #2845: Buddy's hit points. Tuning range 8–12; #2880 rebalance settled on 9 (offense was the problem, not toughness). */
export const BUDDY_HP = 9;
export const BUDDY_HURT_RADIUS = 11; // px — Buddy's hit circle (a bigger hull than the player's forgiveness circle)
export const BUDDY_SPEED = 0.14; // px/ms — the bound on its evasive and station-keeping moves
const BUDDY_TRANSIT_SPEED = 0.34; // px/ms — flying in and peeling off
export const BUDDY_STATION_MS = 9000; // ms on station before it peels off
export const BUDDY_BURSTS = 3; // attack runs per sortie — one spread burst each
export const BUDDY_FIRST_BURST_MS = 700; // ms after reaching station before the first burst
export const BUDDY_BURST_INTERVAL = 2200; // ms between bursts
export const BUDDY_RUN_MS = 700; // the attack run: it lines up under its target this long before a burst
const BUDDY_RUN_RISE = 24; // px it climbs toward the target on an attack run (never inside the standoff)
const BUDDY_BULLET_SPEED = 0.5; // px/ms
const BUDDY_BULLET_COUNT_MIN = 3; // #2880: was 5–7
const BUDDY_BULLET_COUNT_MAX = 4;
/** #2880: a Buddy shot is spent after hitting this many ships (was unlimited pierce). */
export const BUDDY_PIERCE_HITS = 2;
const BUDDY_SPREAD_HALF = Math.PI / 9; // ±20° fan
/** #2845: Buddy never closes inside this distance of the Carrier on station — no point-blank passes. */
export const BUDDY_STANDOFF = 150; // px
const BUDDY_FORMATION_GAP = 55; // px Buddy keeps below the lowest ship holding formation
const BUDDY_PLAYER_GAP = 90; // px Buddy keeps above the player lane (its floor)
const BUDDY_STRAFE = 55; // px either side of its target line while strafing
const BUDDY_STRAFE_PERIOD = 3200; // ms per strafe cycle
export const BUDDY_REPLAN_MS = 220; // ms reaction latency between evasion re-plans (imperfection)
// sampled every 40 ms so even a fast shot (0.5 px/ms) can't slip between samples of a ~22 px reach
const BUDDY_LOOKAHEAD_MS = Array.from({ length: 19 }, (_, i) => i * 40); // 0 … 720 ms
const BUDDY_MARGIN = 6; // px of slack its evasion keeps from a hazard
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
const BUDDY_TARGET_RANGE = 380; // px — a ship only diverts to a Buddy within this range…
const BUDDY_TARGET_BELOW = 20; // …and at least this far below it (enemy guns point down)

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
// 2-second collection window. Computed per-canvas so it works at any screen height.
function powerUpDespawnMs(canvasH: number): number {
  return Math.ceil((canvasH - PLAYER_Y_FROM_BOTTOM - POWERUP_H / 2) / POWERUP_VY) + 2000;
}
const SUPER_SHOOT_COOLDOWN = 70; // ms (4× fire rate during super)
const SUPER_DAMAGE = 4;

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
const BEAM_WIGGLE_AMPLITUDE = 3; // px, during charge
const TWIN_FIRE_OFFSET = 14; // px either side of centre for the twin lasers
export const CARRIER_CADENCE_CAP = 1.6; // paramScale is capped here for every Carrier cadence
export const ATTACK_RUN_BRACE_MS = 800; // #2843: attack-run telegraph — the Carrier rears back
const ATTACK_RUN_BRACE_LIFT = 8; // px the Carrier rears up while bracing
/** #2843: how long the heavy attack run takes, and how deep it reaches (fraction of canvasH). */
export const ATTACK_RUN: Readonly<
  Record<Exclude<CarrierStage, "protected">, { readonly ms: number; readonly depth: number }>
> = {
  exposed: { ms: 3400, depth: 0.46 },
  finalStand: { ms: 2800, depth: 0.56 },
};

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
const TWIN_OFFSET = 7; // px either side of centre for the twin guns (L2+)
const SPREAD_OFFSET = 12; // px either side for the L3 spread pair
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
const DODGE_LOOKAHEAD_MS = [200, 400, 700] as const; // sampled rock positions for the threat check
const DODGE_MARGIN = 6; // px of slack around the ship's hitbox
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
const FLAK_SCALE_CAP = 1.3;
export const FLAK_RANGE = 120; // px
export const FLAK_COOLDOWN = 900; // ms per ship
const FLAK_LEAD_MS = 300; // aim at where the rock will be
const FLAK_SPEED = 0.42; // px/ms
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

/** #2844: a tier's attention costs (see ASTEROID_ATTENTION). */
export function asteroidAttention(tier: EnemyTier): AsteroidAttention {
  return ASTEROID_ATTENTION[tier];
}

/**
 * #2844: a ship's next-shot timer after spending attention on a rock. Pure; `kind` picks the cost.
 * The delay is added on top of whatever time is left, so a ship already about to fire is pushed
 * back by the full amount rather than merely reset.
 */
export function withAsteroidAttention(
  shootTimer: number,
  tier: EnemyTier,
  kind: "threat" | "flak"
): number {
  const a = ASTEROID_ATTENTION[tier];
  return Math.max(0, shootTimer) + (kind === "flak" ? a.flakMs : a.threatMs);
}

/**
 * #2844: a ship pays attention to a rock: its next-shot timer slips back AND the same amount is
 * booked as `attentionMs` debt, a floor that tickEnemies re-applies after every tick so a phase
 * change (dive launch, straggler cap) cannot erase it.
 */
function payAttention<E extends Pick<Enemy, "tier" | "shootTimer" | "attentionMs">>(
  e: E,
  kind: "threat" | "flak"
): E {
  const a = ASTEROID_ATTENTION[e.tier];
  return {
    ...e,
    shootTimer: withAsteroidAttention(e.shootTimer, e.tier, kind),
    attentionMs: e.attentionMs + (kind === "flak" ? a.flakMs : a.threatMs),
  };
}

/**
 * #2844: degrade a player-directed shot's aim while its ship is evading. The velocity gets a
 * sideways kick of (0.5–1 × the tier's aimSpread × |vy|) in a random direction — always a real
 * miss, never a no-op, bigger for the more distracted tiers. `rand` supplies two draws.
 */
export function degradeAim(
  vx: number,
  vy: number,
  tier: EnemyTier,
  rand: () => number
): { vx: number; vy: number } {
  const mag = (0.5 + 0.5 * rand()) * ASTEROID_ATTENTION[tier].aimSpread * Math.abs(vy);
  return { vx: vx + (rand() < 0.5 ? -mag : mag), vy };
}

// #2486: errant asteroids — a neutral hazard that damages both sides and absorbs bullets
export const MAX_ASTEROIDS = 2; // timed spawns stop at this many in flight; a split may briefly exceed it
export const ASTEROID_MIN_WAVE = 2;
export const ASTEROID_INTERVAL_MIN = 12_000; // ms between timed spawns (Playing phase only)
export const ASTEROID_INTERVAL_MAX = 20_000;
const ASTEROID_SPEED_MIN = 0.15; // px/ms
const ASTEROID_SPEED_MAX = 0.22;
// #2844: entry geometry — where a rock may come from and how its crossing is vetted
const ASTEROID_ENTRY_EDGE = 6; // px of clearance beyond the radius, so a rock starts fully off-screen
export const ASTEROID_ENTRY_ATTEMPTS = 8; // candidate trajectories tried per spawn before giving up
export const ASTEROID_MIN_CROSS_FRAC = 0.5; // in-field path length, as a fraction of canvas width
export const ASTEROID_MIN_REACTION_MS = 1500; // on-screen time before a rock can reach the player row
const ASTEROID_MIN_ANGLE = 0.3; // rad below horizontal — never a flat skim along the top
const ASTEROID_LARGE_CHANCE = 0.65;
export const ASTEROID_HIT_FLASH_MS = 120;
export const ASTEROID_STATS: Record<AsteroidKind, { radius: number; hp: number }> = {
  large: { radius: 22, hp: 6 },
  small: { radius: 12, hp: 2 },
};

// #2484: Carrier — one per wave, never dives, armored while its four Guardian escorts live.
const TIER_SCORE: Record<EnemyTier, number> = {
  Grunt: 100,
  Elite: 200,
  Guardian: 400,
  Carrier: 1000,
};
const TIER_HP: Record<EnemyTier, number> = { Grunt: 1, Elite: 2, Guardian: 4, Carrier: 8 };

/** #2484: Guardian and Carrier sit out the Grunt/Elite "non-leader" thresholds (35% / ≤3 remaining). */
export function isLeaderTier(tier: EnemyTier): boolean {
  return tier === "Guardian" || tier === "Carrier";
}

function carrierArmoredIn(enemies: readonly Enemy[]): boolean {
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

const STAGE_RANK: Readonly<Record<CarrierStage, number>> = {
  protected: 0,
  exposed: 1,
  finalStand: 2,
};

/** #2843: the stage of the Carrier in this roster; null when no Carrier is alive. */
function carrierStageIn(enemies: readonly Enemy[]): CarrierStage | null {
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
 * #2843: the bounds a Carrier cadence rolls within, at this stage, difficulty and wave; null if
 * the action doesn't happen in that stage. Difficulty divides by min(1.6, paramScale), a boss
 * wave divides the beam by a further 1.5, and nothing goes below CARRIER_CADENCE_FLOOR.
 */
export function carrierCadenceBounds(
  kind: CarrierCadence,
  stage: CarrierStage,
  difficulty: DifficultyTier,
  bossWave: boolean
): CadenceRange | null {
  const base = CARRIER_CADENCE[kind][stage];
  if (!base) return null;
  const div =
    Math.min(CARRIER_CADENCE_CAP, difficultyParamScale(difficulty)) *
    (kind === "beam" && bossWave ? BOSS_WAVE_BEAM_SCALE : 1);
  const floor = CARRIER_CADENCE_FLOOR[kind];
  return { min: Math.max(floor, base.min / div), max: Math.max(floor, base.max / div) };
}

/**
 * #2843: one seeded roll of a Carrier cadence — uniform within `carrierCadenceBounds`. An action
 * that doesn't happen in this stage returns CADENCE_INACTIVE_MS without drawing from the rng (a
 * finite "never", so it survives a save — JSON has no Infinity). Uses the engine's rng(), so
 * seeded runs replay exactly.
 */
export function rollCarrierCadence(
  kind: CarrierCadence,
  stage: CarrierStage,
  difficulty: DifficultyTier,
  bossWave: boolean
): number {
  const b = carrierCadenceBounds(kind, stage, difficulty, bossWave);
  if (!b) return CADENCE_INACTIVE_MS;
  return b.min + rng() * (b.max - b.min);
}

// #979/#2484: heavier tiers drift less with the formation sway
function clampSway(tier: EnemyTier, swayX: number): number {
  const limit =
    tier === "Carrier" ? CARRIER_MAX_SWAY : tier === "Guardian" ? GUARDIAN_MAX_SWAY : MAX_SWAY;
  return Math.max(-limit, Math.min(limit, swayX));
}

// ---------------------------------------------------------------------------
// Difficulty tier system (#1037)
// ---------------------------------------------------------------------------

const DIFFICULTY_SCORE_MULT: Record<DifficultyTier, number> = {
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
const DIFFICULTY_PARAM_SCALE: Record<DifficultyTier, number> = {
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

const DIFFICULTY_LABEL: Record<DifficultyTier, string> = {
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
function bonusLifeThreshold(difficulty: DifficultyTier): number {
  return BONUS_LIFE_BASE * difficultyMultiplier(difficulty);
}
const TIER_SIZE: Record<EnemyTier, { w: number; h: number }> = {
  Grunt: { w: 24, h: 24 },
  Elite: { w: 28, h: 28 },
  Guardian: { w: 36, h: 32 },
  Carrier: { w: 54, h: 48 }, // #2484 — matches the 172×151 sprite's aspect so it isn't squashed
};

// ---------------------------------------------------------------------------
// LCG RNG — deterministic and seedable for tests
// ---------------------------------------------------------------------------

let _seed = 42;

export function seedRng(seed: number): void {
  _seed = seed >>> 0;
}

function rng(): number {
  _seed = (Math.imul(1664525, _seed) + 1013904223) >>> 0;
  return _seed / 0xffffffff;
}

// ---------------------------------------------------------------------------
// ID counter
// ---------------------------------------------------------------------------

let _nextId = 1;

function nextId(): number {
  return _nextId++;
}

/**
 * #2880: Buddy's own entities (the ship, its shots, its wreck's explosion) draw ids from a
 * separate range, so launching a Buddy never shifts the main id stream. Carrier targeting and
 * Buddy/pilot hazard-notice hashes are keyed on ids, and the balance sim's with/without-Buddy
 * counterfactual needs both branches to see the same keys for the same world. Gameplay is
 * otherwise unchanged. The range sits far above any id a run reaches.
 */
const BUDDY_ID_BASE = 1_000_000_000;
let _nextBuddyId = BUDDY_ID_BASE;

function nextBuddyId(): number {
  return _nextBuddyId++;
}

/** The id the next entity will get — a deterministic, rng-free key (#2845 Carrier volley roll). */
function peekNextId(): number {
  return _nextId;
}

/** Reset for testing only. */
export function _resetIds(): void {
  _nextId = 1;
  _nextBuddyId = BUDDY_ID_BASE;
}

/**
 * The module-level counters a run depends on (#2645). A new process starts them over — ids
 * from 1, the rng from the default seed — so a run restored after a cold start carries them.
 */
export interface EngineCounters {
  readonly nextId: number;
  readonly seed: number;
  /** #2880: Buddy's separate id counter. Absent in saves from before it existed. */
  readonly buddyNextId?: number;
}

export function engineCounters(): EngineCounters {
  return { nextId: _nextId, seed: _seed, buddyNextId: _nextBuddyId };
}

/** Counters a save may carry: a positive integer id counter and a 32-bit seed. */
export function isEngineCounters(v: unknown): v is EngineCounters {
  if (v === null || typeof v !== "object") return false;
  const { nextId, seed } = v as Record<string, unknown>;
  return (
    Number.isSafeInteger(nextId) &&
    (nextId as number) >= 1 &&
    Number.isInteger(seed) &&
    (seed as number) >= 0 &&
    (seed as number) <= 0xffffffff &&
    ((v as Record<string, unknown>).buddyNextId === undefined ||
      Number.isSafeInteger((v as Record<string, unknown>).buddyNextId))
  );
}

/**
 * Continue a restored run's counters. Ids only move forward: never back onto an id this
 * process has already issued, nor onto one the restored run holds. Counters that aren't
 * valid change nothing.
 */
export function restoreEngineCounters(counters: EngineCounters): void {
  if (!isEngineCounters(counters)) return;
  _nextId = Math.max(_nextId, counters.nextId);
  _nextBuddyId = Math.max(_nextBuddyId, counters.buddyNextId ?? BUDDY_ID_BASE);
  _seed = counters.seed >>> 0;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function evalCubic(c: CubicBezier, t: number): Vec2 {
  const u = 1 - t;
  const u2 = u * u;
  const u3 = u2 * u;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: u3 * c.p0.x + 3 * u2 * t * c.p1.x + 3 * u * t2 * c.p2.x + t3 * c.p3.x,
    y: u3 * c.p0.y + 3 * u2 * t * c.p1.y + 3 * u * t2 * c.p2.y + t3 * c.p3.y,
  };
}

/** AABB overlap — positions are centers, w/h are full extents. */
function aabb(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return (
    ax - aw / 2 < bx + bw / 2 &&
    ax + aw / 2 > bx - bw / 2 &&
    ay - ah / 2 < by + bh / 2 &&
    ay + ah / 2 > by - bh / 2
  );
}

// #974: circle (player hurt area) vs AABB — positions are centers, w/h are full extents
export function collideCircleAABB(
  cx: number,
  cy: number,
  cr: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  const nearX = Math.max(bx - bw / 2, Math.min(bx + bw / 2, cx));
  const nearY = Math.max(by - bh / 2, Math.min(by + bh / 2, cy));
  const dx = cx - nearX;
  const dy = cy - nearY;
  return dx * dx + dy * dy <= cr * cr;
}

// ---------------------------------------------------------------------------
// Formation layout helpers
// ---------------------------------------------------------------------------

interface SlotDef {
  tier: EnemyTier;
  row: number;
  col: number;
  rowCols: number;
}

function waveSlots(wave: number): SlotDef[] {
  const slots: SlotDef[] = [];

  // Guardian row: 4 enemies, centered
  for (let c = 0; c < 4; c++) slots.push({ tier: "Guardian", row: 1, col: c, rowCols: 4 });

  // Two Elite rows
  for (let r = 2; r <= 3; r++)
    for (let c = 0; c < FORMATION_COLS; c++)
      slots.push({ tier: "Elite", row: r, col: c, rowCols: FORMATION_COLS });

  // Grunt rows: 2 at wave 1, +1 every other wave, max 5
  const gruntRows = Math.min(2 + Math.floor((wave - 1) / 2), 5);
  for (let r = 4; r < 4 + gruntRows; r++)
    for (let c = 0; c < FORMATION_COLS; c++)
      slots.push({ tier: "Grunt", row: r, col: c, rowCols: FORMATION_COLS });

  // #2484: Carrier row — one ship, centered above its escorts. Last in the list so it is the
  // last to swoop in (and so enemies[0] stays a Guardian, which the dev panel and tests lean on).
  slots.push({ tier: "Carrier", row: 0, col: 0, rowCols: 1 });

  return slots;
}

/** #2490: a boss wave is the Carrier and its four escorts, nothing else. Carrier last, as above. */
function bossWaveSlots(): SlotDef[] {
  const slots: SlotDef[] = [];
  for (let c = 0; c < 4; c++) slots.push({ tier: "Guardian", row: 1, col: c, rowCols: 4 });
  slots.push({ tier: "Carrier", row: 0, col: 0, rowCols: 1 });
  return slots;
}

function slotToWorld(slot: SlotDef, canvasW: number): { fx: number; fy: number } {
  const rowWidth = slot.rowCols * FORMATION_COL_W;
  const left = (canvasW - rowWidth) / 2 + FORMATION_COL_W / 2;
  return {
    fx: left + slot.col * FORMATION_COL_W,
    fy: FORMATION_TOP + slot.row * FORMATION_ROW_H,
  };
}

// ---------------------------------------------------------------------------
// Path factories
// ---------------------------------------------------------------------------

function swoopPath(idx: number, fx: number, fy: number, canvasW: number): CubicBezier {
  const fromLeft = idx % 2 === 0;
  const p0: Vec2 = fromLeft ? { x: -40, y: -50 } : { x: canvasW + 40, y: -50 };
  const p1: Vec2 = fromLeft
    ? { x: canvasW * 0.72, y: CANVAS_H * 0.32 }
    : { x: canvasW * 0.28, y: CANVAS_H * 0.32 };
  const p2: Vec2 = { x: fx + (fromLeft ? -55 : 55), y: fy + 70 };
  const p3: Vec2 = { x: fx, y: fy };
  return { p0, p1, p2, p3 };
}

function returnPath(ex: number, ey: number, fx: number, fy: number): CubicBezier {
  const jitter = rng() * 50 - 25;
  return {
    p0: { x: ex, y: ey },
    p1: { x: (ex + fx) / 2, y: ey - 110 },
    p2: { x: fx + jitter, y: fy + 55 },
    p3: { x: fx, y: fy },
  };
}

/** #2489: from where the grunt is to off-screen top on its nearer side — a lift, then a bolt. */
function fleePath(x: number, y: number, canvasW: number): CubicBezier {
  const endX = x < canvasW / 2 ? -60 : canvasW + 60;
  const endY = -60;
  return {
    p0: { x, y },
    p1: { x: x + (endX - x) * 0.15, y: y - 40 - rng() * 30 },
    p2: { x: endX - (endX - x) * 0.25, y: endY + 80 },
    p3: { x: endX, y: endY },
  };
}

// #977: wide Bézier arc for Diving phase — sweeps outward before descending
// shallow=true produces an Elite Phase-1 dive that stays above 60% canvas height
function divePath(enemy: Enemy, targetX: number, canvasH: number, shallow = false): CubicBezier {
  const sweepDir = enemy.formationX < CANVAS_W / 2 ? -1 : 1;
  const jitter = (rng() - 0.5) * 40;
  if (shallow) {
    return {
      p0: { x: enemy.x, y: enemy.y },
      p1: { x: enemy.formationX + sweepDir * 50, y: enemy.formationY + 50 },
      p2: { x: targetX + jitter, y: canvasH * 0.4 },
      p3: { x: targetX, y: canvasH * 0.55 },
    };
  }
  return {
    p0: { x: enemy.x, y: enemy.y },
    p1: { x: enemy.formationX + sweepDir * 80, y: enemy.formationY + 80 },
    p2: { x: targetX + jitter, y: canvasH * 0.7 },
    p3: { x: targetX, y: canvasH * 0.9 },
  };
}

// #1032: weighted power-up type selection based on player lives
// Uses Math.random() intentionally — cosmetic choice, should not affect determinism.
function pickPowerUpType(lives: number): PowerUpType {
  const r = Math.random();
  if (lives <= 1) {
    // Shield and Bomb each 33%, Lightning and Buddy each 17%
    if (r < 0.33) return "shield";
    if (r < 0.66) return "bomb";
    if (r < 0.83) return "lightning";
    return "buddy";
  }
  // lives >= 2: equal 25% each
  if (r < 0.25) return "lightning";
  if (r < 0.5) return "shield";
  if (r < 0.75) return "buddy";
  return "bomb";
}

// ---------------------------------------------------------------------------
// Asteroids (#2486)
// ---------------------------------------------------------------------------

function asteroidInterval(): number {
  return ASTEROID_INTERVAL_MIN + rng() * (ASTEROID_INTERVAL_MAX - ASTEROID_INTERVAL_MIN);
}

function makeAsteroid(kind: AsteroidKind, x: number, y: number, vx: number, vy: number): Asteroid {
  return {
    id: nextId(),
    kind,
    x,
    y,
    vx,
    vy,
    radius: ASTEROID_STATS[kind].radius,
    hp: ASTEROID_STATS[kind].hp,
    rotation: 0,
    spin: (rng() - 0.5) * 0.004,
    hitFlashTimer: 0,
    hitEnemyIds: [],
  };
}

// ── #2844 shared asteroid threat / collision contract ─────────────────────────────────────────
// Everything that needs to ask "is this rock a danger to that thing?" or "did it hit?" — enemies,
// the extraction autopilot and (#2845) Buddy — goes through these pure helpers, so the rules
// cannot drift between consumers. A "circle" is any ship or hitbox reduced to a centre + radius.

/** A thing a rock can threaten or strike: a centre, a radius, and optionally its own velocity (px/ms). */
export interface ThreatCircle {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly vx?: number;
  readonly vy?: number;
}

/** The part of a rock the contract reads — an `Asteroid` satisfies it. */
export type RockLike = Pick<Asteroid, "x" | "y" | "vx" | "vy" | "radius" | "hp">;

/** True when the rock's body overlaps the circle right now. A destroyed rock (hp <= 0) never does. */
export function asteroidHits(rock: RockLike, circle: ThreatCircle): boolean {
  if (rock.hp <= 0) return false;
  return circleCircle(rock.x, rock.y, rock.radius, circle.x, circle.y, circle.r);
}

/** Same as asteroidHits for a centred axis-aligned box (`width` × `height`) — how enemy ships are hit. */
export function asteroidHitsBox(
  rock: RockLike,
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
): boolean {
  if (rock.hp <= 0) return false;
  return collideCircleAABB(rock.x, rock.y, rock.radius, box.x, box.y, box.width, box.height);
}

/**
 * Will this rock's body reach the circle within `lookaheadMs`, both moving in straight lines at
 * their current velocities? Exact closest-approach over [0, lookaheadMs] (no sampling gaps), so a
 * fast rock cannot tunnel between checks. True if it already overlaps. `circle.r` should include
 * any safety margin the consumer wants; Buddy's "strong but imperfect" avoidance lives in how it
 * reacts to this, not in the test itself.
 */
export function asteroidThreatens(
  rock: RockLike,
  circle: ThreatCircle,
  lookaheadMs: number
): boolean {
  if (rock.hp <= 0) return false;
  const reach = rock.radius + circle.r;
  const px = rock.x - circle.x;
  const py = rock.y - circle.y;
  if (px * px + py * py <= reach * reach) return true;
  const vx = rock.vx - (circle.vx ?? 0);
  const vy = rock.vy - (circle.vy ?? 0);
  const v2 = vx * vx + vy * vy;
  if (v2 === 0) return false;
  const t = Math.max(0, Math.min(lookaheadMs, -(px * vx + py * vy) / v2));
  const cx = px + vx * t;
  const cy = py + vy * t;
  return cx * cx + cy * cy <= reach * reach;
}

/** A ship's hitbox as a threat circle (half the longer side). */
export function enemyThreatCircle(e: Pick<Enemy, "x" | "y" | "width" | "height">): ThreatCircle {
  return { x: e.x, y: e.y, r: Math.max(e.width, e.height) / 2 };
}

// ── #2844 entry geometry ──────────────────────────────────────────────────────────────────────

export type AsteroidEntryRegion = "left" | "right" | "top" | "topLeft" | "topRight";

export interface AsteroidEntry {
  readonly region: AsteroidEntryRegion;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/** Relative odds of each entry region: broad side edges, the top edge, and the upper corners. */
const ASTEROID_REGION_WEIGHTS: readonly (readonly [AsteroidEntryRegion, number])[] = [
  ["left", 0.28],
  ["right", 0.28],
  ["top", 0.26],
  ["topLeft", 0.09],
  ["topRight", 0.09],
];

/** How a candidate crossing measures up (see `asteroidEntryMetrics`). */
export interface AsteroidEntryMetrics {
  /** Path length (px) the rock's centre spends inside the canvas. */
  readonly crossPx: number;
  /** ms from the rock first touching the screen until it can reach the player's row; Infinity if never. */
  readonly reactionMs: number;
}

/**
 * Measure a trajectory by stepping it (20 ms) — pure, deterministic. The player row is where the
 * ship sits (`playerY`); "can reach" means the rock's edge gets down to the ship's top.
 */
export function asteroidEntryMetrics(
  entry: Pick<AsteroidEntry, "x" | "y" | "vx" | "vy">,
  radius: number,
  canvasW: number,
  canvasH: number
): AsteroidEntryMetrics {
  const STEP = 20;
  const speed = Math.hypot(entry.vx, entry.vy);
  const playerTop = canvasH - PLAYER_Y_FROM_BOTTOM - PLAYER_H / 2;
  let crossPx = 0;
  let enteredAt = -1;
  let reactionMs = Infinity;
  for (let t = 0; t <= 60_000; t += STEP) {
    const x = entry.x + entry.vx * t;
    const y = entry.y + entry.vy * t;
    const touching =
      x + radius > 0 && x - radius < canvasW && y + radius > 0 && y - radius < canvasH;
    if (touching && enteredAt < 0) enteredAt = t;
    if (x >= 0 && x <= canvasW && y >= 0 && y <= canvasH) crossPx += speed * STEP;
    if (enteredAt >= 0 && y + radius >= playerTop && x > -radius && x < canvasW + radius) {
      reactionMs = t - enteredAt;
      break;
    }
    if (enteredAt >= 0 && !touching) break; // left the screen without ever reaching the player row
    if (enteredAt < 0 && (y - radius > canvasH || x < -400 || x > canvasW + 400)) break;
  }
  return { crossPx, reactionMs };
}

/**
 * #2844: plan one rock's off-screen entry and crossing trajectory. Picks an entry region (a broad
 * left/right edge band, the top edge, or an upper corner), a point in the play space to cross, and
 * a speed; the rock starts fully off-screen and is aimed through that point. A candidate is
 * rejected unless it
 *  - points downward by at least ASTEROID_MIN_ANGLE (no flat skim),
 *  - spends at least ASTEROID_MIN_CROSS_FRAC × canvasWidth of path inside the field,
 *  - leaves at least ASTEROID_MIN_REACTION_MS before it can reach the player's row, and
 *  - does not start overlapping any of `actors` (ships waiting off-screen, for instance).
 * Up to ASTEROID_ENTRY_ATTEMPTS candidates are drawn from `rand`; returns null if none is fair.
 * Pure: the same `rand` stream yields the same plan, so seeded runs replay exactly.
 */
export function planAsteroidEntry(
  canvasW: number,
  canvasH: number,
  radius: number,
  actors: readonly ThreatCircle[],
  rand: () => number
): AsteroidEntry | null {
  const off = radius + ASTEROID_ENTRY_EDGE;
  const fair = (x: number, y: number, vx: number, vy: number): boolean => {
    if (Math.atan2(vy, Math.abs(vx)) < ASTEROID_MIN_ANGLE) return false;
    if (actors.some((a) => circleCircle(x, y, radius, a.x, a.y, a.r))) return false;
    const m = asteroidEntryMetrics({ x, y, vx, vy }, radius, canvasW, canvasH);
    return (
      m.crossPx >= ASTEROID_MIN_CROSS_FRAC * canvasW && m.reactionMs >= ASTEROID_MIN_REACTION_MS
    );
  };
  for (let attempt = 0; attempt < ASTEROID_ENTRY_ATTEMPTS; attempt++) {
    let pick = rand();
    let region: AsteroidEntryRegion = "left";
    for (const [r, w] of ASTEROID_REGION_WEIGHTS) {
      region = r;
      if (pick < w) break;
      pick -= w;
    }
    let x: number;
    let y: number;
    switch (region) {
      case "left":
        x = -off;
        y = canvasH * (0.04 + 0.5 * rand());
        break;
      case "right":
        x = canvasW + off;
        y = canvasH * (0.04 + 0.5 * rand());
        break;
      case "top":
        x = canvasW * (0.1 + 0.8 * rand());
        y = -off;
        break;
      case "topLeft":
        x = -off - 20 * rand();
        y = -off - 20 * rand();
        break;
      default:
        x = canvasW + off + 20 * rand();
        y = -off - 20 * rand();
    }
    const tx = canvasW * (0.15 + 0.7 * rand());
    const ty = canvasH * (0.25 + 0.45 * rand());
    const speed = ASTEROID_SPEED_MIN + rand() * (ASTEROID_SPEED_MAX - ASTEROID_SPEED_MIN);
    const len = Math.hypot(tx - x, ty - y) || 1;
    const vx = ((tx - x) / len) * speed;
    const vy = ((ty - y) / len) * speed;
    if (fair(x, y, vx, vy)) return { region, x, y, vx, vy };
  }
  // Deterministic fallback, so a timed spawn is not silently dropped on an awkward canvas (a
  // landscape tablet is short, and a random aim is often too steep to cross far enough before it
  // reaches the player row): scan side-edge entries at the slowest speed over a fixed set of
  // angles, starting at a rand()-chosen offset for variety. The same fairness rules apply.
  const FALLBACK_Y = [0.04, 0.15, 0.3] as const;
  const FALLBACK_ANGLE = [0.35, 0.5, 0.65, 0.8, 0.95] as const;
  const combos: { region: AsteroidEntryRegion; y: number; angle: number }[] = [];
  for (const region of ["left", "right"] as const) {
    for (const fy of FALLBACK_Y) {
      for (const angle of FALLBACK_ANGLE) combos.push({ region, y: canvasH * fy, angle });
    }
  }
  const start = Math.floor(rand() * combos.length);
  for (let i = 0; i < combos.length; i++) {
    const c = combos[(start + i) % combos.length]!;
    const dir = c.region === "left" ? 1 : -1;
    const x = c.region === "left" ? -off : canvasW + off;
    const vx = dir * Math.cos(c.angle) * ASTEROID_SPEED_MIN;
    const vy = Math.sin(c.angle) * ASTEROID_SPEED_MIN;
    if (fair(x, c.y, vx, vy)) return { region: c.region, x, y: c.y, vx, vy };
  }
  return null;
}

/** Everything a fresh rock must not start on top of: live ships (even off-screen ones), the player, Buddy. */
function entryActors(state: StarSwarmState): ThreatCircle[] {
  const out: ThreatCircle[] = [
    {
      x: state.player.x,
      y: state.player.y,
      r: Math.max(state.player.width, state.player.height) / 2,
    },
  ];
  for (const e of state.enemies) if (e.isAlive) out.push(enemyThreatCircle(e));
  for (const b of state.buddyShips) out.push({ x: b.x, y: b.y, r: PLAYER_H / 2 });
  return out;
}

/** A rock entering from a planned off-screen point (#2844); null if no fair trajectory was found. */
function spawnAsteroid(state: StarSwarmState, kind?: AsteroidKind): Asteroid | null {
  const k: AsteroidKind = kind ?? (rng() < ASTEROID_LARGE_CHANCE ? "large" : "small");
  const entry = planAsteroidEntry(
    state.canvasW,
    state.canvasH,
    ASTEROID_STATS[k].radius,
    entryActors(state),
    rng
  );
  return entry ? makeAsteroid(k, entry.x, entry.y, entry.vx, entry.vy) : null;
}

/** Timed spawns happen only mid-wave: never during swoop-in, bonus waves or game over. */
function canSpawnAsteroid(state: StarSwarmState): boolean {
  return (
    state.phase === "Playing" &&
    state.wave >= ASTEROID_MIN_WAVE &&
    !isBossWave(state.wave) && // #2490: no timed rocks on a boss wave — the Carrier is the show
    !state.asteroidsDisabled &&
    state.asteroids.length < MAX_ASTEROIDS
  );
}

/**
 * Dev-panel / test hook: throw a rock now. Honours the on-screen cap but ignores the wave
 * minimum and the dev "disabled" toggle, so a tester can always summon one. #2842: combat only —
 * no hazard may enter during swoop-in (setup time) or extraction (only survivors resolve).
 */
export function throwAsteroid(state: StarSwarmState, kind?: AsteroidKind): StarSwarmState {
  if (!weaponsFree(state) || state.asteroids.length >= MAX_ASTEROIDS) return state;
  const rock = spawnAsteroid(state, kind);
  if (!rock) return state;
  return {
    ...state,
    asteroids: [...state.asteroids, rock],
    runStats: bumpRun(state.runStats, { rocksSpawned: 1 }), // #2491
  };
}

function tickAsteroids(state: StarSwarmState, dtMs: number): StarSwarmState {
  const { canvasW, canvasH } = state;
  let asteroids = mapFilterKeep(
    state.asteroids,
    (a) => ({
      ...a,
      x: a.x + a.vx * dtMs,
      y: a.y + a.vy * dtMs,
      rotation: a.rotation + a.spin * dtMs,
      hitFlashTimer: Math.max(0, a.hitFlashTimer - dtMs),
    }),
    (a) => a.y - a.radius < canvasH + 40 && a.x > -60 - a.radius && a.x < canvasW + 60 + a.radius
  );

  // The timer only runs mid-wave, so a wave never opens with a rock already on the way in.
  let nextAsteroidTimer = state.nextAsteroidTimer;
  let runStats = state.runStats;
  if (state.phase === "Playing") {
    nextAsteroidTimer -= dtMs;
    if (nextAsteroidTimer <= 0) {
      nextAsteroidTimer = asteroidInterval();
      const moved = { ...state, asteroids };
      if (canSpawnAsteroid(moved)) {
        const rock = spawnAsteroid(moved);
        if (rock) {
          asteroids = [...asteroids, rock];
          runStats = bumpRun(runStats, { rocksSpawned: 1 }); // #2491
        }
      }
    }
  }
  if (
    asteroids === state.asteroids &&
    nextAsteroidTimer === state.nextAsteroidTimer &&
    runStats === state.runStats
  ) {
    return state; // #2963: no rocks, and the spawn timer is idle outside Playing
  }
  return { ...state, asteroids, nextAsteroidTimer, runStats };
}

function circleCircle(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Bullets (either owner, piercing or not) that reach a rock are spent on it and chip its HP.
 * `broken` counts the rocks this batch of shots finished off (#2491).
 */
function absorbBulletsIntoRocks<B extends Bullet>(
  bullets: readonly B[],
  rocks: readonly Asteroid[]
): { bullets: B[]; rocks: Asteroid[]; broken: number } {
  const outRocks = [...rocks];
  if (rocks.length === 0) return { bullets: [...bullets], rocks: outRocks, broken: 0 };
  const kept: B[] = [];
  let broken = 0;
  for (const b of bullets) {
    const idx = outRocks.findIndex(
      (r) => r.hp > 0 && collideCircleAABB(r.x, r.y, r.radius, b.x, b.y, b.width, b.height)
    );
    if (idx === -1) {
      kept.push(b);
      continue;
    }
    const r = outRocks[idx]!;
    const hp = r.hp - b.damage;
    if (hp <= 0) broken++;
    outRocks[idx] = { ...r, hp, hitFlashTimer: ASTEROID_HIT_FLASH_MS };
  }
  return { bullets: kept, rocks: outRocks, broken };
}

/**
 * Rocks ram ships: one hit per enemy per rock, in any phase once the ship is on screen
 * (`pathT >= 0` — swooping reinforcements included). A small rock shatters on whatever it hits,
 * a large one keeps going.
 *
 * #2844: the Carrier's immunity comes from its armor, not its tier. `armored` (the tick's
 * starting roster, see tickCollisions) means its force field is up: the rock shatters on the
 * field and the Carrier takes nothing. With the last Guardian gone `armored` is false and the
 * Carrier is an ordinary hull — it takes the rock's hit like any ship (a Carrier the rock kills
 * still drops its hull plating, via `drops`).
 */
function rocksStrikeEnemies(
  rocks: readonly Asteroid[],
  enemies: readonly Enemy[],
  explosions: Explosion[],
  struck: EnemyTier[], // #2487: tiers hit, for tierStats
  armored: boolean,
  drops: PowerUp[],
  canvasH: number
): { rocks: Asteroid[]; enemies: Enemy[]; deflects: number } {
  const outRocks = [...rocks];
  const outEnemies = [...enemies];
  let deflects = 0;
  for (let ri = 0; ri < outRocks.length; ri++) {
    let rock = outRocks[ri]!;
    if (rock.hp <= 0) continue;
    for (let ei = 0; ei < outEnemies.length; ei++) {
      const e = outEnemies[ei]!;
      if (!e.isAlive || (e.pathT < 0 && e.phase !== "Fleeing") || rock.hitEnemyIds.includes(e.id))
        continue;
      if (!asteroidHitsBox(rock, e)) continue;
      if (e.tier === "Carrier" && armored) {
        outEnemies[ei] = { ...e, hitFlashTimer: HIT_FLASH_DURATION };
        rock = { ...rock, hp: 0, shattered: true };
        deflects++;
        break;
      }
      const newHp = e.hp - 1;
      struck.push(e.tier);
      if (newHp <= 0) {
        explosions.push(spawnExplosion(e.x, e.y));
        if (e.tier === "Carrier") drops.push(makePickup("hull", e.x, e.y, canvasH)); // #2488
        outEnemies[ei] = { ...e, hp: 0, isAlive: false, hitFlashTimer: 0 };
      } else {
        outEnemies[ei] = { ...e, hp: newHp, hitFlashTimer: HIT_FLASH_DURATION };
      }
      rock = {
        ...rock,
        hitEnemyIds: [...rock.hitEnemyIds, e.id],
        hitFlashTimer: ASTEROID_HIT_FLASH_MS,
      };
      if (rock.kind === "small") {
        rock = { ...rock, hp: 0, shattered: true };
        break;
      }
    }
    outRocks[ri] = rock;
  }
  return { rocks: outRocks, enemies: outEnemies, deflects };
}

/**
 * Broken rocks pop an explosion; a large one splits in two unless it shattered on impact.
 * #2488: a broken large rock also has a chance to drop a salvage crate — whoever broke it.
 */
function settleRocks(
  rocks: readonly Asteroid[],
  explosions: Explosion[],
  drops: PowerUp[],
  canvasH: number
): Asteroid[] {
  const out: Asteroid[] = [];
  for (const a of rocks) {
    if (a.hp > 0) {
      out.push(a);
      continue;
    }
    explosions.push(spawnExplosion(a.x, a.y));
    // Only a rock broken by shots pays out — one that shattered on a hull (the player's or the
    // Carrier's field) would otherwise hand the ship it just hit a free upgrade (#2540 review).
    if (a.kind === "large" && !a.shattered && rng() < SALVAGE_DROP_CHANCE) {
      drops.push(makePickup("salvage", a.x, a.y, canvasH));
    }
    if (a.kind === "large" && !a.shattered) {
      for (const side of [-1, 1] as const) {
        out.push(makeAsteroid("small", a.x + side * 10, a.y, a.vx + side * 0.06, a.vy));
      }
    }
  }
  return out;
}

/**
 * GLSL-style hash → a fraction in [0, 1). Shared by the outline wobble below and the render
 * layer's per-rock meteor-sprite pick (#2573), so the technique lives in exactly one place.
 */
export function hashFrac(seed: number): number {
  const h = Math.sin(seed) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Deterministic 9-point outline for a rock in world space at its current rotation. Shared by
 * both renderers so the shape is identical on native and web (the id seeds the wobble).
 */
export function asteroidOutline(a: Asteroid): Vec2[] {
  const pts: Vec2[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const wobble = 0.78 + 0.28 * hashFrac(a.id * 12.9898 + i * 78.233);
    const t = a.rotation + (i / n) * Math.PI * 2;
    pts.push({
      x: a.x + Math.cos(t) * a.radius * wobble,
      y: a.y + Math.sin(t) * a.radius * wobble,
    });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// In-run ship upgrades (#2488)
// ---------------------------------------------------------------------------

/** A falling pickup of any type at a world position. */
function makePickup(type: PowerUpType, x: number, y: number, canvasH: number): PowerUp {
  return {
    id: nextId(),
    type,
    x,
    y,
    vy: POWERUP_VY,
    width: POWERUP_W,
    height: POWERUP_H,
    despawnTimer: powerUpDespawnMs(canvasH),
  };
}

/**
 * #2488: the bullets one trigger pull produces at a gun level. L1 a single shot; L2 a twin pair;
 * L3 the pair plus a spread pair drifting outward. Lightning's super-state bullets keep their
 * size, damage and piercing at every level — the ladder decides how many, lightning what kind.
 */
export function playerVolley(x: number, y: number, guns: GunsLevel, isSuper: boolean): Bullet[] {
  const make = (dx: number, vx: number): Bullet => ({
    id: nextId(),
    x: x + dx,
    y,
    vx,
    vy: BULLET_P_VY,
    owner: "player",
    width: isSuper ? BULLET_C_W : BULLET_P_W,
    height: isSuper ? BULLET_C_H : BULLET_P_H,
    damage: isSuper ? SUPER_DAMAGE : 1,
    piercing: isSuper ? true : undefined,
    // #2845: Lightning is the explicit armor-piercing exception — multi-hit AND through the field
    armorPiercing: isSuper ? true : undefined,
  });
  if (guns === 1) return [make(0, 0)];
  const volley = [make(-TWIN_OFFSET, 0), make(TWIN_OFFSET, 0)];
  if (guns === 3) volley.push(make(-SPREAD_OFFSET, -SPREAD_VX), make(SPREAD_OFFSET, SPREAD_VX));
  return volley;
}

/** #2488: ladder changes between two ticks, for the screen's sound and spoken cues. */
export function upgradeEvents(prev: StarSwarmState, next: StarSwarmState): UpgradeEvent[] {
  const a = prev.player;
  const b = next.player;
  const out: UpgradeEvent[] = [];
  const ev = (kind: UpgradeEvent["kind"]) => out.push({ kind, guns: b.guns, hull: b.hull });
  if (b.guns > a.guns) ev("gunsUp");
  else if (b.guns < a.guns) ev("gunsDown");
  if (b.hull > a.hull) ev("hullUp");
  else if (b.hull < a.hull) ev("hullHit");
  return out;
}

// ---------------------------------------------------------------------------
// Enemy asteroid response (#2487)
// ---------------------------------------------------------------------------

const ZERO_TIER_STATS: TierStats = {
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

function bumpStat(
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

const ZERO_RUN_STATS: RunStats = {
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

function bumpRun(stats: RunStats, patch: Partial<Record<keyof RunStats, number>>): RunStats {
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

const TIER_ORDER: readonly EnemyTier[] = ["Grunt", "Elite", "Guardian", "Carrier"];

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

/**
 * #2491 dev-panel hook: destroy every escort at once so the Carrier's final stand, twin fire
 * and plating drop can be reached without playing the wave out. No points — it's a tool, not a
 * bomb — and the escalation latches are left to the next tick to work out as usual.
 */
export function killEscorts(state: StarSwarmState): StarSwarmState {
  if (state.phase !== "Playing") return state;
  const explosions: Explosion[] = [...state.explosions];
  const enemies = state.enemies.map((e) => {
    if (!e.isAlive || e.tier === "Carrier") return e;
    explosions.push(spawnExplosion(e.x, e.y));
    return { ...e, hp: 0, isAlive: false, hitFlashTimer: 0 };
  });
  return { ...state, enemies, explosions };
}

const PATH_PHASES = new Set(["SwoopIn", "Diving", "Returning", "Fleeing", "AttackRun"]);

/** Where the ship will be `ms` from now: on its path if it has one, else where it is. */
function predictEnemyPos(e: Enemy, ms: number): Vec2 {
  if (PATH_PHASES.has(e.phase) && e.path) {
    return evalCubic(e.path, Math.max(0, Math.min(1, e.pathT + ms / e.pathDuration)));
  }
  return { x: e.x, y: e.y };
}

/** Flak envelope shared by formation and diver flak: the rock is approaching and within range. */
function flakEngages(a: Asteroid, e: Enemy): boolean {
  const dx = a.x - e.x;
  const dy = a.y - e.y;
  return a.vx * -dx + a.vy * -dy > 0 && dx * dx + dy * dy < FLAK_RANGE * FLAK_RANGE;
}

/** Will this rock cross the ship's hitbox within the lookahead window? */
function rockThreatens(a: Asteroid, e: Enemy): boolean {
  for (const ms of DODGE_LOOKAHEAD_MS) {
    const p = predictEnemyPos(e, ms);
    if (
      collideCircleAABB(
        a.x + a.vx * ms,
        a.y + a.vy * ms,
        a.radius + DODGE_MARGIN,
        p.x,
        p.y,
        e.width,
        e.height
      )
    )
      return true;
  }
  return false;
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * The part of a cubic still ahead of parameter `t`, as its own cubic (de Casteljau split).
 * Evaluating the result at u gives the original at t + u·(1 − t); at t = 0 it is the same curve.
 */
export function splitRemaining(path: CubicBezier, t: number): CubicBezier {
  if (t <= 0) return path;
  const a = lerp(path.p0, path.p1, t);
  const b = lerp(path.p1, path.p2, t);
  const c = lerp(path.p2, path.p3, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const f = lerp(d, e, t);
  return { p0: f, p1: e, p2: c, p3: path.p3 };
}

/** Shift a path's middle control points sideways; p0 and the destination (p3) are untouched. */
export function nudgePath(
  path: CubicBezier,
  dir: 1 | -1,
  px: number = DODGE_PATH_NUDGE
): CubicBezier {
  return {
    p0: path.p0,
    p1: { x: path.p1.x + dir * px, y: path.p1.y },
    p2: { x: path.p2.x + dir * px, y: path.p2.y },
    p3: path.p3,
  };
}

/**
 * Bend the rest of a ship's path away from a rock without moving the ship: split the curve at
 * its current progress, nudge only the remaining segment, and restart that segment at pathT = 0
 * with the duration it had left, so speed along the path is unchanged. (Nudging the original
 * control points in place would pull the ship's current position sideways by up to ~30 px.)
 */
function nudgeRemainingPath(e: Enemy, dir: 1 | -1, px: number = DODGE_PATH_NUDGE): Enemy {
  const t = Math.max(0, Math.min(1, e.pathT));
  if (t >= 1 || !e.path) return e;
  return {
    ...e,
    path: nudgePath(splitRemaining(e.path, t), dir, px),
    pathT: 0,
    pathDuration: e.pathDuration * (1 - t),
  };
}

/** Current sidestep offset for a ship holding formation (or wiggling); 0 when not dodging. */
function dodgeOffset(e: Enemy): number {
  if (!e.dodge) return 0;
  return e.dodge.dir * DODGE_SIDESTEP * Math.sin((Math.PI * e.dodge.t) / e.dodge.dur);
}

/**
 * #2487/#2844: each live ship looks at each live rock once. Only a ship the rock actually
 * threatens (`rockThreatens`: nearby, approaching or on a projected path into it) reacts — a
 * far-off ship is untouched. Reacting costs attention, paid out of the ship's own next-shot timer
 * (finite combat capacity, see ASTEROID_ATTENTION):
 *  - a threatening rock is a mild distraction (threatMs), once per rock per ship;
 *  - firing flak (formation ships only; the Carrier's flak is a diverted volley, see
 *    chooseCarrierTarget) adds flakMs to the timer, so the flak displaces player-directed fire
 *    instead of riding on top of it. Flak stays outside bulletCap() — the timer pays for it;
 *  - a successful dodge (sidestep in formation, a path nudge on a path) starts `evadeMs`, during
 *    which the ship's player-directed shots are degraded (degradeAim, applied in tickEnemies).
 * On screen (pathT >= 0) and not the Carrier, a ship rolls once per rock to dodge (a Circling ship
 * has no sidestep or path to bend, so it is detected and pays the threat cost but skips the roll).
 * #2881: ships in REACTION_PHASES (Wiggling, Diving, Returning, Fleeing, Circling) also get, once
 * per rock per phase (reactedAsteroidIds resets on a phase change), while threatened: a flinch
 * (FLINCH_CHANCE; evadeMs + the flinchMs wobble cue), flak at the rock (FLAK_BASE x DIVER_FLAK_FACTOR,
 * paid through payAttention so it displaces a shot), and, if the normal dodge did not happen, a
 * late LATE_NUDGE_PX path nudge that leaves the dive endpoint fixed. The armored Carrier is
 * unchanged and the exposed Carrier never reacts.
 * The armored Carrier ignores rocks (its force field shatters them); an exposed Carrier pays the
 * threat distraction but never dodges — it stays heavy. A failed roll takes no action; the
 * collision then follows naturally. All rolls use the seeded rng().
 */
function tickAsteroidThreats(state: StarSwarmState, dtMs: number, ctx: TickCtx): StarSwarmState {
  // #2963: tier stats are copied on their first bump, so a quiet tick keeps the same object
  let ownStats: Record<EnemyTier, TierStats> | null = null;
  const stats = (): Record<EnemyTier, TierStats> => (ownStats ??= { ...state.tierStats });
  const flakShots: Bullet[] = [];
  const paramScale = ctx.paramScale;
  const flakScale = Math.min(FLAK_SCALE_CAP, paramScale);
  const rocks =
    state.asteroids.length === 0 ? state.asteroids : state.asteroids.filter((a) => a.hp > 0);
  // #2963: a live Carrier (carrierStageIn !== null) with no Guardian left (!carrierArmoredIn)
  const carrierExposed = ctx.alive.carrierIdx >= 0 && !ctx.armored;

  const enemies = mapKeep(state.enemies, (e0) => {
    if (!e0.isAlive) return e0;
    let e = e0;
    if (e.flakCooldown > 0) e = { ...e, flakCooldown: Math.max(0, e.flakCooldown - dtMs) };
    if (e.evadeMs > 0) e = { ...e, evadeMs: Math.max(0, e.evadeMs - dtMs) };
    if (e.flinchMs > 0) e = { ...e, flinchMs: Math.max(0, e.flinchMs - dtMs) };
    if (e.reactedPhase !== e.phase) e = { ...e, reactedAsteroidIds: [], reactedPhase: e.phase };
    if (e.attentionMs > 0) e = { ...e, attentionMs: Math.max(0, e.attentionMs - dtMs) };
    if (e.dodge) {
      const t = e.dodge.t + dtMs;
      e = t >= e.dodge.dur ? { ...e, dodge: null } : { ...e, dodge: { ...e.dodge, t } };
    }
    // pathT < 0 means "still off screen" for a swoop-in — a fleeing grunt in its stagger is on
    // screen and fair game (#2489)
    if (rocks.length === 0 || (e.pathT < 0 && e.phase !== "Fleeing")) return e;
    // the armored Carrier's force field handles rocks; it never reacts
    if (e.tier === "Carrier" && !carrierExposed) return e;

    for (const a of rocks) {
      const canFlak =
        e.tier !== "Carrier" &&
        e.phase !== "Fleeing" && // a routed ship never shoots; it has no player shot to displace
        e.flakCooldown <= 0 &&
        weaponsFree(state) && // #2842: no new fire outside combat
        !state.enemyFireDisabled &&
        !state.flakDisabled; // #2491 dev toggle
      const fireFlak = (): void => {
        const tx = a.x + a.vx * FLAK_LEAD_MS;
        const ty = a.y + a.vy * FLAK_LEAD_MS;
        const len = Math.hypot(tx - e.x, ty - e.y) || 1;
        flakShots.push({
          id: nextId(),
          x: e.x,
          y: e.y,
          vx: ((tx - e.x) / len) * FLAK_SPEED,
          vy: ((ty - e.y) / len) * FLAK_SPEED,
          owner: "enemy",
          width: BULLET_E_W,
          height: BULLET_E_H,
          damage: 1,
          flak: true,
        });
        // #2844: the attention cost — this ship's next player-directed shot slips back
        e = payAttention({ ...e, flakCooldown: FLAK_COOLDOWN }, "flak");
        bumpStat(stats(), e.tier, { flak: 1 });
      };

      // Flak: a formation ship shoots at a rock coming its way (the Carrier's is its twin volley)
      if (e.phase === "Formation" && canFlak && rockThreatens(a, e)) {
        if (flakEngages(a, e) && rng() < FLAK_BASE[e.tier] * flakScale) fireFlak();
      }

      // Dodge: one roll per rock per ship (the #2491 dev toggle skips the roll entirely, so the
      // counters only ever describe rolls that were actually taken)
      const alreadyRolled = e.rolledAsteroidIds.includes(a.id);
      const reactive = e.tier !== "Carrier" && REACTION_PHASES.has(e.phase);
      const reacted = reactive && e.reactedAsteroidIds.includes(a.id);
      if (reactive ? reacted : alreadyRolled) continue;
      if (e.tier === "Carrier") {
        // #2844: heavy — no sidestep, but a rock bearing down still takes its attention (once)
        if (rockThreatens(a, e)) {
          e = payAttention({ ...e, rolledAsteroidIds: [...e.rolledAsteroidIds, a.id] }, "threat");
        }
        continue;
      }
      // #2491: dodgeDisabled gates only the dodge roll and the nudges; flinch is ungated and
      // flakDisabled (canFlak) alone gates flak
      if ((state.dodgeDisabled && !reactive) || !rockThreatens(a, e)) continue;
      const onPath = PATH_PHASES.has(e.phase) && e.path !== null;
      let dodgedNow = false;
      if (!alreadyRolled && !state.dodgeDisabled) {
        // #2844 mild distraction
        e = payAttention({ ...e, rolledAsteroidIds: [...e.rolledAsteroidIds, a.id] }, "threat");
        if (e.phase !== "Circling") {
          // a circling ship has no sidestep or path to bend: it is detected and pays, then reacts
          bumpStat(stats(), e.tier, { rolls: 1, pathRolls: onPath ? 1 : 0 });
          if (rng() < dodgeChance(e.tier, paramScale)) {
            dodgedNow = true;
            bumpStat(stats(), e.tier, { dodged: 1, pathDodged: onPath ? 1 : 0 });
            const dir: 1 | -1 = e.x < a.x + a.vx * 400 ? -1 : 1;
            e = onPath
              ? nudgeRemainingPath(e, dir)
              : { ...e, dodge: { dir, t: 0, dur: DODGE_SIDESTEP_MS } };
            e = { ...e, evadeMs: DODGE_SIDESTEP_MS }; // #2844: aim suffers while evading
          }
        }
      }

      // #2881: the visible reactions — once per rock per phase, only for a threatened ship
      if (!reactive) continue;
      e = { ...e, reactedAsteroidIds: [...e.reactedAsteroidIds, a.id] };
      if (rng() < FLINCH_CHANCE[e.tier]) {
        e = { ...e, evadeMs: Math.max(e.evadeMs, FLINCH_MS), flinchMs: FLINCH_MS };
      }
      if (
        canFlak &&
        e.flakCooldown <= 0 &&
        flakEngages(a, e) && // same envelope as formation flak: approaching and within range
        rng() < FLAK_BASE[e.tier] * DIVER_FLAK_FACTOR * flakScale
      ) {
        fireFlak();
      }
      if (
        !state.dodgeDisabled &&
        !dodgedNow &&
        onPath &&
        e.pathT >= 0 &&
        e.pathT < 1 &&
        rng() < LATE_NUDGE_CHANCE[e.tier]
      ) {
        const dir: 1 | -1 = e.x < a.x + a.vx * 400 ? -1 : 1;
        e = nudgeRemainingPath(e, dir, LATE_NUDGE_PX); // p3 untouched: the dive stays committed
      }
    }
    return e;
  });

  if (enemies === state.enemies && flakShots.length === 0 && ownStats === null) return state;
  return {
    ...state,
    enemies,
    enemyBullets: flakShots.length > 0 ? [...state.enemyBullets, ...flakShots] : state.enemyBullets,
    tierStats: ownStats ?? state.tierStats,
  };
}

// ---------------------------------------------------------------------------
// Enemy factories
// ---------------------------------------------------------------------------

function makeEnemy(idx: number, slot: SlotDef, canvasW: number): Enemy {
  const { fx, fy } = slotToWorld(slot, canvasW);
  const size = TIER_SIZE[slot.tier];
  const path = swoopPath(idx, fx, fy, canvasW);
  const p0 = evalCubic(path, 0);
  const delay = (idx * SWOOP_STAGGER) / SWOOP_DURATION;

  return {
    id: nextId(),
    tier: slot.tier,
    phase: "SwoopIn",
    x: p0.x,
    y: p0.y,
    width: size.w,
    height: size.h,
    formationX: fx,
    formationY: fy,
    path,
    pathT: -delay, // negative = waiting; advances to 0 before path traversal begins
    pathDuration: SWOOP_DURATION,
    vel: { x: 0, y: 0 },
    circleCx: 0,
    circleCy: 0,
    circleRadius: CIRCLE_RADIUS + rng() * 10,
    circleAngle: 0,
    circleSpeed: CIRCLE_SPEED * (0.85 + rng() * 0.3),
    shootTimer: rng() * (SHOOT_INTERVAL_BASE + SHOOT_INTERVAL_JITTER),
    diveTargetX: 0,
    hp: TIER_HP[slot.tier],
    isAlive: true,
    hitFlashTimer: 0,
    wiggleTimer: 0,
    burstShotsLeft: 0,
    beamPhase: "idle",
    beamTimer: 0, // #2843: the Carrier's is rolled in buildWaveState / on launch; unused otherwise
    runPhase: "idle",
    runTimer: 0, // #2843: rolled when the Carrier is exposed; unused otherwise
    dodge: null,
    rolledAsteroidIds: [],
    flakCooldown: 0,
    evadeMs: 0,
    flinchMs: 0,
    reactedAsteroidIds: [],
    reactedPhase: "SwoopIn",
    attentionMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Wave helpers
// ---------------------------------------------------------------------------

function diveInterval(wave: number, paramScale = 1): number {
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

// #972: max enemy bullets on screen — 3 at wave 1, +1 every 2 waves; scaled by difficulty
export function bulletCap(wave: number, paramScale = 1): number {
  return Math.min(24, Math.round((3 + Math.floor((wave - 1) / 2)) * paramScale));
}

// #1314: proportional aim — keeps vy = speed (same arrival time), scales vx to intersect the player.
// vx is capped at ±speed so the bullet never travels more than 45° from vertical; without the cap,
// circling enemies near the player's altitude produce extreme vx values (dy is small → dx/dy blows up).
function aimVelocity(
  enemyX: number,
  enemyY: number,
  playerX: number,
  playerY: number,
  speed = BULLET_E_VY
): { vx: number; vy: number } {
  const dy = playerY - enemyY;
  if (dy <= 0) return { vx: 0, vy: speed }; // player at or above enemy — fire straight down
  const dx = playerX - enemyX;
  const rawVx = (dx / dy) * speed;
  const vx = Math.max(-speed, Math.min(speed, rawVx));
  return { vx, vy: speed };
}

// #924/#1314: compute velocity for a Grunt enemy bullet — straight down before wave 1+;
// probability-gated proportional aim that ramps per wave
function aimedBulletVelocity(
  enemyX: number,
  enemyY: number,
  playerX: number,
  playerY: number,
  wave: number,
  paramScale = 1
): { vx: number; vy: number } {
  if (wave < AIMED_SHOT_WAVE_START) return { vx: 0, vy: BULLET_E_VY };
  const cap = Math.min(0.9, 0.6 * paramScale);
  const fraction = Math.min(cap, AIMED_SHOT_FRACTION + (wave - AIMED_SHOT_WAVE_START) * 0.05);
  if (rng() > fraction) return { vx: 0, vy: BULLET_E_VY };
  return aimVelocity(enemyX, enemyY, playerX, playerY);
}

// ---------------------------------------------------------------------------
// Public: initStarSwarm
// ---------------------------------------------------------------------------

export function initStarSwarm(
  canvasW: number,
  canvasH: number,
  wave = 1,
  seed = 42,
  difficulty: DifficultyTier = "LieutenantJG",
  stragglerEnabled?: boolean
): StarSwarmState {
  seedRng(seed);

  const player: Player = {
    x: canvasW / 2,
    y: canvasH - PLAYER_Y_FROM_BOTTOM,
    width: PLAYER_W,
    height: PLAYER_H,
    lives: 3,
    invincibleTimer: 0,
    shootCooldown: 0,
    guns: 1, // #2488: the ladders start over every run
    hull: 0,
    hullFlashTimer: 0,
  };

  return buildWaveState(canvasW, canvasH, wave, player, 0, 0, difficulty, stragglerEnabled);
}

function buildWaveState(
  canvasW: number,
  canvasH: number,
  wave: number,
  player: Player,
  score: number,
  bonusLivesAwarded = 0,
  difficulty: DifficultyTier = "LieutenantJG",
  stragglerOverride: boolean | undefined = undefined,
  // #2842: a wave always opens on a clean transient state — no bullets, rocks, beams or buddy
  // ships carry over (see clearTransientCombat), so nothing here takes them as parameters.
  // #2487: counters carry across waves, reset on a new game
  tierStats: Readonly<Record<EnemyTier, TierStats>> = emptyTierStats(),
  // #2491: likewise
  runStats: RunStats = emptyRunStats()
): StarSwarmState {
  // #2490: a boss wave is the Carrier and its four escorts, nothing else — a short, hostile
  // stage of its own in the slot the old bonus wave held. It swoops in and plays like any wave.
  const bossWave = isBossWave(wave);
  const slots = bossWave ? bossWaveSlots() : waveSlots(wave);
  const built: Enemy[] = slots.map((slot, idx) => makeEnemy(idx, slot, canvasW));
  const phase: StarSwarmState["phase"] = "SwoopIn";

  const startingNonLeaderCount = built.filter((e) => !isLeaderTier(e.tier)).length;

  const powerUps: PowerUp[] = [];
  const dropJitterTarget = triggerKills(wave) + Math.floor(rng() * 5) - 2;
  // #2843: the Carrier's first beam and the first reinforcement launch are seeded rolls from the
  // protected stage's ranges (a boss wave's beam range is already 1.5× faster, from the first on)
  const enemies: Enemy[] = built.map((e) =>
    e.tier === "Carrier"
      ? { ...e, beamTimer: rollCarrierCadence("beam", "protected", difficulty, bossWave) }
      : e
  );
  const reinforceTimer = rollCarrierCadence("reinforce", "protected", difficulty, bossWave);
  const paramScale = difficultyParamScale(difficulty);
  // Ensign gets gentler AI; every tier above gets straggler aggression.
  // stragglerOverride lets the dev panel disable it regardless of difficulty.
  const stragglerEnabled = stragglerOverride ?? difficulty !== "Ensign";

  // Reset invincibility on each new wave so same-tick hit state never carries forward.
  // #2842: the extraction flew the ship off the top — it is back on station, centred.
  const wavePlayer: Player = {
    ...player,
    x: canvasW / 2,
    y: canvasH - PLAYER_Y_FROM_BOTTOM,
    invincibleTimer: 0,
  };

  return {
    phase,
    wave,
    score,
    player: wavePlayer,
    enemies,
    playerBullets: [],
    enemyBullets: [],
    explosions: [],
    powerUps,
    buddyShips: [],
    asteroids: [],
    nextAsteroidTimer: asteroidInterval(),
    asteroidsDisabled: false,
    reinforceTimer,
    reinforcedThisWave: 0,
    carrierBeams: [],
    carrierStage: carrierStageIn(enemies), // "protected": every wave opens with its Guardians
    tierStats,
    runStats,
    dodgeDisabled: false,
    flakDisabled: false,
    phaseTimer: 0,
    extraction: null,
    canvasW,
    canvasH,
    nextDiveTimer: diveInterval(wave, paramScale),
    formationSwayX: 0,
    formationSwayDir: 1,
    bonusLivesAwarded,
    bonusLifeSlowMoTimer: 0,
    startingNonLeaderCount,
    killsSinceLastDrop: 0,
    dropJitterTarget,
    activePowerUp: null,
    // #2490: on a boss wave the Bosses are active from the first tick — bursts and dives
    guardianThresholdCrossed: bossWave,
    guardianDeepThresholdCrossed: false,
    stragglerEnabled,
    pauseStraggler: false,
    routed: false,
    routDisabled: false,
    bombFlashTimer: 0,
    difficulty,
    playerFireDisabled: false,
    enemyFireDisabled: false,
    missionCompleteTimer: 0,
    scoreLedger: emptyScoreLedger(), // #2837: startNextWave carries the run's ledger over
  };
}

// ---------------------------------------------------------------------------
// Public: tick
// ---------------------------------------------------------------------------

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
interface TickCtx {
  readonly alive: AliveRoster;
  /** `difficultyParamScale(state.difficulty)` — the difficulty never changes mid-tick. */
  readonly paramScale: number;
  /** `isBossWave(state.wave)` — the wave changes only in `checkPhaseTransitions`, last. */
  readonly bossWave: boolean;
  /** `carrierArmoredIn(roster)`: a Guardian escort is alive. */
  readonly armored: boolean;
}

/** #2963: alive-roster tallies, one pass over `enemies`. */
interface AliveRoster {
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

function tickCtx(state: StarSwarmState): TickCtx {
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
function carrierStageOf(ctx: TickCtx): CarrierStage | null {
  if (ctx.alive.carrierIdx < 0) return null;
  if (ctx.armored) return "protected";
  return ctx.alive.holdouts > 0 ? "exposed" : "finalStand";
}

/** #2963: `arr.map(fn)`, handing back `arr` itself when `fn` returned every element unchanged. */
function mapKeep<T>(arr: readonly T[], fn: (x: T) => T): readonly T[] {
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
function mapFilterKeep<T>(
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

export function tick(state: StarSwarmState, dtMs: number, input: StarSwarmInput): StarSwarmState {
  if (state.phase === "GameOver") return state;

  // #1078: decrement slow-mo timer with real time; scale all gameplay by BONUS_LIFE_SLOW_MO_SCALE
  const slowMoActive = state.bonusLifeSlowMoTimer > 0;
  const bonusLifeSlowMoTimer = Math.max(0, state.bonusLifeSlowMoTimer - dtMs);
  const scaledDt = slowMoActive ? dtMs * BONUS_LIFE_SLOW_MO_SCALE : dtMs;
  // #2352: purely cosmetic — never gates or slows gameplay, just counts down real time.
  const missionCompleteTimer = decayMissionCompleteTimer(state.missionCompleteTimer, dtMs);

  let s: StarSwarmState =
    bonusLifeSlowMoTimer === state.bonusLifeSlowMoTimer &&
    missionCompleteTimer === state.missionCompleteTimer
      ? state
      : { ...state, bonusLifeSlowMoTimer, missionCompleteTimer };
  const ctx = tickCtx(state); // #2963
  s = tickPlayer(s, scaledDt, input);
  s = tickAsteroidThreats(s, scaledDt, ctx); // #2487: before the enemy tick so a nudged path or sidestep applies now
  s = tickEnemies(s, scaledDt, ctx);
  s = tickBullets(s, scaledDt);
  s = tickAsteroids(s, scaledDt); // #2486
  s = tickPowerUps(s, scaledDt);
  s = tickBuddyShips(s, scaledDt);
  // #2842: the central damage gate — during swoop-in every actor is invulnerable, so no
  // bullet, rock, beam or ram resolves at all (and no incoming enemy can be pre-damaged).
  if (hazardsLive(s)) {
    const awards: ScorePoints = {}; // #2837
    s = tickCollisions(s, awards); // score updated by kills here
    s = commitAwards(s, awards);
  }
  s = tickBonusLives(state, s); // #1078: after score updated; un-GameOvers if bonus life rescues player
  s = tickExplosions(s, scaledDt);
  s = checkPhaseTransitions(s);
  return s;
}

// ---------------------------------------------------------------------------
// Bonus lives (#945)
// ---------------------------------------------------------------------------

// #1078 #1079: repeating threshold scaled by difficulty; slow-mo + invincibility on award
// No early exit on GameOver — if the threshold was just crossed in the same tick the player died,
// the bonus life is still awarded and GameOver is reverted (race condition fix).
function tickBonusLives(prev: StarSwarmState, next: StarSwarmState): StarSwarmState {
  const threshold = bonusLifeThreshold(next.difficulty);
  const livesEarnable = Math.floor(next.score / threshold);
  const livesToAward = Math.max(0, livesEarnable - next.bonusLivesAwarded);

  if (livesToAward === 0 || next.player.lives >= MAX_LIVES) {
    // #2334: no bonus life to revive the player this tick — GameOver sticks. tickCollisions
    // preserved in-flight playerBullets in case of a same-tick revival (see its comment); since
    // there isn't one, finalize the clear here so the frozen GameOver frame doesn't render a
    // stray bolt next to the destroyed ship.
    if (next.phase === "GameOver") return { ...next, playerBullets: [] };
    return next;
  }

  const awarded = Math.min(livesToAward, MAX_LIVES - next.player.lives);
  const newLives = next.player.lives + awarded;

  // #1078: if the bonus life rescued the player from a same-tick lethal hit, revert GameOver —
  // to the phase the tick started in (#2842: a rescue mid-extraction stays in extraction)
  const phase =
    next.phase === "GameOver" && newLives > 0
      ? prev.phase === "GameOver"
        ? "Playing"
        : prev.phase
      : next.phase;

  return {
    ...next,
    phase,
    player: {
      ...next.player,
      lives: newLives,
      invincibleTimer: Math.max(next.player.invincibleTimer, BONUS_LIFE_INVINCIBLE_MS),
    },
    bonusLivesAwarded: next.bonusLivesAwarded + awarded,
    bonusLifeSlowMoTimer: BONUS_LIFE_SLOW_MO_DURATION,
  };
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function tickPlayer(state: StarSwarmState, dtMs: number, input: StarSwarmInput): StarSwarmState {
  const p = state.player;
  const invincibleTimer = Math.max(0, p.invincibleTimer - dtMs);
  const shootCooldown = Math.max(0, p.shootCooldown - dtMs);
  const hullFlashTimer = Math.max(0, p.hullFlashTimer - dtMs); // #2488

  // #2842: after the last kill the AI has the ship — input is ignored until the next wave
  if (state.phase === "Extraction" && state.extraction) {
    const piloted = tickExtractionPilot(state, state.extraction, dtMs);
    return {
      ...state,
      player: { ...piloted.player, invincibleTimer, shootCooldown, hullFlashTimer },
      extraction: piloted.extraction,
    };
  }

  const hw = p.width / 2;
  const newX = Math.max(hw, Math.min(state.canvasW - hw, input.playerX));
  const player: Player = { ...p, x: newX, invincibleTimer, shootCooldown, hullFlashTimer };

  const isSuper = state.activePowerUp?.type === "lightning";

  if (
    shootCooldown === 0 &&
    input.fire &&
    weaponsFree(state) && // #2842: no firing during swoop-in (extraction returned above)
    !state.playerFireDisabled &&
    state.playerBullets.length < MAX_PLAYER_BULLETS
  ) {
    // #2488: the gun level decides how many bullets a trigger pull spawns; the cap still holds
    const room = MAX_PLAYER_BULLETS - state.playerBullets.length;
    const volley = playerVolley(newX, p.y - p.height / 2, p.guns, isSuper).slice(0, room);
    return {
      ...state,
      player: { ...player, shootCooldown: isSuper ? SUPER_SHOOT_COOLDOWN : PLAYER_SHOOT_COOLDOWN },
      playerBullets: [...state.playerBullets, ...volley],
    };
  }

  return { ...state, player };
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

interface EnemyTickResult {
  enemy: Enemy;
  bullet: Bullet | null;
  /** #2485: a volley (the Carrier's twin lasers) — each still counts against bulletCap(). */
  bullets?: Bullet[];
  /** #2843: a released Carrier beam — its own entity from here on (see CarrierBeam). */
  beam?: CarrierBeam;
}

/** #2485/#2843: what the Carrier needs to know that the per-enemy tick otherwise doesn't see. */
export interface CarrierCtx {
  /** Playing phase — the Carrier only acts mid-wave. */
  playing: boolean;
  /** The Carrier's live stage this tick (null with no Carrier). */
  stage: CarrierStage | null;
  /** The stage the Carrier last acted on (`state.carrierStage`) — an escalation re-rolls. */
  prevStage: CarrierStage | null;
  /** #2490: boss wave — the beam cadence is BOSS_WAVE_BEAM_SCALE× faster. */
  bossWave: boolean;
  difficulty: DifficultyTier;
  playerX: number;
  playerY: number;
  canvasH: number;
  /** #2844: a rock the exposed Carrier would answer with flak this tick (see `carrierFlakRock`); else null. */
  flakRock: CarrierFlakRock | null;
  /**
   * #2845: the Buddy an *exposed* Carrier may divert a volley to (nearest in range, pressure cap
   * not reached); null while armored or with no Buddy to shoot at.
   */
  buddy: BuddyShip | null;
}
const NO_CARRIER_CTX: CarrierCtx = {
  playing: false,
  stage: null,
  prevStage: null,
  bossWave: false,
  difficulty: "LieutenantJG",
  playerX: 0,
  playerY: 0,
  canvasH: CANVAS_H,
  flakRock: null,
  buddy: null,
};

/** #2844: the part of a rock the Carrier's flak choice needs. */
export type CarrierFlakRock = Pick<Asteroid, "x" | "y" | "vx" | "vy">;

/**
 * #2843/#2844 finite-capacity seam: where a Carrier volley goes. The Carrier's own timers decide
 * *when* it fires and how much; this decides only *where*. A volley aimed at a rock REPLACES the
 * player-directed one on the same timer — it never adds a volley, a gun or any cadence. #2845:
 * a volley at Buddy plugs in here the same way — the same two guns on the same timer.
 */
export type CarrierTarget =
  | { readonly kind: "player"; readonly x: number; readonly y: number }
  | {
      readonly kind: "rock";
      /** Lead point the flak is aimed at. */
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "buddy";
      /** The Buddy being shot at (the volley leads it, see aimAtBuddy). */
      readonly buddy: BuddyShip;
      /** Stateless per-volley key for the aim-error hash. */
      readonly key: number;
    };

/**
 * #2844: the nearest live rock an *exposed* Carrier would divert its volley to — approaching and
 * within CARRIER_FLAK_RANGE. Null while armored (its force field handles rocks), with flak
 * disabled, or when nothing is coming. Pure and rng-free, so a Carrier's diverted volley never
 * perturbs the seeded stream.
 */
export function carrierFlakRock(
  carrier: Pick<Enemy, "x" | "y">,
  rocks: readonly Asteroid[],
  armored: boolean
): CarrierFlakRock | null {
  if (armored) return null;
  let best: Asteroid | null = null;
  let bestD = CARRIER_FLAK_RANGE * CARRIER_FLAK_RANGE;
  for (const a of rocks) {
    if (a.hp <= 0) continue;
    const dx = a.x - carrier.x;
    const dy = a.y - carrier.y;
    if (a.vx * -dx + a.vy * -dy <= 0) continue; // not approaching
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/**
 * Where this volley goes: a threatening rock first (#2844), then — #2845, exposed Carrier only —
 * Buddy on a `BUDDY_TARGETING.Carrier.divert` roll, else the player. The roll is a stateless hash
 * of `key` (the volley's first bullet id), so it never draws from the seeded rng.
 */
export function chooseCarrierTarget(ctx: CarrierCtx, key = 0): CarrierTarget {
  if (ctx.flakRock) {
    const r = ctx.flakRock;
    return { kind: "rock", x: r.x + r.vx * FLAK_LEAD_MS, y: r.y + r.vy * FLAK_LEAD_MS };
  }
  if (ctx.buddy && buddyDivertRoll(key) < BUDDY_TARGETING.Carrier.divert) {
    return { kind: "buddy", buddy: ctx.buddy, key };
  }
  return { kind: "player", x: ctx.playerX, y: ctx.playerY };
}

/** #2485/#2699: the Carrier's twin lasers, aimed at `target`. */
function carrierTwinVolley(c: Enemy, target: CarrierTarget): Bullet[] {
  return [-TWIN_FIRE_OFFSET, TWIN_FIRE_OFFSET].map((dx) => {
    const ox = c.x + dx;
    const oy = c.y + c.height / 2;
    if (target.kind === "buddy") {
      // #2845: the same two guns on the same timer, aimed at Buddy instead of the player
      const vel = aimAtBuddy(ox, oy, target.buddy, "Carrier", target.key + dx);
      return {
        id: nextId(),
        x: ox,
        y: oy,
        vx: vel.vx,
        vy: vel.vy,
        owner: "enemy" as const,
        width: BULLET_E_W,
        height: BULLET_E_H,
        damage: 1,
        target: "buddy" as const,
      };
    }
    if (target.kind === "rock") {
      // #2844: diverted to flak — same two guns, same timer, aimed at the rock; outside the cap
      const len = Math.hypot(target.x - ox, target.y - oy) || 1;
      return {
        id: nextId(),
        x: ox,
        y: oy,
        vx: ((target.x - ox) / len) * FLAK_SPEED,
        vy: ((target.y - oy) / len) * FLAK_SPEED,
        owner: "enemy" as const,
        width: BULLET_E_W,
        height: BULLET_E_H,
        damage: 1,
        flak: true,
      };
    }
    const vel = aimVelocity(ox, c.y, target.x, target.y, GUARDIAN_BULLET_VY);
    return {
      id: nextId(),
      x: ox,
      y: oy,
      vx: vel.vx,
      vy: vel.vy,
      owner: "enemy" as const,
      width: BULLET_E_W,
      height: BULLET_E_H,
      damage: 1,
    };
  });
}

/** #2843: a released beam, leaving the Carrier's emitter and heading straight down. */
function releaseBeam(c: Enemy): CarrierBeam {
  return {
    id: nextId(),
    x: c.x,
    y: c.y + c.height / 2,
    vy: BEAM_SPEED,
    length: BEAM_LENGTH,
    halfWidth: BEAM_HALF_WIDTH,
  };
}

/**
 * #2843: the Carrier's heavy attack run — not a Grunt dive. It leans out to one side, sweeps
 * down to the player's column (captured when the brace began) at `depth`, and climbs back to
 * its station: one slow, wide, readable swoop that never reaches the player lane. Deeper and
 * quicker in the final stand.
 */
export function carrierRunPath(
  c: Enemy,
  targetX: number,
  canvasH: number,
  stage: Exclude<CarrierStage, "protected">
): CubicBezier {
  const depthY = canvasH * ATTACK_RUN[stage].depth;
  const lean = c.formationX < targetX ? -1 : 1; // swing out away from the target first
  return {
    p0: { x: c.x, y: c.y },
    p1: { x: targetX + lean * 70, y: depthY },
    p2: { x: targetX - lean * 70, y: depthY },
    p3: { x: c.formationX, y: c.formationY },
  };
}

/**
 * #2485/#2843: the Carrier's own tick (station-keeping or on its attack run). Every cadence is a
 * seeded roll from its stage's range (`rollCarrierCadence`), so nothing is metronomic.
 *
 * - Beam: idle → charge (BEAM_CHARGE_MS telegraph) → release. The release is an independent
 *   CarrierBeam; the Carrier goes straight back to idle.
 * - Twin lasers (exposed / final stand only): a pair of aimed shots per roll.
 * - Attack run (exposed / final stand only): brace (ATTACK_RUN_BRACE_MS telegraph) → run.
 *
 * Telegraphs never overlap: a charge never starts during a brace, nor a brace during a charge.
 * While exposed the beam also holds during the run; in the final stand beam, direct fire and
 * movement may combine — each keeps its own telegraph.
 *
 * On an escalation (protected → exposed → final stand) timers pull in: an action that just
 * came online rolls fresh, one already running keeps the sooner of its timer and a new roll.
 */
function tickCarrier(enemy: Enemy, dtMs: number, ctx: CarrierCtx): EnemyTickResult {
  const stage = ctx.stage;
  if (!ctx.playing || !stage) return { enemy, bullet: null };
  const roll = (kind: CarrierCadence) =>
    rollCarrierCadence(kind, stage, ctx.difficulty, ctx.bossWave);

  let e = enemy;
  const prev = ctx.prevStage;
  if (prev && STAGE_RANK[stage] > STAGE_RANK[prev]) {
    const cameOnline = prev === "protected";
    e = {
      ...e,
      beamTimer: e.beamPhase === "idle" ? Math.min(e.beamTimer, roll("beam")) : e.beamTimer,
      shootTimer: cameOnline ? roll("twin") : Math.min(e.shootTimer, roll("twin")),
      runTimer:
        e.runPhase === "idle" && e.phase !== "AttackRun"
          ? cameOnline
            ? roll("attackRun")
            : Math.min(e.runTimer, roll("attackRun"))
          : e.runTimer,
    };
  }

  const armedStage = stage !== "protected";
  const bracing = e.runPhase === "brace";
  const running = e.phase === "AttackRun";

  // ── Beam ──
  let beamPhase: BeamPhase = e.beamPhase;
  let beamTimer = e.beamTimer;
  let beam: CarrierBeam | undefined;
  if (beamPhase === "charge") {
    beamTimer -= dtMs;
    if (beamTimer <= 0) {
      beam = releaseBeam(e);
      beamPhase = "idle";
      beamTimer = roll("beam");
    }
  } else if (!bracing && !(running && stage !== "finalStand")) {
    beamTimer -= dtMs;
    if (beamTimer <= 0) {
      beamPhase = "charge";
      beamTimer = BEAM_CHARGE_MS;
    }
  }

  // ── Twin lasers ──
  let shootTimer = e.shootTimer;
  let bullets: Bullet[] | undefined;
  if (armedStage) {
    shootTimer -= dtMs;
    if (shootTimer <= 0) {
      shootTimer = roll("twin");
      bullets = carrierTwinVolley(e, chooseCarrierTarget(ctx, peekNextId()));
    }
  }

  // ── Attack run ──
  let next: Enemy = { ...e, beamPhase, beamTimer, shootTimer };
  if (running) {
    const newT = e.pathT + dtMs / e.pathDuration;
    if (newT >= 1 || !e.path) {
      next = {
        ...next,
        phase: "Formation",
        x: e.formationX,
        y: e.formationY,
        path: null,
        pathT: 1,
        runTimer: roll("attackRun"),
      };
    } else {
      const pos = evalCubic(e.path, newT);
      next = { ...next, x: pos.x, y: pos.y, pathT: newT };
    }
  } else if (bracing) {
    const runTimer = e.runTimer - dtMs;
    if (runTimer <= 0 && armedStage) {
      const start = { ...next, y: e.formationY };
      next = {
        ...start,
        phase: "AttackRun",
        runPhase: "idle",
        runTimer: 0,
        path: carrierRunPath(start, e.diveTargetX, ctx.canvasH, stage as "exposed" | "finalStand"),
        pathT: 0,
        pathDuration: ATTACK_RUN[stage as "exposed" | "finalStand"].ms,
      };
    } else {
      // rear back: a slow lift and settle, the run's telegraph
      const p = 1 - Math.max(0, runTimer) / ATTACK_RUN_BRACE_MS;
      next = {
        ...next,
        runTimer,
        y: e.formationY - ATTACK_RUN_BRACE_LIFT * Math.sin(Math.PI * p),
      };
    }
  } else if (armedStage) {
    const runTimer = e.runTimer - dtMs;
    // a brace waits for a beam charge to finish, so the two telegraphs never overlap
    if (runTimer <= 0 && beamPhase !== "charge") {
      next = {
        ...next,
        runPhase: "brace",
        runTimer: ATTACK_RUN_BRACE_MS,
        diveTargetX: ctx.playerX,
      };
    } else {
      next = { ...next, runTimer };
    }
  }

  return { enemy: next, bullet: null, bullets, beam };
}

/**
 * #2843: the Carrier's beam charge, for both renderers and the beam-start event; null when it
 * isn't charging (released beams are `state.carrierBeams`).
 */
export function carrierBeamCharge(
  state: StarSwarmState
): { x: number; y: number; progress: number } | null {
  const c = state.enemies.find((e) => e.isAlive && e.tier === "Carrier");
  if (!c || c.beamPhase !== "charge") return null;
  return {
    x: c.x,
    y: c.y + c.height / 2,
    progress: 1 - Math.max(0, c.beamTimer) / BEAM_CHARGE_MS,
  };
}

/** #2843: the Carrier's attack-run brace (telegraph) progress 0–1; null when not bracing. */
export function carrierRunBrace(
  state: StarSwarmState
): { x: number; y: number; r: number; progress: number } | null {
  const c = state.enemies.find((e) => e.isAlive && e.tier === "Carrier");
  if (!c || c.runPhase !== "brace") return null;
  return {
    x: c.x,
    y: c.y,
    r: Math.max(c.width, c.height) * 0.7,
    progress: 1 - Math.max(0, c.runTimer) / ATTACK_RUN_BRACE_MS,
  };
}

/** #2485: true on the tick the Carrier starts charging its beam (telegraph sound + a11y). */
export function carrierBeamJustStarted(prev: StarSwarmState, next: StarSwarmState): boolean {
  return carrierBeamCharge(prev) === null && carrierBeamCharge(next) !== null;
}

/** #2843: true on the tick a beam is released (a beam in flight that wasn't there before). */
export function carrierBeamJustFired(prev: StarSwarmState, next: StarSwarmState): boolean {
  if (next.wave !== prev.wave) return false;
  const before = new Set(prev.carrierBeams.map((b) => b.id));
  return next.carrierBeams.some((b) => !before.has(b.id));
}

/** #2843: true on the tick the Carrier braces for an attack run (its telegraph). */
export function carrierAttackRunJustStarted(prev: StarSwarmState, next: StarSwarmState): boolean {
  return carrierRunBrace(prev) === null && carrierRunBrace(next) !== null;
}

/** #2485: true on the tick a reinforcement batch launches (same wave, counter went up). */
export function reinforcementsJustLaunched(prev: StarSwarmState, next: StarSwarmState): boolean {
  return next.wave === prev.wave && next.reinforcedThisWave > prev.reinforcedThisWave;
}

/** #2489: true on the tick the wave's grunts break and run. */
export function routJustStarted(prev: StarSwarmState, next: StarSwarmState): boolean {
  return next.wave === prev.wave && next.routed && !prev.routed;
}

/** #2489: live grunts currently fleeing — the banner shows while this is > 0. */
export function fleeingCount(state: StarSwarmState): number {
  return state.enemies.filter((e) => e.isAlive && e.phase === "Fleeing").length;
}

/**
 * #2843: the wave's original Grunt slots — the only slots reinforcements may refill, and the
 * ceiling on how many Grunts can be alive at once. None on a boss wave.
 */
function originalGruntSlots(wave: number, bossWave = isBossWave(wave)): readonly SlotDef[] {
  if (bossWave) return NO_SLOTS;
  // #2963: the tick asks every frame — build each wave's list once (it depends on `wave` alone)
  let slots = GRUNT_SLOTS.get(wave);
  if (!slots) {
    slots = waveSlots(wave).filter((s) => s.tier === "Grunt");
    GRUNT_SLOTS.set(wave, slots);
  }
  return slots;
}
const NO_SLOTS: readonly SlotDef[] = [];
const GRUNT_SLOTS = new Map<number, readonly SlotDef[]>();

/** #2843: the wave's original simultaneous Grunt population (0 on a boss wave). */
export function originalGruntCount(wave: number): number {
  return originalGruntSlots(wave).length;
}

/** #2485: reinforcements per wave are capped at half the wave's original grunt slots. */
export function reinforceCap(wave: number): number {
  return Math.floor(originalGruntCount(wave) / 2);
}

function tickSingleEnemy(
  enemy: Enemy,
  dtMs: number,
  playerX: number,
  playerY: number,
  canvasH: number,
  shouldDive: boolean,
  wave: number,
  guardianThresholdCrossed: boolean,
  guardianDeepThresholdCrossed: boolean,
  paramScale = 1,
  carrierCtx: CarrierCtx = NO_CARRIER_CTX
): EnemyTickResult {
  if (!enemy.isAlive) return { enemy, bullet: null };
  // #2485/#2843: the Carrier has its own tick, on station and on its attack run
  if (enemy.tier === "Carrier" && (enemy.phase === "Formation" || enemy.phase === "AttackRun")) {
    return tickCarrier(enemy, dtMs, carrierCtx);
  }

  switch (enemy.phase) {
    case "SwoopIn":
      return tickSwoopIn(enemy, dtMs);
    case "Formation":
      return tickFormation(
        enemy,
        dtMs,
        playerX,
        playerY,
        shouldDive,
        wave,
        guardianThresholdCrossed,
        paramScale
      );
    case "Wiggling":
      return tickWiggling(
        enemy,
        dtMs,
        canvasH,
        guardianThresholdCrossed,
        guardianDeepThresholdCrossed
      );
    case "Diving":
      return tickDiving(
        enemy,
        dtMs,
        canvasH,
        playerX,
        playerY,
        guardianThresholdCrossed,
        guardianDeepThresholdCrossed
      );
    case "Circling":
      return tickCircling(enemy, dtMs, playerX, playerY);
    case "Returning":
      return tickReturning(enemy, dtMs);
    case "Fleeing":
      return tickFleeing(enemy, dtMs);
    case "AttackRun":
      return { enemy, bullet: null }; // #2843: Carrier only, routed above
  }
}

function tickSwoopIn(enemy: Enemy, dtMs: number): EnemyTickResult {
  const newT = enemy.pathT + dtMs / enemy.pathDuration;

  if (newT < 0) {
    // Still waiting (stagger delay)
    return { enemy: { ...enemy, pathT: newT }, bullet: null };
  }

  if (newT >= 1) {
    // Arrived — snap to formation position
    return {
      enemy: {
        ...enemy,
        phase: "Formation",
        x: enemy.formationX,
        y: enemy.formationY,
        pathT: 1,
        path: null,
      },
      bullet: null,
    };
  }

  const pos = evalCubic(enemy.path!, newT);
  return { enemy: { ...enemy, x: pos.x, y: pos.y, pathT: newT }, bullet: null };
}

function tickFormation(
  enemy: Enemy,
  dtMs: number,
  playerX: number,
  playerY: number,
  shouldDive: boolean,
  wave: number,
  guardianThresholdCrossed: boolean,
  paramScale = 1
): EnemyTickResult {
  // #2484/#2485: a Carrier in Formation is routed to tickCarrier before reaching here
  if (enemy.tier === "Carrier") {
    return { enemy, bullet: null };
  }

  // Guardian is passive until threshold crossed: no firing, no diving
  if (enemy.tier === "Guardian" && !guardianThresholdCrossed) {
    return { enemy, bullet: null };
  }

  // #975: transition to Wiggling (not directly to Diving) — gives player a reaction window
  if (shouldDive) {
    return {
      enemy: {
        ...enemy,
        phase: "Wiggling",
        wiggleTimer: WIGGLE_DURATION,
        diveTargetX: playerX,
      },
      bullet: null,
    };
  }

  const shootTimer = enemy.shootTimer - dtMs;
  if (shootTimer > 0) {
    return { enemy: { ...enemy, shootTimer }, bullet: null };
  }

  // #979: Guardian fires in bursts; other tiers use random single-shot interval
  if (enemy.tier === "Guardian") {
    const { enemy: e, bullet } = guardianBurstFire(enemy, playerX, playerY);
    return { enemy: e, bullet };
  }

  // #1314: Elites always fire proportionally-aimed shots; Grunts use wave-scaled probabilistic aim
  const vel =
    enemy.tier === "Elite"
      ? aimVelocity(enemy.x, enemy.y, playerX, playerY)
      : aimedBulletVelocity(enemy.x, enemy.y, playerX, playerY, wave, paramScale);

  const bullet: Bullet = {
    id: nextId(),
    x: enemy.x,
    y: enemy.y + enemy.height / 2,
    vx: vel.vx,
    vy: vel.vy,
    owner: "enemy",
    width: BULLET_E_W,
    height: BULLET_E_H,
    damage: 1,
  };
  return {
    enemy: { ...enemy, shootTimer: SHOOT_INTERVAL_BASE + rng() * SHOOT_INTERVAL_JITTER },
    bullet,
  };
}

// #979: shared burst-fire logic for Guardian in Formation and Diving phases
function guardianBurstFire(enemy: Enemy, playerX: number, playerY: number): EnemyTickResult {
  const newBurstShotsLeft =
    enemy.burstShotsLeft === 0
      ? 2 + Math.floor(rng() * 3) // start new burst: pick 3–5 total shots; return remaining after this shot
      : enemy.burstShotsLeft - 1;
  const newShootTimer =
    newBurstShotsLeft > 0 ? BURST_INTERVAL : BURST_PAUSE_BASE + rng() * BURST_PAUSE_JITTER;

  const vel = aimVelocity(enemy.x, enemy.y, playerX, playerY, GUARDIAN_BULLET_VY); // #1314
  const bullet: Bullet = {
    id: nextId(),
    x: enemy.x,
    y: enemy.y + enemy.height / 2,
    vx: vel.vx,
    vy: vel.vy,
    owner: "enemy",
    width: BULLET_E_W,
    height: BULLET_E_H,
    damage: 1,
  };
  return {
    enemy: { ...enemy, shootTimer: newShootTimer, burstShotsLeft: newBurstShotsLeft },
    bullet,
  };
}

// #975: oscillate ±WIGGLE_AMPLITUDE px for WIGGLE_DURATION ms, then launch Bézier dive
function tickWiggling(
  enemy: Enemy,
  dtMs: number,
  canvasH: number,
  guardianThresholdCrossed: boolean,
  guardianDeepThresholdCrossed: boolean
): EnemyTickResult {
  const newTimer = enemy.wiggleTimer - dtMs;

  if (newTimer <= 0) {
    // Stage 1 Elites: shallow arc; Stage 2 Guardians: shallow arc (like Stage 1 Elites)
    const isGuardianStage2 =
      enemy.tier === "Guardian" && guardianThresholdCrossed && !guardianDeepThresholdCrossed;
    const shallow = (enemy.tier === "Elite" && !guardianThresholdCrossed) || isGuardianStage2;
    const path = divePath(enemy, enemy.diveTargetX, canvasH, shallow);
    const duration = enemy.tier === "Guardian" ? GUARDIAN_DIVE_PATH_DURATION : DIVE_PATH_DURATION;
    return {
      enemy: {
        ...enemy,
        phase: "Diving",
        wiggleTimer: 0,
        path,
        pathT: 0,
        pathDuration: duration,
        vel: { x: 0, y: 0 },
        burstShotsLeft: 0,
        shootTimer: 0,
      },
      bullet: null,
    };
  }

  const elapsed = WIGGLE_DURATION - newTimer;
  const wiggleOffset = Math.sin((4 * Math.PI * elapsed) / WIGGLE_DURATION) * WIGGLE_AMPLITUDE;
  return {
    enemy: { ...enemy, x: enemy.formationX + wiggleOffset, wiggleTimer: newTimer },
    bullet: null,
  };
}

// #977/#1029/#1030: Bézier arc dive
// - Grunts: skip Circling; go directly to Returning at 85%
// - Elites Phase 1 (guardianThresholdCrossed=false): shallow arc, Returning at 60%, no body collision
// - Elites Phase 2 + Guardians: Circling at 85% (existing behaviour)
function tickDiving(
  enemy: Enemy,
  dtMs: number,
  canvasH: number,
  playerX: number,
  playerY: number,
  guardianThresholdCrossed: boolean,
  guardianDeepThresholdCrossed: boolean
): EnemyTickResult {
  const newT = enemy.pathT + dtMs / enemy.pathDuration;
  const pos = evalCubic(enemy.path!, Math.min(newT, 1));

  // Tick shoot timer; Guardian uses burst fire (#979), others use single aimed shot
  const shootTimer = enemy.shootTimer - dtMs;
  let bullet: Bullet | null = null;
  let nextShootTimer = shootTimer;
  let nextBurstShotsLeft = enemy.burstShotsLeft;

  if (shootTimer <= 0) {
    if (enemy.tier === "Guardian") {
      const result = guardianBurstFire(enemy, playerX, playerY);
      bullet = result.bullet;
      nextShootTimer = result.enemy.shootTimer;
      nextBurstShotsLeft = result.enemy.burstShotsLeft;
    } else {
      const vel = aimVelocity(enemy.x, enemy.y, playerX, playerY); // #1314
      bullet = {
        id: nextId(),
        x: enemy.x,
        y: enemy.y + enemy.height / 2,
        vx: vel.vx,
        vy: vel.vy,
        owner: "enemy",
        width: BULLET_E_W,
        height: BULLET_E_H,
        damage: 1,
      };
      nextShootTimer = DIVE_SHOOT_INTERVAL;
    }
  }

  const isElitePhase1 = enemy.tier === "Elite" && !guardianThresholdCrossed;
  // #1077: Stage 2 Guardian uses shallow arc — return to formation like Elite Phase 1, no Circling
  const isGuardianStage2 =
    enemy.tier === "Guardian" && guardianThresholdCrossed && !guardianDeepThresholdCrossed;
  const depthThreshold = isElitePhase1 || isGuardianStage2 ? canvasH * 0.6 : canvasH * 0.85;
  const pathDone = pos.y > depthThreshold || newT >= 1;

  if (pathDone) {
    if (enemy.tier === "Grunt" || isElitePhase1 || isGuardianStage2) {
      // No circling: return directly to formation
      const path = returnPath(pos.x, pos.y, enemy.formationX, enemy.formationY);
      return {
        enemy: {
          ...enemy,
          phase: "Returning",
          x: pos.x,
          y: pos.y,
          pathT: 0,
          path,
          pathDuration: RETURN_DURATION,
          shootTimer: nextShootTimer,
          burstShotsLeft: nextBurstShotsLeft,
        },
        bullet,
      };
    }

    // Elite Phase 2 + Guardian → Circling
    return {
      enemy: {
        ...enemy,
        phase: "Circling",
        x: pos.x,
        y: pos.y,
        pathT: Math.min(newT, 1),
        circleCx: pos.x,
        circleCy: pos.y,
        circleAngle: Math.PI / 2,
        vel: { x: 0, y: 0 },
        shootTimer: nextShootTimer,
        burstShotsLeft: nextBurstShotsLeft,
      },
      bullet,
    };
  }

  return {
    enemy: {
      ...enemy,
      x: pos.x,
      y: pos.y,
      pathT: newT,
      vel: { x: 0, y: 0 },
      shootTimer: nextShootTimer,
      burstShotsLeft: nextBurstShotsLeft,
    },
    bullet,
  };
}

function tickCircling(
  enemy: Enemy,
  dtMs: number,
  playerX: number,
  playerY: number
): EnemyTickResult {
  const newAngle = enemy.circleAngle + enemy.circleSpeed * dtMs;
  const newX = enemy.circleCx + Math.cos(newAngle) * enemy.circleRadius;
  const newY = enemy.circleCy + Math.sin(newAngle) * enemy.circleRadius;

  // #944/#1314: tick shoot timer and fire proportionally-aimed bullet if ready
  const shootTimer = enemy.shootTimer - dtMs;
  let bullet: Bullet | null = null;
  if (shootTimer <= 0) {
    const speed = enemy.tier === "Guardian" ? GUARDIAN_BULLET_VY : undefined;
    const vel = aimVelocity(enemy.x, enemy.y, playerX, playerY, speed);
    bullet = {
      id: nextId(),
      x: enemy.x,
      y: enemy.y + enemy.height / 2,
      vx: vel.vx,
      vy: vel.vy,
      owner: "enemy",
      width: BULLET_E_W,
      height: BULLET_E_H,
      damage: 1,
    };
  }
  const nextShootTimer = shootTimer <= 0 ? DIVE_SHOOT_INTERVAL : shootTimer;

  // After ~1 full revolution (2π rad), start returning
  if (newAngle - Math.PI / 2 >= Math.PI * 2) {
    const path = returnPath(newX, newY, enemy.formationX, enemy.formationY);
    return {
      enemy: {
        ...enemy,
        phase: "Returning",
        x: newX,
        y: newY,
        circleAngle: newAngle,
        path,
        pathT: 0,
        pathDuration: RETURN_DURATION,
        shootTimer: nextShootTimer,
      },
      bullet,
    };
  }

  return {
    enemy: { ...enemy, x: newX, y: newY, circleAngle: newAngle, shootTimer: nextShootTimer },
    bullet,
  };
}

function tickReturning(enemy: Enemy, dtMs: number): EnemyTickResult {
  const newT = enemy.pathT + dtMs / enemy.pathDuration;

  if (newT >= 1) {
    return {
      enemy: {
        ...enemy,
        phase: "Formation",
        x: enemy.formationX,
        y: enemy.formationY,
        pathT: 1,
        path: null,
        shootTimer: SHOOT_INTERVAL_BASE + rng() * SHOOT_INTERVAL_JITTER,
      },
      bullet: null,
    };
  }

  const pos = evalCubic(enemy.path!, newT);
  return { enemy: { ...enemy, x: pos.x, y: pos.y, pathT: newT }, bullet: null };
}

/** #2489: a grunt breaking for the top edge. It never shoots; reaching the end of the path is an
 * escape — the ship is removed with no score (tickEnemies counts it as routEscaped). */
function tickFleeing(enemy: Enemy, dtMs: number): EnemyTickResult {
  const newT = enemy.pathT + dtMs / enemy.pathDuration;
  if (newT < 0) {
    // Hesitating before it bolts — still where it was, still shootable
    return { enemy: { ...enemy, pathT: newT }, bullet: null };
  }
  if (newT >= 1) {
    return { enemy: { ...enemy, isAlive: false, hp: 0, pathT: 1, hitFlashTimer: 0 }, bullet: null };
  }
  const pos = evalCubic(enemy.path!, newT);
  return { enemy: { ...enemy, x: pos.x, y: pos.y, pathT: newT }, bullet: null };
}

/** #2489: put a grunt on its flee path from wherever it is — any phase but SwoopIn. */
function startFleeing(e: Enemy, canvasW: number, difficulty: DifficultyTier): Enemy {
  const scale = difficulty === "Ensign" ? FLEE_ENSIGN_SCALE : 1;
  const duration = (FLEE_DURATION_MIN + rng() * (FLEE_DURATION_MAX - FLEE_DURATION_MIN)) * scale;
  const stagger = rng() * FLEE_STAGGER_MAX;
  return {
    ...e,
    phase: "Fleeing",
    path: fleePath(e.x, e.y, canvasW),
    pathT: -stagger / duration,
    pathDuration: duration,
    dodge: null,
    wiggleTimer: 0,
    burstShotsLeft: 0,
  };
}

function tickEnemies(state: StarSwarmState, dtMs: number, ctx: TickCtx): StarSwarmState {
  // #2963: the opening checks read the tick's starting roster from ctx — tickAsteroidThreats,
  // the only sub-tick since, changes no ship's isAlive, tier or phase
  // #1030: guardianThresholdCrossed latches true once ≤35% non-leader enemies remain
  const aliveNonLeader = ctx.alive.nonLeader;
  const guardianThresholdCrossed =
    state.guardianThresholdCrossed ||
    state.startingNonLeaderCount === 0 ||
    aliveNonLeader / state.startingNonLeaderCount <= GUARDIAN_DIVE_THRESHOLD;

  // #1077: guardianDeepThresholdCrossed latches true at Stage 3 (≤3 enemies alive)
  // #2484: the Carrier never leaves formation, so it is not counted as a straggler
  const aliveAll = ctx.alive.nonCarrier;
  const guardianDeepThresholdCrossed =
    state.guardianDeepThresholdCrossed ||
    (state.stragglerEnabled &&
      !state.pauseStraggler &&
      state.phase === "Playing" &&
      aliveAll > 0 &&
      aliveAll <= 3);

  // #2489: grunt rout — the moment nothing but grunts is left alive (Elites count as leaders here,
  // unlike isLeaderTier), every surviving grunt breaks for the top edge. Decided on the tick's
  // starting roster, before anything shoots or dives, so the trigger tick fires no last volley.
  // Latched for the wave, and re-applied every tick so a reinforcement still swooping in when it
  // happens runs too, the moment it lands.
  let routed = state.routed;
  if (
    !routed &&
    !state.routDisabled &&
    state.phase === "Playing" &&
    ctx.alive.grunts > 0 &&
    ctx.alive.nonGrunts === 0
  ) {
    routed = true;
  }
  const roster = routed
    ? state.enemies.map((e) =>
        e.isAlive && e.tier === "Grunt" && e.phase !== "SwoopIn" && e.phase !== "Fleeing"
          ? startFleeing(e, state.canvasW, state.difficulty)
          : e
      )
    : state.enemies;

  // #926 Dive AI: pick up to maxDivers(wave) formation enemies to send diving
  let nextDiveTimer = state.nextDiveTimer;
  const diveIndices = new Set<number>();

  if (state.phase === "Playing") {
    nextDiveTimer -= dtMs;
    if (nextDiveTimer <= 0) {
      nextDiveTimer = diveInterval(state.wave, ctx.paramScale);
      // #978/#1030: Guardian only eligible once guardianThresholdCrossed
      const candidates = roster
        .map((e, i) => ({ e, i }))
        .filter(
          ({ e }) =>
            e.isAlive &&
            e.phase === "Formation" &&
            e.tier !== "Carrier" && // #2484: never dives
            (e.tier !== "Guardian" || guardianThresholdCrossed)
        );
      // Only launch enough new divers to reach the cap; Wiggling enemies are NOT counted (#975)
      const currentDivers = roster.filter((e) => e.isAlive && e.phase === "Diving").length;
      const allowedNew = Math.max(0, maxDivers(state.wave) - currentDivers);
      for (let k = 0; k < allowedNew && candidates.length > 0; k++) {
        const pick = Math.floor(rng() * candidates.length);
        diveIndices.add(candidates[pick]!.i);
        candidates.splice(pick, 1);
      }
    }
  }

  // #923 Formation sway: advance offset, bounce at ±MAX_SWAY
  const _ps = ctx.paramScale;
  const swaySpeed = SWAY_SPEED_BASE * _ps;
  let swayX = state.formationSwayX + state.formationSwayDir * swaySpeed * dtMs;
  let swayDir = state.formationSwayDir;
  if (swayX >= MAX_SWAY) {
    swayX = MAX_SWAY;
    swayDir = -1;
  } else if (swayX <= -MAX_SWAY) {
    swayX = -MAX_SWAY;
    swayDir = 1;
  }

  // #2963: copied on the first new shot, so a tick that fires nothing keeps the same list
  let newEnemyBullets: Bullet[] | null = null;
  const fire = (b: Bullet): void => {
    (newEnemyBullets ??= [...state.enemyBullets]).push(b);
  };
  // #2487: flak at rocks is outside the cap
  let liveEnemyBulletCount = 0;
  for (const b of state.enemyBullets) if (!b.flak) liveEnemyBulletCount++;
  // #2842: ships that reach formation during swoop-in hold their fire until combat starts
  const enemyWeaponsFree = weaponsFree(state) && !state.enemyFireDisabled;
  const enemyBulletCap = bulletCap(state.wave, _ps);
  // #2843: the Carrier acts on its stage as of the tick's starting roster; an escalation since
  // the stage it last acted on (state.carrierStage) pulls its timers in (see tickCarrier)
  // (#2963: a rout only sets grunts fleeing, and a routed wave has no Carrier — ctx's stage
  // is the roster's whenever the roster is the tick's own; recomputed otherwise all the same)
  const stage = roster === state.enemies ? carrierStageOf(ctx) : carrierStageIn(roster);
  const carrierCtx: { -readonly [K in keyof CarrierCtx]: CarrierCtx[K] } = {
    playing: state.phase === "Playing",
    stage,
    prevStage: state.carrierStage,
    bossWave: ctx.bossWave, // #2490
    difficulty: state.difficulty,
    playerX: state.player.x,
    playerY: state.player.y,
    canvasH: state.canvasH,
    flakRock: null, // set below once the Carrier's position is known
    buddy: null,
  };
  // #2963: the first alive Carrier — a rout maps grunts only, so its index is the roster's too
  const carrierNow = ctx.alive.carrierIdx >= 0 ? roster[ctx.alive.carrierIdx] : undefined;
  if (carrierNow && stage && stage !== "protected" && !state.flakDisabled) {
    // #2844: an exposed Carrier diverts its twin volley to an approaching rock (never while armored)
    carrierCtx.flakRock = carrierFlakRock(carrierNow, state.asteroids, ctx.armored);
  }
  // #2845: fire at Buddy. Every diversion below REPLACES a shot that was about to go at the player
  // (same ship, same timer, same bullet) — no ship gains a gun or any cadence because Buddy is here.
  let buddyIncoming = 0;
  for (const b of state.enemyBullets) if (b.target === "buddy") buddyIncoming++;
  let buddyShotsDrawn = 0;
  if (carrierNow && buddyIncoming + 2 <= BUDDY_MAX_INCOMING) {
    carrierCtx.buddy = buddyTargetFor(carrierNow, state.buddyShips, ctx.armored, state.canvasW);
  }
  // #2963: copied on the first flak bump, not re-spread per bullet
  let ownTierStats: Record<EnemyTier, TierStats> | null = null;
  let newCarrierBeams: CarrierBeam[] | null = null; // #2963: copied on the first release
  let routEscaped = 0; // #2489: fleeing grunts that reached the edge this tick
  let enemies: readonly Enemy[] = roster.map((enemy, idx) => {
    const shouldDive = diveIndices.has(idx);
    const result = tickSingleEnemy(
      enemy,
      dtMs,
      state.player.x,
      state.player.y,
      state.canvasH,
      shouldDive,
      state.wave,
      guardianThresholdCrossed,
      guardianDeepThresholdCrossed,
      _ps,
      carrierCtx
    );
    let e = result.enemy;
    if (enemy.isAlive && enemy.phase === "Fleeing" && !e.isAlive) routEscaped++; // #2489
    // Apply sway offset to enemies holding Formation position
    // #979: Guardian sways ±GUARDIAN_MAX_SWAY (20px) vs ±MAX_SWAY (40px) for other tiers
    if (e.isAlive && e.phase === "Formation") {
      e = { ...e, x: e.formationX + clampSway(e.tier, swayX) + dodgeOffset(e) }; // #2487 sidestep
    }
    if (e.isAlive && (e.phase === "Formation" || e.phase === "AttackRun")) {
      // #2485: beam telegraph — a quick shudder so the player has time to sidestep (#2843: on
      // station or mid-run in the final stand)
      if (e.beamPhase === "charge") {
        const elapsed = BEAM_CHARGE_MS - e.beamTimer;
        e = {
          ...e,
          x: e.x + Math.sin((6 * Math.PI * elapsed) / BEAM_CHARGE_MS) * BEAM_WIGGLE_AMPLITUDE,
        };
      }
    }
    // #2487: a sidestep also carries through the pre-dive wiggle (which recomputes x each tick)
    if (e.isAlive && e.phase === "Wiggling" && e.dodge) {
      e = { ...e, x: e.x + dodgeOffset(e) };
    }
    // Decrement hit-flash timer (#976)
    if (e.isAlive && e.hitFlashTimer > 0) {
      e = { ...e, hitFlashTimer: Math.max(0, e.hitFlashTimer - dtMs) };
    }
    // #2844: a ship that is evading a rock shoots worse — player-directed shots only (flak is
    // already aimed at the rock)
    const evading = enemy.evadeMs > 0;
    const volley = result.bullets;
    const shots = volley ? volley.length : 0;
    // #2963: result.bullet, then result.bullets, without building a list of them
    for (let bi = -1; bi < shots; bi++) {
      const raw = bi < 0 ? result.bullet : volley![bi]!;
      if (!raw) continue;
      let b = raw;
      // #2845: this ship's fire decision — the shot it was about to fire at the player may go to
      // Buddy instead (the Carrier decided inside chooseCarrierTarget). Rng-free (a hash of the
      // bullet id), so Buddy's presence never perturbs the seeded stream.
      if (!b.flak && b.target !== "buddy" && enemy.tier !== "Carrier") {
        const buddy =
          buddyIncoming < BUDDY_MAX_INCOMING
            ? buddyTargetFor(enemy, state.buddyShips, false, state.canvasW)
            : null;
        if (buddy && buddyDivertRoll(b.id) < BUDDY_TARGETING[enemy.tier].divert) {
          b = { ...b, ...aimAtBuddy(b.x, b.y, buddy, enemy.tier, b.id), target: "buddy" };
        }
      } else if (b.target === "buddy" && buddyIncoming >= BUDDY_MAX_INCOMING) {
        // the Carrier chose Buddy on the tick's opening count, but ships ahead of it in the roster
        // have since filled the pressure cap — that volley goes back to the player
        const vel = aimVelocity(b.x, enemy.y, state.player.x, state.player.y, GUARDIAN_BULLET_VY);
        b = { ...b, vx: vel.vx, vy: vel.vy, target: undefined };
      }
      if (evading && !b.flak) {
        // #2844 evasion degrades player-directed aim only. A shot at Buddy keeps its
        // BUDDY_TARGETING aim, but the rng draws are still taken so the seeded stream is the same
        // whichever target the shot went to (the same-seed counterfactual relies on it).
        const degraded = degradeAim(b.vx, b.vy, enemy.tier, rng);
        if (b.target !== "buddy") b = { ...b, ...degraded };
      }
      if (b.flak) {
        // #2844: flak is outside the cap — its price was paid in the ship's fire timer. Only the
        // Carrier's diverted volley reaches here (a volley that replaced a player-directed one).
        if (enemyWeaponsFree) {
          fire(b);
          const stats = (ownTierStats ??= { ...state.tierStats });
          stats[enemy.tier] = { ...stats[enemy.tier], flak: stats[enemy.tier].flak + 1 };
        }
      } else if (liveEnemyBulletCount < enemyBulletCap && enemyWeaponsFree) {
        fire(b);
        liveEnemyBulletCount++;
        if (b.target === "buddy") {
          buddyIncoming++;
          buddyShotsDrawn++;
        }
      }
    }
    // #2843: a released beam is its own entity from here on
    if (result.beam && enemyWeaponsFree) {
      (newCarrierBeams ??= [...state.carrierBeams]).push(result.beam);
    }
    return e;
  });

  // #2485/#2843: Carrier reinforcements — on a seeded, stage-ranged interval, refill vacant
  // *original* grunt slots only, so the live grunt count never exceeds the wave's original
  // grunt population; also capped per wave (reinforceCap). A wave with no original grunts (a
  // boss wave) gets none, and neither does a Carrier in its final stand, nor Ensign.
  // Reinforcements don't touch startingNonLeaderCount, so the 35% / ≤3 latches are unaffected
  // once crossed; until then they delay the escalation, which is the point.
  let reinforceTimer = state.reinforceTimer;
  let reinforcedThisWave = state.reinforcedThisWave;
  let runStats = state.runStats;
  const gruntSlots = originalGruntSlots(state.wave, ctx.bossWave);
  const launchRange = stage ? REINFORCE_COUNT[stage] : undefined;
  if (
    state.phase === "Playing" &&
    stage !== null &&
    launchRange !== undefined &&
    state.difficulty !== "Ensign" &&
    gruntSlots.length > 0
  ) {
    // #2843: an escalation pulls a pending launch into the new stage's range, like the
    // Carrier's other timers (the sooner of what was pending and a fresh seeded roll)
    const prevStage = state.carrierStage;
    if (prevStage && STAGE_RANK[stage] > STAGE_RANK[prevStage]) {
      reinforceTimer = Math.min(
        reinforceTimer,
        rollCarrierCadence("reinforce", stage, state.difficulty, ctx.bossWave)
      );
    }
    reinforceTimer -= dtMs;
    if (reinforceTimer <= 0) {
      reinforceTimer = rollCarrierCadence("reinforce", stage, state.difficulty, ctx.bossWave);
      const live = enemies.filter((e) => e.isAlive);
      let liveGrunts = 0;
      for (const e of live) if (e.tier === "Grunt") liveGrunts++;
      // #2963: a slot is taken when a live ship holds exactly its (fx, fy) — compared as numbers
      // (the same equality the old "fx,fy" string keys gave), with no key strings or Set built
      const empty = gruntSlots.filter((slot) => {
        const { fx, fy } = slotToWorld(slot, state.canvasW);
        return !live.some((e) => e.formationX === fx && e.formationY === fy);
      });
      const n = Math.min(
        empty.length,
        launchRange.min + Math.floor(rng() * (launchRange.max - launchRange.min + 1)),
        reinforceCap(state.wave) - reinforcedThisWave,
        gruntSlots.length - liveGrunts // the population ceiling
      );
      const launched: Enemy[] = [];
      for (let i = 0; i < n; i++) {
        const slot = empty.splice(Math.floor(rng() * empty.length), 1)[0]!;
        const g = makeEnemy(i, slot, state.canvasW);
        launched.push({ ...g, pathT: -(i * 200) / SWOOP_DURATION });
      }
      if (launched.length > 0) {
        enemies = [...enemies, ...launched];
        reinforcedThisWave += launched.length;
        runStats = bumpRun(runStats, { reinforced: launched.length }); // #2491
      }
    }
  }

  if (routEscaped > 0) runStats = bumpRun(runStats, { routEscaped });
  if (buddyShotsDrawn > 0) runStats = bumpRun(runStats, { buddyShotsDrawn }); // #2845

  // #1031: straggler aggression — when ≤3 enemies survive in a Playing wave,
  // all Formation enemies immediately start wiggling
  // #1039: pauseStraggler dev-panel toggle suppresses this
  // #2489: a routed survivor set is fleeing, not fighting — the rule stands down
  if (state.stragglerEnabled && !state.pauseStraggler && state.phase === "Playing" && !routed) {
    const aliveCount = enemies.filter((e) => e.isAlive && e.tier !== "Carrier").length; // #2484
    if (aliveCount > 0 && aliveCount <= 3) {
      enemies = enemies.map((e) => {
        if (!e.isAlive || e.phase !== "Formation" || e.tier === "Carrier") return e;
        return {
          ...e,
          phase: "Wiggling" as const,
          wiggleTimer: WIGGLE_DURATION,
          diveTargetX: state.player.x,
          shootTimer: Math.min(e.shootTimer, SHOOT_INTERVAL_BASE / 2),
        };
      });
    }
  }

  // #2844: the attention debt is a floor under every ship's next-shot timer, whatever the phase
  // changes above did to it (a dive launch zeroes the timer; the straggler rule caps it)
  enemies = mapKeep(enemies, (e) =>
    e.isAlive && e.attentionMs > 0 && e.shootTimer < e.attentionMs
      ? { ...e, shootTimer: e.attentionMs }
      : e
  );

  return {
    ...state,
    enemies,
    enemyBullets: newEnemyBullets ?? state.enemyBullets,
    nextDiveTimer,
    formationSwayX: swayX,
    formationSwayDir: swayDir,
    guardianThresholdCrossed,
    guardianDeepThresholdCrossed,
    reinforceTimer,
    reinforcedThisWave,
    carrierBeams: newCarrierBeams ?? state.carrierBeams,
    tierStats: ownTierStats ?? state.tierStats,
    // #2843: only in combat does the Carrier act on (and so "consume") a stage change
    carrierStage: state.phase === "Playing" ? stage : state.carrierStage,
    runStats,
    routed,
  };
}

// ---------------------------------------------------------------------------
// Power-ups (#980)
// ---------------------------------------------------------------------------

function tickPowerUps(state: StarSwarmState, dtMs: number): StarSwarmState {
  const powerUps = mapFilterKeep(
    state.powerUps,
    (pu) => ({ ...pu, y: pu.y + pu.vy * dtMs, despawnTimer: pu.despawnTimer - dtMs }),
    (pu) => pu.despawnTimer > 0 && pu.y - pu.height / 2 < state.canvasH
  );

  let activePowerUp = state.activePowerUp;
  if (activePowerUp !== null) {
    const newMs = activePowerUp.remainingMs - dtMs;
    if (newMs <= 0) {
      if (__DEV__) {
        const evt =
          activePowerUp.type === "shield"
            ? {
                event: "powerup_expired",
                type: "shield",
                bulletsAbsorbed: activePowerUp.shieldAbsorbed,
              }
            : { event: "powerup_expired", type: activePowerUp.type };

        console.log("[StarSwarm analytics]", evt);
      }
      activePowerUp = null;
    } else {
      activePowerUp = { ...activePowerUp, remainingMs: newMs };
    }
  }

  const bombFlashTimer = Math.max(0, state.bombFlashTimer - dtMs);

  if (
    powerUps === state.powerUps &&
    activePowerUp === state.activePowerUp &&
    bombFlashTimer === state.bombFlashTimer
  ) {
    return state; // #2963: nothing falling, active or flashing
  }
  return { ...state, powerUps, activePowerUp, bombFlashTimer };
}

// ---------------------------------------------------------------------------
// Buddy (#1035, #2845) — a durable, targetable allied ship
// ---------------------------------------------------------------------------
//
// Buddy flies in from a side edge to a standoff lane below the formation (Entering), strafes
// there making BUDDY_BURSTS attack runs — it lines up under its target and fires one piercing
// spread burst per run (OnStation) — then peels off (Leaving). It has BUDDY_HP hit points;
// hostile shots, released Carrier beams and rocks damage it, and at 0 it is destroyed (its
// unfired bursts are lost, its fired shots fly on). Every Buddy decision is deterministic and
// rng-free (stateless hashes of entity ids), so Buddy never perturbs the seeded stream.

/** Stateless [0, 1) roll for a key — a divert decision or an aim error, never the seeded rng. */
function buddyDivertRoll(key: number): number {
  return hashFrac(key * 7.7713 + 1.37);
}

/**
 * #2845: does Buddy notice this hazard at all? A per-hazard, per-Buddy hash against `chance`
 * (see BUDDY_NOTICE) — deterministic, and the imperfection in Buddy's otherwise strong evasion.
 */
export function buddyNotices(buddyId: number, hazardId: number, chance: number): boolean {
  return hashFrac(hazardId * 12.9898 + buddyId * 4.1414 + 0.5) < chance;
}

/** #2845: Buddy's hit circle (with its velocity) — the asteroid contract's input. */
export function buddyThreatCircle(b: BuddyShip, pad = 0): ThreatCircle {
  return { x: b.x, y: b.y, r: BUDDY_HURT_RADIUS + pad, vx: b.vx, vy: b.vy };
}

/**
 * #2845: the Buddy `shooter` may divert a shot to — the nearest one on screen, in range and far
 * enough below it (enemy guns point down); null if none. The armored Carrier never targets Buddy
 * (it has no aimed guns then anyway); from the moment the last Guardian dies it does.
 */
export function buddyTargetFor(
  shooter: Pick<Enemy, "x" | "y" | "tier">,
  buddies: readonly BuddyShip[],
  carrierArmored: boolean,
  canvasW = CANVAS_W
): BuddyShip | null {
  if (shooter.tier === "Carrier" && carrierArmored) return null;
  let best: BuddyShip | null = null;
  let bestD = BUDDY_TARGET_RANGE * BUDDY_TARGET_RANGE;
  for (const b of buddies) {
    if (b.hp <= 0 || b.x < 0 || b.x > canvasW || b.y < 0) continue;
    const dy = b.y - shooter.y;
    if (dy < BUDDY_TARGET_BELOW) continue;
    const dx = b.x - shooter.x;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/**
 * #2845: a shot's velocity from (ox, oy) at Buddy, by tier (BUDDY_TARGETING): its speed, how much
 * of Buddy's motion it leads, and an aim error drawn from a hash of `key`. Grunts are slow, blind
 * to motion and wild; the Carrier is fast, leads fully and barely misses.
 */
export function aimAtBuddy(
  ox: number,
  oy: number,
  buddy: Pick<BuddyShip, "x" | "y" | "vx" | "vy">,
  tier: EnemyTier,
  key: number
): { vx: number; vy: number } {
  const t = BUDDY_TARGETING[tier];
  const flight = Math.hypot(buddy.x - ox, buddy.y - oy) / t.speed;
  const tx = buddy.x + buddy.vx * flight * t.lead;
  const ty = buddy.y + buddy.vy * flight * t.lead;
  const err = (hashFrac(key * 3.7331 + 0.21) * 2 - 1) * t.aimError;
  const ang = Math.atan2(ty - oy, tx - ox) + err;
  return { vx: Math.cos(ang) * t.speed, vy: Math.sin(ang) * t.speed };
}

/**
 * #2845 allied collision policy — an explicit rule, not an omission: only enemy-owned shots can
 * hurt the player or Buddy. Player shots (Buddy's burst included) pass through both allies
 * harmlessly, and player/Buddy shots never collide with each other (nothing tests one player shot
 * against another). The player and Buddy's hulls never collide either. Both still meet hostiles
 * and rocks normally.
 */
export function shotHarmsAllies(b: Pick<Bullet, "owner">): boolean {
  return b.owner === "enemy";
}

/** #2845: what Buddy fires at — the exposed Carrier first, else the formation's centre. */
function buddyAimTarget(state: StarSwarmState): Vec2 | null {
  const carrier = state.enemies.find((e) => e.isAlive && e.tier === "Carrier");
  if (carrier && !carrierArmoredIn(state.enemies)) return { x: carrier.x, y: carrier.y };
  // the armored Carrier is off the list: its field would stop the burst
  const ships = state.enemies.filter(
    (e) => e.isAlive && e.tier !== "Carrier" && e.y >= 0 && e.phase !== "SwoopIn"
  );
  if (ships.length === 0) return null;
  return {
    x: ships.reduce((s, e) => s + e.x, 0) / ships.length,
    y: ships.reduce((s, e) => s + e.y, 0) / ships.length,
  };
}

/** Buddy's lowest allowed lane — it keeps clear of the player's. */
function buddyFloorY(canvasH: number): number {
  return canvasH - PLAYER_Y_FROM_BOTTOM - BUDDY_PLAYER_GAP;
}

/**
 * #2845: where Buddy wants to be right now. A lane below the lowest ship holding formation, and
 * never within BUDDY_STANDOFF of the Carrier (the vertical gap alone guarantees it); strafing
 * ±BUDDY_STRAFE about its target line, except on an attack run (the last BUDDY_RUN_MS before a
 * burst), when it lines up under the target and climbs BUDDY_RUN_RISE — still outside the
 * standoff. The floor (above the player lane) wins if the Carrier dives deep on its own run.
 */
export function buddyStation(
  state: StarSwarmState,
  b: Pick<BuddyShip, "ageMs" | "burstTimer" | "burstsLeft" | "phase">
): Vec2 {
  const { canvasW, canvasH } = state;
  const floor = buddyFloorY(canvasH);
  let formationBottom = 0;
  for (const e of state.enemies) {
    if (e.isAlive && (e.phase === "Formation" || e.phase === "Wiggling")) {
      formationBottom = Math.max(formationBottom, e.y + e.height / 2);
    }
  }
  const carrier = state.enemies.find((e) => e.isAlive && e.tier === "Carrier");
  const standoffY = carrier ? carrier.y + BUDDY_STANDOFF : -Infinity;
  let y = Math.max(formationBottom + BUDDY_FORMATION_GAP, canvasH * 0.4, standoffY);
  const target = buddyAimTarget(state);
  const runIn = b.phase === "OnStation" && b.burstsLeft > 0 && b.burstTimer <= BUDDY_RUN_MS;
  let x: number;
  if (target && runIn) {
    x = target.x;
    y = Math.max(y - BUDDY_RUN_RISE, standoffY);
  } else {
    const cx = target ? target.x : canvasW / 2;
    x = cx + BUDDY_STRAFE * Math.sin((2 * Math.PI * b.ageMs) / BUDDY_STRAFE_PERIOD);
  }
  return {
    x: Math.max(20, Math.min(canvasW - 20, x)),
    y: Math.min(floor, y),
  };
}

/** #2843: a released beam as a chain of overlapping circles covering its length. */
function beamHazards(b: CarrierBeam): Hazard[] {
  const out: Hazard[] = [];
  const step = b.halfWidth * 1.5;
  for (let d = 0; d <= b.length; d += step) {
    out.push({ x: b.x, y: b.y - d, vx: 0, vy: b.vy, r: b.halfWidth });
  }
  return out;
}

/**
 * #2845: the hostiles Buddy is dodging — the enemy shots (flak and shots at the player included),
 * released Carrier beams and threatening rocks (`asteroidThreatens` over BUDDY_ROCK_LOOKAHEAD_MS)
 * that it noticed (BUDDY_NOTICE). Player shots are allied and never listed.
 */
export function buddyHazards(state: StarSwarmState, b: BuddyShip): Hazard[] {
  const out: Hazard[] = [];
  for (const e of state.enemyBullets) {
    if (!shotHarmsAllies(e)) continue;
    if (Math.abs(e.x - b.x) > 280 || Math.abs(e.y - b.y) > 360) continue; // can't arrive in time
    if (!buddyNotices(b.id, e.id, e.target === "buddy" ? BUDDY_NOTICE_AIMED : BUDDY_NOTICE.shot))
      continue;
    out.push({ x: e.x, y: e.y, vx: e.vx, vy: e.vy, r: Math.max(e.width, e.height) / 2 });
  }
  for (const beam of state.carrierBeams) {
    if (buddyNotices(b.id, beam.id, BUDDY_NOTICE.beam)) out.push(...beamHazards(beam));
  }
  const circle = buddyThreatCircle(b, BUDDY_MARGIN);
  for (const a of state.asteroids) {
    if (!asteroidThreatens(a, circle, BUDDY_ROCK_LOOKAHEAD_MS)) continue;
    if (!buddyNotices(b.id, a.id, BUDDY_NOTICE.rock)) continue;
    out.push({ x: a.x, y: a.y, vx: a.vx, vy: a.vy, r: a.radius });
  }
  return out;
}

/** How dangerous steering from Buddy's spot for (tx, ty) is over the next ~700 ms. 0 = clear. */
function buddyDanger(
  b: BuddyShip,
  hazards: readonly Hazard[],
  tx: number,
  ty: number,
  speed: number
): number {
  const dx = tx - b.x;
  const dy = ty - b.y;
  const len = Math.hypot(dx, dy);
  let danger = 0;
  for (const t of BUDDY_LOOKAHEAD_MS) {
    const step = len > 0 ? Math.min(len, speed * t) / len : 0;
    const sx = b.x + dx * step;
    const sy = b.y + dy * step;
    const weight = 1 / (1 + t / 250);
    for (const h of hazards) {
      const reach = h.r + BUDDY_HURT_RADIUS + BUDDY_MARGIN;
      const hx = h.x + h.vx * t - sx;
      const hy = h.y + h.vy * t - sy;
      if (hx * hx + hy * hy < reach * reach) danger += weight;
    }
  }
  return danger;
}

const BUDDY_DODGE_DX = [-90, -60, -30, 0, 30, 60, 90] as const;
const BUDDY_DODGE_DY = [-40, 0, 40] as const;

/**
 * #2845: Buddy's evasion — pick the point to steer for. With nothing noticed it is simply its
 * station. Otherwise it scores its station and a bounded ring of nearby points (±90 px across,
 * ±40 px up/down) against every noticed hazard at its capped speed, and takes the safest, pulled
 * toward its station; on station no point inside the Carrier standoff is considered. Strong (it sees 700 ms
 * ahead), bounded (BUDDY_SPEED, a small ring) and imperfect (BUDDY_NOTICE misses, and it only
 * re-plans every BUDDY_REPLAN_MS).
 */
function planBuddyGoal(
  state: StarSwarmState,
  b: BuddyShip,
  desired: Vec2,
  speed: number,
  clampToField: boolean
): Vec2 {
  const hazards = buddyHazards(state, b);
  if (hazards.length === 0) return desired;
  const carrier = state.enemies.find((e) => e.isAlive && e.tier === "Carrier");
  const floor = buddyFloorY(state.canvasH) + 30;
  // the standoff holds while dodging too — a dodge never ducks in toward the Carrier
  const ceiling = Math.max(state.canvasH * 0.2, carrier ? carrier.y + BUDDY_STANDOFF : 0);
  const candidates: Vec2[] = [desired];
  for (const dx of BUDDY_DODGE_DX) {
    for (const dy of BUDDY_DODGE_DY) {
      let x = b.x + dx;
      let y = b.y + dy;
      if (clampToField) {
        x = Math.max(16, Math.min(state.canvasW - 16, x));
        y = Math.min(floor, Math.max(ceiling, y));
      }
      candidates.push({ x, y });
    }
  }
  let best = desired;
  let bestCost = Infinity;
  for (const c of candidates) {
    let cost = buddyDanger(b, hazards, c.x, c.y, speed) * 1000;
    cost += Math.hypot(c.x - desired.x, c.y - desired.y) * 0.05;
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best;
}

/** #2845: one attack-run burst — a piercing (not armor-piercing) fan at `target`. */
/** #2845: how many shots Buddy's next burst fans out (a stateless hash — rng-free). */
export function buddyBurstCount(b: Pick<BuddyShip, "id" | "burstsLeft">): number {
  return (
    BUDDY_BULLET_COUNT_MIN +
    Math.floor(
      hashFrac(b.id * 9.13 + b.burstsLeft * 2.71) *
        (BUDDY_BULLET_COUNT_MAX - BUDDY_BULLET_COUNT_MIN + 1)
    )
  );
}

/**
 * The whole fan, always — the caller only fires it once the player-bullet cap (#2334: Buddy's
 * shots are player-owned) has room for every shot, so a burst is never spent half-empty.
 */
function buddyBurst(b: BuddyShip, target: Vec2 | null): Bullet[] {
  const count = buddyBurstCount(b);
  const base = target ? Math.atan2(target.y - b.y, target.x - b.x) : -Math.PI / 2;
  const out: Bullet[] = [];
  for (let i = 0; i < count; i++) {
    const angle = count === 1 ? base : base + ((i / (count - 1)) * 2 - 1) * BUDDY_SPREAD_HALF;
    out.push({
      id: nextBuddyId(),
      x: b.x,
      y: b.y,
      vx: Math.cos(angle) * BUDDY_BULLET_SPEED,
      vy: Math.sin(angle) * BUDDY_BULLET_SPEED,
      owner: "player",
      width: BULLET_E_W,
      height: BULLET_E_H,
      damage: 1,
      piercing: true, // multi-hit through ordinary hulls…
      pierceLeft: BUDDY_PIERCE_HITS, // …but only this many (#2880)
      // …but not armorPiercing: the escorted Carrier's field stops it (#2845)
      source: "buddy",
    });
  }
  return out;
}

/** #2845: a fresh Buddy entering from a side edge (the side is a hash of its id — rng-free). */
function makeBuddy(state: StarSwarmState): BuddyShip {
  // Seed Buddy's range from where the main stream is at launch (read-only: nothing is allocated
  // from it), so Buddy's id — which keys its side, fan size and noticing — still differs run to
  // run instead of being the same 1e9 every time. Only ever moves forward, so ids stay unique.
  _nextBuddyId = Math.max(_nextBuddyId, BUDDY_ID_BASE + peekNextId() * 100);
  const id = nextBuddyId();
  const fromLeft = hashFrac(id * 5.19 + 0.3) < 0.5;
  const station = buddyStation(state, {
    ageMs: 0,
    burstTimer: BUDDY_FIRST_BURST_MS,
    burstsLeft: BUDDY_BURSTS,
    phase: "Entering",
  });
  const x = fromLeft ? -30 : state.canvasW + 30;
  return {
    id,
    x,
    y: station.y,
    vx: 0,
    vy: 0,
    phase: "Entering",
    hp: BUDDY_HP,
    hitFlashTimer: 0,
    ageMs: 0,
    stationMs: BUDDY_STATION_MS,
    burstsLeft: BUDDY_BURSTS,
    burstTimer: BUDDY_FIRST_BURST_MS,
    planMs: 0,
    goalX: x,
    goalY: station.y,
    facingRight: fromLeft,
    hitRockIds: [],
  };
}

/** #2845: launch a Buddy (pickup or dev panel) and count it. */
function launchBuddy(state: StarSwarmState): StarSwarmState {
  return {
    ...state,
    buddyShips: [...state.buddyShips, makeBuddy(state)],
    runStats: bumpRun(state.runStats, { buddyLaunched: 1 }),
  };
}

/** #2845: true on the tick a Buddy is destroyed (the screen announces it). */
export function buddyJustLost(prev: StarSwarmState, next: StarSwarmState): boolean {
  return next.runStats.buddyLost > prev.runStats.buddyLost;
}

function tickBuddyShips(state: StarSwarmState, dtMs: number): StarSwarmState {
  if (state.buddyShips.length === 0) return state;
  const { canvasW, canvasH } = state;
  const newPlayerBullets = [...state.playerBullets];
  const updated: BuddyShip[] = [];
  // Nothing left to fight, or the wave is being extracted: every Buddy peels off (unfired bursts
  // are lost). A Buddy in flight during swoop-in holds its fire (weaponsFree), like every gun.
  const standDown = state.phase === "Extraction" || !state.enemies.some((e) => e.isAlive);

  for (const b0 of state.buddyShips) {
    let b: BuddyShip = {
      ...b0,
      ageMs: b0.ageMs + dtMs,
      hitFlashTimer: Math.max(0, b0.hitFlashTimer - dtMs),
      planMs: b0.planMs - dtMs,
    };
    if (standDown && b.phase !== "Leaving") b = { ...b, phase: "Leaving" };

    // ── phase and attack runs ──
    if (b.phase === "Entering") {
      const st = buddyStation(state, b);
      if (Math.hypot(st.x - b.x, st.y - b.y) < 10 || b.ageMs > 2500)
        b = { ...b, phase: "OnStation" };
    } else if (b.phase === "OnStation") {
      let { burstTimer, burstsLeft, stationMs } = b;
      stationMs -= dtMs;
      burstTimer -= dtMs;
      if (burstTimer <= 0 && burstsLeft > 0) {
        const room = MAX_PLAYER_BULLETS - newPlayerBullets.length;
        if (weaponsFree(state) && room >= buddyBurstCount(b)) {
          newPlayerBullets.push(...buddyBurst(b, buddyAimTarget(state)));
          burstsLeft--;
          burstTimer = BUDDY_BURST_INTERVAL;
          if (burstsLeft === 0) stationMs = Math.min(stationMs, 800); // a beat, then away
        } else {
          // hold the run (lined up) until combat allows fire and the player-bullet cap has room
          // for the whole fan; station time still runs, so a blocked burst can't stretch the sortie
          burstTimer = 0;
        }
      }
      b = { ...b, burstTimer, burstsLeft, stationMs };
      if (stationMs <= 0) b = { ...b, phase: "Leaving" };
    }

    // ── steering: station → evasion plan → capped move ──
    const leaving = b.phase === "Leaving";
    const desired: Vec2 = leaving
      ? { x: b.x < canvasW / 2 ? -60 : canvasW + 60, y: b.y - 80 }
      : buddyStation(state, b);
    const speed = b.phase === "OnStation" ? BUDDY_SPEED : BUDDY_TRANSIT_SPEED;
    let goal: Vec2 = { x: b.goalX, y: b.goalY };
    if (b.planMs <= 0) {
      goal = planBuddyGoal(state, b, desired, speed, b.phase === "OnStation");
      b = { ...b, planMs: BUDDY_REPLAN_MS, goalX: goal.x, goalY: goal.y };
    }
    const dx = goal.x - b.x;
    const dy = goal.y - b.y;
    const len = Math.hypot(dx, dy);
    const step = len > 0 ? Math.min(len, speed * dtMs) / len : 0;
    const x = b.x + dx * step;
    const y = b.y + dy * step;
    const vx = dtMs > 0 ? (x - b.x) / dtMs : 0;
    const vy = dtMs > 0 ? (y - b.y) / dtMs : 0;
    const facingRight = Math.abs(vx) > 0.03 ? vx > 0 : b.facingRight;
    b = { ...b, x, y, vx, vy, facingRight };

    const gone = leaving && (x < -30 || x > canvasW + 30 || y < -30 || y > canvasH + 30);
    if (!gone) updated.push(b);
  }

  return { ...state, buddyShips: updated, playerBullets: newPlayerBullets };
}

/**
 * #2845: hostiles against Buddy. Enemy shots (any tier, flak and shots meant for the player
 * included) and released Carrier beams that touch Buddy's hit circle are spent on it — a shot
 * deals its damage, a beam BUDDY_BEAM_DAMAGE. A rock deals BUDDY_ROCK_DAMAGE once per rock
 * (`asteroidHits`); a small one shatters, a large one flies on. The player's shield never covers
 * Buddy, and player shots are allied (`shotHarmsAllies`). At 0 HP Buddy explodes and is removed —
 * its unfired bursts go with it, but the shots it already fired fly on (they are separate
 * entities in `playerBullets`).
 */
function resolveBuddyHits(
  buddies: readonly BuddyShip[],
  enemyBullets: readonly Bullet[],
  beams: readonly CarrierBeam[],
  rocks: Asteroid[],
  explosions: Explosion[]
): { buddies: BuddyShip[]; enemyBullets: Bullet[]; beams: CarrierBeam[]; lost: number } {
  if (buddies.length === 0) {
    return { buddies: [], enemyBullets: [...enemyBullets], beams: [...beams], lost: 0 };
  }
  const spentShots = new Set<number>();
  const spentBeams = new Set<number>();
  const out: BuddyShip[] = [];
  let lost = 0;
  for (const b0 of buddies) {
    let b = b0;
    let damage = 0;
    for (const s of enemyBullets) {
      if (spentShots.has(s.id) || !shotHarmsAllies(s)) continue;
      if (!collideCircleAABB(b.x, b.y, BUDDY_HURT_RADIUS, s.x, s.y, s.width, s.height)) continue;
      spentShots.add(s.id);
      damage += s.damage;
    }
    for (const beam of beams) {
      if (spentBeams.has(beam.id)) continue;
      const hit = collideCircleAABB(
        b.x,
        b.y,
        BUDDY_HURT_RADIUS,
        beam.x,
        beam.y - beam.length / 2,
        beam.halfWidth * 2,
        beam.length
      );
      if (!hit) continue;
      spentBeams.add(beam.id);
      damage += BUDDY_BEAM_DAMAGE;
    }
    const circle = buddyThreatCircle(b);
    for (let ri = 0; ri < rocks.length; ri++) {
      const rock = rocks[ri]!;
      if (b.hitRockIds.includes(rock.id) || !asteroidHits(rock, circle)) continue;
      damage += BUDDY_ROCK_DAMAGE;
      b = { ...b, hitRockIds: [...b.hitRockIds, rock.id] };
      rocks[ri] =
        rock.kind === "small"
          ? { ...rock, hp: 0, shattered: true }
          : { ...rock, hitFlashTimer: ASTEROID_HIT_FLASH_MS };
    }
    if (damage === 0) {
      out.push(b);
      continue;
    }
    const hp = b.hp - damage;
    if (hp <= 0) {
      explosions.push(spawnExplosion(b.x, b.y, nextBuddyId()));
      lost++;
      continue;
    }
    out.push({ ...b, hp, hitFlashTimer: HIT_FLASH_DURATION });
  }
  return {
    buddies: out,
    enemyBullets: spentShots.size
      ? enemyBullets.filter((s) => !spentShots.has(s.id))
      : [...enemyBullets],
    beams: spentBeams.size ? beams.filter((x) => !spentBeams.has(x.id)) : [...beams],
    lost,
  };
}

// ---------------------------------------------------------------------------
// Bullets
// ---------------------------------------------------------------------------

function tickBullets(state: StarSwarmState, dtMs: number): StarSwarmState {
  const { canvasW, canvasH } = state;

  const move = (b: Bullet): Bullet => ({ ...b, x: b.x + b.vx * dtMs, y: b.y + b.vy * dtMs });
  const playerBullets = mapFilterKeep(
    state.playerBullets,
    move,
    (b) => b.y + b.height / 2 > 0 && b.x > -10 && b.x < canvasW + 10
  );

  const enemyBullets = mapFilterKeep(
    state.enemyBullets,
    move,
    (b) =>
      b.y - b.height / 2 < canvasH &&
      b.y + b.height / 2 > -20 && // #2487: flak fired upward at a rock leaves off the top
      b.x > -10 &&
      b.x < canvasW + 10
  );

  // #2843: released Carrier beams fly on whatever became of the Carrier; gone once the whole
  // bolt is below the screen
  const carrierBeams = mapFilterKeep(
    state.carrierBeams,
    (b) => ({ ...b, y: b.y + b.vy * dtMs }),
    (b) => b.y - b.length < canvasH
  );

  if (
    playerBullets === state.playerBullets &&
    enemyBullets === state.enemyBullets &&
    carrierBeams === state.carrierBeams
  ) {
    return state; // #2963: nothing in flight
  }
  return { ...state, playerBullets, enemyBullets, carrierBeams };
}

/** #2843: does this released beam touch the player's hurt circle? */
function beamHitsPlayer(b: CarrierBeam, p: Player): boolean {
  return collideCircleAABB(
    p.x,
    p.y,
    PLAYER_HURT_RADIUS,
    b.x,
    b.y - b.length / 2,
    b.halfWidth * 2,
    b.length
  );
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

function spawnExplosion(x: number, y: number, id: number = nextId()): Explosion {
  return { id, x, y, frame: 0, frameTimer: EXPLOSION_FRAME_MS };
}

// #2837: `awards` collects this tick's points by source; tick() commits them to the ledger.
function tickCollisions(state: StarSwarmState, awards: ScorePoints = {}): StarSwarmState {
  const { player } = state;
  let score = state.score;
  const newExplosions: Explosion[] = [...state.explosions];
  let killsSinceLastDrop = state.killsSinceLastDrop;
  let dropJitterTarget = state.dropJitterTarget;
  let powerUps: PowerUp[] = [...state.powerUps];
  const scoreMult = difficultyMultiplier(state.difficulty);
  // #2484: armor is judged on the tick's starting roster — an escort that dies this same tick
  // still shields the Carrier until the next one.
  const carrierArmored = carrierArmoredIn(state.enemies);
  let rocks: Asteroid[] = [...state.asteroids]; // #2486
  let tierStats: Record<EnemyTier, TierStats> = { ...state.tierStats }; // #2487
  let runStats = state.runStats; // #2491
  let armorDeflects = 0;
  let routCaught = 0; // #2489
  // #2488: in-run upgrade ladders — pickups raise them, a lost life lowers the guns, plating
  // absorbs a hit; pickups spawned this tick (salvage from rocks, plating from the Carrier)
  let guns: GunsLevel = player.guns;
  let hull: HullLevel = player.hull;
  let hullFlashTimer = player.hullFlashTimer;
  const newDrops: PowerUp[] = [];

  // ── Player bullets ↔ enemies ──────────────────────────────────────────────
  const hitBulletIds = new Set<number>(); // non-piercing bullets consumed this tick
  // Piercing bullets aren't consumed on hit, so a slow bullet can keep overlapping a big
  // hitbox across several ticks. New hits are staged here and merged into each bullet's
  // persistent `hitEnemyIds` after the pass, so a bullet can never damage the same enemy twice
  // across its whole flight — not just within this one tick.
  const newPiercingHits = new Map<number, number[]>(); // bulletId -> enemy ids newly hit this tick
  let enemies = state.enemies.map((enemy) => {
    if (!enemy.isAlive) return enemy;

    for (const b of state.playerBullets) {
      if (hitBulletIds.has(b.id)) continue; // spent (a non-piercing hit, or a field deflection)
      if (b.piercing) {
        const alreadyHit = b.hitEnemyIds?.includes(enemy.id);
        const hitThisTick = newPiercingHits.get(b.id)?.includes(enemy.id);
        if (alreadyHit || hitThisTick) continue;
      }
      if (!aabb(b.x, b.y, b.width, b.height, enemy.x, enemy.y, enemy.width, enemy.height)) continue;

      if (b.piercing) {
        const hits = newPiercingHits.get(b.id);
        if (hits) hits.push(enemy.id);
        else newPiercingHits.set(b.id, [enemy.id]);
        // #2880: a capped shot (Buddy's) is spent on its last allowed hit — the hit still lands.
        // Lightning and the player's own piercing carry no counter and are never capped.
        if (
          b.pierceLeft !== undefined &&
          b.pierceLeft - (newPiercingHits.get(b.id)?.length ?? 0) <= 0
        )
          hitBulletIds.add(b.id);
      } else {
        hitBulletIds.add(b.id);
      }

      // #2484/#2845: an escorted Carrier shrugs off every shot that isn't armor-piercing — the
      // bullet is spent on the field (a piercing Buddy shot included: multi-hit through ordinary
      // hulls is not armor bypass), the ring plays, no damage. Lightning is the explicit exception.
      if (enemy.tier === "Carrier" && carrierArmored && !b.armorPiercing) {
        hitBulletIds.add(b.id);
        armorDeflects++;
        return { ...enemy, hitFlashTimer: HIT_FLASH_DURATION };
      }

      const newHp = enemy.hp - b.damage;

      if (newHp <= 0) {
        newExplosions.push(spawnExplosion(enemy.x, enemy.y));
        // #2488: the Carrier always drops hull plating
        if (enemy.tier === "Carrier")
          newDrops.push(makePickup("hull", enemy.x, enemy.y, state.canvasH));
        const base = TIER_SCORE[enemy.tier];
        // #2489: a fleeing grunt pays the dive multiplier — it was getting away
        const onTheMove =
          enemy.phase === "Diving" || enemy.phase === "Circling" || enemy.phase === "Fleeing";
        const mult = onTheMove ? DIVE_SCORE_MULT : 1;
        if (enemy.phase === "Fleeing") routCaught++;
        const mod = enemy.phase === "Fleeing" ? "rout" : onTheMove ? "dive" : undefined; // #2837
        score += award(awards, scoreSource(enemy.tier, mod), Math.round(base * mult * scoreMult));
        if (state.phase === "Playing") killsSinceLastDrop++;
        return { ...enemy, hp: 0, isAlive: false, hitFlashTimer: 0 };
      }

      // Non-lethal hit — shield ring burst (#1310); killing blow skips flash (explosion takes over)
      return { ...enemy, hp: newHp, hitFlashTimer: HIT_FLASH_DURATION };
    }
    return enemy;
  });

  if (armorDeflects > 0) runStats = bumpRun(runStats, { armorDeflects });
  if (routCaught > 0) runStats = bumpRun(runStats, { routCaught });

  // Piercing bullets are removed by the off-screen filter in tickBullets, not here
  let playerBullets: Bullet[] = state.playerBullets
    .filter((b) => !hitBulletIds.has(b.id))
    .map((b) => {
      const hits = newPiercingHits.get(b.id);
      if (!hits) return b;
      return {
        ...b,
        hitEnemyIds: [...(b.hitEnemyIds ?? []), ...hits],
        ...(b.pierceLeft !== undefined ? { pierceLeft: b.pierceLeft - hits.length } : {}),
      };
    });

  // #2486: rocks are cover — any shot that reaches one is spent on it (piercing shots included),
  // then rocks ram whatever they fly into. Nobody scores for any of it.
  {
    const absorbed = absorbBulletsIntoRocks(playerBullets, rocks);
    playerBullets = absorbed.bullets;
    if (absorbed.broken > 0) runStats = bumpRun(runStats, { rocksBrokenByPlayer: absorbed.broken }); // #2491
    const struckTiers: EnemyTier[] = [];
    const struck = rocksStrikeEnemies(
      absorbed.rocks,
      enemies,
      newExplosions,
      struckTiers,
      carrierArmored, // #2844: the field is judged on the tick's starting roster
      newDrops,
      state.canvasH
    );
    rocks = struck.rocks;
    enemies = struck.enemies;
    if (struck.deflects > 0) runStats = bumpRun(runStats, { armorDeflects: struck.deflects });
    if (struckTiers.length > 0) {
      const next = { ...tierStats };
      for (const tier of struckTiers) bumpStat(next, tier, { struck: 1 });
      tierStats = next;
    }
  }

  // ── Power-up drop check (Playing only, max 1 on screen) ────────────────────
  // #2488: salvage crates and plating are upgrade pickups, not power-ups — they don't hold
  // the slot (#2540 review), or frequent rock salvage would starve shields and bombs.
  const isPowerUpDrop = (p: PowerUp) => p.type !== "salvage" && p.type !== "hull";
  if (
    state.phase === "Playing" &&
    killsSinceLastDrop >= dropJitterTarget &&
    !powerUps.some(isPowerUpDrop)
  ) {
    // #1032: X uses Math.random() — cosmetic, non-deterministic
    const spawnX = POWERUP_W / 2 + Math.random() * (state.canvasW - POWERUP_W);
    powerUps = [
      ...powerUps, // #2488: keep any upgrade pickups already falling
      {
        id: nextId(),
        type: pickPowerUpType(state.player.lives),
        x: spawnX,
        y: POWERUP_H / 2,
        vy: POWERUP_VY,
        width: POWERUP_W,
        height: POWERUP_H,
        despawnTimer: powerUpDespawnMs(state.canvasH),
      },
    ];
    killsSinceLastDrop = 0;
    dropJitterTarget = triggerKills(state.wave) + Math.floor(rng() * 5) - 2;
  }

  // ── Player ↔ power-up collection ────────────────────────────────────────
  let activePowerUp = state.activePowerUp;
  let buddyShips = [...state.buddyShips];
  let bombFlashTimer = state.bombFlashTimer;
  let bombActivated = false;
  const collectedIdx = powerUps.findIndex((pu) =>
    aabb(player.x, player.y, player.width, player.height, pu.x, pu.y, pu.width, pu.height)
  );
  if (collectedIdx !== -1) {
    const collected = powerUps[collectedIdx]!;
    powerUps = powerUps.filter((_, i) => i !== collectedIdx);

    if (__DEV__) {
      console.log("[StarSwarm analytics]", {
        event: "powerup_collected",
        type: collected.type,
        wave: state.wave,
        livesAtCollection: player.lives,
      });
    }

    if (collected.type === "salvage") {
      // #2488: one gun level per crate; nothing at the top of the ladder (and no points)
      guns = Math.min(GUNS_MAX, guns + 1) as GunsLevel;
    } else if (collected.type === "hull") {
      hull = Math.min(HULL_MAX, hull + 1) as HullLevel;
    } else if (collected.type === "bomb") {
      // #1034: instant — clear all enemy bullets, deal 1 damage to every alive enemy
      bombActivated = true;
      bombFlashTimer = BOMB_FLASH_DURATION;
      rocks = rocks.map((a) => ({ ...a, hp: 0, shattered: true })); // #2486: the blast clears rocks too
      let bombCaught = 0;
      const armoredNow = carrierArmoredIn(enemies);
      enemies = enemies.map((e) => {
        if (!e.isAlive) return e;
        // #2484: the blast rings off an escorted Carrier's force field
        if (e.tier === "Carrier" && armoredNow) return { ...e, hitFlashTimer: HIT_FLASH_DURATION };
        const newHp = e.hp - 1;
        if (newHp <= 0) {
          newExplosions.push(spawnExplosion(e.x, e.y));
          // #2488: the Carrier drops plating however it dies
          if (e.tier === "Carrier") newDrops.push(makePickup("hull", e.x, e.y, state.canvasH));
          if (e.phase === "Fleeing") bombCaught++; // #2489: caught is caught, even at 1×
          // no dive multiplier for bomb kills
          score += award(
            awards,
            scoreSource(e.tier, "bomb"),
            Math.round(TIER_SCORE[e.tier] * scoreMult)
          );
          if (state.phase === "Playing") killsSinceLastDrop++;
          return { ...e, hp: 0, isAlive: false, hitFlashTimer: 0 };
        }
        return { ...e, hp: newHp, hitFlashTimer: HIT_FLASH_DURATION };
      });
      if (bombCaught > 0) runStats = bumpRun(runStats, { routCaught: bombCaught });
    } else if (collected.type === "buddy") {
      // #1035/#2845: launch Buddy
      buddyShips = [...buddyShips, makeBuddy({ ...state, enemies })];
      runStats = bumpRun(runStats, { buddyLaunched: 1 });
    } else {
      // lightning or shield: duration buff
      activePowerUp = { remainingMs: POWERUP_DURATION, type: collected.type, shieldAbsorbed: 0 };
    }
  }

  // ── Enemy contact ↔ player (bullets + #925 diving/circling ships) ──────────
  // #974: player uses a small forgiveness circle (PLAYER_HURT_RADIUS) instead of full AABB
  // #1033: shield absorbs enemy bullets (body collision still kills)
  const shieldActive = activePowerUp?.type === "shield";

  // #1034: bomb cleared all enemy bullets on activation
  let currentEnemyBullets: typeof state.enemyBullets = bombActivated ? [] : state.enemyBullets;
  // #2843: …and every released Carrier beam (enemy projectiles too); a charge on the Carrier
  // isn't a projectile yet, so it is untouched
  let carrierBeams: readonly CarrierBeam[] = bombActivated ? [] : state.carrierBeams;

  // #2486: enemy shots are spent on rocks the same way the player's are
  {
    const absorbed = absorbBulletsIntoRocks(currentEnemyBullets, rocks);
    currentEnemyBullets = absorbed.bullets;
    rocks = absorbed.rocks;
    if (absorbed.broken > 0) runStats = bumpRun(runStats, { rocksBrokenByEnemy: absorbed.broken }); // #2491
  }

  // #2845: hostiles ↔ Buddy — before the player, so a shot that reaches Buddy first is spent there
  {
    const hit = resolveBuddyHits(
      buddyShips,
      currentEnemyBullets,
      carrierBeams,
      rocks,
      newExplosions
    );
    buddyShips = hit.buddies;
    currentEnemyBullets = hit.enemyBullets;
    carrierBeams = hit.beams;
    if (hit.lost > 0) runStats = bumpRun(runStats, { buddyLost: hit.lost });
  }

  if (player.invincibleTimer <= 0) {
    // #2842: every enemy shot in flight is live — including during extraction, after the ship
    // that fired it (or the whole wave) has died. Only the wave-boundary reset removes them.
    const bulletHits = currentEnemyBullets.filter((b) =>
      collideCircleAABB(player.x, player.y, PLAYER_HURT_RADIUS, b.x, b.y, b.width, b.height)
    );
    const hitByBullet = bulletHits.length > 0;
    // #2486: a rock on the hull is treated like a shot — the shield absorbs it, otherwise it
    // costs a life. Either way the rock shatters.
    const rockHitIdx = rocks.findIndex(
      (a) => a.hp > 0 && circleCircle(player.x, player.y, PLAYER_HURT_RADIUS, a.x, a.y, a.radius)
    );
    const hitByRock = rockHitIdx !== -1;
    if (hitByRock) rocks[rockHitIdx] = { ...rocks[rockHitIdx]!, hp: 0, shattered: true };
    // #2843: a released Carrier beam that reaches the ship is spent on it — shield-absorbed or
    // not — so one beam costs at most one plate or one life. Whether its Carrier still lives is
    // irrelevant: a released beam is its own entity.
    const beamHitIds = new Set(
      carrierBeams.filter((b) => beamHitsPlayer(b, player)).map((b) => b.id)
    );
    const hitByBeam = beamHitIds.size > 0;
    if (hitByBeam) carrierBeams = carrierBeams.filter((b) => !beamHitIds.has(b.id));

    // #1033: the shield absorbs projectiles (bullets, a rock, the beam) but never a ship
    // collision, so the ram check below runs whether or not something was absorbed this tick
    // (#2533).
    const projectileHit = hitByBullet || hitByRock || hitByBeam;
    const absorbed = projectileHit && shieldActive;
    if (absorbed) {
      // Shield absorbs the bullets — no damage.
      currentEnemyBullets = currentEnemyBullets.filter(
        (b) =>
          !collideCircleAABB(player.x, player.y, PLAYER_HURT_RADIUS, b.x, b.y, b.width, b.height)
      );
      activePowerUp = {
        ...activePowerUp!,
        shieldAbsorbed: activePowerUp!.shieldAbsorbed + bulletHits.length + (hitByRock ? 1 : 0),
      };
    }
    {
      // #956/#1029/#1030/#1077: capture the ramming enemy so we can destroy it on collision
      // Guardians collidable only in Stage 3 (guardianDeepThresholdCrossed); Elite Phase 1 always exempt
      // A projectile that already costs the life makes the ram check moot; an absorbed one doesn't.
      let rammingEnemyId: number | null = null;
      const hitByShip =
        (absorbed || !projectileHit) &&
        enemies.some((e) => {
          if (!e.isAlive) return false;
          if (e.tier === "Carrier") return false; // #2484: never leaves formation
          if (e.tier === "Guardian" && !state.guardianDeepThresholdCrossed) return false;
          if (e.tier === "Elite" && !state.guardianThresholdCrossed) return false;
          if (e.phase !== "Diving" && e.phase !== "Circling") return false;
          if (
            !collideCircleAABB(player.x, player.y, PLAYER_HURT_RADIUS, e.x, e.y, e.width, e.height)
          )
            return false;
          rammingEnemyId = e.id;
          return true;
        });

      if (hitByShip || (projectileHit && !absorbed)) {
        // #2491/#2843: a beam that lands (plating or a life) counts once — it is spent on the
        // ship, so the same beam can never land twice
        if (hitByBeam && !absorbed) runStats = bumpRun(runStats, { beamHits: 1 });
        const finalEnemies =
          hitByShip && rammingEnemyId !== null
            ? enemies.map((e) => {
                if (e.id === rammingEnemyId) {
                  newExplosions.push(spawnExplosion(e.x, e.y));
                  score += award(
                    awards,
                    scoreSource(e.tier, "ram"),
                    Math.round(TIER_SCORE[e.tier] * DIVE_SCORE_MULT * scoreMult)
                  );
                  return { ...e, hp: 0, isAlive: false };
                }
                return e;
              })
            : enemies;

        const enemyBulletsAfterHit = hitByBullet
          ? currentEnemyBullets.filter(
              (b) =>
                !collideCircleAABB(
                  player.x,
                  player.y,
                  PLAYER_HURT_RADIUS,
                  b.x,
                  b.y,
                  b.width,
                  b.height
                )
            )
          : currentEnemyBullets;

        // #2488: hull plating takes the hit before a life does — shield → hull → life. The rammer
        // still dies and the bullet is still spent; the ship gets a short grace, not a respawn.
        if (hull > 0) {
          hull = (hull - 1) as HullLevel;
          hullFlashTimer = HIT_FLASH_DURATION;
          const settledRocks = settleRocks(rocks, newExplosions, newDrops, state.canvasH);
          return {
            ...state,
            enemies: finalEnemies,
            asteroids: settledRocks,
            tierStats,
            runStats,
            playerBullets,
            enemyBullets: enemyBulletsAfterHit,
            carrierBeams,
            explosions: newExplosions,
            score,
            powerUps: [...powerUps, ...newDrops],
            buddyShips,
            killsSinceLastDrop,
            dropJitterTarget,
            activePowerUp,
            bombFlashTimer,
            player: {
              ...player,
              guns,
              hull,
              hullFlashTimer,
              // #2843: a beam is spent on contact, so one plate per beam needs no longer grace
              invincibleTimer: Math.max(player.invincibleTimer, HULL_INVINCIBLE_MS),
            },
          };
        }

        const newLives = player.lives - 1;
        guns = Math.max(1, guns - 1) as GunsLevel; // #2488: a death costs one gun level
        newExplosions.push(spawnExplosion(player.x, player.y));

        if (newLives <= 0) {
          const settledRocks = settleRocks(rocks, newExplosions, newDrops, state.canvasH);
          return {
            ...state,
            enemies: finalEnemies,
            asteroids: settledRocks, // #2486
            tierStats,
            runStats,
            // #2334: tick() short-circuits on GameOver (see the phase guard near the top
            // of this file), freezing whatever frame is current — including any player
            // bullets mid-flight. Normally we'd clear them here so the frozen frame doesn't
            // render a stray bolt next to the destroyed ship, but tickBonusLives (#1078) can
            // still revive this same tick if a bonus-life threshold was also just crossed —
            // clearing unconditionally would permanently drop those bullets on a rescue. Keep
            // the (already collision-filtered) survivors here; tickBonusLives finalizes the
            // clear only if the GameOver sticks.
            playerBullets,
            enemyBullets: enemyBulletsAfterHit,
            carrierBeams,
            explosions: newExplosions,
            score,
            powerUps: [...powerUps, ...newDrops],
            buddyShips,
            killsSinceLastDrop,
            dropJitterTarget,
            activePowerUp,
            bombFlashTimer,
            player: { ...player, guns, hull, hullFlashTimer, lives: 0 },
            phase: "GameOver",
          };
        }

        const settledRocks = settleRocks(rocks, newExplosions, newDrops, state.canvasH);
        return {
          ...state,
          enemies: finalEnemies,
          asteroids: settledRocks, // #2486
          tierStats,
          runStats,
          playerBullets,
          enemyBullets: enemyBulletsAfterHit,
          carrierBeams,
          explosions: newExplosions,
          score,
          powerUps: [...powerUps, ...newDrops],
          buddyShips,
          killsSinceLastDrop,
          dropJitterTarget,
          activePowerUp,
          bombFlashTimer,
          player: {
            ...player,
            guns,
            hull,
            hullFlashTimer,
            lives: newLives,
            invincibleTimer: PLAYER_INVINCIBLE_MS,
          },
        };
      }
    }
  }

  const settledRocks = settleRocks(rocks, newExplosions, newDrops, state.canvasH);
  return {
    ...state,
    enemies,
    asteroids: settledRocks, // #2486
    tierStats,
    runStats,
    player: { ...player, guns, hull, hullFlashTimer }, // #2488
    playerBullets,
    enemyBullets: currentEnemyBullets,
    carrierBeams,
    score,
    explosions: newExplosions,
    powerUps: [...powerUps, ...newDrops],
    buddyShips,
    killsSinceLastDrop,
    dropJitterTarget,
    activePowerUp,
    bombFlashTimer,
  };
}

// ---------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------

function tickExplosions(state: StarSwarmState, dtMs: number): StarSwarmState {
  const explosions = mapFilterKeep(
    state.explosions,
    (ex) => {
      const frameTimer = ex.frameTimer - dtMs;
      if (frameTimer <= 0) {
        return { ...ex, frame: ex.frame + 1, frameTimer: EXPLOSION_FRAME_MS };
      }
      return { ...ex, frameTimer };
    },
    (ex) => ex.frame < EXPLOSION_FRAMES
  );

  return explosions === state.explosions ? state : { ...state, explosions }; // #2963
}

// ---------------------------------------------------------------------------
// Wave lifecycle (#2842)
// ---------------------------------------------------------------------------
//
//   SwoopIn ──all arrived──▶ Playing ──last kill──▶ Extraction ──ship out──▶ clearTransientCombat
//      ▲                                                                           │
//      └─────────────────────────────── buildWaveState (wave N+1) ◀────────────────┘
//
// The screen's 3 s countdown runs with the engine frozen before each SwoopIn, so combat begins
// only once both the countdown and the swoop-in are over. Two central gates decide everything:
// weaponsFree (may anything *new* be fired or spawned?) and hazardsLive (does anything already
// in flight resolve — hit, damage, collect?).

/**
 * #2842: may anything new enter play — player or enemy fire, flak, a buddy's burst, the Carrier's
 * beam and twin lasers, a timed or thrown asteroid? Only in combat. Swoop-in is setup time and
 * extraction only lets what is already in flight resolve.
 */
export function weaponsFree(state: StarSwarmState): boolean {
  return state.phase === "Playing";
}

/**
 * #2842: do projectiles, rocks, beams and rams resolve against ships? In combat, and during
 * extraction — shots already fired stay real after the wave's last kill. Never during swoop-in:
 * the player and every enemy are invulnerable until combat starts.
 */
export function hazardsLive(state: StarSwarmState): boolean {
  return state.phase === "Playing" || state.phase === "Extraction";
}

/** #2842: the AI is flying the player ship (input is ignored). */
export function isAutopilot(state: StarSwarmState): boolean {
  return state.phase === "Extraction";
}

/** #2842: true on the tick the wave's last enemy dies (wave-clear sound, haptic, a11y). */
export function waveJustCleared(prev: StarSwarmState, next: StarSwarmState): boolean {
  return prev.phase !== "Extraction" && next.phase === "Extraction";
}

/** #2842: a hostile thing in flight, as a circle, for the extraction autopilot. */
export interface Hazard {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly r: number;
}

/**
 * #2842: every hostile hazard still in flight: enemy shots (flak included), rocks and (#2843)
 * released Carrier beams. A new traveling hostile entity must be added here so the autopilot
 * dodges it, and to clearTransientCombat so it cannot outlive its wave.
 */
export function liveHazards(state: StarSwarmState): Hazard[] {
  const hazards: Hazard[] = state.enemyBullets.map((b) => ({
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    r: Math.max(b.width, b.height) / 2,
  }));
  for (const a of state.asteroids) {
    if (a.hp > 0) hazards.push({ x: a.x, y: a.y, vx: a.vx, vy: a.vy, r: a.radius });
  }
  // #2843: a beam is a long band, not a circle — cover it with a chain of overlapping circles
  for (const b of state.carrierBeams) hazards.push(...beamHazards(b));
  // #2845: Buddy, and the shots it fires, are allied — never a hazard to the ship. Enemy shots
  // aimed at Buddy are enemy shots like any other and are listed above.
  return hazards;
}

function climbSpeed(climbMs: number): number {
  return Math.min(PILOT_CLIMB_MAX, PILOT_CLIMB_ACCEL * climbMs);
}

/** A hazard that could still reach the ship — anything but one below it and falling away. */
function stillThreatens(h: Hazard, p: Player): boolean {
  return !(h.y - h.r > p.y + PLAYER_HURT_RADIUS && h.vy >= 0);
}

/**
 * How dangerous heading for lane `targetX` is over the next ~700 ms: every sampled moment a
 * hazard would come within reach of the ship counts, near moments weighing more. 0 = clear.
 */
function laneDanger(
  p: Player,
  hazards: readonly Hazard[],
  targetX: number,
  climbMs: number,
  climbing: boolean
): number {
  let danger = 0;
  const dx = targetX - p.x;
  for (const t of PILOT_LOOKAHEAD_MS) {
    const sx = p.x + Math.sign(dx) * Math.min(Math.abs(dx), PILOT_SPEED * t);
    const sy = climbing ? p.y - climbSpeed(climbMs + t / 2) * t : p.y;
    const weight = 1 / (1 + t / 250);
    for (const h of hazards) {
      const reach = h.r + PLAYER_HURT_RADIUS + PILOT_MARGIN;
      const hx = h.x + h.vx * t - sx;
      const hy = h.y + h.vy * t - sy;
      if (hx * hx + hy * hy < reach * reach) danger += weight;
    }
  }
  return danger;
}

/** The safest lane to steer for — the current one unless another is strictly safer. */
function pickLane(
  p: Player,
  hazards: readonly Hazard[],
  canvasW: number,
  climbMs: number,
  climbing: boolean
): number {
  if (hazards.length === 0) return p.x;
  let best = p.x;
  let bestCost = laneDanger(p, hazards, p.x, climbMs, climbing) * 1000;
  if (bestCost === 0) return p.x;
  const hw = p.width / 2;
  for (let x = hw; x <= canvasW - hw; x += PILOT_STEP) {
    const cost = laneDanger(p, hazards, x, climbMs, climbing) * 1000 + Math.abs(x - p.x) * 0.01;
    if (cost < bestCost) {
      bestCost = cost;
      best = x;
    }
  }
  return best;
}

/**
 * #2945: the lane of the persistent pickup (salvage / hull) the ship can still collect, or null.
 * Pickups fall at a fixed
 * speed, so the ship holds its row and meets one: it must arrive before the pickup falls past,
 * be reachable laterally by then, and land inside the pickup hold window. First in array order
 * wins a tie, so the choice is deterministic.
 */
function pickupLane(state: StarSwarmState, elapsedMs: number): number | null {
  const p = state.player;
  let best: PowerUp | null = null;
  let bestArrive = Infinity;
  for (const pu of state.powerUps) {
    // only upgrades persist: the reset wipes timed buffs (shield, lightning), Buddy and bombs
    if ((pu.type !== "salvage" && pu.type !== "hull") || pu.vy <= 0) continue;
    const gap = p.y - pu.y - (p.height + pu.height) / 2; // vertical distance until they touch
    const arrive = Math.max(0, gap) / pu.vy;
    const leave = Math.max(0, p.y - pu.y + (p.height + pu.height) / 2) / pu.vy; // fallen past
    const lateral = Math.max(0, Math.abs(pu.x - p.x) - (p.width + pu.width) / 2);
    if (
      leave <= 0 ||
      pu.despawnTimer <= arrive ||
      elapsedMs + arrive > EXTRACTION_PICKUP_HOLD_MAX_MS ||
      lateral / PILOT_SPEED > leave
    )
      continue;
    if (arrive < bestArrive) {
      best = pu;
      bestArrive = arrive;
    }
  }
  if (!best) return null;
  const hw = p.width / 2;
  return Math.max(hw, Math.min(state.canvasW - hw, best.x));
}

/**
 * #2842: one tick of the extraction autopilot. The ship holds the lane, sidestepping whatever
 * is still live, for at least EXTRACTION_HOLD_MIN_MS; once nothing can still reach it (or at
 * EXTRACTION_HOLD_MAX_MS regardless) it accelerates off the top, still steering around hazards.
 * Deterministic: no rng, so seeded runs replay exactly.
 */
function tickExtractionPilot(
  state: StarSwarmState,
  ex: Extraction,
  dtMs: number
): { player: Player; extraction: Extraction } {
  const p = state.player;
  const elapsedMs = ex.elapsedMs + dtMs;
  const hazards = liveHazards(state);
  // #2945: a collectable pickup holds the ship in the lane (up to the pickup hold cap) and draws
  // it sideways — but only into a lane with no hazard coming, so hazards keep priority.
  const chaseX = ex.climbMs > 0 ? null : pickupLane(state, elapsedMs);
  const chase = chaseX !== null && laneDanger(p, hazards, chaseX, 0, false) === 0 ? chaseX : null;
  const climbing =
    ex.climbMs > 0 ||
    (elapsedMs >= EXTRACTION_HOLD_MIN_MS &&
      chase === null &&
      (elapsedMs >= EXTRACTION_HOLD_MAX_MS || !hazards.some((h) => stillThreatens(h, p))));
  const climbMs = climbing ? ex.climbMs + dtMs : 0;
  const targetX = chase ?? pickLane(p, hazards, state.canvasW, climbMs, climbing);
  const dx = targetX - p.x;
  const x = p.x + Math.sign(dx) * Math.min(Math.abs(dx), PILOT_SPEED * dtMs);
  const y = climbing ? p.y - climbSpeed(climbMs) * dtMs : p.y;
  return { player: { ...p, x, y }, extraction: { elapsedMs, climbMs } };
}

/** #2842: the ship is off the top (or the extraction timed out) — time for the reset. */
function extractionComplete(state: StarSwarmState): boolean {
  const ex = state.extraction;
  if (state.phase !== "Extraction" || !ex) return false;
  return state.player.y + state.player.height / 2 < 0 || ex.elapsedMs >= EXTRACTION_MAX_MS;
}

/**
 * #2842: the last enemy is down. Award the clear bonus, raise the banner and hand the ship to
 * the autopilot. Nothing is frozen and nothing is removed: shots already fired (by either side,
 * whether or not their ship survives) and rocks keep flying and stay harmful.
 */
function beginExtraction(state: StarSwarmState): StarSwarmState {
  // #2490 ×2 on boss waves; #2837 credited to the wave just cleared
  const scored = addScore(
    state,
    WAVE_CLEAR_SOURCE,
    waveClearBonusPoints(state.wave, state.difficulty)
  );
  return {
    ...scored,
    phase: "Extraction",
    extraction: { elapsedMs: 0, climbMs: 0 },
    missionCompleteTimer: MISSION_COMPLETE_BANNER_MS,
  };
}

/**
 * #2842: the hard wave-boundary reset — the one explicit place transient combat entities leave
 * play other than by their own hit or despawn. Projectiles are never removed because the ship
 * that fired them died (see the #2776 invariants); they persist until this boundary.
 *
 * Clears: player shots (Buddy's shots are player-owned, so included), enemy shots (aimed, burst,
 * twin-laser, flak, and #2845's shots at Buddy), asteroids, Buddy ships (with their HP, bursts
 * and steering state, #2845), #2843's released Carrier beams, and any beam charge or attack-run
 * brace still on a Carrier. Plug-in point: a new transient combat entity must be cleared here
 * (and in the reset tests in engine.test.ts / buddy.test.ts), so nothing from wave N can
 * interact with wave N+1.
 */
export function clearTransientCombat(state: StarSwarmState): StarSwarmState {
  return {
    ...state,
    playerBullets: [],
    enemyBullets: [],
    carrierBeams: [],
    asteroids: [],
    buddyShips: [],
    enemies: state.enemies.map((e) =>
      e.beamPhase === "idle" && e.runPhase === "idle"
        ? e
        : { ...e, beamPhase: "idle" as const, runPhase: "idle" as const }
    ),
    extraction: null,
  };
}

function checkPhaseTransitions(state: StarSwarmState): StarSwarmState {
  const liveEnemies = state.enemies.filter((e) => e.isAlive);

  // SwoopIn → Playing once all enemies are in Formation
  if (state.phase === "SwoopIn") {
    const allArrived = liveEnemies.every((e) => e.phase !== "SwoopIn");
    if (allArrived) return { ...state, phase: "Playing" };
    return state;
  }

  // Playing → Extraction on the last kill (#2842)
  if (state.phase === "Playing") {
    return liveEnemies.length === 0 ? beginExtraction(state) : state;
  }

  // Extraction → hard reset → wave N+1, once the ship is out
  if (state.phase === "Extraction") {
    return extractionComplete(state) ? startNextWave(clearTransientCombat(state)) : state;
  }

  return state;
}

function startNextWave(state: StarSwarmState): StarSwarmState {
  const next = buildWaveState(
    state.canvasW,
    state.canvasH,
    state.wave + 1,
    state.player,
    state.score,
    state.bonusLivesAwarded,
    state.difficulty,
    state.stragglerEnabled,
    state.tierStats,
    state.runStats
  );
  // the cosmetic banner raised on the last kill finishes its own fade;
  // #2837: the ledger carries across waves
  return {
    ...next,
    missionCompleteTimer: state.missionCompleteTimer,
    scoreLedger: state.scoreLedger,
  };
}

// ---------------------------------------------------------------------------
// Public: applyPowerUp — used by triggerPowerUp dev-panel handle (#1039)
// ---------------------------------------------------------------------------

export function applyPowerUp(state: StarSwarmState, type: PowerUpType): StarSwarmState {
  if (state.phase !== "Playing") return state;

  // #2488: dev-panel upgrades apply straight to the ladders
  if (type === "salvage") {
    const guns = Math.min(GUNS_MAX, state.player.guns + 1) as GunsLevel;
    return { ...state, player: { ...state.player, guns } };
  }
  if (type === "hull") {
    const hull = Math.min(HULL_MAX, state.player.hull + 1) as HullLevel;
    return { ...state, player: { ...state.player, hull } };
  }

  if (type === "bomb") {
    const newExplosions: Explosion[] = [...state.explosions];
    const sm = difficultyMultiplier(state.difficulty);
    let score = state.score;
    const awards: ScorePoints = {}; // #2837
    let killsSinceLastDrop = state.killsSinceLastDrop;
    const armoredNow = carrierArmoredIn(state.enemies); // #2484
    const drops: PowerUp[] = []; // #2488
    const enemies = state.enemies.map((e) => {
      if (!e.isAlive) return e;
      if (e.tier === "Carrier" && armoredNow) return { ...e, hitFlashTimer: HIT_FLASH_DURATION };
      const newHp = e.hp - 1;
      if (newHp <= 0) {
        newExplosions.push({
          id: nextId(),
          x: e.x,
          y: e.y,
          frame: 0,
          frameTimer: EXPLOSION_FRAME_MS,
        });
        score += award(awards, scoreSource(e.tier, "bomb"), Math.round(TIER_SCORE[e.tier] * sm));
        killsSinceLastDrop++;
        // #2488: the Carrier drops plating however it dies
        if (e.tier === "Carrier") drops.push(makePickup("hull", e.x, e.y, state.canvasH));
        return { ...e, hp: 0, isAlive: false, hitFlashTimer: 0 };
      }
      return { ...e, hp: newHp, hitFlashTimer: HIT_FLASH_DURATION };
    });
    for (const a of state.asteroids) newExplosions.push(spawnExplosion(a.x, a.y)); // #2486
    return {
      ...state,
      enemies,
      asteroids: [],
      enemyBullets: [],
      carrierBeams: [], // #2843: released beams are enemy projectiles too
      powerUps: [...state.powerUps, ...drops],
      explosions: newExplosions,
      score,
      scoreLedger: recordScore(state.scoreLedger, state.wave, awards), // #2837
      killsSinceLastDrop,
      bombFlashTimer: BOMB_FLASH_DURATION,
    };
  }

  if (type === "buddy") return launchBuddy(state); // #2845

  // lightning or shield: replace any active duration buff
  return {
    ...state,
    activePowerUp: { remainingMs: POWERUP_DURATION, type, shieldAbsorbed: 0 },
  };
}

// ---------------------------------------------------------------------------
// Derived helpers (useful for renderers)
// ---------------------------------------------------------------------------

/** True while any enemy is still in the SwoopIn entry animation. */
export function isSwooping(state: StarSwarmState): boolean {
  return state.enemies.some((e) => e.isAlive && e.phase === "SwoopIn");
}

/** Number of enemies currently airborne (Diving or Circling). */
export function diverCount(state: StarSwarmState): number {
  return state.enemies.filter((e) => e.isAlive && (e.phase === "Diving" || e.phase === "Circling"))
    .length;
}

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
} from "./types";

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
const FORMATION_COL_W = 44; // #950: was 38 — Boss (36 px) had only 1 px margin/side
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
export const DIVE_PATH_DURATION = 1800; // ms (non-Boss)
const BOSS_DIVE_PATH_DURATION = Math.round(DIVE_PATH_DURATION * (DIVE_SPEED / 0.22)); // ~2210ms

// #978: Boss dive eligibility threshold
export const BOSS_DIVE_THRESHOLD = 0.35; // boss unlocked when ≤35% non-boss remain

// #979: Boss burst-fire
export const BURST_INTERVAL = 200; // ms between shots within a burst
export const BURST_PAUSE_BASE = 2000; // ms cooldown after burst completes
const BURST_PAUSE_JITTER = 1000; // ms random addend to pause
export const BOSS_BULLET_VY = 0.46; // px/ms — faster than Elite (0.35) so boss shots are harder to dodge
const BOSS_MAX_SWAY = 20; // px — Boss sways ±20px vs ±40px for other tiers
// #2484: the Carrier is the heaviest hull in the formation and barely drifts.
const CARRIER_MAX_SWAY = 12; // px

const DIVE_INTERVAL_BASE = 3200; // ms between dive triggers
const DIVE_INTERVAL_MIN = 900; // floor regardless of wave

// #2352: wave clear no longer freezes gameplay or hands the ship to an AI autopilot —
// the wave advances the instant the last enemy dies. This just times the purely-cosmetic
// "MISSION COMPLETE" banner fade so it doesn't block or slow anything down.
export const MISSION_COMPLETE_BANNER_MS = 1200;
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
 * counting down through. Also suppressed while the pre-wave countdown overlay is showing (the
 * countdown starts in the same tick as a wave clear, and both overlays render full-screen and
 * centered) — countdownActive is passed in since the countdown lives in the renderer's ref
 * state, not the engine state. */
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

// #2489: grunt rout — once no Elite, Boss or Carrier is left alive, surviving grunts break and run
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

// #1035: Buddy Ship
const BUDDY_SHIP_DURATION = 2500; // ms to cross the screen
const BUDDY_BULLET_SPEED = 0.5; // px/ms
const BUDDY_BULLET_COUNT_MIN = 5;
const BUDDY_BULLET_COUNT_MAX = 7;
const BUDDY_FIRE_AT_T = 0.45; // path progress when spread burst fires
// Time for a powerup to fall from spawn (y = POWERUP_H/2) to just past the player, plus a
// 2-second collection window. Computed per-canvas so it works at any screen height.
function powerUpDespawnMs(canvasH: number): number {
  return Math.ceil((canvasH - PLAYER_Y_FROM_BOTTOM - POWERUP_H / 2) / POWERUP_VY) + 2000;
}
const SUPER_SHOOT_COOLDOWN = 70; // ms (4× fire rate during super)
const SUPER_DAMAGE = 4;

// #974: small circle around the player sprite centre — forgiveness hitbox
export const PLAYER_HURT_RADIUS = 7; // px

// #1310: duration of the shield-ring hit flash on non-lethal Elite/Boss hits
export const HIT_FLASH_DURATION = 250; // ms

// #2485: Carrier actions — sweep beam, reinforcements, lone-ship lasers
export const BEAM_INTERVAL_BASE = 7000; // ms between beams (÷ min(1.6, paramScale))
export const BOSS_WAVE_BEAM_SCALE = 1.5; // #2490: beams come this much faster on a boss wave
export const BEAM_CHARGE_MS = 600; // telegraph: wiggle + glow
export const BEAM_FIRE_MS = 1200; // beam on, dragged sideways by the formation sway
export const BEAM_HALF_WIDTH = 12; // px either side of the Carrier's x
const BEAM_WIGGLE_AMPLITUDE = 3; // px, during charge
export const REINFORCE_INTERVAL = 8000; // ms between launches while the Carrier lives
const REINFORCE_MIN = 2;
const REINFORCE_MAX = 4;
export const LONE_FIRE_INTERVAL = 1100; // ms between twin-laser volleys once the Carrier is unarmored
const LONE_FIRE_OFFSET = 14; // px either side of centre for the twin lasers
const BEAM_DIFFICULTY_CAP = 1.6; // paramScale is capped here for beam/lone-fire cadence

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
  Boss: 0.8,
  Carrier: 0,
};
export const DODGE_CAP = 0.97;
const DODGE_LOOKAHEAD_MS = [200, 400, 700] as const; // sampled rock positions for the threat check
const DODGE_MARGIN = 6; // px of slack around the ship's hitbox
export const DODGE_SIDESTEP = 22; // px, formation sidestep amplitude
export const DODGE_SIDESTEP_MS = 600; // sine out-and-back
export const DODGE_PATH_NUDGE = 40; // px, control-point shift for ships on a path
export const FLAK_BASE: Record<EnemyTier, number> = {
  Grunt: 0.3,
  Elite: 0.7,
  Boss: 0.9,
  Carrier: 1,
};
const FLAK_SCALE_CAP = 1.3;
export const FLAK_RANGE = 120; // px
export const FLAK_COOLDOWN = 900; // ms per ship
const FLAK_LEAD_MS = 300; // aim at where the rock will be
const FLAK_SPEED = 0.42; // px/ms

// #2486: errant asteroids — a neutral hazard that damages both sides and absorbs bullets
export const MAX_ASTEROIDS = 2; // timed spawns stop at this many in flight; a split may briefly exceed it
export const ASTEROID_MIN_WAVE = 2;
export const ASTEROID_INTERVAL_MIN = 12_000; // ms between timed spawns (Playing phase only)
export const ASTEROID_INTERVAL_MAX = 20_000;
const ASTEROID_SPEED_MIN = 0.15; // px/ms
const ASTEROID_SPEED_MAX = 0.22;
const ASTEROID_ENTRY_Y_MIN = 40; // spawn band down the top corners
const ASTEROID_ENTRY_Y_MAX = 100;
const ASTEROID_ANGLE_MIN = 0.55; // rad below horizontal — crosses the formation, then the player lane
const ASTEROID_ANGLE_MAX = 0.9;
const ASTEROID_LARGE_CHANCE = 0.65;
export const ASTEROID_HIT_FLASH_MS = 120;
export const ASTEROID_STATS: Record<AsteroidKind, { radius: number; hp: number }> = {
  large: { radius: 22, hp: 6 },
  small: { radius: 12, hp: 2 },
};

// #2484: Carrier — one per wave, never dives, armored while its four Boss escorts live.
const TIER_SCORE: Record<EnemyTier, number> = { Grunt: 100, Elite: 200, Boss: 400, Carrier: 1000 };
const TIER_HP: Record<EnemyTier, number> = { Grunt: 1, Elite: 2, Boss: 4, Carrier: 8 };

/** #2484: Boss and Carrier sit out the Grunt/Elite "non-boss" thresholds (35% / ≤3 remaining). */
export function isLeaderTier(tier: EnemyTier): boolean {
  return tier === "Boss" || tier === "Carrier";
}

function carrierArmoredIn(enemies: readonly Enemy[]): boolean {
  return enemies.some((e) => e.isAlive && e.tier === "Boss");
}

/**
 * #2484: the Carrier is armored while any of its four Boss escorts is alive. Ordinary player
 * shots are spent on the force field (ring plays, no damage); piercing shots go through.
 * False when there is no live Carrier, so renderers can key an indicator off this alone.
 */
export function isCarrierArmored(state: StarSwarmState): boolean {
  return (
    state.enemies.some((e) => e.isAlive && e.tier === "Carrier") && carrierArmoredIn(state.enemies)
  );
}

/**
 * #2484: true on the exact tick the Carrier's armor drops — its last Boss escort died while the
 * Carrier itself is still alive. A Carrier killed *through* its armor (piercing shots) also stops
 * reading as armored, but nothing was exposed, so that edge is excluded. Shared by both renderers
 * so the announcement can't drift between native and web.
 */
export function carrierJustExposed(prev: StarSwarmState, next: StarSwarmState): boolean {
  const carrierAlive = next.enemies.some((e) => e.isAlive && e.tier === "Carrier");
  return carrierAlive && isCarrierArmored(prev) && !isCarrierArmored(next);
}

// #979/#2484: heavier tiers drift less with the formation sway
function clampSway(tier: EnemyTier, swayX: number): number {
  const limit = tier === "Carrier" ? CARRIER_MAX_SWAY : tier === "Boss" ? BOSS_MAX_SWAY : MAX_SWAY;
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
  Boss: { w: 36, h: 32 },
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

/** Reset for testing only. */
export function _resetIds(): void {
  _nextId = 1;
}

/**
 * The module-level counters a run depends on (#2645). A new process starts them over — ids
 * from 1, the rng from the default seed — so a run restored after a cold start carries them.
 */
export interface EngineCounters {
  readonly nextId: number;
  readonly seed: number;
}

export function engineCounters(): EngineCounters {
  return { nextId: _nextId, seed: _seed };
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
    (seed as number) <= 0xffffffff
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

  // Boss row: 4 enemies, centered
  for (let c = 0; c < 4; c++) slots.push({ tier: "Boss", row: 1, col: c, rowCols: 4 });

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
  // last to swoop in (and so enemies[0] stays a Boss, which the dev panel and tests lean on).
  slots.push({ tier: "Carrier", row: 0, col: 0, rowCols: 1 });

  return slots;
}

/** #2490: a boss wave is the Carrier and its four escorts, nothing else. Carrier last, as above. */
function bossWaveSlots(): SlotDef[] {
  const slots: SlotDef[] = [];
  for (let c = 0; c < 4; c++) slots.push({ tier: "Boss", row: 1, col: c, rowCols: 4 });
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

// #1035: Bézier arc for a buddy ship crossing from one edge to the other
function buddyShipPath(
  fromLeft: boolean,
  targetX: number,
  targetY: number,
  canvasW: number,
  canvasH: number
): CubicBezier {
  const startX = fromLeft ? -40 : canvasW + 40;
  const endX = fromLeft ? canvasW + 40 : -40;
  const entryY = canvasH * 0.3;
  return {
    p0: { x: startX, y: entryY },
    p1: { x: canvasW * (fromLeft ? 0.3 : 0.7), y: canvasH * 0.12 },
    p2: { x: targetX, y: targetY },
    p3: { x: endX, y: entryY },
  };
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

/** A rock entering from a random top corner, heading down and across the formation. */
function spawnAsteroid(canvasW: number, kind?: AsteroidKind): Asteroid {
  const k: AsteroidKind = kind ?? (rng() < ASTEROID_LARGE_CHANCE ? "large" : "small");
  const r = ASTEROID_STATS[k].radius;
  const fromLeft = rng() < 0.5;
  const angle = ASTEROID_ANGLE_MIN + rng() * (ASTEROID_ANGLE_MAX - ASTEROID_ANGLE_MIN);
  const speed = ASTEROID_SPEED_MIN + rng() * (ASTEROID_SPEED_MAX - ASTEROID_SPEED_MIN);
  return makeAsteroid(
    k,
    fromLeft ? -r : canvasW + r,
    ASTEROID_ENTRY_Y_MIN + rng() * (ASTEROID_ENTRY_Y_MAX - ASTEROID_ENTRY_Y_MIN),
    (fromLeft ? 1 : -1) * Math.cos(angle) * speed,
    Math.sin(angle) * speed
  );
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
 * minimum and the dev "disabled" toggle, so a tester can always summon one.
 */
export function throwAsteroid(state: StarSwarmState, kind?: AsteroidKind): StarSwarmState {
  if (state.phase === "GameOver" || state.asteroids.length >= MAX_ASTEROIDS) return state;
  return {
    ...state,
    asteroids: [...state.asteroids, spawnAsteroid(state.canvasW, kind)],
    runStats: bumpRun(state.runStats, { rocksSpawned: 1 }), // #2491
  };
}

function tickAsteroids(state: StarSwarmState, dtMs: number): StarSwarmState {
  const { canvasW, canvasH } = state;
  let asteroids: Asteroid[] = state.asteroids
    .map((a) => ({
      ...a,
      x: a.x + a.vx * dtMs,
      y: a.y + a.vy * dtMs,
      rotation: a.rotation + a.spin * dtMs,
      hitFlashTimer: Math.max(0, a.hitFlashTimer - dtMs),
    }))
    .filter(
      (a) => a.y - a.radius < canvasH + 40 && a.x > -60 - a.radius && a.x < canvasW + 60 + a.radius
    );

  // The timer only runs mid-wave, so a wave never opens with a rock already on the way in.
  let nextAsteroidTimer = state.nextAsteroidTimer;
  let runStats = state.runStats;
  if (state.phase === "Playing") {
    nextAsteroidTimer -= dtMs;
    if (nextAsteroidTimer <= 0) {
      nextAsteroidTimer = asteroidInterval();
      if (canSpawnAsteroid({ ...state, asteroids })) {
        asteroids = [...asteroids, spawnAsteroid(canvasW)];
        runStats = bumpRun(runStats, { rocksSpawned: 1 }); // #2491
      }
    }
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
 * (`pathT >= 0` — swooping reinforcements included). The Carrier's force field shatters the
 * rock instead; a small rock shatters on whatever it hits, a large one keeps going.
 */
function rocksStrikeEnemies(
  rocks: readonly Asteroid[],
  enemies: readonly Enemy[],
  explosions: Explosion[],
  struck: EnemyTier[] // #2487: tiers hit, for tierStats
): { rocks: Asteroid[]; enemies: Enemy[] } {
  const outRocks = [...rocks];
  const outEnemies = [...enemies];
  for (let ri = 0; ri < outRocks.length; ri++) {
    let rock = outRocks[ri]!;
    if (rock.hp <= 0) continue;
    for (let ei = 0; ei < outEnemies.length; ei++) {
      const e = outEnemies[ei]!;
      if (!e.isAlive || (e.pathT < 0 && e.phase !== "Fleeing") || rock.hitEnemyIds.includes(e.id))
        continue;
      if (!collideCircleAABB(rock.x, rock.y, rock.radius, e.x, e.y, e.width, e.height)) continue;
      if (e.tier === "Carrier") {
        outEnemies[ei] = { ...e, hitFlashTimer: HIT_FLASH_DURATION };
        rock = { ...rock, hp: 0, shattered: true };
        break;
      }
      const newHp = e.hp - 1;
      struck.push(e.tier);
      if (newHp <= 0) {
        explosions.push(spawnExplosion(e.x, e.y));
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
  return { rocks: outRocks, enemies: outEnemies };
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
    Boss: ZERO_TIER_STATS,
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

const TIER_ORDER: readonly EnemyTier[] = ["Grunt", "Elite", "Boss", "Carrier"];

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
 * #2491 dev-panel hook: destroy every escort at once so the Carrier's exposed state, lone fire
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

const PATH_PHASES = new Set(["SwoopIn", "Diving", "Returning", "Fleeing"]);

/** Where the ship will be `ms` from now: on its path if it has one, else where it is. */
function predictEnemyPos(e: Enemy, ms: number): Vec2 {
  if (PATH_PHASES.has(e.phase) && e.path) {
    return evalCubic(e.path, Math.max(0, Math.min(1, e.pathT + ms / e.pathDuration)));
  }
  return { x: e.x, y: e.y };
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
export function nudgePath(path: CubicBezier, dir: 1 | -1): CubicBezier {
  return {
    p0: path.p0,
    p1: { x: path.p1.x + dir * DODGE_PATH_NUDGE, y: path.p1.y },
    p2: { x: path.p2.x + dir * DODGE_PATH_NUDGE, y: path.p2.y },
    p3: path.p3,
  };
}

/**
 * Bend the rest of a ship's path away from a rock without moving the ship: split the curve at
 * its current progress, nudge only the remaining segment, and restart that segment at pathT = 0
 * with the duration it had left, so speed along the path is unchanged. (Nudging the original
 * control points in place would pull the ship's current position sideways by up to ~30 px.)
 */
function nudgeRemainingPath(e: Enemy, dir: 1 | -1): Enemy {
  const t = Math.max(0, Math.min(1, e.pathT));
  if (t >= 1 || !e.path) return e;
  return {
    ...e,
    path: nudgePath(splitRemaining(e.path, t), dir),
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
 * #2487: each live ship looks at each live rock once. In formation it may also fire flak at a
 * rock approaching within range; on screen (pathT ≥ 0), not circling and not the Carrier, it
 * rolls once per rock to dodge — a sidestep in formation, a path nudge on a path. A failed roll
 * takes no action; the collision then follows naturally. All rolls use the seeded rng().
 */
function tickAsteroidThreats(state: StarSwarmState, dtMs: number): StarSwarmState {
  const stats: Record<EnemyTier, TierStats> = { ...state.tierStats };
  const flakShots: Bullet[] = [];
  const paramScale = difficultyParamScale(state.difficulty);
  const flakScale = Math.min(FLAK_SCALE_CAP, paramScale);
  const rocks = state.asteroids.filter((a) => a.hp > 0);

  const enemies = state.enemies.map((e0) => {
    if (!e0.isAlive) return e0;
    let e = e0;
    if (e.flakCooldown > 0) e = { ...e, flakCooldown: Math.max(0, e.flakCooldown - dtMs) };
    if (e.dodge) {
      const t = e.dodge.t + dtMs;
      e = t >= e.dodge.dur ? { ...e, dodge: null } : { ...e, dodge: { ...e.dodge, t } };
    }
    // pathT < 0 means "still off screen" for a swoop-in — a fleeing grunt in its stagger is on
    // screen and fair game (#2489)
    if (rocks.length === 0 || (e.pathT < 0 && e.phase !== "Fleeing")) return e;

    for (const a of rocks) {
      // Flak: a formation ship shoots at a rock coming its way
      if (
        e.phase === "Formation" &&
        e.flakCooldown <= 0 &&
        !state.enemyFireDisabled &&
        !state.flakDisabled // #2491 dev toggle
      ) {
        const dx = a.x - e.x;
        const dy = a.y - e.y;
        const approaching = a.vx * -dx + a.vy * -dy > 0;
        if (approaching && dx * dx + dy * dy < FLAK_RANGE * FLAK_RANGE) {
          if (rng() < FLAK_BASE[e.tier] * flakScale) {
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
            e = { ...e, flakCooldown: FLAK_COOLDOWN };
            bumpStat(stats, e.tier, { flak: 1 });
          }
        }
      }

      // Dodge: one roll per rock per ship (the #2491 dev toggle skips the roll entirely, so the
      // counters only ever describe rolls that were actually taken)
      if (
        state.dodgeDisabled ||
        e.tier === "Carrier" ||
        e.phase === "Circling" ||
        e.rolledAsteroidIds.includes(a.id)
      ) {
        continue;
      }
      if (!rockThreatens(a, e)) continue;
      e = { ...e, rolledAsteroidIds: [...e.rolledAsteroidIds, a.id] };
      const onPath = PATH_PHASES.has(e.phase) && e.path !== null;
      bumpStat(stats, e.tier, { rolls: 1, pathRolls: onPath ? 1 : 0 });
      if (rng() < dodgeChance(e.tier, paramScale)) {
        bumpStat(stats, e.tier, { dodged: 1, pathDodged: onPath ? 1 : 0 });
        const dir: 1 | -1 = e.x < a.x + a.vx * 400 ? -1 : 1;
        e = onPath
          ? nudgeRemainingPath(e, dir)
          : { ...e, dodge: { dir, t: 0, dur: DODGE_SIDESTEP_MS } };
      }
    }
    return e;
  });

  return {
    ...state,
    enemies,
    enemyBullets: flakShots.length > 0 ? [...state.enemyBullets, ...flakShots] : state.enemyBullets,
    tierStats: stats,
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
    beamTimer: BEAM_INTERVAL_BASE, // #2485: first beam one full interval after the wave settles
    dodge: null,
    rolledAsteroidIds: [],
    flakCooldown: 0,
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
  // #2352 follow-up: bullets already in flight when a wave clears carry into the next wave
  // instead of vanishing (a real missile doesn't disappear because the ship that fired it
  // did). Empty by default for a fresh game start (initStarSwarm) — only startNextWave()
  // passes real carried-over bullets.
  playerBullets: readonly Bullet[] = [],
  enemyBullets: readonly Bullet[] = [],
  // #2486: rocks in flight carry over too — the next wave's swoop-in meets them
  asteroids: readonly Asteroid[] = [],
  // #2487: counters carry across waves, reset on a new game
  tierStats: Readonly<Record<EnemyTier, TierStats>> = emptyTierStats(),
  // #2491: likewise
  runStats: RunStats = emptyRunStats()
): StarSwarmState {
  // #2490: a boss wave is the Carrier and its four escorts, nothing else — a short, hostile
  // stage of its own in the slot the old bonus wave held. It swoops in and plays like any wave.
  const bossWave = isBossWave(wave);
  const slots = bossWave ? bossWaveSlots() : waveSlots(wave);
  const enemies: Enemy[] = slots.map((slot, idx) => {
    const e = makeEnemy(idx, slot, canvasW);
    // the Carrier beams more often here, from the first one on
    return bossWave && slot.tier === "Carrier"
      ? { ...e, beamTimer: e.beamTimer / BOSS_WAVE_BEAM_SCALE }
      : e;
  });
  const phase: StarSwarmState["phase"] = "SwoopIn";

  const startingNonBossCount = enemies.filter((e) => !isLeaderTier(e.tier)).length;

  const powerUps: PowerUp[] = [];
  const dropJitterTarget = triggerKills(wave) + Math.floor(rng() * 5) - 2;
  const paramScale = difficultyParamScale(difficulty);
  // Ensign gets gentler AI; every tier above gets straggler aggression.
  // stragglerOverride (from the dev panel) forces the value regardless of difficulty —
  // both directions: disabling it on aggressive tiers, or enabling it on Ensign.
  const stragglerEnabled = stragglerOverride ?? difficulty !== "Ensign";

  // Reset invincibility on each new wave so same-tick hit state never carries forward
  const wavePlayer: Player = { ...player, invincibleTimer: 0 };

  return {
    phase,
    wave,
    score,
    player: wavePlayer,
    enemies,
    playerBullets,
    enemyBullets,
    explosions: [],
    powerUps,
    buddyShips: [],
    asteroids,
    nextAsteroidTimer: asteroidInterval(),
    asteroidsDisabled: false,
    reinforceTimer: REINFORCE_INTERVAL,
    reinforcedThisWave: 0,
    tierStats,
    runStats,
    dodgeDisabled: false,
    flakDisabled: false,
    phaseTimer: 0,
    canvasW,
    canvasH,
    nextDiveTimer: diveInterval(wave, paramScale),
    formationSwayX: 0,
    formationSwayDir: 1,
    bonusLivesAwarded,
    bonusLifeSlowMoTimer: 0,
    startingNonBossCount,
    killsSinceLastDrop: 0,
    dropJitterTarget,
    activePowerUp: null,
    // #2490: on a boss wave the Bosses are active from the first tick — bursts and dives
    bossThresholdCrossed: bossWave,
    bossDeepThresholdCrossed: false,
    stragglerEnabled,
    pauseStraggler: false,
    routed: false,
    routDisabled: false,
    bombFlashTimer: 0,
    difficulty,
    playerFireDisabled: false,
    enemyFireDisabled: false,
    missionCompleteTimer: 0,
  };
}

// ---------------------------------------------------------------------------
// Public: tick
// ---------------------------------------------------------------------------

export function tick(state: StarSwarmState, dtMs: number, input: StarSwarmInput): StarSwarmState {
  if (state.phase === "GameOver") return state;

  // #1078: decrement slow-mo timer with real time; scale all gameplay by BONUS_LIFE_SLOW_MO_SCALE
  const slowMoActive = state.bonusLifeSlowMoTimer > 0;
  const bonusLifeSlowMoTimer = Math.max(0, state.bonusLifeSlowMoTimer - dtMs);
  const scaledDt = slowMoActive ? dtMs * BONUS_LIFE_SLOW_MO_SCALE : dtMs;
  // #2352: purely cosmetic — never gates or slows gameplay, just counts down real time.
  const missionCompleteTimer = decayMissionCompleteTimer(state.missionCompleteTimer, dtMs);

  let s: StarSwarmState = { ...state, bonusLifeSlowMoTimer, missionCompleteTimer };
  s = tickPlayer(s, scaledDt, input);
  s = tickAsteroidThreats(s, scaledDt); // #2487: before the enemy tick so a nudged path or sidestep applies now
  s = tickEnemies(s, scaledDt);
  s = tickBullets(s, scaledDt);
  s = tickAsteroids(s, scaledDt); // #2486
  s = tickPowerUps(s, scaledDt);
  s = tickBuddyShips(s, scaledDt);
  s = tickCollisions(s); // score updated by kills here
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
function tickBonusLives(_prev: StarSwarmState, next: StarSwarmState): StarSwarmState {
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

  // #1078: if the bonus life rescued the player from a same-tick lethal hit, revert GameOver
  const phase = next.phase === "GameOver" && newLives > 0 ? "Playing" : next.phase;

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
  const hw = p.width / 2;
  const newX = Math.max(hw, Math.min(state.canvasW - hw, input.playerX));
  const invincibleTimer = Math.max(0, p.invincibleTimer - dtMs);
  const shootCooldown = Math.max(0, p.shootCooldown - dtMs);

  const hullFlashTimer = Math.max(0, p.hullFlashTimer - dtMs); // #2488
  const player: Player = { ...p, x: newX, invincibleTimer, shootCooldown, hullFlashTimer };

  const isSuper = state.activePowerUp?.type === "lightning";

  if (
    shootCooldown === 0 &&
    input.fire &&
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
  /** #2485: a volley (the lone Carrier's twin lasers) — each still counts against bulletCap(). */
  bullets?: Bullet[];
}

/** #2485: what the Carrier needs to know that the per-enemy tick otherwise doesn't see. */
interface CarrierCtx {
  /** Playing phase — beams and lone fire only happen mid-wave. */
  playing: boolean;
  /** #2699: its four Boss escorts are dead, so its force field is down — twin lasers fire. */
  unarmored: boolean;
  /** #2490: boss wave — the beam cadence is BOSS_WAVE_BEAM_SCALE× faster. */
  bossWave: boolean;
}
const NO_CARRIER_CTX: CarrierCtx = { playing: false, unarmored: false, bossWave: false };

/**
 * #2485: the Carrier's own tick while holding station. Beam: idle → charge (telegraph) → fire →
 * idle on a difficulty-scaled cadence. Twin-laser lasers: #2699 once its armor is down (its Boss
 * escorts are dead) it fires a pair of aimed shots every LONE_FIRE_INTERVAL, so the player can't
 * just plink an exposed Carrier from off to one side while grunts still live. Reinforcements live
 * in tickEnemies (they need the whole roster).
 */
function tickCarrier(
  enemy: Enemy,
  dtMs: number,
  playerX: number,
  playerY: number,
  paramScale: number,
  ctx: CarrierCtx
): EnemyTickResult {
  if (!ctx.playing) return { enemy, bullet: null };
  const cadence = Math.min(BEAM_DIFFICULTY_CAP, paramScale);

  let beamPhase: BeamPhase = enemy.beamPhase;
  let beamTimer = enemy.beamTimer - dtMs;
  if (beamTimer <= 0) {
    if (beamPhase === "idle") {
      beamPhase = "charge";
      beamTimer = BEAM_CHARGE_MS;
    } else if (beamPhase === "charge") {
      beamPhase = "fire";
      beamTimer = BEAM_FIRE_MS;
    } else {
      beamPhase = "idle";
      beamTimer = BEAM_INTERVAL_BASE / cadence / (ctx.bossWave ? BOSS_WAVE_BEAM_SCALE : 1);
    }
  }

  let shootTimer = enemy.shootTimer;
  let bullets: Bullet[] | undefined;
  if (ctx.unarmored) {
    shootTimer -= dtMs;
    if (shootTimer <= 0) {
      shootTimer = LONE_FIRE_INTERVAL / cadence;
      bullets = [-LONE_FIRE_OFFSET, LONE_FIRE_OFFSET].map((dx) => {
        const vel = aimVelocity(enemy.x + dx, enemy.y, playerX, playerY, BOSS_BULLET_VY);
        return {
          id: nextId(),
          x: enemy.x + dx,
          y: enemy.y + enemy.height / 2,
          vx: vel.vx,
          vy: vel.vy,
          owner: "enemy" as const,
          width: BULLET_E_W,
          height: BULLET_E_H,
          damage: 1,
        };
      });
    }
  }

  return { enemy: { ...enemy, beamPhase, beamTimer, shootTimer }, bullet: null, bullets };
}

/** #2485: where the Carrier's beam is, for collisions and both renderers; null when no beam. */
export function carrierBeam(
  state: StarSwarmState
): { x: number; y: number; phase: Exclude<BeamPhase, "idle">; progress: number } | null {
  const c = state.enemies.find((e) => e.isAlive && e.tier === "Carrier");
  if (!c || c.beamPhase === "idle") return null;
  const total = c.beamPhase === "charge" ? BEAM_CHARGE_MS : BEAM_FIRE_MS;
  return {
    x: c.x,
    y: c.y + c.height / 2,
    phase: c.beamPhase,
    progress: 1 - Math.max(0, c.beamTimer) / total,
  };
}

/** #2485: true on the tick the Carrier starts charging its beam (telegraph sound + a11y). */
export function carrierBeamJustStarted(prev: StarSwarmState, next: StarSwarmState): boolean {
  return carrierBeam(prev)?.phase !== "charge" && carrierBeam(next)?.phase === "charge";
}

/** #2485: true on the tick the beam switches from telegraph to firing. */
export function carrierBeamJustFired(prev: StarSwarmState, next: StarSwarmState): boolean {
  return carrierBeam(prev)?.phase !== "fire" && carrierBeam(next)?.phase === "fire";
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

/** #2485: reinforcements are capped at half the wave's grunt slots. */
export function reinforceCap(wave: number): number {
  return Math.floor(waveSlots(wave).filter((s) => s.tier === "Grunt").length / 2);
}

function tickSingleEnemy(
  enemy: Enemy,
  dtMs: number,
  playerX: number,
  playerY: number,
  canvasH: number,
  shouldDive: boolean,
  wave: number,
  bossThresholdCrossed: boolean,
  bossDeepThresholdCrossed: boolean,
  paramScale = 1,
  carrierCtx: CarrierCtx = NO_CARRIER_CTX
): EnemyTickResult {
  if (!enemy.isAlive) return { enemy, bullet: null };
  // #2485: the Carrier has its own station-keeping tick
  if (enemy.tier === "Carrier" && enemy.phase === "Formation") {
    return tickCarrier(enemy, dtMs, playerX, playerY, paramScale, carrierCtx);
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
        bossThresholdCrossed,
        paramScale
      );
    case "Wiggling":
      return tickWiggling(enemy, dtMs, canvasH, bossThresholdCrossed, bossDeepThresholdCrossed);
    case "Diving":
      return tickDiving(
        enemy,
        dtMs,
        canvasH,
        playerX,
        playerY,
        bossThresholdCrossed,
        bossDeepThresholdCrossed
      );
    case "Circling":
      return tickCircling(enemy, dtMs, playerX, playerY);
    case "Returning":
      return tickReturning(enemy, dtMs);
    case "Fleeing":
      return tickFleeing(enemy, dtMs);
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
  bossThresholdCrossed: boolean,
  paramScale = 1
): EnemyTickResult {
  // #2484/#2485: a Carrier in Formation is routed to tickCarrier before reaching here
  if (enemy.tier === "Carrier") {
    return { enemy, bullet: null };
  }

  // Boss is passive until threshold crossed: no firing, no diving
  if (enemy.tier === "Boss" && !bossThresholdCrossed) {
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

  // #979: Boss fires in bursts; other tiers use random single-shot interval
  if (enemy.tier === "Boss") {
    const { enemy: e, bullet } = bossBurstFire(enemy, playerX, playerY);
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

// #979: shared burst-fire logic for Boss in Formation and Diving phases
function bossBurstFire(enemy: Enemy, playerX: number, playerY: number): EnemyTickResult {
  const newBurstShotsLeft =
    enemy.burstShotsLeft === 0
      ? 2 + Math.floor(rng() * 3) // start new burst: pick 3–5 total shots; return remaining after this shot
      : enemy.burstShotsLeft - 1;
  const newShootTimer =
    newBurstShotsLeft > 0 ? BURST_INTERVAL : BURST_PAUSE_BASE + rng() * BURST_PAUSE_JITTER;

  const vel = aimVelocity(enemy.x, enemy.y, playerX, playerY, BOSS_BULLET_VY); // #1314
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
  bossThresholdCrossed: boolean,
  bossDeepThresholdCrossed: boolean
): EnemyTickResult {
  const newTimer = enemy.wiggleTimer - dtMs;

  if (newTimer <= 0) {
    // Stage 1 Elites: shallow arc; Stage 2 Bosses: shallow arc (like Stage 1 Elites)
    const isBossStage2 = enemy.tier === "Boss" && bossThresholdCrossed && !bossDeepThresholdCrossed;
    const shallow = (enemy.tier === "Elite" && !bossThresholdCrossed) || isBossStage2;
    const path = divePath(enemy, enemy.diveTargetX, canvasH, shallow);
    const duration = enemy.tier === "Boss" ? BOSS_DIVE_PATH_DURATION : DIVE_PATH_DURATION;
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
// - Elites Phase 1 (bossThresholdCrossed=false): shallow arc, Returning at 60%, no body collision
// - Elites Phase 2 + Bosses: Circling at 85% (existing behaviour)
function tickDiving(
  enemy: Enemy,
  dtMs: number,
  canvasH: number,
  playerX: number,
  playerY: number,
  bossThresholdCrossed: boolean,
  bossDeepThresholdCrossed: boolean
): EnemyTickResult {
  const newT = enemy.pathT + dtMs / enemy.pathDuration;
  const pos = evalCubic(enemy.path!, Math.min(newT, 1));

  // Tick shoot timer; Boss uses burst fire (#979), others use single aimed shot
  const shootTimer = enemy.shootTimer - dtMs;
  let bullet: Bullet | null = null;
  let nextShootTimer = shootTimer;
  let nextBurstShotsLeft = enemy.burstShotsLeft;

  if (shootTimer <= 0) {
    if (enemy.tier === "Boss") {
      const result = bossBurstFire(enemy, playerX, playerY);
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

  const isElitePhase1 = enemy.tier === "Elite" && !bossThresholdCrossed;
  // #1077: Stage 2 Boss uses shallow arc — return to formation like Elite Phase 1, no Circling
  const isBossStage2 = enemy.tier === "Boss" && bossThresholdCrossed && !bossDeepThresholdCrossed;
  const depthThreshold = isElitePhase1 || isBossStage2 ? canvasH * 0.6 : canvasH * 0.85;
  const pathDone = pos.y > depthThreshold || newT >= 1;

  if (pathDone) {
    if (enemy.tier === "Grunt" || isElitePhase1 || isBossStage2) {
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

    // Elite Phase 2 + Boss → Circling
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
    const speed = enemy.tier === "Boss" ? BOSS_BULLET_VY : undefined;
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

function tickEnemies(state: StarSwarmState, dtMs: number): StarSwarmState {
  // #1030: bossThresholdCrossed latches true once ≤35% non-boss enemies remain
  const aliveNonBoss = state.enemies.filter((e) => e.isAlive && !isLeaderTier(e.tier)).length;
  const bossThresholdCrossed =
    state.bossThresholdCrossed ||
    state.startingNonBossCount === 0 ||
    aliveNonBoss / state.startingNonBossCount <= BOSS_DIVE_THRESHOLD;

  // #1077: bossDeepThresholdCrossed latches true at Stage 3 (≤3 enemies alive)
  // #2484: the Carrier never leaves formation, so it is not counted as a straggler
  const aliveAll = state.enemies.filter((e) => e.isAlive && e.tier !== "Carrier").length;
  const bossDeepThresholdCrossed =
    state.bossDeepThresholdCrossed ||
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
    state.enemies.some((e) => e.isAlive && e.tier === "Grunt") &&
    !state.enemies.some((e) => e.isAlive && e.tier !== "Grunt")
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
      nextDiveTimer = diveInterval(state.wave, difficultyParamScale(state.difficulty));
      // #978/#1030: Boss only eligible once bossThresholdCrossed
      const candidates = roster
        .map((e, i) => ({ e, i }))
        .filter(
          ({ e }) =>
            e.isAlive &&
            e.phase === "Formation" &&
            e.tier !== "Carrier" && // #2484: never dives
            (e.tier !== "Boss" || bossThresholdCrossed)
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
  const _ps = difficultyParamScale(state.difficulty);
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

  const newEnemyBullets: Bullet[] = [...state.enemyBullets];
  // Harmless bullets carried over from a cleared wave (see Bullet.harmless) don't count
  // against bulletCap() — otherwise up to a full cap's worth of leftovers would suppress
  // the new wave's real fire until they drift off-screen.
  // #2487: flak at rocks is outside the cap too
  let liveEnemyBulletCount = newEnemyBullets.filter((b) => !b.harmless && !b.flak).length;
  const enemyBulletCap = bulletCap(state.wave, _ps);
  // #2699: the Carrier fires its twin lasers once its armor is down (Boss escorts dead),
  // not only once it's the sole enemy left alive.
  const carrierCtx: CarrierCtx = {
    playing: state.phase === "Playing",
    unarmored: !carrierArmoredIn(state.enemies),
    bossWave: isBossWave(state.wave), // #2490
  };
  let routEscaped = 0; // #2489: fleeing grunts that reached the edge this tick
  let enemies = roster.map((enemy, idx) => {
    const shouldDive = diveIndices.has(idx);
    const result = tickSingleEnemy(
      enemy,
      dtMs,
      state.player.x,
      state.player.y,
      state.canvasH,
      shouldDive,
      state.wave,
      bossThresholdCrossed,
      bossDeepThresholdCrossed,
      _ps,
      carrierCtx
    );
    let e = result.enemy;
    if (enemy.isAlive && enemy.phase === "Fleeing" && !e.isAlive) routEscaped++; // #2489
    // Apply sway offset to enemies holding Formation position
    // #979: Boss sways ±BOSS_MAX_SWAY (20px) vs ±MAX_SWAY (40px) for other tiers
    if (e.isAlive && e.phase === "Formation") {
      e = { ...e, x: e.formationX + clampSway(e.tier, swayX) + dodgeOffset(e) }; // #2487 sidestep
      // #2485: beam telegraph — a quick shudder so the player has time to sidestep
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
    for (const b of [result.bullet, ...(result.bullets ?? [])]) {
      if (b && liveEnemyBulletCount < enemyBulletCap && !state.enemyFireDisabled) {
        newEnemyBullets.push(b);
        liveEnemyBulletCount++;
      }
    }
    return e;
  });

  // #2485: Carrier reinforcements — refill empty grunt slots while it lives, capped per wave.
  // Not on Ensign. Reinforcements don't touch startingNonBossCount, so the 35% / ≤3 latches
  // are unaffected once crossed; until then they delay the escalation, which is the point.
  let reinforceTimer = state.reinforceTimer;
  let reinforcedThisWave = state.reinforcedThisWave;
  let runStats = state.runStats;
  const carrierAlive = enemies.some((e) => e.isAlive && e.tier === "Carrier");
  // #2490: never on a boss wave — there are no grunt slots to refill, and it's meant to be short.
  if (
    state.phase === "Playing" &&
    carrierAlive &&
    state.difficulty !== "Ensign" &&
    !isBossWave(state.wave)
  ) {
    reinforceTimer -= dtMs;
    if (reinforceTimer <= 0) {
      reinforceTimer = REINFORCE_INTERVAL;
      const occupied = new Set(
        enemies.filter((e) => e.isAlive).map((e) => `${e.formationX},${e.formationY}`)
      );
      const empty = waveSlots(state.wave).filter((slot) => {
        if (slot.tier !== "Grunt") return false;
        const { fx, fy } = slotToWorld(slot, state.canvasW);
        return !occupied.has(`${fx},${fy}`);
      });
      const n = Math.min(
        empty.length,
        REINFORCE_MIN + Math.floor(rng() * (REINFORCE_MAX - REINFORCE_MIN + 1)),
        reinforceCap(state.wave) - reinforcedThisWave
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

  return {
    ...state,
    enemies,
    enemyBullets: newEnemyBullets,
    nextDiveTimer,
    formationSwayX: swayX,
    formationSwayDir: swayDir,
    bossThresholdCrossed,
    bossDeepThresholdCrossed,
    reinforceTimer,
    reinforcedThisWave,
    runStats,
    routed,
  };
}

// ---------------------------------------------------------------------------
// Power-ups (#980)
// ---------------------------------------------------------------------------

function tickPowerUps(state: StarSwarmState, dtMs: number): StarSwarmState {
  const powerUps = state.powerUps
    .map((pu) => ({ ...pu, y: pu.y + pu.vy * dtMs, despawnTimer: pu.despawnTimer - dtMs }))
    .filter((pu) => pu.despawnTimer > 0 && pu.y - pu.height / 2 < state.canvasH);

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

  return { ...state, powerUps, activePowerUp, bombFlashTimer };
}

// ---------------------------------------------------------------------------
// Buddy ships (#1035)
// ---------------------------------------------------------------------------

function tickBuddyShips(state: StarSwarmState, dtMs: number): StarSwarmState {
  if (state.buddyShips.length === 0) return state;

  const newPlayerBullets = [...state.playerBullets];
  const updatedBuddies: BuddyShip[] = [];

  for (const buddy of state.buddyShips) {
    const newT = buddy.pathT + dtMs / buddy.pathDuration;
    const pos = evalCubic(buddy.path, Math.min(newT, 1));

    // Fire spread burst once at BUDDY_FIRE_AT_T
    let hasFired = buddy.hasFired;
    if (!hasFired && newT >= BUDDY_FIRE_AT_T) {
      hasFired = true;
      const bulletCount =
        BUDDY_BULLET_COUNT_MIN +
        Math.floor(Math.random() * (BUDDY_BULLET_COUNT_MAX - BUDDY_BULLET_COUNT_MIN + 1));
      const aliveEnemies = state.enemies.filter((e) => e.isAlive);
      let aimX = pos.x;
      let aimY = pos.y + 1;
      if (aliveEnemies.length > 0) {
        aimX = aliveEnemies.reduce((s, e) => s + e.x, 0) / aliveEnemies.length;
        aimY = aliveEnemies.reduce((s, e) => s + e.y, 0) / aliveEnemies.length;
      }
      const dx = aimX - pos.x;
      const dy = aimY - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const baseDirX = dist > 1 ? dx / dist : 0;
      const baseDirY = dist > 1 ? dy / dist : 1;
      const baseAngle = Math.atan2(baseDirY, baseDirX);
      const spreadHalf = Math.PI / 6; // ±30° total fan
      for (let i = 0; i < bulletCount; i++) {
        // #2334: buddy-ship bullets are player-owned — respect the same hard cap tickPlayer
        // enforces, so a burst can't push playerBullets past it during heavy Lightning fire.
        if (newPlayerBullets.length >= MAX_PLAYER_BULLETS) break;
        const angle =
          bulletCount === 1
            ? baseAngle
            : baseAngle + ((i / (bulletCount - 1)) * 2 - 1) * spreadHalf;
        newPlayerBullets.push({
          id: nextId(),
          x: pos.x,
          y: pos.y,
          vx: Math.cos(angle) * BUDDY_BULLET_SPEED,
          vy: Math.sin(angle) * BUDDY_BULLET_SPEED,
          owner: "player",
          width: BULLET_E_W,
          height: BULLET_E_H,
          damage: 1,
          piercing: true,
        });
      }
    }

    // Remove when path complete and off screen
    if (newT < 1.2) {
      updatedBuddies.push({ ...buddy, x: pos.x, y: pos.y, pathT: newT, hasFired });
    }
  }

  return { ...state, buddyShips: updatedBuddies, playerBullets: newPlayerBullets };
}

// ---------------------------------------------------------------------------
// Bullets
// ---------------------------------------------------------------------------

function tickBullets(state: StarSwarmState, dtMs: number): StarSwarmState {
  const { canvasW, canvasH } = state;

  const playerBullets = state.playerBullets
    .map((b) => ({ ...b, x: b.x + b.vx * dtMs, y: b.y + b.vy * dtMs }))
    .filter((b) => b.y + b.height / 2 > 0 && b.x > -10 && b.x < canvasW + 10);

  const enemyBullets = state.enemyBullets
    .map((b) => ({ ...b, x: b.x + b.vx * dtMs, y: b.y + b.vy * dtMs }))
    .filter(
      (b) =>
        b.y - b.height / 2 < canvasH &&
        b.y + b.height / 2 > -20 && // #2487: flak fired upward at a rock leaves off the top
        b.x > -10 &&
        b.x < canvasW + 10
    );

  return { ...state, playerBullets, enemyBullets };
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

function spawnExplosion(x: number, y: number): Explosion {
  return { id: nextId(), x, y, frame: 0, frameTimer: EXPLOSION_FRAME_MS };
}

function tickCollisions(state: StarSwarmState): StarSwarmState {
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
      if (!b.piercing && hitBulletIds.has(b.id)) continue;
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
      } else {
        hitBulletIds.add(b.id);
      }

      // #2484: an escorted Carrier shrugs off ordinary shots — the bullet is spent, the force-field
      // ring plays, no damage. Piercing shots (lightning super-state, buddy burst) go through.
      if (enemy.tier === "Carrier" && carrierArmored && !b.piercing) {
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
        score += Math.round(base * mult * scoreMult);
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
      return { ...b, hitEnemyIds: [...(b.hitEnemyIds ?? []), ...hits] };
    });

  // #2486: rocks are cover — any shot that reaches one is spent on it (piercing shots included),
  // then rocks ram whatever they fly into. Nobody scores for any of it.
  {
    const absorbed = absorbBulletsIntoRocks(playerBullets, rocks);
    playerBullets = absorbed.bullets;
    if (absorbed.broken > 0) runStats = bumpRun(runStats, { rocksBrokenByPlayer: absorbed.broken }); // #2491
    const struckTiers: EnemyTier[] = [];
    const struck = rocksStrikeEnemies(absorbed.rocks, enemies, newExplosions, struckTiers);
    rocks = struck.rocks;
    enemies = struck.enemies;
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
          score += Math.round(TIER_SCORE[e.tier] * scoreMult); // no dive multiplier for bomb kills
          if (state.phase === "Playing") killsSinceLastDrop++;
          return { ...e, hp: 0, isAlive: false, hitFlashTimer: 0 };
        }
        return { ...e, hp: newHp, hitFlashTimer: HIT_FLASH_DURATION };
      });
      if (bombCaught > 0) runStats = bumpRun(runStats, { routCaught: bombCaught });
    } else if (collected.type === "buddy") {
      // #1035: spawn a buddy ship
      const aliveEnemies = enemies.filter((e) => e.isAlive);
      const targetX =
        aliveEnemies.length > 0
          ? aliveEnemies.reduce((sum, e) => sum + e.x, 0) / aliveEnemies.length
          : state.canvasW / 2;
      const targetY =
        aliveEnemies.length > 0
          ? aliveEnemies.reduce((sum, e) => sum + e.y, 0) / aliveEnemies.length
          : state.canvasH * 0.4;
      const fromLeft = Math.random() > 0.5;
      const path = buddyShipPath(fromLeft, targetX, targetY, state.canvasW, state.canvasH);
      buddyShips = [
        ...buddyShips,
        {
          id: nextId(),
          x: fromLeft ? -40 : state.canvasW + 40,
          y: state.canvasH * 0.3,
          path,
          pathT: 0,
          pathDuration: BUDDY_SHIP_DURATION,
          hasFired: false,
          targetX,
          targetY,
          fromLeft,
        },
      ];
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

  // #2486: enemy shots are spent on rocks the same way the player's are
  {
    const absorbed = absorbBulletsIntoRocks(currentEnemyBullets, rocks);
    currentEnemyBullets = absorbed.bullets;
    rocks = absorbed.rocks;
    if (absorbed.broken > 0) runStats = bumpRun(runStats, { rocksBrokenByEnemy: absorbed.broken }); // #2491
  }

  if (player.invincibleTimer <= 0) {
    // Harmless (carried-over from a cleared wave, see Bullet.harmless) bullets keep flying
    // and rendering but can never register a hit — they're excluded here rather than filtered
    // out of currentEnemyBullets entirely so they still despawn normally via tickBullets.
    const bulletHits = currentEnemyBullets.filter(
      (b) =>
        !b.harmless &&
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
    // #2485: the Carrier's beam — a vertical band below it; the shield holds it off, otherwise it
    // costs a life (post-hit invincibility then covers the rest of the sweep)
    const firingBeamOn = enemies.find(
      (e) =>
        e.isAlive &&
        e.tier === "Carrier" &&
        e.beamPhase === "fire" &&
        player.y > e.y &&
        Math.abs(player.x - e.x) < BEAM_HALF_WIDTH + PLAYER_HURT_RADIUS
    );
    const hitByBeam = firingBeamOn !== undefined;
    const beamRemainingMs = firingBeamOn ? Math.max(0, firingBeamOn.beamTimer) : 0;

    // #1033: the shield absorbs projectiles (bullets, a rock, the beam) but never a ship
    // collision, so the ram check below runs whether or not something was absorbed this tick.
    // (Before #2533 an absorbed hit skipped it; harmless for a one-frame bullet, but the beam
    // lasts 1.2 s and left a shielded player parked in its column unrammable.)
    const projectileHit = hitByBullet || hitByRock || hitByBeam;
    const absorbed = projectileHit && shieldActive;
    if (absorbed) {
      // Shield absorbs the bullets — no damage. Harmless bullets aren't absorbed (they were
      // never counted in bulletHits), so they fly on through instead of popping mid-screen.
      currentEnemyBullets = currentEnemyBullets.filter(
        (b) =>
          b.harmless ||
          !collideCircleAABB(player.x, player.y, PLAYER_HURT_RADIUS, b.x, b.y, b.width, b.height)
      );
      activePowerUp = {
        ...activePowerUp!,
        shieldAbsorbed: activePowerUp!.shieldAbsorbed + bulletHits.length + (hitByRock ? 1 : 0),
      };
    }
    {
      // #956/#1029/#1030/#1077: capture the ramming enemy so we can destroy it on collision
      // Bosses collidable only in Stage 3 (bossDeepThresholdCrossed); Elite Phase 1 always exempt
      // A projectile that already costs the life makes the ram check moot; an absorbed one doesn't.
      let rammingEnemyId: number | null = null;
      const hitByShip =
        (absorbed || !projectileHit) &&
        enemies.some((e) => {
          if (!e.isAlive) return false;
          if (e.tier === "Carrier") return false; // #2484: never leaves formation
          if (e.tier === "Boss" && !state.bossDeepThresholdCrossed) return false;
          if (e.tier === "Elite" && !state.bossThresholdCrossed) return false;
          if (e.phase !== "Diving" && e.phase !== "Circling") return false;
          if (
            !collideCircleAABB(player.x, player.y, PLAYER_HURT_RADIUS, e.x, e.y, e.width, e.height)
          )
            return false;
          rammingEnemyId = e.id;
          return true;
        });

      if (hitByShip || (projectileHit && !absorbed)) {
        // #2491: a sweep that lands (plating or a life) counts once — the grace that follows
        // keeps the rest of the same sweep out of this block
        if (hitByBeam && !absorbed) runStats = bumpRun(runStats, { beamHits: 1 });
        const finalEnemies =
          hitByShip && rammingEnemyId !== null
            ? enemies.map((e) => {
                if (e.id === rammingEnemyId) {
                  newExplosions.push(spawnExplosion(e.x, e.y));
                  score += Math.round(TIER_SCORE[e.tier] * DIVE_SCORE_MULT * scoreMult);
                  return { ...e, hp: 0, isAlive: false };
                }
                return e;
              })
            : enemies;

        const enemyBulletsAfterHit = hitByBullet
          ? currentEnemyBullets.filter(
              (b) =>
                b.harmless ||
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
              // A beam lasts longer than the plating's grace, so the grace stretches to the end
              // of the sweep — one plate per beam, never two and a life (#2540 review).
              invincibleTimer: Math.max(
                player.invincibleTimer,
                HULL_INVINCIBLE_MS,
                hitByBeam ? beamRemainingMs + 50 : 0
              ),
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
  const explosions = state.explosions
    .map((ex) => {
      const frameTimer = ex.frameTimer - dtMs;
      if (frameTimer <= 0) {
        return { ...ex, frame: ex.frame + 1, frameTimer: EXPLOSION_FRAME_MS };
      }
      return { ...ex, frameTimer };
    })
    .filter((ex) => ex.frame < EXPLOSION_FRAMES);

  return { ...state, explosions };
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

function checkPhaseTransitions(state: StarSwarmState): StarSwarmState {
  const liveEnemies = state.enemies.filter((e) => e.isAlive);

  // SwoopIn → Playing once all enemies are in Formation
  if (state.phase === "SwoopIn") {
    const allArrived = liveEnemies.every((e) => e.phase !== "SwoopIn");
    if (allArrived) return { ...state, phase: "Playing" };
    return state;
  }

  // Playing → next wave once all enemies dead. #2352: the next wave starts immediately — no
  // freeze, no AI autopilot lockout. The wave-clear sound/haptic (fired by the caller off the
  // `wave` bump) and the brief, non-blocking missionCompleteTimer banner are the only
  // acknowledgment. #2490: a boss wave pays double (see waveClearBonusPoints).
  if (state.phase === "Playing") {
    if (liveEnemies.length === 0) {
      const waveClearBonus = waveClearBonusPoints(state.wave, state.difficulty);
      // Note: invincibleTimer and bombFlashTimer don't need resetting here —
      // startNextWave() → buildWaveState() unconditionally resets both on every wave.
      const next = startNextWave({
        ...state,
        score: state.score + waveClearBonus,
      });
      return { ...next, missionCompleteTimer: MISSION_COMPLETE_BANNER_MS };
    }
    return state;
  }

  return state;
}

function startNextWave(state: StarSwarmState): StarSwarmState {
  const nextWave = state.wave + 1;
  // Only carry a stragglerEnabled override forward when it deviates from what difficulty
  // would naturally produce — passing undefined lets buildWaveState re-derive from difficulty.
  const stragglerOverride =
    state.stragglerEnabled !== (state.difficulty !== "Ensign") ? state.stragglerEnabled : undefined;
  return buildWaveState(
    state.canvasW,
    state.canvasH,
    nextWave,
    state.player,
    state.score,
    state.bonusLivesAwarded,
    state.difficulty,
    stragglerOverride,
    // In-flight bullets survive the wave boundary instead of vanishing. Enemy bullets are
    // marked harmless (see Bullet.harmless): the ship the player was flying already won this
    // wave, so a shot fired at it a moment before the last enemy died can't retroactively
    // kill them — it just keeps flying across the screen like a normal spent shot.
    state.playerBullets,
    state.enemyBullets.map((b) => (b.harmless ? b : { ...b, harmless: true })),
    state.asteroids,
    state.tierStats,
    state.runStats
  );
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
        score += Math.round(TIER_SCORE[e.tier] * sm);
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
      powerUps: [...state.powerUps, ...drops],
      explosions: newExplosions,
      score,
      killsSinceLastDrop,
      bombFlashTimer: BOMB_FLASH_DURATION,
    };
  }

  if (type === "buddy") {
    const aliveEnemies = state.enemies.filter((e) => e.isAlive);
    const targetX =
      aliveEnemies.length > 0
        ? aliveEnemies.reduce((sum, e) => sum + e.x, 0) / aliveEnemies.length
        : state.canvasW / 2;
    const targetY =
      aliveEnemies.length > 0
        ? aliveEnemies.reduce((sum, e) => sum + e.y, 0) / aliveEnemies.length
        : state.canvasH * 0.4;
    const fromLeft = Math.random() > 0.5;
    const path = buddyShipPath(fromLeft, targetX, targetY, state.canvasW, state.canvasH);
    return {
      ...state,
      buddyShips: [
        ...state.buddyShips,
        {
          id: nextId(),
          x: fromLeft ? -40 : state.canvasW + 40,
          y: state.canvasH * 0.3,
          path,
          pathT: 0,
          pathDuration: BUDDY_SHIP_DURATION,
          hasFired: false,
          targetX,
          targetY,
          fromLeft,
        },
      ],
    };
  }

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

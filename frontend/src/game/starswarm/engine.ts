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

export const BULLET_C_W = 12; // super-state bullet — wider
const BULLET_C_H = 22;

const BULLET_E_W = 5;
const BULLET_E_H = 10;
export const BULLET_E_VY = 0.35; // px/ms downward

const FORMATION_COLS = 8;
const FORMATION_COL_W = 44; // #950: was 38 — Boss (36 px) had only 1 px margin/side
const FORMATION_ROW_H = 46;
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

const DIVE_INTERVAL_BASE = 3200; // ms between dive triggers
const DIVE_INTERVAL_MIN = 900; // floor regardless of wave

const WAVE_CLEAR_PAUSE = 1600; // ms
const FREE_FIRE_CLEAR_PAUSE = 2200; // ms
const FREE_FIRE_ENEMY_COUNT = 40; // classic 40-enemy Free Fire Zone (#1022)
const PERFECT_BONUS = 10_000; // flat bonus for hitting all challenge enemies (#1022)
// #1463: reduced HP — free fire zone is a shooting gallery; multi-hit enemies are unkillable at speed
const FREE_FIRE_TIER_HP: Record<EnemyTier, number> = { Grunt: 1, Elite: 1, Boss: 2 };
// #1463: slower swarm — 5 s arc, 400 ms stagger → ~20.6 s total stage
const FREE_FIRE_PATH_DURATION = 5000; // ms each enemy traverses its arc
const FREE_FIRE_STAGGER_MS = 400; // ms between successive enemy entries

const SHOOT_INTERVAL_BASE = 2600; // ms base
const SHOOT_INTERVAL_JITTER = 1400; // ms random addend

const EXPLOSION_FRAME_MS = 28;
const EXPLOSION_FRAMES = 20;

const WAVE_CLEAR_BONUS_BASE = 500;

// Score diving enemies get a 2× multiplier.
const DIVE_SCORE_MULT = 2;

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

const TIER_SCORE: Record<EnemyTier, number> = { Grunt: 100, Elite: 200, Boss: 400 };
const TIER_HP: Record<EnemyTier, number> = { Grunt: 1, Elite: 2, Boss: 4 };

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
  for (let c = 0; c < 4; c++) slots.push({ tier: "Boss", row: 0, col: c, rowCols: 4 });

  // Two Elite rows
  for (let r = 1; r <= 2; r++)
    for (let c = 0; c < FORMATION_COLS; c++)
      slots.push({ tier: "Elite", row: r, col: c, rowCols: FORMATION_COLS });

  // Grunt rows: 2 at wave 1, +1 every other wave, max 5
  const gruntRows = Math.min(2 + Math.floor((wave - 1) / 2), 5);
  for (let r = 3; r < 3 + gruntRows; r++)
    for (let c = 0; c < FORMATION_COLS; c++)
      slots.push({ tier: "Grunt", row: r, col: c, rowCols: FORMATION_COLS });

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

function challengePath(idx: number, total: number, canvasW: number, canvasH: number): CubicBezier {
  const col = idx % FORMATION_COLS;
  const startX = (canvasW / FORMATION_COLS) * col + canvasW / (FORMATION_COLS * 2);
  const amp = canvasW * 0.28;
  const sign = idx % 2 === 0 ? 1 : -1;
  return {
    p0: { x: startX, y: -60 - Math.floor(idx / FORMATION_COLS) * 55 },
    p1: { x: Math.min(canvasW - 20, Math.max(20, startX + sign * amp)), y: canvasH * 0.28 },
    p2: { x: Math.min(canvasW - 20, Math.max(20, startX - sign * amp)), y: canvasH * 0.62 },
    p3: { x: startX, y: canvasH + 80 },
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
  };
}

function makeFreeFireEnemy(idx: number, total: number, canvasW: number, canvasH: number): Enemy {
  const tier: EnemyTier = idx % 6 === 0 ? "Boss" : idx % 3 === 0 ? "Elite" : "Grunt";
  const size = TIER_SIZE[tier];
  const path = challengePath(idx, total, canvasW, canvasH);
  const p0 = evalCubic(path, 0);
  const delay = (idx * FREE_FIRE_STAGGER_MS) / FREE_FIRE_PATH_DURATION;

  return {
    id: nextId(),
    tier,
    phase: "SwoopIn",
    x: p0.x,
    y: p0.y,
    width: size.w,
    height: size.h,
    formationX: path.p3.x,
    formationY: path.p3.y,
    path,
    pathT: -delay,
    pathDuration: FREE_FIRE_PATH_DURATION,
    vel: { x: 0, y: 0 },
    circleCx: 0,
    circleCy: 0,
    circleRadius: CIRCLE_RADIUS,
    circleAngle: 0,
    circleSpeed: CIRCLE_SPEED,
    shootTimer: 9_999_999, // never shoots
    diveTargetX: 0,
    hp: FREE_FIRE_TIER_HP[tier],
    isAlive: true,
    hitFlashTimer: 0,
    wiggleTimer: 0,
    burstShotsLeft: 0,
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

// Free Fire Zone cadence: wave 3, then every 4th wave (3, 7, 11, 15 …) (#1022)
function isFreeFireWave(wave: number): boolean {
  if (wave === 3) return true;
  if (wave < 3) return false;
  return (wave - 3) % 4 === 0;
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
  difficulty: DifficultyTier = "LieutenantJG"
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
  };

  return buildWaveState(canvasW, canvasH, wave, player, 0, 0, difficulty);
}

function buildWaveState(
  canvasW: number,
  canvasH: number,
  wave: number,
  player: Player,
  score: number,
  bonusLivesAwarded = 0,
  difficulty: DifficultyTier = "LieutenantJG"
): StarSwarmState {
  let enemies: Enemy[];
  let phase: StarSwarmState["phase"];

  if (isFreeFireWave(wave)) {
    enemies = Array.from({ length: FREE_FIRE_ENEMY_COUNT }, (_, i) =>
      makeFreeFireEnemy(i, FREE_FIRE_ENEMY_COUNT, canvasW, canvasH)
    );
    phase = "FreeFireZone";
  } else {
    const slots = waveSlots(wave);
    enemies = slots.map((slot, idx) => makeEnemy(idx, slot, canvasW));
    phase = "SwoopIn";
  }

  const startingNonBossCount = enemies.filter((e) => e.tier !== "Boss").length;

  const powerUps: PowerUp[] = [];
  const dropJitterTarget = triggerKills(wave) + Math.floor(rng() * 5) - 2;
  const paramScale = difficultyParamScale(difficulty);
  // Ensign gets gentler AI; every tier above gets straggler aggression
  const stragglerEnabled = difficulty !== "Ensign";

  return {
    phase,
    wave,
    score,
    player,
    enemies,
    playerBullets: [],
    enemyBullets: [],
    explosions: [],
    powerUps,
    buddyShips: [],
    phaseTimer: 0,
    canvasW,
    canvasH,
    freeFireHits: 0,
    nextDiveTimer: diveInterval(wave, paramScale),
    formationSwayX: 0,
    formationSwayDir: 1,
    bonusLivesAwarded,
    bonusLifeSlowMoTimer: 0,
    startingNonBossCount,
    killsSinceLastDrop: 0,
    dropJitterTarget,
    activePowerUp: null,
    bossThresholdCrossed: false,
    bossDeepThresholdCrossed: false,
    stragglerEnabled,
    pauseStraggler: false,
    bombFlashTimer: 0,
    difficulty,
    freeFirePerfect: false,
    playerFireDisabled: false,
    enemyFireDisabled: false,
  };
}

// ---------------------------------------------------------------------------
// Public: tick
// ---------------------------------------------------------------------------

export function tick(state: StarSwarmState, dtMs: number, input: StarSwarmInput): StarSwarmState {
  if (state.phase === "GameOver") return state;

  if (state.phase === "WaveClear") {
    const timer = state.phaseTimer - dtMs;
    if (timer <= 0) return startNextWave(state);
    return { ...state, phaseTimer: timer };
  }

  // #1078: decrement slow-mo timer with real time; scale all gameplay by BONUS_LIFE_SLOW_MO_SCALE
  const slowMoActive = state.bonusLifeSlowMoTimer > 0;
  const bonusLifeSlowMoTimer = Math.max(0, state.bonusLifeSlowMoTimer - dtMs);
  const scaledDt = slowMoActive ? dtMs * BONUS_LIFE_SLOW_MO_SCALE : dtMs;

  let s: StarSwarmState = { ...state, bonusLifeSlowMoTimer };
  s = tickPlayer(s, scaledDt, input);
  s = tickEnemies(s, scaledDt);
  s = tickBullets(s, scaledDt);
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

  if (livesToAward === 0 || next.player.lives >= MAX_LIVES) return next;

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

  const player: Player = { ...p, x: newX, invincibleTimer, shootCooldown };

  const isSuper = state.activePowerUp?.type === "lightning";

  if (shootCooldown === 0 && input.fire && !state.playerFireDisabled) {
    const bullet: Bullet = {
      id: nextId(),
      x: newX,
      y: p.y - p.height / 2,
      vx: 0,
      vy: BULLET_P_VY,
      owner: "player",
      width: isSuper ? BULLET_C_W : BULLET_P_W,
      height: isSuper ? BULLET_C_H : BULLET_P_H,
      damage: isSuper ? SUPER_DAMAGE : 1,
      piercing: isSuper ? true : undefined,
    };
    return {
      ...state,
      player: { ...player, shootCooldown: isSuper ? SUPER_SHOOT_COOLDOWN : PLAYER_SHOOT_COOLDOWN },
      playerBullets: [...state.playerBullets, bullet],
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
  paramScale = 1
): EnemyTickResult {
  if (!enemy.isAlive) return { enemy, bullet: null };

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

function tickEnemies(state: StarSwarmState, dtMs: number): StarSwarmState {
  // #1030: bossThresholdCrossed latches true once ≤35% non-boss enemies remain
  const aliveNonBoss = state.enemies.filter((e) => e.isAlive && e.tier !== "Boss").length;
  const bossThresholdCrossed =
    state.bossThresholdCrossed ||
    state.startingNonBossCount === 0 ||
    aliveNonBoss / state.startingNonBossCount <= BOSS_DIVE_THRESHOLD;

  // #1077: bossDeepThresholdCrossed latches true at Stage 3 (≤3 enemies alive)
  const aliveAll = state.enemies.filter((e) => e.isAlive).length;
  const bossDeepThresholdCrossed =
    state.bossDeepThresholdCrossed ||
    (state.stragglerEnabled &&
      !state.pauseStraggler &&
      state.phase === "Playing" &&
      aliveAll > 0 &&
      aliveAll <= 3);

  // #926 Dive AI: pick up to maxDivers(wave) formation enemies to send diving
  let nextDiveTimer = state.nextDiveTimer;
  const diveIndices = new Set<number>();

  if (state.phase === "Playing") {
    nextDiveTimer -= dtMs;
    if (nextDiveTimer <= 0) {
      nextDiveTimer = diveInterval(state.wave, difficultyParamScale(state.difficulty));
      // #978/#1030: Boss only eligible once bossThresholdCrossed
      const candidates = state.enemies
        .map((e, i) => ({ e, i }))
        .filter(
          ({ e }) =>
            e.isAlive && e.phase === "Formation" && (e.tier !== "Boss" || bossThresholdCrossed)
        );
      // Only launch enough new divers to reach the cap; Wiggling enemies are NOT counted (#975)
      const currentDivers = state.enemies.filter((e) => e.isAlive && e.phase === "Diving").length;
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
  let enemies = state.enemies.map((enemy, idx) => {
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
      _ps
    );
    let e = result.enemy;
    // Apply sway offset to enemies holding Formation position
    // #979: Boss sways ±BOSS_MAX_SWAY (20px) vs ±MAX_SWAY (40px) for other tiers
    if (e.isAlive && e.phase === "Formation") {
      const appliedSway =
        e.tier === "Boss" ? Math.max(-BOSS_MAX_SWAY, Math.min(BOSS_MAX_SWAY, swayX)) : swayX;
      e = { ...e, x: e.formationX + appliedSway };
    }
    // Decrement hit-flash timer (#976)
    if (e.isAlive && e.hitFlashTimer > 0) {
      e = { ...e, hitFlashTimer: Math.max(0, e.hitFlashTimer - dtMs) };
    }
    if (
      result.bullet &&
      newEnemyBullets.length < bulletCap(state.wave, _ps) &&
      !state.enemyFireDisabled
    ) {
      newEnemyBullets.push(result.bullet);
    }
    return e;
  });

  // #934: challenge enemies follow a path that exits off the bottom; once they
  // cross canvasH they can't be shot, so mark them dead to unblock WaveClear.
  if (state.phase === "FreeFireZone") {
    enemies = enemies.map((e) =>
      e.isAlive && e.y > state.canvasH + 60 ? { ...e, isAlive: false } : e
    );
  }

  // #1031: straggler aggression — when ≤3 enemies survive in a Playing wave,
  // all Formation enemies immediately start wiggling
  // #1039: pauseStraggler dev-panel toggle suppresses this
  if (state.stragglerEnabled && !state.pauseStraggler && state.phase === "Playing") {
    const aliveCount = enemies.filter((e) => e.isAlive).length;
    if (aliveCount > 0 && aliveCount <= 3) {
      enemies = enemies.map((e) => {
        if (!e.isAlive || e.phase !== "Formation") return e;
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
        // eslint-disable-next-line no-console
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
    .filter((b) => b.y - b.height / 2 < canvasH && b.x > -10 && b.x < canvasW + 10);

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
  let { score, freeFireHits } = state;
  const newExplosions: Explosion[] = [...state.explosions];
  let killsSinceLastDrop = state.killsSinceLastDrop;
  let dropJitterTarget = state.dropJitterTarget;
  let powerUps: PowerUp[] = [...state.powerUps];
  const scoreMult = difficultyMultiplier(state.difficulty);

  // ── Player bullets ↔ enemies ──────────────────────────────────────────────
  const hitBulletIds = new Set<number>(); // non-piercing bullets consumed this tick
  const piercingHits = new Set<string>(); // `${bulletId}:${enemyId}` — prevents double-hit
  let enemies = state.enemies.map((enemy) => {
    if (!enemy.isAlive) return enemy;

    for (const b of state.playerBullets) {
      if (!b.piercing && hitBulletIds.has(b.id)) continue;
      if (b.piercing && piercingHits.has(`${b.id}:${enemy.id}`)) continue;
      if (!aabb(b.x, b.y, b.width, b.height, enemy.x, enemy.y, enemy.width, enemy.height)) continue;

      if (b.piercing) {
        piercingHits.add(`${b.id}:${enemy.id}`);
      } else {
        hitBulletIds.add(b.id);
      }

      const newHp = enemy.hp - b.damage;

      if (newHp <= 0) {
        newExplosions.push(spawnExplosion(enemy.x, enemy.y));
        const base = TIER_SCORE[enemy.tier];
        const mult = enemy.phase === "Diving" || enemy.phase === "Circling" ? DIVE_SCORE_MULT : 1;
        const bonus = state.phase === "FreeFireZone" ? 1 : mult;
        score += Math.round(base * bonus * scoreMult);
        if (state.phase === "FreeFireZone") freeFireHits += 1;
        if (state.phase === "Playing") killsSinceLastDrop++;
        return { ...enemy, hp: 0, isAlive: false, hitFlashTimer: 0 };
      }

      // Non-lethal hit — shield ring burst (#1310); killing blow skips flash (explosion takes over)
      return { ...enemy, hp: newHp, hitFlashTimer: HIT_FLASH_DURATION };
    }
    return enemy;
  });

  // Piercing bullets are removed by the off-screen filter in tickBullets, not here
  const playerBullets = state.playerBullets.filter((b) => !hitBulletIds.has(b.id));

  // ── Power-up drop check (Playing only, max 1 on screen) ────────────────────
  if (
    state.phase === "Playing" &&
    killsSinceLastDrop >= dropJitterTarget &&
    powerUps.length === 0
  ) {
    // #1032: X uses Math.random() — cosmetic, non-deterministic
    const spawnX = POWERUP_W / 2 + Math.random() * (state.canvasW - POWERUP_W);
    powerUps = [
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
      // eslint-disable-next-line no-console
      console.log("[StarSwarm analytics]", {
        event: "powerup_collected",
        type: collected.type,
        wave: state.wave,
        livesAtCollection: player.lives,
      });
    }

    if (collected.type === "bomb") {
      // #1034: instant — clear all enemy bullets, deal 1 damage to every alive enemy
      bombActivated = true;
      bombFlashTimer = BOMB_FLASH_DURATION;
      enemies = enemies.map((e) => {
        if (!e.isAlive) return e;
        const newHp = e.hp - 1;
        if (newHp <= 0) {
          newExplosions.push(spawnExplosion(e.x, e.y));
          score += Math.round(TIER_SCORE[e.tier] * scoreMult); // no dive multiplier for bomb kills
          if (state.phase === "Playing") killsSinceLastDrop++;
          return { ...e, hp: 0, isAlive: false, hitFlashTimer: 0 };
        }
        return { ...e, hp: newHp, hitFlashTimer: HIT_FLASH_DURATION };
      });
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

  if (player.invincibleTimer <= 0) {
    const bulletHits = currentEnemyBullets.filter((b) =>
      collideCircleAABB(player.x, player.y, PLAYER_HURT_RADIUS, b.x, b.y, b.width, b.height)
    );
    const hitByBullet = bulletHits.length > 0;

    if (hitByBullet && shieldActive) {
      // Shield absorbs the bullets — no damage
      currentEnemyBullets = currentEnemyBullets.filter(
        (b) =>
          !collideCircleAABB(player.x, player.y, PLAYER_HURT_RADIUS, b.x, b.y, b.width, b.height)
      );
      activePowerUp = {
        ...activePowerUp!,
        shieldAbsorbed: activePowerUp!.shieldAbsorbed + bulletHits.length,
      };
    } else {
      // #956/#1029/#1030/#1077: capture the ramming enemy so we can destroy it on collision
      // Bosses collidable only in Stage 3 (bossDeepThresholdCrossed); Elite Phase 1 always exempt
      let rammingEnemyId: number | null = null;
      const hitByShip =
        !hitByBullet &&
        enemies.some((e) => {
          if (!e.isAlive) return false;
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

      if (hitByBullet || hitByShip) {
        const newLives = player.lives - 1;
        newExplosions.push(spawnExplosion(player.x, player.y));

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

        if (newLives <= 0) {
          return {
            ...state,
            enemies: finalEnemies,
            playerBullets,
            enemyBullets: enemyBulletsAfterHit,
            explosions: newExplosions,
            score,
            freeFireHits,
            powerUps,
            buddyShips,
            killsSinceLastDrop,
            dropJitterTarget,
            activePowerUp,
            bombFlashTimer,
            player: { ...player, lives: 0 },
            phase: "GameOver",
          };
        }

        return {
          ...state,
          enemies: finalEnemies,
          playerBullets,
          enemyBullets: enemyBulletsAfterHit,
          explosions: newExplosions,
          score,
          freeFireHits,
          powerUps,
          buddyShips,
          killsSinceLastDrop,
          dropJitterTarget,
          activePowerUp,
          bombFlashTimer,
          player: { ...player, lives: newLives, invincibleTimer: PLAYER_INVINCIBLE_MS },
        };
      }
    }
  }

  return {
    ...state,
    enemies,
    playerBullets,
    enemyBullets: currentEnemyBullets,
    score,
    freeFireHits,
    explosions: newExplosions,
    powerUps,
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

  // SwoopIn → Playing once all enemies are in Formation (or Challenging started)
  if (state.phase === "SwoopIn") {
    const allArrived = liveEnemies.every((e) => e.phase !== "SwoopIn");
    if (allArrived) return { ...state, phase: "Playing" };
    return state;
  }

  // FreeFireZone → WaveClear once all challenge enemies have exited
  if (state.phase === "FreeFireZone") {
    // Enemies exit when their path completes (they reach formationY which is off-screen bottom)
    const anyAlive = liveEnemies.length > 0;
    if (!anyAlive) {
      const sm = difficultyMultiplier(state.difficulty);
      // #1463: wave-clear bonus scales with hit ratio — zero kills = zero bonus
      const hitFraction = Math.min(1, state.freeFireHits / FREE_FIRE_ENEMY_COUNT);
      const waveClearBonus = Math.round(hitFraction * state.wave * WAVE_CLEAR_BONUS_BASE * sm);
      const perfect = state.freeFireHits === FREE_FIRE_ENEMY_COUNT;
      const perfectBonus = perfect ? Math.round(PERFECT_BONUS * sm) : 0;
      return {
        ...state,
        score:
          state.score + waveClearBonus + Math.round(state.freeFireHits * 50 * sm) + perfectBonus,
        phase: "WaveClear",
        phaseTimer: FREE_FIRE_CLEAR_PAUSE,
        freeFirePerfect: perfect,
        bombFlashTimer: 0,
      };
    }
    return state;
  }

  // Playing → WaveClear once all enemies dead
  if (state.phase === "Playing") {
    if (liveEnemies.length === 0) {
      const sm = difficultyMultiplier(state.difficulty);
      const waveClearBonus = Math.round(state.wave * WAVE_CLEAR_BONUS_BASE * sm);
      return {
        ...state,
        score: state.score + waveClearBonus,
        phase: "WaveClear",
        phaseTimer: WAVE_CLEAR_PAUSE,
        bombFlashTimer: 0,
      };
    }
    return state;
  }

  return state;
}

function startNextWave(state: StarSwarmState): StarSwarmState {
  const nextWave = state.wave + 1;
  return buildWaveState(
    state.canvasW,
    state.canvasH,
    nextWave,
    state.player,
    state.score,
    state.bonusLivesAwarded,
    state.difficulty
  );
}

// ---------------------------------------------------------------------------
// Public: applyPowerUp — used by triggerPowerUp dev-panel handle (#1039)
// ---------------------------------------------------------------------------

export function applyPowerUp(state: StarSwarmState, type: PowerUpType): StarSwarmState {
  if (state.phase !== "Playing") return state;

  if (type === "bomb") {
    const newExplosions: Explosion[] = [...state.explosions];
    const sm = difficultyMultiplier(state.difficulty);
    let score = state.score;
    let killsSinceLastDrop = state.killsSinceLastDrop;
    const enemies = state.enemies.map((e) => {
      if (!e.isAlive) return e;
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
        return { ...e, hp: 0, isAlive: false, hitFlashTimer: 0 };
      }
      return { ...e, hp: newHp, hitFlashTimer: HIT_FLASH_DURATION };
    });
    return {
      ...state,
      enemies,
      enemyBullets: [],
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

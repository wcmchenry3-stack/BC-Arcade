/**
 * The shape of a saved StarSwarmState, per object type (#2645).
 *
 * Each spec lists every key of its type as "required" or "optional", and the compiler holds
 * it to the type: add, drop or make optional a field of any saved type and typecheck fails
 * here until the spec is updated. That update changes SAVE_FINGERPRINT, which drops every
 * save made with the old shape — no manual version bump to forget. A restore also checks
 * each saved object against its spec, so a save that doesn't fit is never handed to the
 * engine.
 */

import type {
  Asteroid,
  BuddyShip,
  Bullet,
  CubicBezier,
  Enemy,
  Explosion,
  Player,
  PowerUp,
  RunStats,
  StarSwarmState,
  TierStats,
  Vec2,
} from "./types";

type KeySpec<T> = {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  readonly [K in keyof T]-?: {} extends Pick<T, K> ? "optional" : "required";
};

const VEC2: KeySpec<Vec2> = { x: "required", y: "required" };

const BEZIER: KeySpec<CubicBezier> = {
  p0: "required",
  p1: "required",
  p2: "required",
  p3: "required",
};

const DODGE: KeySpec<NonNullable<Enemy["dodge"]>> = {
  dir: "required",
  t: "required",
  dur: "required",
};

const ENEMY: KeySpec<Enemy> = {
  id: "required",
  tier: "required",
  phase: "required",
  x: "required",
  y: "required",
  width: "required",
  height: "required",
  formationX: "required",
  formationY: "required",
  path: "required",
  pathT: "required",
  pathDuration: "required",
  vel: "required",
  circleCx: "required",
  circleCy: "required",
  circleRadius: "required",
  circleAngle: "required",
  circleSpeed: "required",
  shootTimer: "required",
  diveTargetX: "required",
  hp: "required",
  isAlive: "required",
  hitFlashTimer: "required",
  wiggleTimer: "required",
  burstShotsLeft: "required",
  beamPhase: "required",
  beamTimer: "required",
  dodge: "required",
  rolledAsteroidIds: "required",
  flakCooldown: "required",
};

const BULLET: KeySpec<Bullet> = {
  id: "required",
  x: "required",
  y: "required",
  vx: "required",
  vy: "required",
  owner: "required",
  width: "required",
  height: "required",
  damage: "required",
  piercing: "optional",
  hitEnemyIds: "optional",
  harmless: "optional",
  flak: "optional",
};

const PLAYER: KeySpec<Player> = {
  x: "required",
  y: "required",
  width: "required",
  height: "required",
  lives: "required",
  invincibleTimer: "required",
  shootCooldown: "required",
  guns: "required",
  hull: "required",
  hullFlashTimer: "required",
};

const EXPLOSION: KeySpec<Explosion> = {
  id: "required",
  x: "required",
  y: "required",
  frame: "required",
  frameTimer: "required",
};

const POWER_UP: KeySpec<PowerUp> = {
  id: "required",
  type: "required",
  x: "required",
  y: "required",
  vy: "required",
  width: "required",
  height: "required",
  despawnTimer: "required",
};

const BUDDY_SHIP: KeySpec<BuddyShip> = {
  id: "required",
  x: "required",
  y: "required",
  path: "required",
  pathT: "required",
  pathDuration: "required",
  hasFired: "required",
  targetX: "required",
  targetY: "required",
  fromLeft: "required",
};

const ASTEROID: KeySpec<Asteroid> = {
  id: "required",
  kind: "required",
  x: "required",
  y: "required",
  vx: "required",
  vy: "required",
  radius: "required",
  hp: "required",
  rotation: "required",
  spin: "required",
  hitFlashTimer: "required",
  hitEnemyIds: "required",
  shattered: "optional",
};

const ACTIVE_POWER_UP: KeySpec<NonNullable<StarSwarmState["activePowerUp"]>> = {
  remainingMs: "required",
  type: "required",
  shieldAbsorbed: "required",
};

const TIER_STATS: KeySpec<TierStats> = {
  rolls: "required",
  dodged: "required",
  pathRolls: "required",
  pathDodged: "required",
  struck: "required",
  flak: "required",
};

const RUN_STATS: KeySpec<RunStats> = {
  reinforced: "required",
  armorDeflects: "required",
  beamHits: "required",
  routCaught: "required",
  routEscaped: "required",
  rocksSpawned: "required",
  rocksBrokenByPlayer: "required",
  rocksBrokenByEnemy: "required",
};

const STATE: KeySpec<StarSwarmState> = {
  phase: "required",
  wave: "required",
  score: "required",
  player: "required",
  enemies: "required",
  playerBullets: "required",
  enemyBullets: "required",
  explosions: "required",
  powerUps: "required",
  buddyShips: "required",
  asteroids: "required",
  nextAsteroidTimer: "required",
  asteroidsDisabled: "required",
  reinforceTimer: "required",
  reinforcedThisWave: "required",
  tierStats: "required",
  runStats: "required",
  dodgeDisabled: "required",
  flakDisabled: "required",
  phaseTimer: "required",
  canvasW: "required",
  canvasH: "required",
  nextDiveTimer: "required",
  formationSwayX: "required",
  formationSwayDir: "required",
  bonusLivesAwarded: "required",
  bonusLifeSlowMoTimer: "required",
  startingNonBossCount: "required",
  killsSinceLastDrop: "required",
  dropJitterTarget: "required",
  activePowerUp: "required",
  bossThresholdCrossed: "required",
  bossDeepThresholdCrossed: "required",
  stragglerEnabled: "required",
  pauseStraggler: "required",
  routed: "required",
  routDisabled: "required",
  bombFlashTimer: "required",
  difficulty: "required",
  playerFireDisabled: "required",
  enemyFireDisabled: "required",
  missionCompleteTimer: "required",
};

const SPECS = {
  STATE,
  PLAYER,
  ENEMY,
  BULLET,
  EXPLOSION,
  POWER_UP,
  BUDDY_SHIP,
  ASTEROID,
  ACTIVE_POWER_UP,
  TIER_STATS,
  RUN_STATS,
  VEC2,
  BEZIER,
  DODGE,
};

/** Changes whenever any saved type's shape does; a save carries the one it was made with. */
export const SAVE_FINGERPRINT = JSON.stringify(SPECS);

type AnySpec = Readonly<Record<string, "required" | "optional">>;

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Every key the object has is in the spec, and every required one is there. */
function fits(v: unknown, spec: AnySpec): v is Record<string, unknown> {
  if (!isObject(v)) return false;
  for (const k of Object.keys(v)) if (!(k in spec)) return false;
  for (const [k, need] of Object.entries(spec)) if (need === "required" && !(k in v)) return false;
  return true;
}

function allFit(v: unknown, check: (item: unknown) => boolean): boolean {
  return Array.isArray(v) && v.every(check);
}

const fitsBezier = (v: unknown) =>
  fits(v, BEZIER) && [v.p0, v.p1, v.p2, v.p3].every((p) => fits(p, VEC2));

const fitsEnemy = (v: unknown) =>
  fits(v, ENEMY) &&
  fits(v.vel, VEC2) &&
  (v.path === null || fitsBezier(v.path)) &&
  (v.dodge === null || fits(v.dodge, DODGE)) &&
  Array.isArray(v.rolledAsteroidIds);

/** A parsed save's state fits this build's StarSwarmState, all the way down. */
export function fitsSaveShape(v: unknown): v is StarSwarmState {
  if (!fits(v, STATE)) return false;
  return (
    fits(v.player, PLAYER) &&
    allFit(v.enemies, fitsEnemy) &&
    allFit(v.playerBullets, (b) => fits(b, BULLET)) &&
    allFit(v.enemyBullets, (b) => fits(b, BULLET)) &&
    allFit(v.explosions, (e) => fits(e, EXPLOSION)) &&
    allFit(v.powerUps, (p) => fits(p, POWER_UP)) &&
    allFit(v.buddyShips, (b) => fits(b, BUDDY_SHIP) && fitsBezier(b.path)) &&
    allFit(v.asteroids, (a) => fits(a, ASTEROID)) &&
    (v.activePowerUp === null || fits(v.activePowerUp, ACTIVE_POWER_UP)) &&
    fits(v.runStats, RUN_STATS) &&
    isObject(v.tierStats) &&
    Object.values(v.tierStats).every((t) => fits(t, TIER_STATS))
  );
}

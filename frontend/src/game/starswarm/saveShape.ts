/**
 * The shape of a saved StarSwarmState, per object type (#2645).
 *
 * Each spec lists every key of its type as "required" or "optional", and the compiler holds
 * it to the type: add, drop or make optional a field of any saved type and typecheck fails
 * here until the spec is updated. That update changes SAVE_FINGERPRINT, which drops every
 * save made with the old shape — no manual version bump to forget. A restore also checks
 * each saved object against its spec, so a save that doesn't fit is never handed to the
 * engine.
 *
 * #3245: a field added purely as an observation (the per-wave stats) needn't cost a player
 * their paused run. Such fields are listed in ADDED_STATE instead of STATE: they stay out of
 * SAVE_FINGERPRINT, a save may lack them, and `restoreSavedState` fills in (or starts over) any
 * that are missing or don't fit this build. Never put a field the engine's play depends on there.
 */

import type {
  Asteroid,
  BuddyShip,
  Bullet,
  CarrierBeam,
  CubicBezier,
  Enemy,
  Explosion,
  Extraction,
  Player,
  PowerUp,
  RunStats,
  StarSwarmState,
  TierStats,
  Vec2,
} from "./types";
import type { EarlierScore, ScoreLedger, WaveScore } from "./scoreLedger";
import {
  WAVE_STATS_VERSION,
  bumpWave,
  countSpawned,
  emptyWaveStats,
  isWaveStats,
  loadoutOf,
  type WaveRout,
  type WaveStats,
  type WaveStatsWire,
} from "./engine/waveStats";
import { DIFFICULTY_TIERS } from "./engine/tuning";
import { ENEMY_TIERS, HIT_CAUSES, POWERUP_SOURCES } from "./engine/registries";
import { NO_OVERFLOW, wavesBytes, type ClosedWavesOverflow } from "./engine/closedWaves";
import { SHOTS_FIRED, countShipsSpawned } from "./engine/waveCounters";

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
  runPhase: "required",
  runTimer: "required",
  dodge: "required",
  rolledAsteroidIds: "required",
  flakCooldown: "required",
  evadeMs: "required",
  flinchMs: "required",
  reactedAsteroidIds: "required",
  reactedPhase: "required",
  attentionMs: "required",
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
  pierceLeft: "optional", // #2880
  flak: "optional",
  armorPiercing: "optional", // #2845
  source: "optional",
  target: "optional",
};

// #2843
const CARRIER_BEAM: KeySpec<CarrierBeam> = {
  id: "required",
  x: "required",
  y: "required",
  vy: "required",
  length: "required",
  halfWidth: "required",
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

// #3246: `source` is left out of the spec (and so of SAVE_FINGERPRINT) on purpose: adding it would
// drop every paused run. It is optional in a save (fitsPowerUp) and read as "kill" when absent.
const POWER_UP: KeySpec<Omit<PowerUp, "source">> = {
  id: "required",
  type: "required",
  x: "required",
  y: "required",
  vy: "required",
  width: "required",
  height: "required",
  despawnTimer: "required",
};

// #2845: a real allied ship — HP, steering and attack-run state
const BUDDY_SHIP: KeySpec<BuddyShip> = {
  id: "required",
  x: "required",
  y: "required",
  vx: "required",
  vy: "required",
  phase: "required",
  hp: "required",
  hitFlashTimer: "required",
  ageMs: "required",
  stationMs: "required",
  burstsLeft: "required",
  burstTimer: "required",
  planMs: "required",
  goalX: "required",
  goalY: "required",
  facingRight: "required",
  hitRockIds: "required",
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

const EXTRACTION: KeySpec<Extraction> = {
  elapsedMs: "required",
  climbMs: "required",
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
  buddyLaunched: "required", // #2845
  buddyLost: "required",
  buddyShotsDrawn: "required",
};

// #2837
const SCORE_LEDGER: KeySpec<ScoreLedger> = { waves: "required", earlier: "required" };
const WAVE_SCORE: KeySpec<WaveScore> = { wave: "required", pts: "required" };
const EARLIER_SCORE: KeySpec<EarlierScore> = {
  first: "required",
  last: "required",
  pts: "required",
};

/**
 * #3245: StarSwarmState fields added after saves existed — observations, not play state. Not in
 * the fingerprint (adding one keeps every existing save) and optional in a save; see the header.
 */
type AddedStateKey =
  "waveStats" | "lastClosedWave" | "closedWaves" | "closedWavesOverflow" | "closedWavesBytes";
const ADDED_STATE: Readonly<Record<AddedStateKey, "optional">> = {
  waveStats: "optional",
  lastClosedWave: "optional",
  closedWaves: "optional", // #3251
  closedWavesOverflow: "optional", // #3251
  closedWavesBytes: "optional", // #3251: recomputed on restore, whatever the save holds
};

/** A saved state as read back: the ADDED_STATE fields may be missing or from another build. */
export type SavedStarSwarmState = Omit<StarSwarmState, AddedStateKey> & {
  readonly [K in AddedStateKey]?: unknown;
};

const STATE: KeySpec<Omit<StarSwarmState, AddedStateKey>> = {
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
  carrierBeams: "required",
  carrierStage: "required",
  tierStats: "required",
  runStats: "required",
  dodgeDisabled: "required",
  flakDisabled: "required",
  phaseTimer: "required",
  extraction: "required",
  canvasW: "required",
  canvasH: "required",
  nextDiveTimer: "required",
  formationSwayX: "required",
  formationSwayDir: "required",
  bonusLivesAwarded: "required",
  bonusLifeSlowMoTimer: "required",
  startingNonLeaderCount: "required",
  killsSinceLastDrop: "required",
  dropJitterTarget: "required",
  activePowerUp: "required",
  guardianThresholdCrossed: "required",
  guardianDeepThresholdCrossed: "required",
  stragglerEnabled: "required",
  pauseStraggler: "required",
  routed: "required",
  routDisabled: "required",
  bombFlashTimer: "required",
  difficulty: "required",
  playerFireDisabled: "required",
  enemyFireDisabled: "required",
  missionCompleteTimer: "required",
  scoreLedger: "required",
};

// An unknown `source` (another build's) doesn't reject the save: restore reads it as "kill".
const fitsPowerUp = (p: unknown) => fits(p, { ...POWER_UP, source: "optional" });

const hasSource = (p: { readonly source?: unknown }) =>
  (POWERUP_SOURCES as readonly unknown[]).includes(p.source);

const SPECS = {
  STATE,
  PLAYER,
  ENEMY,
  BULLET,
  CARRIER_BEAM,
  EXPLOSION,
  POWER_UP,
  BUDDY_SHIP,
  ASTEROID,
  ACTIVE_POWER_UP,
  EXTRACTION,
  TIER_STATS,
  RUN_STATS,
  SCORE_LEDGER,
  WAVE_SCORE,
  EARLIER_SCORE,
  VEC2,
  BEZIER,
  DODGE,
};

/** Changes whenever any saved type's shape does; a save carries the one it was made with. */
export const SAVE_FINGERPRINT = JSON.stringify(SPECS);

type AnySpec = Readonly<Record<string, "required" | "optional">>;

/** What a saved state is checked against: STATE plus the optional ADDED_STATE fields. */
const STATE_FITS: AnySpec = { ...STATE, ...ADDED_STATE };

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

const fitsPts = (v: unknown) =>
  isObject(v) && Object.values(v).every((n) => typeof n === "number" && Number.isFinite(n));

const fitsScoreLedger = (v: unknown) =>
  fits(v, SCORE_LEDGER) &&
  allFit(v.waves, (w) => fits(w, WAVE_SCORE) && fitsPts(w.pts)) &&
  (v.earlier === null || (fits(v.earlier, EARLIER_SCORE) && fitsPts(v.earlier.pts)));

/**
 * A parsed save's state fits this build's StarSwarmState, all the way down — except the
 * ADDED_STATE fields, which `restoreSavedState` settles.
 */
export function fitsSaveShape(v: unknown): v is SavedStarSwarmState {
  if (!fits(v, STATE_FITS)) return false;
  return (
    fits(v.player, PLAYER) &&
    allFit(v.enemies, fitsEnemy) &&
    allFit(v.playerBullets, (b) => fits(b, BULLET)) &&
    allFit(v.enemyBullets, (b) => fits(b, BULLET)) &&
    allFit(v.carrierBeams, (b) => fits(b, CARRIER_BEAM)) &&
    allFit(v.explosions, (e) => fits(e, EXPLOSION)) &&
    allFit(v.powerUps, fitsPowerUp) &&
    allFit(v.buddyShips, (b) => fits(b, BUDDY_SHIP) && Array.isArray(b.hitRockIds)) &&
    allFit(v.asteroids, (a) => fits(a, ASTEROID)) &&
    (v.activePowerUp === null || fits(v.activePowerUp, ACTIVE_POWER_UP)) &&
    (v.extraction === null || fits(v.extraction, EXTRACTION)) &&
    fits(v.runStats, RUN_STATS) &&
    fitsScoreLedger(v.scoreLedger) &&
    isObject(v.tierStats) &&
    Object.values(v.tierStats).every((t) => fits(t, TIER_STATS))
  );
}

// #3251: the keys of a closed wave's wire form (WaveStatsWire), all always present
const WIRE: KeySpec<WaveStatsWire> = {
  v: "required",
  wave: "required",
  difficulty: "required",
  outcome: "required",
  dev: "required",
  pacing: "required",
  score: "required",
  powerUps: "required",
  rocks: "required",
  buddy: "required",
  carrier: "required",
  rout: "required",
  combat: "required",
  damage: "required",
};
const WIRE_SECTIONS = ["pacing", "score", "powerUps", "rocks", "buddy", "carrier", "combat"];

const ROUT: KeySpec<WaveRout> = {
  triggered: "required",
  atMs: "required",
  grunts: "required",
  caught: "required",
  escaped: "required",
};
const OVERFLOW: KeySpec<ClosedWavesOverflow> = {
  waves: "required",
  bytes: "required",
  largestBytes: "required",
  full: "required",
};

const isCount = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isIntCount = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0;

/** Every leaf under `v` passes `leaf` (a non-negative finite number by default). */
function countsOnly(v: unknown, leaf: (x: unknown) => boolean = isCount): boolean {
  if (isObject(v)) return Object.values(v).every((x) => countsOnly(x, leaf));
  return leaf(v);
}

/** `rout`, sent whole: a boolean, a start time or null, and three counts. */
const fitsRout = (v: unknown): boolean =>
  fits(v, ROUT as AnySpec) &&
  typeof v.triggered === "boolean" &&
  (v.atMs === null || isIntCount(v.atMs)) &&
  [v.grunts, v.caught, v.escaped].every(isIntCount);

/** `damage`: a death cause (null or a HIT_CAUSES value) and otherwise only counts. */
function fitsDamage(v: unknown): boolean {
  if (!isObject(v) || !("deathCause" in v)) return false;
  const { deathCause, ...counts } = v;
  return (
    (deathCause === null || (HIT_CAUSES as readonly unknown[]).includes(deathCause)) &&
    countsOnly(counts, isIntCount)
  );
}

/**
 * A saved closed wave looks like this build's wire form: its keys, its version, a known
 * difficulty and outcome, and only counts in its sections. The backend validates the rest.
 */
function fitsWire(v: unknown): v is WaveStatsWire {
  if (!fits(v, WIRE as AnySpec)) return false;
  const { rout, damage } = v;
  return (
    v.v === WAVE_STATS_VERSION &&
    Number.isInteger(v.wave) &&
    (v.wave as number) >= 1 &&
    (DIFFICULTY_TIERS as readonly unknown[]).includes(v.difficulty) &&
    (v.outcome === "cleared" || v.outcome === "died") &&
    typeof v.dev === "boolean" &&
    WIRE_SECTIONS.every((k) => isObject(v[k]) && countsOnly(v[k])) &&
    fitsRout(rout) &&
    fitsDamage(damage)
  );
}

/** #3251: a saved overflow count: three counts and the list-closed flag. */
const isOverflow = (v: unknown): v is ClosedWavesOverflow =>
  fits(v, OVERFLOW as AnySpec) &&
  [v.waves, v.bytes, v.largestBytes].every(isIntCount) &&
  typeof v.full === "boolean";

/** #3251: a saved `closedWaves` — closed waves in wave order (a dev revert can repeat one). */
function isClosedWaves(v: unknown): v is readonly WaveStatsWire[] {
  return (
    allFit(v, fitsWire) &&
    (v as WaveStatsWire[]).every((w, i, all) => i === 0 || w.wave >= all[i - 1]!.wave)
  );
}

/**
 * #3245: the engine state for a save that passed `fitsSaveShape`. An older save (or one from a
 * build whose registries differ) gets fresh wave stats, seeded from the restored ship; the
 * wave's stats then count from the restore on. `lastClosedWave` always restores as null,
 * whatever the save holds: it only marks a close for `waveJustClosed`, and a restored run has
 * nothing to compare it with, so a saved one is ignored rather than validated.
 * #3251: `closedWaves` restores as saved when it fits, else as `[]` (an older save, or one that
 * doesn't fit): the waves closed before the save are then not sent, and nothing invalid is.
 * `closedWavesOverflow` restores as saved when it fits, else as `NO_OVERFLOW`. `closedWavesBytes`
 * is recomputed from the restored list (a save without it, or one whose list was dropped, can't
 * leave it wrong).
 */
export function restoreSavedState(saved: SavedStarSwarmState): StarSwarmState {
  // #3246: a pickup with no (or an unknown) source is read as a kill drop. Only a pre-#3246 build
  // saves one, and it never counted spawns, so those are counted now; a sourced pickup was
  // counted by this build and isn't recounted.
  const unsourced = saved.powerUps
    .filter((p) => !hasSource(p))
    .map((p) => ({ ...p, source: "kill" as const }));
  const powerUps =
    unsourced.length === 0
      ? saved.powerUps
      : saved.powerUps.map((p) => (hasSource(p) ? p : { ...p, source: "kill" as const }));
  // fresh stats still count every pickup already falling as spawned, so they balance
  // #3248: and the ships of the wave and the shots in flight, when the stats don't count them yet
  // (withRosterSpawns)
  const waveStats = withRosterSpawns(
    isWaveStats(saved.waveStats)
      ? countSpawned(saved.waveStats, unsourced)
      : countSpawned(emptyWaveStats(loadoutOf(saved.player)), powerUps),
    saved.enemies,
    saved.playerBullets
  );
  // #3251
  const closedWaves = isClosedWaves(saved.closedWaves) ? saved.closedWaves : [];
  return {
    ...saved,
    powerUps,
    waveStats,
    lastClosedWave: null,
    closedWaves,
    closedWavesBytes: wavesBytes(closedWaves),
    closedWavesOverflow: isOverflow(saved.closedWavesOverflow)
      ? saved.closedWavesOverflow
      : NO_OVERFLOW,
  };
}

/**
 * #3248: fresh stats — or kept ones from a build before #3248, whose `combat.spawned` is all 0 —
 * get the saved roster (every ship of the wave, alive or dead) as their spawns, so the kills
 * still to come have spawns to match, and the player's shots still in flight as fired, so the
 * hits still to come keep `shotsHit ≤ shotsFired`. Stats that already count spawns are left alone.
 */
function withRosterSpawns(
  ws: WaveStats,
  enemies: readonly Enemy[],
  playerBullets: readonly Bullet[]
): WaveStats {
  let spawned = 0;
  for (const tier of ENEMY_TIERS) spawned += ws.combat.spawned[tier];
  if (spawned !== 0) return ws;
  const inFlight = playerBullets.filter((b) => b.source !== "buddy").length;
  return bumpWave(countShipsSpawned(ws, enemies), SHOTS_FIRED, inFlight);
}

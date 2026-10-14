/**
 * Star Swarm engine — per-wave stats (#3245, epic #3244).
 *
 * `state.waveStats` is the current wave's accumulator. A wave opens with a fresh one
 * (`emptyWaveStats`, seeded with the ship's loadout), the engine bumps its counters as things
 * happen (`bumpWave`, copy-on-write), and the wave closes exactly once — `"cleared"` when its
 * extraction completes, `"died"` when the run ends on it — into a frozen v1 snapshot
 * (`closeWave`), kept on `state.lastClosedWave` (`waveJustClosed(prev, next)` picks a close
 * up) and appended, as `toWirePayload(snapshot)`, to `state.closedWaves`. The screen sends
 * those as `wave_completed` events at game over (#3251, waveEvents.ts).
 *
 * Every keyed table is dense by construction: `emptyWaveStats` builds it from the registries
 * (`registries.ts`), so every key is present at 0 — a new registry value included, which is why
 * the contract test (not the compiler) is what forces it to get a real counter.
 * On the wire, zero counters and then-empty objects are left out (`toWirePayload`).
 *
 * Coverage: #3245 fills `pacing` (and `score`, derived from the ledger at close), #3246 `powerUps`.
 * The other sections are in place and stay 0 until their counter stories (#3247–#3249) fill them.
 * The schema is pinned on epic #3244 ("wave_completed v1 schema"); changing its shape is a `v`
 * bump. See docs/games/starswarm.md#per-wave-stats.
 */
import type {
  DifficultyTier,
  GunsLevel,
  HullLevel,
  Player,
  PowerUp,
  StarSwarmState,
} from "../types";
import { waveScorePoints } from "../scoreLedger";
import {
  ASTEROID_KINDS,
  BUDDY_HIT_CAUSES,
  CARRIER_STAGES,
  ENEMY_TIERS,
  HIT_CAUSES,
  HIT_RESULTS,
  KILL_METHODS,
  POWERUP_SOURCES,
  POWERUP_TYPES,
  ROCK_BREAKERS,
  type AsteroidKind,
  type BuddyHitCause,
  type CarrierStage,
  type EnemyTier,
  type HitCause,
  type HitResult,
  type KillMethod,
  type PowerUpSource,
  type PowerUpType,
  type RockBreaker,
} from "./registries";

/** The `wave_completed` schema version. */
export const WAVE_STATS_VERSION = 1;
/**
 * Serialized size cap for one `toWirePayload` (the backend drops anything larger).
 */
export const WAVE_STATS_MAX_BYTES = 4096;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A dense counter table: one count per registry value. */
export type Counts<K extends string> = Readonly<Record<K, number>>;

/** The ship's loadout at a wave boundary. */
export interface Loadout {
  readonly lives: number;
  readonly guns: GunsLevel;
  readonly hull: HullLevel;
}

export interface WavePacing {
  /** Sum of `tick` dt (ms) over every phase of the wave, swoop-in to close. */
  readonly durationMs: number;
  /** The loadout the wave opened with. */
  readonly start: Loadout;
  /** Bonus lives granted this wave. */
  readonly bonusLives: number;
}

export interface WavePowerUps {
  readonly spawned: Readonly<Record<PowerUpType, Counts<PowerUpSource>>>;
  readonly collected: Counts<PowerUpType>;
  /** Despawned or fell off screen. */
  readonly missed: Counts<PowerUpType>;
  /** On screen when the wave closed. */
  readonly leftover: Counts<PowerUpType>;
  /** Timed buffs that ran out this wave. */
  readonly expired: Counts<PowerUpType>;
  readonly activeMs: Counts<PowerUpType>;
  readonly shieldAbsorbed: number;
}

/** A tier's asteroid-response counters this wave (compare the run-wide `TierStats`). */
export interface WaveDodge {
  readonly rolls: number;
  readonly dodged: number;
  readonly pathRolls: number;
  readonly pathDodged: number;
  readonly flak: number;
}

export interface WaveRocks {
  readonly spawned: Counts<AsteroidKind>;
  readonly devSpawned: number;
  readonly broken: Counts<RockBreaker>;
  readonly enemiesStruck: Counts<EnemyTier>;
  readonly enemiesDestroyed: Counts<EnemyTier>;
  readonly playerHits: Counts<HitResult>;
  readonly buddyHits: number;
  readonly buddyDestroyed: number;
  readonly dodge: Readonly<Record<EnemyTier, WaveDodge>>;
}

export interface WaveBuddy {
  readonly launched: number;
  readonly hits: Counts<BuddyHitCause>;
  readonly destroyed: Counts<BuddyHitCause>;
  readonly shotsDrawn: number;
  readonly kills: Counts<EnemyTier>;
}

export interface WaveCarrier {
  readonly gruntsLaunched: number;
  readonly armorDeflects: number;
  readonly beamsFired: number;
  readonly beamHits: number;
  readonly attackRuns: number;
  /** ms into the wave each stage was first reached; null = never reached. */
  readonly stageReachedMs: Readonly<Record<CarrierStage, number | null>>;
}

export interface WaveRout {
  readonly triggered: boolean;
  /** ms into the wave the rout started; null if it didn't. */
  readonly atMs: number | null;
  readonly grunts: number;
  readonly caught: number;
  readonly escaped: number;
}

export interface WaveCombat {
  readonly spawned: Counts<EnemyTier>;
  readonly kills: Readonly<Record<EnemyTier, Counts<KillMethod>>>;
  readonly shotsFired: number;
  readonly shotsHit: number;
  readonly shotsOnRocks: number;
}

export interface WaveDamage {
  readonly hits: Readonly<Record<HitCause, Counts<HitResult>>>;
  /** The hit that ended the run, on a wave that closes "died"; null otherwise. */
  readonly deathCause: HitCause | null;
}

/** The current wave's accumulator (`state.waveStats`). */
export interface WaveStats {
  /** Any dev-panel action touched this wave (its numbers aren't a real player's). */
  readonly dev: boolean;
  readonly pacing: WavePacing;
  readonly powerUps: WavePowerUps;
  readonly rocks: WaveRocks;
  readonly buddy: WaveBuddy;
  readonly carrier: WaveCarrier;
  readonly rout: WaveRout;
  readonly combat: WaveCombat;
  readonly damage: WaveDamage;
}

export type WaveOutcome = "cleared" | "died";

export interface WaveScore {
  /** Points this wave scored (the sum of `pts`). */
  readonly total: number;
  /** The run's score when the wave closed. */
  readonly runningTotal: number;
  /** This wave's ledger entry, by source (see scoreLedger.ts); `{}` if it scored nothing. */
  readonly pts: Readonly<Record<string, number>>;
}

/** The frozen `wave_completed` v1 record of one closed wave. */
export interface WaveStatsSnapshot {
  readonly v: typeof WAVE_STATS_VERSION;
  readonly wave: number;
  readonly difficulty: DifficultyTier;
  readonly outcome: WaveOutcome;
  readonly dev: boolean;
  readonly pacing: WavePacing & { readonly end: Loadout };
  readonly score: WaveScore;
  readonly powerUps: WavePowerUps;
  readonly rocks: WaveRocks;
  readonly buddy: WaveBuddy;
  readonly carrier: WaveCarrier;
  readonly rout: WaveRout;
  readonly combat: WaveCombat;
  readonly damage: WaveDamage;
}

/** A section on the wire: zero counters and empty objects left out. */
export type Sparse<T> = {
  readonly [K in keyof T]?: T[K] extends number | null ? number : Sparse<T[K]>;
};

/** `toWirePayload`'s output — what the `wave_completed` event carries. */
export interface WaveStatsWire {
  readonly v: typeof WAVE_STATS_VERSION;
  readonly wave: number;
  readonly difficulty: DifficultyTier;
  readonly outcome: WaveOutcome;
  readonly dev: boolean;
  readonly pacing: WaveStatsSnapshot["pacing"];
  readonly score: WaveScore;
  readonly powerUps: Sparse<WavePowerUps>;
  readonly rocks: Sparse<WaveRocks>;
  readonly buddy: Sparse<WaveBuddy>;
  readonly carrier: Sparse<WaveCarrier>;
  readonly rout: WaveRout;
  readonly combat: Sparse<WaveCombat>;
  readonly damage: Sparse<Omit<WaveDamage, "deathCause">> & {
    readonly deathCause: HitCause | null;
  };
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/** A dense table: `make(key)` for every key of a registry. */
function table<K extends string, V>(keys: readonly K[], make: (key: K) => V): Record<K, V> {
  const out = {} as Record<K, V>;
  for (const k of keys) out[k] = make(k);
  return out;
}

const zero = (): number => 0;
const zeros = <K extends string>(keys: readonly K[]): Record<K, number> => table(keys, zero);

/** The ship's loadout now. */
export function loadoutOf(player: Player): Loadout {
  return { lives: player.lives, guns: player.guns, hull: player.hull };
}

/** A fresh wave's stats: every counter 0, every registry key present. */
export function emptyWaveStats(start: Loadout): WaveStats {
  return {
    dev: false,
    pacing: { durationMs: 0, start, bonusLives: 0 },
    powerUps: {
      spawned: table(POWERUP_TYPES, () => zeros(POWERUP_SOURCES)),
      collected: zeros(POWERUP_TYPES),
      missed: zeros(POWERUP_TYPES),
      leftover: zeros(POWERUP_TYPES),
      expired: zeros(POWERUP_TYPES),
      activeMs: zeros(POWERUP_TYPES),
      shieldAbsorbed: 0,
    },
    rocks: {
      spawned: zeros(ASTEROID_KINDS),
      devSpawned: 0,
      broken: zeros(ROCK_BREAKERS),
      enemiesStruck: zeros(ENEMY_TIERS),
      enemiesDestroyed: zeros(ENEMY_TIERS),
      playerHits: zeros(HIT_RESULTS),
      buddyHits: 0,
      buddyDestroyed: 0,
      dodge: table(ENEMY_TIERS, () => ({
        rolls: 0,
        dodged: 0,
        pathRolls: 0,
        pathDodged: 0,
        flak: 0,
      })),
    },
    buddy: {
      launched: 0,
      hits: zeros(BUDDY_HIT_CAUSES),
      destroyed: zeros(BUDDY_HIT_CAUSES),
      shotsDrawn: 0,
      kills: zeros(ENEMY_TIERS),
    },
    carrier: {
      gruntsLaunched: 0,
      armorDeflects: 0,
      beamsFired: 0,
      beamHits: 0,
      attackRuns: 0,
      stageReachedMs: table(CARRIER_STAGES, (): number | null => null),
    },
    rout: { triggered: false, atMs: null, grunts: 0, caught: 0, escaped: 0 },
    combat: {
      spawned: zeros(ENEMY_TIERS),
      kills: table(ENEMY_TIERS, () => zeros(KILL_METHODS)),
      shotsFired: 0,
      shotsHit: 0,
      shotsOnRocks: 0,
    },
    damage: { hits: table(HIT_CAUSES, () => zeros(HIT_RESULTS)), deathCause: null },
  };
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/**
 * Every path from the root of `T` to a numeric counter, as a tuple of keys — e.g.
 * `["combat", "kills", "Grunt", "shot"]`. Flags and nullable fields (`dev`, `rout.atMs`,
 * `carrier.stageReachedMs.*`, `damage.deathCause`) aren't counters and aren't paths.
 */
export type CounterPath<T> = [T] extends [number]
  ? []
  : T extends object
    ? { [K in keyof T & string]: [K, ...CounterPath<T[K]>] }[keyof T & string]
    : never;

export type WaveCounterPath = CounterPath<WaveStats>;

type Node = Readonly<Record<string, unknown>>;

function bumpAt(node: Node, path: readonly string[], i: number, n: number): Node {
  const key = path[i] as string;
  const cur = node[key];
  const next = i === path.length - 1 ? (cur as number) + n : bumpAt(cur as Node, path, i + 1, n);
  return { ...node, [key]: next };
}

/**
 * Adds `n` to one counter, copy-on-write (mirrors `bumpRun`): the objects along `path` are
 * copied, everything else is shared. `n === 0` returns `stats` itself and allocates nothing —
 * hoist a constant path (`const KILL = ["combat", ...] as const`) on a hot path so the call
 * site doesn't allocate either.
 */
export function bumpWave(stats: WaveStats, path: Readonly<WaveCounterPath>, n: number): WaveStats {
  if (n === 0) return stats;
  return bumpAt(stats as unknown as Node, path as readonly string[], 0, n) as unknown as WaveStats;
}

/**
 * `bumpWave` on a state's accumulator; returns `state` itself when `n === 0`.
 * @internal No production caller until the counter stories (#3246–#3249) use it.
 */
export function bumpWaveIn(
  state: StarSwarmState,
  path: Readonly<WaveCounterPath>,
  n: number
): StarSwarmState {
  if (n === 0) return state;
  return { ...state, waveStats: bumpWave(state.waveStats, path, n) };
}

/** #3246: a pickup's source; a pickup restored from a save that predates the field is a kill drop. */
const pickupSource = (p: PowerUp): PowerUpSource => p.source ?? "kill";

/** #3246: one more `spawned[type][source]` for each of `pickups`. */
export function countSpawned(stats: WaveStats, pickups: readonly PowerUp[]): WaveStats {
  let out = stats;
  for (const p of pickups) {
    out = bumpWave(out, ["powerUps", "spawned", p.type, pickupSource(p)] as WaveCounterPath, 1);
  }
  return out;
}

/** #3246: what became of `pickups` — each is one more `collected` / `missed` / `leftover[type]`. */
export function countPickups(
  stats: WaveStats,
  fate: "collected" | "missed" | "leftover",
  pickups: readonly PowerUp[]
): WaveStats {
  let out = stats;
  for (const p of pickups) out = bumpWave(out, ["powerUps", fate, p.type] as WaveCounterPath, 1);
  return out;
}

/**
 * #3249: records the ms into the wave a Carrier stage was first reached; a no-op (returns
 * `stats` itself) once it has one. `bumpWave` only adds to numbers, so the nullable
 * `carrier.stageReachedMs` gets this typed setter instead (copy-on-write, like `bumpWave`).
 */
export function markStageReached(stats: WaveStats, stage: CarrierStage, atMs: number): WaveStats {
  if (stats.carrier.stageReachedMs[stage] !== null) return stats;
  const stageReachedMs = { ...stats.carrier.stageReachedMs, [stage]: atMs };
  return { ...stats, carrier: { ...stats.carrier, stageReachedMs } };
}

/**
 * #3249: latches the wave's rout (`triggered`, `atMs` = ms into the wave); a no-op once latched.
 * The boolean and nullable fields aren't counters, so `bumpWave` can't set them.
 */
export function markRouted(stats: WaveStats, atMs: number): WaveStats {
  if (stats.rout.triggered) return stats;
  return { ...stats, rout: { ...stats.rout, triggered: true, atMs } };
}

/** Flags the current wave as touched by the dev panel (a no-op once flagged). */
export function markWaveDev(state: StarSwarmState): StarSwarmState {
  return state.waveStats.dev ? state : { ...state, waveStats: { ...state.waveStats, dev: true } };
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

/**
 * A deep copy, frozen all the way down, with every number rounded to an integer: the engine's dt
 * is fractional in the real frame loop, and the backend takes `StrictInt` (a fractional ms would
 * drop the whole event). Null and booleans pass through.
 */
function frozenCopy<T>(v: T): T {
  if (typeof v === "number") return Math.round(v) as T;
  if (v === null || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = frozenCopy(x);
  return Object.freeze(out) as T;
}

/**
 * The frozen v1 snapshot of the state's current wave. Pure: the engine calls it at the two close
 * points (extraction complete → "cleared", the run's final GameOver → "died") and keeps the
 * result on `state.lastClosedWave`.
 */
export function closeWave(state: StarSwarmState, outcome: WaveOutcome): WaveStatsSnapshot {
  const ws = state.waveStats;
  const pts = waveScorePoints(state.scoreLedger, state.wave);
  let total = 0;
  for (const k in pts) total += pts[k] ?? 0;
  return frozenCopy<WaveStatsSnapshot>({
    v: WAVE_STATS_VERSION,
    wave: state.wave,
    difficulty: state.difficulty,
    outcome,
    dev: ws.dev,
    pacing: {
      durationMs: ws.pacing.durationMs,
      start: ws.pacing.start,
      end: loadoutOf(state.player),
      bonusLives: ws.pacing.bonusLives,
    },
    score: { total, runningTotal: state.score, pts },
    powerUps: ws.powerUps,
    rocks: ws.rocks,
    buddy: ws.buddy,
    carrier: ws.carrier,
    rout: ws.rout,
    combat: ws.combat,
    damage: ws.damage,
  });
}

/**
 * #3245: the snapshot of a wave that closed between `prev` and `next`, else null — compare
 * `routJustStarted` / `upgradeEvents`. Fires once per close: `lastClosedWave` changes identity
 * only when a wave closes.
 * @internal No production caller: the screen sends `closedWaves` at game over (#3251).
 */
export function waveJustClosed(
  prev: StarSwarmState,
  next: StarSwarmState
): WaveStatsSnapshot | null {
  return next.lastClosedWave !== prev.lastClosedWave ? next.lastClosedWave : null;
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

/** `v` without zero / null leaves and then-empty objects; undefined if nothing is left. */
function sparse(v: unknown, keepZero = false): unknown {
  if (v === null || (v === 0 && !keepZero)) return undefined;
  if (typeof v !== "object") return v;
  let out: Record<string, unknown> | undefined;
  for (const [k, x] of Object.entries(v)) {
    const s = sparse(x, keepZero);
    if (s !== undefined) (out ??= {})[k] = s;
  }
  return out;
}

function sparseSection<T>(section: T): Sparse<T> {
  return (sparse(section) ?? {}) as Sparse<T>;
}

/**
 * The `wave_completed` payload: every top-level section is present, but inside the counter
 * sections zero counters and then-empty objects are left out (the backend reads a missing key
 * as 0). `v`, `wave`, `difficulty`, `outcome`, `dev`, `pacing`, `score`, `rout` and
 * `damage.deathCause` are always sent whole. `carrier.stageReachedMs` is a time, not a counter:
 * a stage reached at 0 ms is sent, one never reached (null) is not.
 */
export function toWirePayload(snap: WaveStatsSnapshot): WaveStatsWire {
  const { stageReachedMs, ...carrierCounts } = snap.carrier;
  const stages = sparse(stageReachedMs, true) as Sparse<WaveCarrier["stageReachedMs"]> | undefined;
  const { deathCause, ...damageCounts } = snap.damage;
  return {
    v: snap.v,
    wave: snap.wave,
    difficulty: snap.difficulty,
    outcome: snap.outcome,
    dev: snap.dev,
    pacing: snap.pacing,
    score: snap.score,
    powerUps: sparseSection(snap.powerUps),
    rocks: sparseSection(snap.rocks),
    buddy: sparseSection(snap.buddy),
    carrier: { ...sparseSection(carrierCounts), ...(stages ? { stageReachedMs: stages } : {}) },
    rout: snap.rout,
    combat: sparseSection(snap.combat),
    damage: { ...sparseSection(damageCounts), deathCause },
  };
}

// ---------------------------------------------------------------------------
// Restore (saveShape.ts)
// ---------------------------------------------------------------------------

const isCount = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isIntIn = (v: unknown, lo: number, hi: number): boolean =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** Leaves whose valid values the template can't express, by dotted path. */
const LEAF_CHECKS: Readonly<Record<string, (v: unknown) => boolean>> = {
  "damage.deathCause": (v) => v === null || (HIT_CAUSES as readonly unknown[]).includes(v),
  "pacing.start.guns": (v) => isIntIn(v, 1, 3),
  "pacing.start.hull": (v) => isIntIn(v, 0, 2),
  "pacing.start.lives": (v) => Number.isInteger(v) && (v as number) >= 0,
};

/**
 * `v` has exactly `template`'s shape: same keys all the way down, a non-negative finite number
 * where the template has a number, null or such a number where it has null (`rout.atMs`,
 * `carrier.stageReachedMs.*`), and LEAF_CHECKS where they apply.
 */
function sameShape(template: unknown, v: unknown, at: string): boolean {
  const check = LEAF_CHECKS[at];
  if (check) return check(v);
  if (template === null) return v === null || isCount(v);
  if (typeof template === "number") return isCount(v);
  if (typeof template !== "object") return typeof v === typeof template;
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const t = template as Record<string, unknown>;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(t);
  if (Object.keys(o).length !== keys.length) return false;
  return keys.every((k) => k in o && sameShape(t[k], o[k], at ? `${at}.${k}` : k));
}

/**
 * A saved `waveStats` fits this build — every section, every registry key. One from a build with
 * another registry (a power-up added since) doesn't, and the restore starts the wave's stats over.
 */
export function isWaveStats(v: unknown): v is WaveStats {
  return sameShape(emptyWaveStats({ lives: 0, guns: 1, hull: 0 }), v, "");
}

/** #2484: Carrier — one per wave, top row, never dives, armored while its Boss escorts live. */
export type EnemyTier = "Grunt" | "Elite" | "Boss" | "Carrier";

/** Pickups. lightning/shield are 5 s buffs, buddy/bomb are instant (#980–#1035); salvage and hull
 * are #2488 in-run upgrades: salvage raises the gun level, hull adds plating. */
export type PowerUpType = "lightning" | "shield" | "buddy" | "bomb" | "salvage" | "hull";

/** #2488: in-run upgrade ladders. Guns: single → twin → twin + spread. Hull: extra hits absorbed. */
export type GunsLevel = 1 | 2 | 3;
export type HullLevel = 0 | 1 | 2;

/** #2488: an upgrade-ladder change the screen reacts to (sound + spoken cue). */
export interface UpgradeEvent {
  readonly kind: "gunsUp" | "gunsDown" | "hullUp" | "hullHit";
  readonly guns: GunsLevel;
  readonly hull: HullLevel;
}

/** Starfleet difficulty tiers (#1037) — ordered easiest to hardest. */
export type DifficultyTier =
  | "Ensign"
  | "LieutenantJG"
  | "Lieutenant"
  | "LieutenantCommander"
  | "Commander"
  | "Captain"
  | "RearAdmiral"
  | "ViceAdmiral"
  | "Admiral"
  | "FleetAdmiral";

/** Five-state AI machine + SwoopIn entry animation. */
export type EnemyPhase =
  | "SwoopIn" // following Bézier path onto screen into formation slot
  | "Formation" // holding grid position
  | "Wiggling" // pre-dive telegraph: oscillates ±6px for ~350ms (#975)
  | "Diving" // following Bézier arc toward player (#977)
  | "Circling" // looping around a fixed center point
  | "Returning" // following Bézier path back to formation slot
  | "Fleeing"; // #2489: grunt rout — Bézier path off the top edge; no shooting, diving or ramming

export type GamePhase =
  | "SwoopIn" // wave intro — enemies filling the grid
  | "Playing" // normal combat
  | "WaveClear" // brief pause before next wave (legacy / backward-compat)
  | "GameOver";

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface CubicBezier {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3: Vec2;
}

export interface Enemy {
  readonly id: number;
  readonly tier: EnemyTier;
  readonly phase: EnemyPhase;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Target formation grid center. */
  readonly formationX: number;
  readonly formationY: number;
  /** Active Bézier path (SwoopIn / Diving / Returning phases). */
  readonly path: CubicBezier | null;
  /**
   * Progress along `path` (0–1).
   * Negative values encode stagger delay: enemy stays at p0 until pathT >= 0.
   */
  readonly pathT: number;
  /** Duration (ms) to traverse `path` from t=0 to t=1. */
  readonly pathDuration: number;
  /** Velocity vector (unused for Bézier-driven phases; kept for Circling tangent). */
  readonly vel: Vec2;
  /** Circle center (Circling phase). */
  readonly circleCx: number;
  readonly circleCy: number;
  readonly circleRadius: number;
  /** Current angle on circle in radians (Circling phase). */
  readonly circleAngle: number;
  /** Angular speed rad/ms (Circling phase). */
  readonly circleSpeed: number;
  /** ms until this enemy fires next. */
  readonly shootTimer: number;
  /** Player X captured when dive was initiated (used as Bézier P3 target). */
  readonly diveTargetX: number;
  readonly hp: number;
  readonly isAlive: boolean;
  /** ms remaining for white hit-flash; 0 when not flashing. */
  readonly hitFlashTimer: number;
  /** Countdown ms for Wiggling phase; 0 otherwise (#975). */
  readonly wiggleTimer: number;
  /** Shots remaining in the active Boss burst; 0 = start a new burst (#979). */
  readonly burstShotsLeft: number;
  /** #2485: Carrier sweep-beam state; "idle" for every other tier. */
  readonly beamPhase: BeamPhase;
  /** #2485: ms left in the current beam phase (idle = until the next charge). */
  readonly beamTimer: number;
  /** #2487: an in-progress formation sidestep away from an asteroid; null when not dodging. */
  readonly dodge: { readonly dir: 1 | -1; readonly t: number; readonly dur: number } | null;
  /** #2487: asteroids this ship has already rolled against — one roll per rock per ship. */
  readonly rolledAsteroidIds: readonly number[];
  /** #2487: ms until this ship may fire flak at an asteroid again. */
  readonly flakCooldown: number;
}

/** #2487: per-tier asteroid-response counters (carried across waves, reset on a new game). */
export interface TierStats {
  /** Dodge rolls taken. */
  readonly rolls: number;
  /** Rolls that succeeded. */
  readonly dodged: number;
  /** Rolls taken while on a path (swoop-in, dive, return), a subset of `rolls`. */
  readonly pathRolls: number;
  /** Path rolls that succeeded, a subset of `dodged`. */
  readonly pathDodged: number;
  /** Times a rock actually hit a ship of this tier. */
  readonly struck: number;
  /** Flak shots fired at rocks. */
  readonly flak: number;
}

/**
 * #2491: whole-run counters — carried across waves, reset on a new game. The dev panel shows
 * them live and one Sentry breadcrumb rolls them up at game over. Counts only, never anything
 * that identifies the player.
 */
export interface RunStats {
  /** Grunts the Carrier launched as reinforcements. */
  readonly reinforced: number;
  /** Ordinary shots spent on the escorted Carrier's force field. */
  readonly armorDeflects: number;
  /** Carrier beam sweeps that cost hull plating or a life (a shield-absorbed sweep isn't one). */
  readonly beamHits: number;
  /** #2489: fleeing grunts the player shot down (or bombed). */
  readonly routCaught: number;
  /** #2489: fleeing grunts that reached the top edge and got away. */
  readonly routEscaped: number;
  /** Rocks that entered play — timed spawns and dev-panel throws alike. */
  readonly rocksSpawned: number;
  /** Rocks the player's shots broke (a bomb or a hull shatter isn't counted). */
  readonly rocksBrokenByPlayer: number;
  /** Rocks enemy shots broke, flak included. */
  readonly rocksBrokenByEnemy: number;
}

/** #2485: the Carrier's sweep beam — telegraph, then a vertical beam it drags across the lane. */
export type BeamPhase = "idle" | "charge" | "fire";

/** #2485: Carrier moments the screen reacts to (sound, haptics, screen-reader announcements). */
export type CarrierEvent = "beamCharge" | "beamFire" | "reinforce";

export interface Bullet {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly owner: "player" | "enemy";
  readonly width: number;
  readonly height: number;
  readonly damage: number;
  /** Charge shot: passes through all enemies in its lane instead of stopping on first hit. */
  readonly piercing?: boolean;
  /** Enemy bullet already in flight when the wave it was fired in cleared — keeps moving and
   * rendering normally until it exits the screen, but can no longer hit the player (see #2352
   * follow-up: the wave-clear autopilot dodge was removed, this replaces it non-blockingly). */
  readonly harmless?: boolean;
  /** #2487: an enemy shot fired at an asteroid — outside bulletCap(), drawn in a distinct colour. */
  readonly flak?: boolean;
}

export interface Player {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly lives: number;
  /** Post-spawn invincibility ms remaining; player cannot be hit while > 0. */
  readonly invincibleTimer: number;
  /** ms until player can fire again. */
  readonly shootCooldown: number;
  /** #2488: gun level for this run — lost one step per life lost, never persisted. */
  readonly guns: GunsLevel;
  /** #2488: hull plating — each level absorbs one hit that would otherwise cost a life. */
  readonly hull: HullLevel;
  /** #2488: ms remaining for the plating's force-field flash; 0 when not flashing. */
  readonly hullFlashTimer: number;
}

export interface Explosion {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** Current frame index (0–19). */
  readonly frame: number;
  /** ms until next frame advance. */
  readonly frameTimer: number;
}

export interface PowerUp {
  readonly id: number;
  /** Which power-up variant this pickup activates (#1032). */
  readonly type: PowerUpType;
  readonly x: number;
  readonly y: number;
  /** Fall speed in px/ms. */
  readonly vy: number;
  readonly width: number;
  readonly height: number;
  /** ms until auto-despawn (if not collected). */
  readonly despawnTimer: number;
}

/** Companion ship that sweeps across the screen and fires a spread burst (#1035). */
export interface BuddyShip {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly path: CubicBezier;
  readonly pathT: number;
  readonly pathDuration: number;
  /** true once the spread burst has been fired (fires once at pathT ≥ 0.45). */
  readonly hasFired: boolean;
  /** Cluster center X captured at spawn time — burst aims here. */
  readonly targetX: number;
  /** Cluster center Y captured at spawn time — burst aims here. */
  readonly targetY: number;
  /** true = entered from left edge; false = entered from right. */
  readonly fromLeft: boolean;
}

/** #2486: errant asteroid — a neutral hazard both sides can hit and be hit by. */
export type AsteroidKind = "large" | "small";

export interface Asteroid {
  readonly id: number;
  readonly kind: AsteroidKind;
  readonly x: number;
  readonly y: number;
  /** Velocity in px/ms. */
  readonly vx: number;
  readonly vy: number;
  readonly radius: number;
  readonly hp: number;
  /** Cosmetic spin: current angle (rad) and rate (rad/ms). */
  readonly rotation: number;
  readonly spin: number;
  /** ms remaining for the hit flash; 0 when not flashing. */
  readonly hitFlashTimer: number;
  /** Enemies this rock has already struck — one hit per enemy per rock. */
  readonly hitEnemyIds: readonly number[];
  /** Set when destroyed by an impact (hull or force field): it shatters without splitting. */
  readonly shattered?: boolean;
}

export interface StarSwarmState {
  readonly phase: GamePhase;
  readonly wave: number;
  readonly score: number;
  readonly player: Player;
  readonly enemies: readonly Enemy[];
  readonly playerBullets: readonly Bullet[];
  readonly enemyBullets: readonly Bullet[];
  readonly explosions: readonly Explosion[];
  readonly powerUps: readonly PowerUp[];
  readonly buddyShips: readonly BuddyShip[];
  /** #2486: asteroids in flight (neutral hazard). */
  readonly asteroids: readonly Asteroid[];
  /** ms until the next timed asteroid spawn; only counts down in the Playing phase. */
  readonly nextAsteroidTimer: number;
  /** Dev: suppress timed asteroid spawns (dev-panel throws still work). */
  readonly asteroidsDisabled: boolean;
  /** #2485: ms until the Carrier's next reinforcement launch (Playing phase only). */
  readonly reinforceTimer: number;
  /** #2485: grunts launched by the Carrier this wave — capped at half the wave's grunt slots. */
  readonly reinforcedThisWave: number;
  /** #2487: asteroid-response counters per tier (see TierStats). */
  readonly tierStats: Readonly<Record<EnemyTier, TierStats>>;
  /** #2491: whole-run counters (see RunStats). */
  readonly runStats: RunStats;
  /** Dev (#2491): enemies never roll to dodge a rock — collisions become the baseline. */
  readonly dodgeDisabled: boolean;
  /** Dev (#2491): enemies never fire flak at a rock. */
  readonly flakDisabled: boolean;
  /** General-purpose countdown timer (WaveClear pause, etc.). */
  readonly phaseTimer: number;
  readonly canvasW: number;
  readonly canvasH: number;
  /** ms until the next dive-AI trigger fires. */
  readonly nextDiveTimer: number;
  /** Current left/right sway offset applied to all Formation enemies (px). */
  readonly formationSwayX: number;
  /** Direction the formation is currently travelling: +1 = right, -1 = left. */
  readonly formationSwayDir: 1 | -1;
  /** How many bonus lives have been awarded so far (prevents re-awarding at same multiple). */
  readonly bonusLivesAwarded: number;
  /** ms remaining for the slow-motion window after a bonus life is awarded (#1078); 0 when inactive. */
  readonly bonusLifeSlowMoTimer: number;
  /** Non-Boss enemy count at wave start; used for Boss dive eligibility (#978). */
  readonly startingNonBossCount: number;
  /** Enemy kills since last power-up drop (Playing phase only). */
  readonly killsSinceLastDrop: number;
  /** Kill count target to trigger the next drop (includes ±2 jitter). */
  readonly dropJitterTarget: number;
  /**
   * Non-null while a duration power-up (lightning / shield) is active.
   * shieldAbsorbed tracks bullets absorbed for analytics on expiry.
   */
  readonly activePowerUp: {
    readonly remainingMs: number;
    readonly type: PowerUpType;
    readonly shieldAbsorbed: number;
  } | null;
  /** True once ≤35% non-boss enemies remain; latches true and never resets mid-wave. */
  readonly bossThresholdCrossed: boolean;
  /** True once ≤3 enemies remain (Stage 3); enables boss deep dive + body collision. */
  readonly bossDeepThresholdCrossed: boolean;
  /** When true, ≤3 surviving enemies immediately break formation and go fully aggressive. */
  readonly stragglerEnabled: boolean;
  /** When true (dev panel), straggler aggression is suppressed regardless of enemy count (#1039). */
  readonly pauseStraggler: boolean;
  /** #2489: latched once the wave's grunts have routed (no Elite, Boss or Carrier left alive). */
  readonly routed: boolean;
  /** Dev (#2489): grunts never rout — the old hunt-the-last-three ending, for comparison. */
  readonly routDisabled: boolean;
  /** ms remaining for the Smart Bomb full-screen flash overlay; 0 when inactive (#1034). */
  readonly bombFlashTimer: number;
  /** Active difficulty tier; drives score multiplier and AI param scaling (#1037). */
  readonly difficulty: DifficultyTier;
  /** Dev: suppress player fire (bullets never spawn, cooldown still ticks). */
  readonly playerFireDisabled: boolean;
  /** Dev: enemy bullets are never pushed to the bullet list. */
  readonly enemyFireDisabled: boolean;
  /**
   * ms remaining to show the non-blocking "MISSION COMPLETE" / "PERFECT" wave-clear banner.
   * Purely cosmetic — gameplay is never paused for this (#2352); set on wave clear, counts
   * down like any other cosmetic timer (compare `bombFlashTimer`).
   */
  readonly missionCompleteTimer: number;
}

/** Input snapshot consumed by each `tick` call. */
export interface StarSwarmInput {
  /** Desired player center X in logical canvas pixels. */
  readonly playerX: number;
  /** true while auto-fire is active. */
  readonly fire: boolean;
}

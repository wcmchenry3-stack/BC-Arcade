import type { ScoreLedger } from "./scoreLedger";

/**
 * Enemy tiers, lightest to heaviest: Grunt → Elite → Guardian → Carrier. #2843: the escort tier
 * was called "Boss" before; it is "Guardian" everywhere now (boss *waves* keep their name).
 * #2484: Carrier — one per wave, top row, armored while its Guardian escorts live.
 */
export type EnemyTier = "Grunt" | "Elite" | "Guardian" | "Carrier";

/**
 * #2843: the Carrier's aggression stage, each more aggressive than the last. Derived from the
 * live roster (`carrierStage` in `engine/roster.ts`):
 * - protected: a Guardian escort lives, so the Carrier is armored;
 * - exposed: the last Guardian is dead, so armor is down, but other enemies still fight;
 * - finalStand: the Carrier is the only meaningful (non-fleeing) enemy left.
 */
export type CarrierStage = "protected" | "exposed" | "finalStand";

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
  | "Fleeing" // #2489: grunt rout — Bézier path off the top edge; no shooting, diving or ramming
  | "AttackRun"; // #2843: the exposed Carrier's heavy swoop toward the player lane and back

/**
 * #2842: the wave lifecycle. SwoopIn is safe setup time (nothing fires, nothing takes damage);
 * Playing is combat; ClearAwaitingPickups (#3132) holds the cleared wave, under the player's
 * control, until every pickup still on screen is collected or gone; Extraction is the live
 * wind-down after that (already-fired shots and rocks stay real while the AI flies the ship
 * out), ended by the hard transient reset (`clearTransientCombat` in `engine/extraction.ts`)
 * just before the next wave is built.
 */
export type GamePhase =
  | "SwoopIn" // wave intro — enemies filling the grid; every actor invulnerable, nobody fires
  | "Playing" // normal combat
  // #3132: last enemy down, pickups still on screen — the player keeps the ship until they're gone
  | "ClearAwaitingPickups"
  | "Extraction" // #2842: last enemy down — the AI flies the ship out through surviving hazards
  | "GameOver";

/** #2842: the AI's hold on the player ship between the wave's last kill and the next wave. */
export interface Extraction {
  /** ms since the wave's last enemy died. */
  readonly elapsedMs: number;
  /** ms the ship has spent climbing out of the lane; 0 while it still holds the lane, dodging. */
  readonly climbMs: number;
}

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
  /** Shots remaining in the active Guardian burst; 0 = start a new burst (#979). */
  readonly burstShotsLeft: number;
  /** #2485/#2843: Carrier beam charge state; "idle" for every other tier. */
  readonly beamPhase: BeamPhase;
  /** #2485: ms left in the current beam phase (idle = until the next charge). */
  readonly beamTimer: number;
  /** #2843: Carrier attack-run telegraph state; "idle" for every other tier. */
  readonly runPhase: AttackRunPhase;
  /** #2843: ms left in the current run phase (idle = until the next brace). */
  readonly runTimer: number;
  /** #2487: an in-progress formation sidestep away from an asteroid; null when not dodging. */
  readonly dodge: { readonly dir: 1 | -1; readonly t: number; readonly dur: number } | null;
  /** #2487: asteroids this ship has already rolled against — one roll per rock per ship. */
  readonly rolledAsteroidIds: readonly number[];
  /** #2487: ms until this ship may fire flak at an asteroid again. */
  readonly flakCooldown: number;
  /** #2844: ms left in which this ship counts as evading a rock — its player-directed aim is degraded. */
  readonly evadeMs: number;
  /** #2881: ms left of the visible flinch wobble (render cue); 0 when not flinching. */
  readonly flinchMs: number;
  /**
   * #2881: rocks this ship has already had its flinch/flak/late-nudge reaction opportunity against
   * in `reactedPhase`. Cleared on every phase change, so a ship gets one opportunity per rock per
   * phase (a ship that rolled in formation can still react when it dives) without per-tick spam.
   */
  readonly reactedAsteroidIds: readonly number[];
  /** #2881: the phase `reactedAsteroidIds` belongs to. */
  readonly reactedPhase: Enemy["phase"];
  /**
   * #2844: remaining attention debt (ms) from answering rocks. While it is > 0 the ship's next-shot
   * timer is held at or above it after every tick, so no phase change (a dive launch resets
   * shootTimer to 0, the straggler rule caps it) can cash the debt in early.
   */
  readonly attentionMs: number;
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
  /** Carrier beams that cost hull plating or a life (a shield-absorbed beam isn't one). */
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
  /** #2845: Buddy ships launched (pickups and dev-panel triggers). */
  readonly buddyLaunched: number;
  /** #2845: Buddy ships destroyed (shot, beamed or rock-struck to 0 HP). */
  readonly buddyLost: number;
  /** #2845: enemy shots diverted to Buddy — each one replaced a shot at the player. */
  readonly buddyShotsDrawn: number;
}

/**
 * #2485/#2843: the Carrier's beam weapon. It charges on the Carrier (the telegraph), then the
 * release spawns an independent `CarrierBeam`. Killing the Carrier mid-charge cancels only the
 * charge; a released beam flies on regardless of what happens to the ship that fired it.
 */
export type BeamPhase = "idle" | "charge";

/**
 * #2843: a released Carrier beam — a fast, heavy bolt travelling straight down its column. An
 * independent battlefield entity: it persists after the Carrier dies, and leaves play only by
 * reaching the player (hit or shield-absorbed), leaving the screen, a Smart Bomb, or the
 * wave-boundary reset (`clearTransientCombat`).
 */
export interface CarrierBeam {
  readonly id: number;
  /** Column centre, px. */
  readonly x: number;
  /** Leading (bottom) edge, px; the bolt trails `length` px above it. */
  readonly y: number;
  /** Downward speed, px/ms. */
  readonly vy: number;
  readonly length: number;
  readonly halfWidth: number;
}

/** #2843: the Carrier's attack-run telegraph. The run itself is the "AttackRun" enemy phase. */
export type AttackRunPhase = "idle" | "brace";

/** #2485: Carrier moments the screen reacts to (sound, haptics, screen-reader announcements). */
export type CarrierEvent = "beamCharge" | "beamFire" | "reinforce" | "attackRun" | "finalStand";

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
  /** Enemy ids this piercing bullet has already damaged, across its whole flight — piercing
   * bullets aren't consumed on hit, so without this a slow bullet overlapping a big hitbox
   * (e.g. the Carrier) for several ticks would re-deal damage every tick it stays inside it. */
  readonly hitEnemyIds?: readonly number[];
  /** #2880: hits a capped piercing shot (Buddy's) may still make; spent at 0. Absent = unlimited. */
  readonly pierceLeft?: number;
  /** #2487: an enemy shot fired at an asteroid — outside bulletCap(), drawn in a distinct colour. */
  readonly flak?: boolean;
  /**
   * #2845: goes through the escorted Carrier's force field. A separate concept from `piercing`
   * (multi-hit through ordinary hulls): Lightning shots are both; Buddy's burst is piercing only,
   * so the armored Carrier's field stops it.
   */
  readonly armorPiercing?: boolean;
  /** #2845: a player-owned shot Buddy fired (allied with the player, never hits it). */
  readonly source?: "buddy";
  /** #2845: an enemy shot aimed at Buddy — it replaced a player-directed shot (finite capacity). */
  readonly target?: "buddy";
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

/**
 * #2845: Buddy's flight phase. Entering: flying in from a side edge to its station. OnStation:
 * strafing at its standoff lane, evading and making attack runs (one burst each). Leaving: out of
 * bursts, out of station time, or the wave is being extracted — it peels off the nearer side edge.
 */
export type BuddyPhase = "Entering" | "OnStation" | "Leaving";

/**
 * Companion ship (#1035), a real allied ship since #2845: it has HP and can be destroyed, enemies
 * of every tier may divert fire to it (finite capacity: a shot at Buddy replaces a shot at the
 * player), and it evades hostile fire and rocks. Its bursts are player-owned shots tagged
 * `source: "buddy"`; they persist after Buddy dies.
 */
export interface BuddyShip {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** Current velocity (px/ms) — what enemies lead their aim with. */
  readonly vx: number;
  readonly vy: number;
  readonly phase: BuddyPhase;
  /** Remaining hit points; Buddy is removed (destroyed) the tick this reaches 0. */
  readonly hp: number;
  /** ms remaining for the hit flash; 0 when not flashing. */
  readonly hitFlashTimer: number;
  /** ms Buddy has been in play (drives its strafe). */
  readonly ageMs: number;
  /** ms left on station before it peels off. */
  readonly stationMs: number;
  /** Attack-run bursts it still has to fire; lost if Buddy dies or leaves first. */
  readonly burstsLeft: number;
  /** ms until its next burst (the attack run lines up during the last BUDDY_RUN_MS). */
  readonly burstTimer: number;
  /** ms until it re-plans its evasion (its reaction latency). */
  readonly planMs: number;
  /** The point it is currently steering for. */
  readonly goalX: number;
  readonly goalY: number;
  /** Sprite facing: true = nose to the right. */
  readonly facingRight: boolean;
  /** Rocks that have already struck it — one hit per rock, like any ship. */
  readonly hitRockIds: readonly number[];
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
  /** #2485/#2843: ms until the Carrier's next reinforcement launch (randomized, Playing only). */
  readonly reinforceTimer: number;
  /** #2485: grunts launched by the Carrier this wave — capped at half the wave's grunt slots. */
  readonly reinforcedThisWave: number;
  /** #2843: released Carrier beams in flight (see CarrierBeam). */
  readonly carrierBeams: readonly CarrierBeam[];
  /**
   * #2843: the Carrier stage the engine last acted on — `carrierStage(state)` is the live
   * value; the engine compares the two to react to an escalation. null with no Carrier alive.
   */
  readonly carrierStage: CarrierStage | null;
  /** #2487: asteroid-response counters per tier (see TierStats). */
  readonly tierStats: Readonly<Record<EnemyTier, TierStats>>;
  /** #2491: whole-run counters (see RunStats). */
  readonly runStats: RunStats;
  /** Dev (#2491): enemies never roll to dodge a rock — collisions become the baseline. */
  readonly dodgeDisabled: boolean;
  /** Dev (#2491): enemies never fire flak at a rock. */
  readonly flakDisabled: boolean;
  /**
   * General-purpose phase timer: ms spent in the current phase, for phases that need one.
   * #3132: ClearAwaitingPickups counts its wait here (the safety cap); 0 in every other phase.
   */
  readonly phaseTimer: number;
  /** #2842: the AI extraction in progress; non-null exactly while phase is "Extraction". */
  readonly extraction: Extraction | null;
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
  /** Non-Guardian enemy count at wave start; used for Guardian dive eligibility (#978). */
  readonly startingNonLeaderCount: number;
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
  /** True once ≤35% non-leader enemies remain; latches true and never resets mid-wave. */
  readonly guardianThresholdCrossed: boolean;
  /** True once ≤3 enemies remain (Stage 3); enables Guardian deep dive + body collision. */
  readonly guardianDeepThresholdCrossed: boolean;
  /** When true, ≤3 surviving enemies immediately break formation and go fully aggressive. */
  readonly stragglerEnabled: boolean;
  /** When true (dev panel), straggler aggression is suppressed regardless of enemy count (#1039). */
  readonly pauseStraggler: boolean;
  /** #2489: latched once the wave's grunts have routed (no Elite, Guardian or Carrier left alive). */
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
   * Purely cosmetic — gameplay is never paused for this (#2352); set on the last kill, counts
   * down like any other cosmetic timer (compare `bombFlashTimer`).
   */
  readonly missionCompleteTimer: number;
  /** #2837: points by wave and source — see scoreLedger.ts. Carries across waves, reset per run. */
  readonly scoreLedger: ScoreLedger;
}

/** Input snapshot consumed by each `tick` call. */
export interface StarSwarmInput {
  /** Desired player center X in logical canvas pixels. */
  readonly playerX: number;
  /** true while auto-fire is active. */
  readonly fire: boolean;
}

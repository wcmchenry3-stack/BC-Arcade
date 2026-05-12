export type EnemyTier = "Grunt" | "Elite" | "Boss";

export type PowerUpType = "lightning" | "shield" | "buddy" | "bomb";

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
  | "Returning"; // following Bézier path back to formation slot

export type GamePhase =
  | "SwoopIn" // wave intro — enemies filling the grid
  | "Playing" // normal combat
  | "ChallengingStage" // non-hostile bonus wave
  | "WaveClear" // brief pause before next wave
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
}

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
  /** General-purpose countdown timer (WaveClear pause, etc.). */
  readonly phaseTimer: number;
  readonly canvasW: number;
  readonly canvasH: number;
  /** Hits accumulated during the current Challenging Stage. */
  readonly challengingHits: number;
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
  /** ms remaining for the Smart Bomb full-screen flash overlay; 0 when inactive (#1034). */
  readonly bombFlashTimer: number;
  /** Active difficulty tier; drives score multiplier and AI param scaling (#1037). */
  readonly difficulty: DifficultyTier;
  /** True when the player hit all enemies in a Challenging Stage (#1022). */
  readonly challengingPerfect: boolean;
  /** Dev: suppress player fire (bullets never spawn, cooldown still ticks). */
  readonly playerFireDisabled: boolean;
  /** Dev: enemy bullets are never pushed to the bullet list. */
  readonly enemyFireDisabled: boolean;
}

/** Input snapshot consumed by each `tick` call. */
export interface StarSwarmInput {
  /** Desired player center X in logical canvas pixels. */
  readonly playerX: number;
  /** true while auto-fire is active. */
  readonly fire: boolean;
}

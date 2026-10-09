/**
 * Star Swarm engine — public surface (#2988).
 *
 * A pure re-export barrel over `engine/`: every importer (`GameCanvas`, `Controls`,
 * `StarSwarmScreen`, the renderers, `pauseStore`, the balance simulator and the tests) keeps
 * importing from `game/starswarm/engine`. The modules, in dependency order:
 *
 *   tuning      every tunable, the difficulty tiers and the injectable `Tuning` object
 *   rng         the seeded LCG and the id counters (the run's replay counters)
 *   geometry    Béziers, overlap tests, the formation layout, path factories, aim, `hashFrac`
 *   roster      roster reads (leader tiers, the Carrier's armor and stage), `TickCtx`, `mapKeep`
 *   stats       per-tier and run-wide counters
 *   entities    pickups, explosions, the power-up type roll
 *   extraction  the `weaponsFree` / `hazardsLive` gates, live hazards, the autopilot, the reset
 *   asteroids   rocks, their threat contract, and the enemies' response to them
 *   buddy       Buddy: station, attack runs, evasion, the fire it draws, the hits it takes
 *   carrier     the Carrier's cadences, volley seam, beam, attack run and event selectors
 *   enemyPhases the per-ship phase machine (SwoopIn → Formation → Wiggling → Diving → …)
 *   enemies     `tickEnemies`: the fleet-wide tick (dives, sway, the Carrier context, reinforcements)
 *   collisions  bullets in flight and the single damage-resolution pass
 *   powerups    the player's volley, upgrade ladders, pickups and `applyPowerUp`
 *   wave        `initStarSwarm`, `buildWaveState`, `tick`, the phase machine (module header there)
 *
 * Tick pipeline (`tick(state, dtMs, input, tuning = DEFAULT_TUNING)`, full list in `wave.ts`):
 * timers and the tick context → player → enemies react to rocks → enemies → bullets → asteroids
 * → power-ups → Buddy → collisions (only while `hazardsLive`) → bonus lives → explosions →
 * `checkPhaseTransitions`, always last. Each step sees the state the one before it returned.
 *
 * Phase machine: SwoopIn → Playing → Extraction → (next wave) SwoopIn; GameOver is terminal and
 * `tick` returns it untouched. Each enemy also runs its own phase machine (`enemyPhases.ts`).
 *
 * Immutability: a tick never mutates its input; a sub-tick that changes nothing returns the same
 * object (`mapKeep`, #2963), so the renderer compares frames by identity. The only mutable state
 * is outside `StarSwarmState`: the LCG seed and id counters in `rng.ts`, which a restored run
 * must put back with `restoreEngineCounters` before its first tick (docs/ARCHITECTURE.md §3.2).
 *
 * The barrel re-exports exactly the pre-split public surface by name (plus `WAVE_COUNTDOWN_MS`, formerly
 * `constants.ts`). Internals (`rng`, id counters, `tickCollisions`, `tickEnemies`, ...) stay private to
 * `engine/`; import them from `engine/<module>` (tests, tooling). The gameplay `rng` must never reach UI.
 *
 * See docs/ARCHITECTURE.md §3 and docs/games/starswarm.md.
 */
export {
  ASTEROID_ATTENTION,
  ASTEROID_ENTRY_ATTEMPTS,
  ASTEROID_HIT_FLASH_MS,
  ASTEROID_INTERVAL_MAX,
  ASTEROID_INTERVAL_MIN,
  ASTEROID_MIN_CROSS_FRAC,
  ASTEROID_MIN_REACTION_MS,
  ASTEROID_MIN_WAVE,
  ASTEROID_STATS,
  ATTACK_RUN,
  ATTACK_RUN_BRACE_MS,
  BEAM_CHARGE_MS,
  BEAM_HALF_WIDTH,
  BEAM_LENGTH,
  BEAM_SPEED,
  BOSS_WAVE_BEAM_SCALE,
  BOSS_WAVE_CLEAR_MULT,
  BUDDY_BEAM_DAMAGE,
  BUDDY_BURSTS,
  BUDDY_BURST_INTERVAL,
  BUDDY_FIRST_BURST_MS,
  BUDDY_HP,
  BUDDY_HURT_RADIUS,
  BUDDY_MAX_INCOMING,
  BUDDY_NOTICE,
  BUDDY_NOTICE_AIMED,
  BUDDY_PIERCE_HITS,
  BUDDY_REPLAN_MS,
  BUDDY_ROCK_DAMAGE,
  BUDDY_ROCK_LOOKAHEAD_MS,
  BUDDY_RUN_MS,
  BUDDY_SPEED,
  BUDDY_STANDOFF,
  BUDDY_STATION_MS,
  BUDDY_TARGETING,
  BULLET_C_W,
  BULLET_E_VY,
  BURST_INTERVAL,
  BURST_PAUSE_BASE,
  CADENCE_INACTIVE_MS,
  CANVAS_H,
  CANVAS_W,
  CARRIER_CADENCE,
  CARRIER_CADENCE_CAP,
  CARRIER_CADENCE_FLOOR,
  CARRIER_FLAK_RANGE,
  DIFFICULTY_TIERS,
  DIVER_FLAK_FACTOR,
  DIVE_PATH_DURATION,
  DODGE_BASE,
  DODGE_CAP,
  DODGE_PATH_NUDGE,
  DODGE_SIDESTEP,
  DODGE_SIDESTEP_MS,
  EXTRACTION_HOLD_MAX_MS,
  EXTRACTION_HOLD_MIN_MS,
  EXTRACTION_MAX_MS,
  EXTRACTION_PICKUP_HOLD_MAX_MS,
  FLAK_BASE,
  FLAK_COOLDOWN,
  FLAK_RANGE,
  FLEE_DURATION_MAX,
  FLEE_DURATION_MIN,
  FLEE_ENSIGN_SCALE,
  FLEE_STAGGER_MAX,
  FLINCH_CHANCE,
  FLINCH_MS,
  FLINCH_WOBBLE_PERIOD_MS,
  FLINCH_WOBBLE_PX,
  FLINCH_WOBBLE_TILT,
  GUARDIAN_BULLET_VY,
  GUARDIAN_DIVE_THRESHOLD,
  GUNS_MAX,
  HIT_FLASH_DURATION,
  HULL_INVINCIBLE_MS,
  HULL_MAX,
  LATE_NUDGE_CHANCE,
  LATE_NUDGE_PX,
  MAX_ASTEROIDS,
  MAX_PLAYER_BULLETS,
  MISSION_COMPLETE_BANNER_MS,
  MISSION_COMPLETE_FADE_MS,
  PILOT_SPEED,
  PLAYER_HURT_RADIUS,
  PLAYER_W,
  POWERUP_DURATION,
  REACTION_PHASES,
  REINFORCE_COUNT,
  SALVAGE_DROP_CHANCE,
  SPREAD_VX,
  WAVE_CLEAR_BONUS_BASE,
  WAVE_COUNTDOWN_MS,
  WIGGLE_DURATION,
  bulletCap,
  difficultyLabel,
  difficultyMultiplier,
  difficultyParamScale,
  isBossWave,
  maxDivers,
  triggerKills,
  waveClearBonusPoints,
} from "./engine/tuning";
export type {
  AsteroidAttention,
  BuddyTargeting,
  CadenceRange,
  CarrierCadence,
} from "./engine/tuning";
export {
  decayMissionCompleteTimer,
  initStarSwarm,
  showMissionCompleteBanner,
  tick,
} from "./engine/wave";
export {
  asteroidAttention,
  asteroidEntryMetrics,
  asteroidHits,
  asteroidHitsBox,
  asteroidOutline,
  asteroidThreatens,
  degradeAim,
  enemyThreatCircle,
  planAsteroidEntry,
  throwAsteroid,
  withAsteroidAttention,
} from "./engine/asteroids";
export type {
  AsteroidEntry,
  AsteroidEntryMetrics,
  AsteroidEntryRegion,
  RockLike,
  ThreatCircle,
} from "./engine/asteroids";
export {
  carrierFinalStandJustStarted,
  carrierJustExposed,
  carrierStage,
  isCarrierArmored,
  isLeaderTier,
} from "./engine/roster";
export {
  carrierAttackRunJustStarted,
  carrierBeamCharge,
  carrierBeamJustFired,
  carrierBeamJustStarted,
  carrierCadenceBounds,
  carrierFlakRock,
  carrierRunBrace,
  carrierRunPath,
  chooseCarrierTarget,
  reinforcementsJustLaunched,
  rollCarrierCadence,
} from "./engine/carrier";
export type { CarrierCtx, CarrierFlakRock, CarrierTarget } from "./engine/carrier";
export {
  _resetIds,
  engineCounters,
  isEngineCounters,
  restoreEngineCounters,
  seedRng,
} from "./engine/rng";
export type { EngineCounters } from "./engine/rng";
export { collideCircleAABB, hashFrac, nudgePath, splitRemaining } from "./engine/geometry";
export { applyPowerUp, playerVolley, upgradeEvents } from "./engine/powerups";
export { dodgeChance, dodgeRateByTier, emptyRunStats, emptyTierStats } from "./engine/stats";
export type { TierDodgeRow } from "./engine/stats";
export {
  diverCount,
  fleeingCount,
  isSwooping,
  killEscorts,
  originalGruntCount,
  reinforceCap,
  routJustStarted,
} from "./engine/enemies";
export {
  aimAtBuddy,
  buddyBurstCount,
  buddyHazards,
  buddyJustLost,
  buddyNotices,
  buddyStation,
  buddyTargetFor,
  buddyThreatCircle,
  shotHarmsAllies,
} from "./engine/buddy";
export {
  clearTransientCombat,
  hazardsLive,
  isAutopilot,
  liveHazards,
  waveJustCleared,
  weaponsFree,
} from "./engine/extraction";
export type { Hazard } from "./engine/extraction";

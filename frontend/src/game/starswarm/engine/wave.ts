/**
 * Star Swarm engine — waves and the tick (#2988).
 *
 * `initStarSwarm` / `buildWaveState` open a wave; `tick` advances it; `checkPhaseTransitions`
 * moves it along the phase machine. The whole engine is pure: a tick never mutates its input
 * state, and a sub-tick that changes nothing hands back the same object (`mapKeep`, #2963), so
 * the renderer can compare frames by identity.
 *
 * Tick pipeline, in order (each step sees the one before it):
 *   1. slow-mo / banner timers (real time) and `tickCtx` — the starting roster, read once
 *   2. `tickPlayer`             input, cooldowns, the player volley; the autopilot in Extraction
 *   3. `tickAsteroidThreats`    enemies react to rocks (before they move, so a dodge applies now)
 *   4. `tickEnemies`            the fleet's phase machine, Carrier, fire, reinforcements
 *   5. `tickBullets`            projectiles move; off-screen ones leave
 *   6. `tickAsteroids`          rocks move, timed spawns
 *   7. `tickPowerUps`           pickups fall, the active buff counts down
 *   8. `tickBuddyShips`         Buddy flies, fires, evades
 *   9. `tickCollisions`         only while `hazardsLive` — every hit, kill, pickup and score,
 *                               with the tick's awards committed to the ledger (#2837)
 *  10. `tickBonusLives`         a threshold crossed this tick (can revert a same-tick GameOver)
 *  11. `tickExplosions`
 *  12. `tickPickupWait`         #3132: the pickup wait's clock (its safety cap)
 *  13. `checkPhaseTransitions`  the phase machine, last
 *
 * Phase machine: SwoopIn ──all arrived──▶ Playing ──last kill──▶ [ClearAwaitingPickups, while
 * a pickup is on screen (#3132)] ──▶ Extraction ──ship out──▶ clearTransientCombat ──▶
 * buildWaveState(wave + 1) ──▶ SwoopIn. GameOver is terminal: `tick` returns the state
 * untouched. The screen's pre-wave countdown runs with the engine frozen.
 *
 * Counters: the seeded rng and the id counters live in `rng.ts`, outside the state. A run
 * restored after a cold start must call `restoreEngineCounters(save.counters)` before its first
 * tick, or ids and the rng stream restart from their defaults.
 *
 * Tuning: `tick(state, dt, input, tuning = DEFAULT_TUNING)` threads one `Tuning` object to the
 * sub-ticks that read it (no per-tick allocation); the balance simulator passes a variant.
 */
import type {
  DifficultyTier,
  Enemy,
  Player,
  PowerUp,
  RunStats,
  StarSwarmInput,
  StarSwarmState,
  EnemyTier,
  TierStats,
} from "../types";
import { commitAwards, emptyScoreLedger, type ScorePoints } from "../scoreLedger";
import { asteroidInterval, tickAsteroidThreats, tickAsteroids } from "./asteroids";
import { tickBuddyShips } from "./buddy";
import { rollCarrierCadence } from "./carrier";
import { tickBullets, tickCollisions } from "./collisions";
import { tickEnemies } from "./enemies";
import { makeEnemy } from "./enemyPhases";
import { tickExplosions } from "./entities";
import {
  beginWaveClear,
  clearTransientCombat,
  endPickupWait,
  extractionComplete,
  extractionYieldsToPickup,
  hazardsLive,
  pickupWaitOver,
  resumePickupWait,
  tickExtractionPilot,
  tickPickupWait,
  weaponsFree,
} from "./extraction";
import { bossWaveSlots, waveSlots } from "./geometry";
import { playerVolley, tickPowerUps } from "./powerups";
import { rng, seedRng } from "./rng";
import { carrierStageIn, isLeaderTier, tickCtx } from "./roster";
import { emptyRunStats, emptyTierStats } from "./stats";
import {
  BONUS_LIFE_INVINCIBLE_MS,
  BONUS_LIFE_SLOW_MO_DURATION,
  BONUS_LIFE_SLOW_MO_SCALE,
  DEFAULT_TUNING,
  MAX_LIVES,
  MAX_PLAYER_BULLETS,
  PLAYER_H,
  PLAYER_SHOOT_COOLDOWN,
  PLAYER_W,
  PLAYER_Y_FROM_BOTTOM,
  SUPER_SHOOT_COOLDOWN,
  bonusLifeThreshold,
  difficultyParamScale,
  diveInterval,
  isBossWave,
  triggerKills,
  type Tuning,
} from "./tuning";

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

// ---------------------------------------------------------------------------
// Public: initStarSwarm
// ---------------------------------------------------------------------------

export function initStarSwarm(
  canvasW: number,
  canvasH: number,
  wave = 1,
  seed = 42,
  difficulty: DifficultyTier = "LieutenantJG",
  stragglerEnabled?: boolean,
  tuning: Tuning = DEFAULT_TUNING
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

  return buildWaveState(
    canvasW,
    canvasH,
    wave,
    player,
    0,
    0,
    difficulty,
    stragglerEnabled,
    undefined,
    undefined,
    tuning
  );
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
  runStats: RunStats = emptyRunStats(),
  tuning: Tuning = DEFAULT_TUNING
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
      ? { ...e, beamTimer: rollCarrierCadence("beam", "protected", difficulty, bossWave, tuning) }
      : e
  );
  const reinforceTimer = rollCarrierCadence("reinforce", "protected", difficulty, bossWave, tuning);
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

export function tick(
  state: StarSwarmState,
  dtMs: number,
  input: StarSwarmInput,
  tuning: Tuning = DEFAULT_TUNING
): StarSwarmState {
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
  s = tickEnemies(s, scaledDt, ctx, tuning);
  s = tickBullets(s, scaledDt);
  s = tickAsteroids(s, scaledDt); // #2486
  s = tickPowerUps(s, scaledDt);
  s = tickBuddyShips(s, scaledDt, tuning);
  // #2842: the central damage gate — during swoop-in every actor is invulnerable, so no
  // bullet, rock, beam or ram resolves at all (and no incoming enemy can be pre-damaged).
  if (hazardsLive(s)) {
    const awards: ScorePoints = {}; // #2837
    s = tickCollisions(s, awards, tuning); // score updated by kills here
    s = commitAwards(s, awards);
  }
  s = tickBonusLives(state, s); // #1078: after score updated; un-GameOvers if bonus life rescues player
  s = tickExplosions(s, scaledDt);
  s = tickPickupWait(s, scaledDt, state.powerUps); // #3132
  s = checkPhaseTransitions(s, tuning);
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

function checkPhaseTransitions(state: StarSwarmState, tuning: Tuning): StarSwarmState {
  const liveEnemies = state.enemies.filter((e) => e.isAlive);

  // SwoopIn → Playing once all enemies are in Formation
  if (state.phase === "SwoopIn") {
    const allArrived = liveEnemies.every((e) => e.phase !== "SwoopIn");
    if (allArrived) return { ...state, phase: "Playing" };
    return state;
  }

  // Playing → (ClearAwaitingPickups →) Extraction on the last kill (#2842, #3132)
  if (state.phase === "Playing") {
    return liveEnemies.length === 0 ? beginWaveClear(state) : state;
  }

  // #3132: the player has collected (or lost) every pickup on screen — now the extraction
  if (state.phase === "ClearAwaitingPickups") {
    return pickupWaitOver(state) ? endPickupWait(state) : state;
  }

  // Extraction → hard reset → wave N+1, once the ship is out
  if (state.phase === "Extraction") {
    if (extractionComplete(state)) return startNextWave(clearTransientCombat(state), tuning);
    // #3132: salvage from a rock an in-flight shot broke — back to the player while on station
    return extractionYieldsToPickup(state) ? resumePickupWait(state) : state;
  }

  return state;
}

function startNextWave(state: StarSwarmState, tuning: Tuning): StarSwarmState {
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
    state.runStats,
    tuning
  );
  // the cosmetic banner raised on the last kill finishes its own fade;
  // #2837: the ledger carries across waves
  return {
    ...next,
    missionCompleteTimer: state.missionCompleteTimer,
    scoreLedger: state.scoreLedger,
  };
}

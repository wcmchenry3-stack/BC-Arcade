/**
 * Star Swarm engine — power-ups and the in-run upgrade ladders (#980, #2488).
 *
 * The player's volley by gun level, the upgrade events the screen announces, falling pickups
 * and the active timed buff (`tickPowerUps`), and `applyPowerUp` — the dev-panel / test handle
 * that applies a power-up directly (its bomb shares `applyBombBlast` with collection).
 */
import type {
  Bullet,
  Explosion,
  GunsLevel,
  HullLevel,
  PowerUp,
  PowerUpType,
  StarSwarmState,
  UpgradeEvent,
} from "../types";
import { recordScore, type ScorePoints } from "../scoreLedger";
import { launchBuddy } from "./buddy";
import { applyBombBlast } from "./collisions";
import { spawnExplosion } from "./entities";
import { nextId } from "./rng";
import { mapFilterKeep } from "./roster";
import {
  BOMB_FLASH_DURATION,
  BULLET_C_H,
  BULLET_C_W,
  BULLET_P_H,
  BULLET_P_VY,
  BULLET_P_W,
  DEFAULT_TUNING,
  GUNS_MAX,
  HULL_MAX,
  POWERUP_DURATION,
  SPREAD_OFFSET,
  SPREAD_VX,
  SUPER_DAMAGE,
  TWIN_OFFSET,
  type Tuning,
} from "./tuning";

// ---------------------------------------------------------------------------
// In-run ship upgrades (#2488)
// ---------------------------------------------------------------------------

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
    // #2845: Lightning is the explicit armor-piercing exception — multi-hit AND through the field
    armorPiercing: isSuper ? true : undefined,
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
// Power-ups (#980)
// ---------------------------------------------------------------------------

export function tickPowerUps(state: StarSwarmState, dtMs: number): StarSwarmState {
  const powerUps = mapFilterKeep(
    state.powerUps,
    (pu) => ({ ...pu, y: pu.y + pu.vy * dtMs, despawnTimer: pu.despawnTimer - dtMs }),
    (pu) => pu.despawnTimer > 0 && pu.y - pu.height / 2 < state.canvasH
  );

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

  if (
    powerUps === state.powerUps &&
    activePowerUp === state.activePowerUp &&
    bombFlashTimer === state.bombFlashTimer
  ) {
    return state; // #2963: nothing falling, active or flashing
  }
  return { ...state, powerUps, activePowerUp, bombFlashTimer };
}

// ---------------------------------------------------------------------------
// Public: applyPowerUp — used by triggerPowerUp dev-panel handle (#1039)
// ---------------------------------------------------------------------------

export function applyPowerUp(
  state: StarSwarmState,
  type: PowerUpType,
  tuning: Tuning = DEFAULT_TUNING
): StarSwarmState {
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
    const awards: ScorePoints = {}; // #2837
    const drops: PowerUp[] = []; // #2488
    const tally = {
      score: state.score,
      killsSinceLastDrop: state.killsSinceLastDrop,
      routCaught: 0,
    };
    const enemies = applyBombBlast(state, state.enemies, newExplosions, drops, awards, tally);
    for (const a of state.asteroids) newExplosions.push(spawnExplosion(a.x, a.y)); // #2486
    return {
      ...state,
      enemies,
      asteroids: [],
      enemyBullets: [],
      carrierBeams: [], // #2843: released beams are enemy projectiles too
      powerUps: [...state.powerUps, ...drops],
      explosions: newExplosions,
      score: tally.score,
      scoreLedger: recordScore(state.scoreLedger, state.wave, awards), // #2837
      killsSinceLastDrop: tally.killsSinceLastDrop,
      bombFlashTimer: BOMB_FLASH_DURATION,
    };
  }

  if (type === "buddy") return launchBuddy(state, tuning); // #2845

  // lightning or shield: replace any active duration buff
  return {
    ...state,
    activePowerUp: { remainingMs: POWERUP_DURATION, type, shieldAbsorbed: 0 },
  };
}

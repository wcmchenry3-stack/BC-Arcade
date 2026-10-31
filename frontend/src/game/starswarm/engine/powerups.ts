/**
 * Star Swarm engine — power-ups and the in-run upgrade ladders (#980, #2488).
 *
 * The player's volley by gun level, the upgrade events the screen announces, falling pickups
 * and the active timed buff (`tickPowerUps`), and `applyPowerUp` — the dev-panel / test handle
 * that applies a power-up directly (its bomb shares `applyBombBlast` with collection).
 */
import type {
  BankablePowerUp,
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
import { isWaveCleared } from "./extraction";
import { tlBuffEnd, tlPickup, tlPlatingUp } from "./waveTimeline";
import { spawnExplosion } from "./entities";
import { nextId } from "./rng";
import { mapFilterKeep } from "./roster";
import { ROCK_BROKEN } from "./waveCounters";
import { bumpRun } from "./stats";
import {
  bumpWave,
  countPickups,
  countSpawned,
  markWaveDev,
  noteGunsPeak,
  type WaveCounterPath,
} from "./waveStats";
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
  POST_CLEAR_PICKUP_SPEED_MULT,
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
  let waveStats = state.waveStats;
  let missed: PowerUp[] | null = null; // #3246: despawned or fell off the bottom
  // #3512: once the wave is clear, pickups fall and despawn faster (a phase branch, no allocation)
  const fallMs = isWaveCleared(state) ? dtMs * POST_CLEAR_PICKUP_SPEED_MULT : dtMs;
  const powerUps = mapFilterKeep(
    state.powerUps,
    (pu) => ({ ...pu, y: pu.y + pu.vy * fallMs, despawnTimer: pu.despawnTimer - fallMs }),
    (pu) => {
      if (pu.despawnTimer > 0 && pu.y - pu.height / 2 < state.canvasH) return true;
      (missed ??= []).push(pu);
      return false;
    }
  );
  const lost = missed as PowerUp[] | null; // (set in the filter callback above)
  if (lost) waveStats = countPickups(waveStats, "missed", lost);

  let activePowerUp = state.activePowerUp;
  let waveTimeline = state.waveTimeline;
  if (activePowerUp !== null) {
    const newMs = activePowerUp.remainingMs - dtMs;
    // #3246: the ms the buff was live this tick belong to this wave (a buff outlives its wave)
    waveStats = bumpWave(
      waveStats,
      ["powerUps", "activeMs", activePowerUp.type] as WaveCounterPath,
      Math.min(dtMs, activePowerUp.remainingMs)
    );
    if (newMs <= 0) {
      waveStats = bumpWave(
        waveStats,
        ["powerUps", "expired", activePowerUp.type] as WaveCounterPath,
        1
      );
      // #3392: the buff ran out (not replaced, not cut off at the wave boundary)
      if (waveTimeline)
        waveTimeline = tlBuffEnd(waveTimeline, waveStats.pacing.durationMs, activePowerUp.type);
      activePowerUp = null;
    } else {
      activePowerUp = { ...activePowerUp, remainingMs: newMs };
    }
  }

  const bombFlashTimer = Math.max(0, state.bombFlashTimer - dtMs);

  if (
    powerUps === state.powerUps &&
    activePowerUp === state.activePowerUp &&
    bombFlashTimer === state.bombFlashTimer &&
    waveStats === state.waveStats &&
    waveTimeline === state.waveTimeline
  ) {
    return state; // #2963: nothing falling, active or flashing
  }
  return { ...state, powerUps, activePowerUp, bombFlashTimer, waveStats, waveTimeline };
}

// #3249: hoisted per-wave counter path (same as collisions.ts)
const ROUT_CAUGHT = ["rout", "caught"] as const;

// ---------------------------------------------------------------------------
// Public: applyPowerUp — used by triggerPowerUp dev-panel handle (#1039)
// ---------------------------------------------------------------------------

export function applyPowerUp(
  state: StarSwarmState,
  type: PowerUpType,
  tuning: Tuning = DEFAULT_TUNING
): StarSwarmState {
  const next = injectPowerUp(state, type, tuning);
  if (next === state) return state;
  // #3245: a dev-panel action touched the wave. #3246: it spawns the power-up and applies it at
  // once — spawned from "dev" and collected in the same breath, so the books still balance.
  const waveStats = bumpWave(
    bumpWave(next.waveStats, ["powerUps", "spawned", type, "dev"] as WaveCounterPath, 1),
    ["powerUps", "collected", type] as WaveCounterPath,
    1
  );
  // #3510: a dev Salvage raises the wave's Guns high like a collected one
  return markWaveDev({ ...next, waveStats: noteGunsPeak(waveStats, next.player.guns) });
}

function injectPowerUp(state: StarSwarmState, type: PowerUpType, tuning: Tuning): StarSwarmState {
  if (state.phase !== "Playing") return state;
  // #3392: recorded like a collected pickup (PICKUP for the four power-ups, before the bomb's
  // blast; PLATING_UP for hull, below)
  const ms = state.waveStats.pacing.durationMs;
  const waveTimeline = state.waveTimeline && tlPickup(state.waveTimeline, ms, type);

  // #2488: dev-panel upgrades apply straight to the ladders
  if (type === "salvage") {
    const guns = Math.min(GUNS_MAX, state.player.guns + 1) as GunsLevel;
    return { ...state, player: { ...state.player, guns } };
  }
  if (type === "hull") {
    const hull = Math.min(HULL_MAX, state.player.hull + 1) as HullLevel;
    const plated = state.waveTimeline && tlPlatingUp(state.waveTimeline, ms, hull); // #3392
    return { ...state, player: { ...state.player, hull }, waveTimeline: plated };
  }
  return activatePowerUp({ ...state, waveTimeline }, type, tuning);
}

/**
 * #3512: apply the power-up banked during the last wave's clear. Called once, on the
 * SwoopIn → Playing transition, so it takes effect on the wave's first combat tick: Shield and
 * Lightning start their full 5 s, Buddy launches, the Smart Bomb fires (normal rules). The
 * collect belongs to the earlier wave (its `collected` count and PICKUP entry); what the power-up
 * does belongs to this one (buff time, BUFF_END, Buddy launched, bomb kills), so nothing counts
 * twice.
 */
export function applyBankedPowerUp(state: StarSwarmState, tuning: Tuning): StarSwarmState {
  const type = state.bankedPowerUp;
  if (type === null) return state;
  return activatePowerUp({ ...state, bankedPowerUp: null }, type, tuning);
}

/**
 * What an ordinary power-up does once it takes effect, shared by the dev panel (`injectPowerUp`)
 * and the banked power-up (`applyBankedPowerUp`). It records no PICKUP: the caller owns that.
 */
function activatePowerUp(
  state: StarSwarmState,
  type: BankablePowerUp,
  tuning: Tuning
): StarSwarmState {
  const waveTimeline = state.waveTimeline;
  if (type === "bomb") {
    const newExplosions: Explosion[] = [...state.explosions];
    const awards: ScorePoints = {}; // #2837
    const drops: PowerUp[] = []; // #2488
    const tally = {
      score: state.score,
      killsSinceLastDrop: state.killsSinceLastDrop,
      routCaught: 0,
      // #3247: every rock on screen is the bomb's (settled rocks are all whole)
      waveStats: bumpWave(state.waveStats, ROCK_BROKEN.bomb, state.asteroids.length),
      timeline: waveTimeline, // #3392: the blast's Carrier kill follows the PICKUP
    };
    const enemies = applyBombBlast(state, state.enemies, newExplosions, drops, awards, tally);
    for (const a of state.asteroids) newExplosions.push(spawnExplosion(a.x, a.y)); // #2486
    // #3272: fleeing grunts the blast kills are caught, as in resolvePickupCollection's bomb branch
    let runStats = state.runStats;
    let waveStats = countSpawned(tally.waveStats, drops);
    if (tally.routCaught > 0) {
      runStats = bumpRun(runStats, { routCaught: tally.routCaught });
      waveStats = bumpWave(waveStats, ROUT_CAUGHT, tally.routCaught);
    }
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
      runStats, // #3272
      // #3247/#3248: the blast's rocks and kills; #3246: Carrier plating it dropped
      waveStats,
      waveTimeline: tally.timeline,
      bombFlashTimer: BOMB_FLASH_DURATION,
    };
  }

  if (type === "buddy") return launchBuddy(state, tuning); // #2845

  // lightning or shield: replace any active duration buff
  return { ...state, activePowerUp: { remainingMs: POWERUP_DURATION, type, shieldAbsorbed: 0 } };
}

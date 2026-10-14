/**
 * Scenario builders for the Carrier and rout wave-stats counters (#3249): used by the contract
 * rows (`waveStatsContract/carrier.ts`, `rout.ts`) and `waveStats.carrier.test.ts`. Not a test file.
 */
import { CANVAS_H, CANVAS_W, initStarSwarm, seedRng, tick, _resetIds } from "../../engine";
import { makePickup } from "../../engine/entities";
import type { Bullet, DifficultyTier, StarSwarmInput, StarSwarmState } from "../../types";
import { advanceMs, clearedSnapshot, makeBeam } from "./engineFixtures";

export const ASIDE: StarSwarmInput = { playerX: 40, fire: false };

type Pick = (e: StarSwarmState["enemies"][number]) => boolean;
export const killWhere = (s: StarSwarmState, pick: Pick): StarSwarmState => ({
  ...s,
  enemies: s.enemies.map((e) => (pick(e) ? { ...e, isAlive: false, hp: 0 } : e)),
});

/** Mid-wave (combat live), enemy fire and rocks off, player parked left and safe. */
export function quietWave(
  wave: number,
  difficulty: DifficultyTier = "LieutenantJG"
): StarSwarmState {
  seedRng(42);
  _resetIds();
  const s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, difficulty), 8000);
  return {
    ...s,
    enemyFireDisabled: true,
    enemyBullets: [],
    asteroids: [],
    asteroidsDisabled: true,
    nextDiveTimer: 1e9,
    player: { ...s.player, x: 40, lives: 3, invincibleTimer: 0 },
  };
}

export const carrierOf = (s: StarSwarmState) =>
  s.enemies.find((e) => e.isAlive && e.tier === "Carrier")!;

const playerShot = (id: number, x: number, y: number): Bullet => ({
  id,
  x,
  y,
  vx: 0,
  vy: 0,
  owner: "player",
  width: 5,
  height: 14,
  damage: 1,
});

/** Wave 1: ten grunts killed, then one reinforcement launch (protected Carrier). */
export function reinforcedWave(): StarSwarmState {
  let s = quietWave(1);
  let n = 0;
  s = killWhere(s, (e) => e.tier === "Grunt" && n++ < 10);
  return tick({ ...s, reinforceTimer: 1 }, 16, ASIDE);
}

/** Wave 1: the Carrier charges and releases one beam, which flies on (no hit). */
export function beamFiredWave(): StarSwarmState {
  let s = quietWave(1);
  const c = carrierOf(s);
  s = {
    ...s,
    enemyFireDisabled: false,
    player: { ...s.player, invincibleTimer: 1e9 },
    enemies: s.enemies.map((e) =>
      e.id === c.id ? { ...e, beamTimer: 100 } : { ...e, shootTimer: 1e9 }
    ),
  };
  for (let i = 0; i < 125 && s.carrierBeams.length === 0; i++) s = tick(s, 16, ASIDE);
  if (s.carrierBeams.length === 0) throw new Error("no beam released");
  return s;
}

/** Wave 1: a released beam lands on the ship. */
export function beamHitWave(): StarSwarmState {
  const base = quietWave(1);
  return tick(
    {
      ...base,
      player: { ...base.player, x: 200 },
      carrierBeams: [makeBeam(200, base.player.y)],
    },
    16,
    { playerX: 200, fire: false }
  );
}

/** Wave 1: a plain shot into the escorted Carrier's field. */
export function deflectWave(): StarSwarmState {
  const s = quietWave(1);
  const c = carrierOf(s);
  return tick({ ...s, playerBullets: [playerShot(77_001, c.x, c.y)] }, 16, ASIDE);
}

/** Wave 1, escorts gone (exposed): the Carrier braces and then leaves station on a run. */
export function attackRunWave(): StarSwarmState {
  let s = killWhere(quietWave(1), (e) => e.tier === "Guardian");
  s = {
    ...s,
    enemies: s.enemies.map((e) =>
      e.tier === "Carrier"
        ? { ...e, runPhase: "brace" as const, runTimer: 1, diveTargetX: 40, beamTimer: 1e9 }
        : e
    ),
  };
  for (let i = 0; i < 200 && carrierOf(s).phase !== "AttackRun"; i++) s = tick(s, 16, ASIDE);
  if (carrierOf(s).phase !== "AttackRun") throw new Error("no attack run");
  return s;
}

/** Wave 1 cleared after the Carrier passed protected, exposed and final stand. */
export function stagesSnapshot() {
  let s = quietWave(1);
  const park = (x: StarSwarmState): StarSwarmState => ({
    ...x,
    enemies: x.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
  });
  s = tick(park(s), 160, ASIDE);
  s = tick(park(killWhere(s, (e) => e.tier === "Guardian")), 160, ASIDE);
  s = tick(park(killWhere(s, (e) => e.tier !== "Carrier")), 160, ASIDE);
  return { state: s, snapshot: clearedSnapshot(s, ASIDE) };
}

// ---- rout (wave 2: no Carrier) ----

export const fleeing = (s: StarSwarmState) =>
  s.enemies.filter((e) => e.isAlive && e.phase === "Fleeing");

/** Wave 2 with only grunts left, one tick before the rout. */
export function preRout(difficulty: DifficultyTier = "Ensign"): StarSwarmState {
  return killWhere(quietWave(2, difficulty), (e) => e.tier !== "Grunt");
}

/** The rout tick. */
export const routTick = (prev: StarSwarmState): StarSwarmState => tick(prev, 16, ASIDE);

export const routGruntCount = (prev: StarSwarmState): number =>
  prev.enemies.filter((e) => e.isAlive && e.tier === "Grunt").length;

/** Ticks (no clearing) until the wave closes on its own; its snapshot. */
function closedSnapshot(state: StarSwarmState) {
  let s = state;
  for (let i = 0; i < 3000 && s.wave === state.wave; i++) s = tick(s, 16, ASIDE);
  if (s.wave === state.wave || !s.lastClosedWave) throw new Error("wave didn't close");
  return s.lastClosedWave;
}

/** One fleeing grunt shot, the rest left to escape; returns the cleared wave's snapshot. */
export function caughtAndEscapedSnapshot() {
  const base = routTick(preRout());
  const target = fleeing(base).find((e) => e.pathT < 0)!;
  const s = tick({ ...base, playerBullets: [playerShot(77_002, target.x, target.y)] }, 16, ASIDE);
  return { base, snapshot: closedSnapshot(s) };
}

/** A Smart Bomb collected while the grunts flee: all caught, none escape. */
export function bombedSnapshot() {
  const base = routTick(preRout());
  const bomb = makePickup("bomb", base.player.x, base.player.y, CANVAS_H);
  const s = tick({ ...base, powerUps: [bomb] }, 16, ASIDE);
  return { base, snapshot: closedSnapshot(s) };
}

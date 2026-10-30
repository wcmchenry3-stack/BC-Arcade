/**
 * #3512: an ordinary power-up (Shield, Lightning, Buddy, Smart Bomb) collected after the wave's
 * last kill is banked, not applied, and takes effect on the next wave's first combat tick; and
 * once the wave is clear, every pickup falls (and despawns) at POST_CLEAR_PICKUP_SPEED_MULT × its
 * normal speed. See docs/games/starswarm.md "Wave clear" and "Temporary Power-Ups".
 */
import {
  CANVAS_H,
  CANVAS_W,
  PILOT_SPEED,
  POWERUP_DURATION,
  _resetIds,
  initStarSwarm,
  pickupWaitMaxMs,
  seedRng,
  tick,
} from "../engine";
import { powerUpDespawnMs } from "../engine/entities";
import {
  BOMB_FLASH_DURATION,
  PLAYER_Y_FROM_BOTTOM,
  POST_CLEAR_PICKUP_SPEED_MULT,
  POWERUP_H,
  POWERUP_VY,
} from "../engine/tuning";
import { TL } from "../engine/waveTimeline";
import { SAVE_FINGERPRINT, fitsSaveShape, restoreSavedState } from "../saveShape";
import type { BankablePowerUp, PowerUp, StarSwarmState } from "../types";
import { NO_INPUT, runExtraction, shotOnShip } from "./helpers/engineFixtures";
import { onShip, parked, pickup } from "./helpers/powerUpFixtures";

const KINDS: readonly BankablePowerUp[] = ["shield", "lightning", "buddy", "bomb"];
const KIND_IDX: Record<BankablePowerUp, number> = { lightning: 0, shield: 1, buddy: 2, bomb: 3 };

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

/** A quiet wave (no enemy fire, rocks or flak) in combat, the timeline recorded. */
function quietPlaying(): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "LieutenantJG", undefined, undefined, {
    timelineOn: true,
  });
  s = { ...s, enemyFireDisabled: true, asteroidsDisabled: true, flakDisabled: true };
  while (s.phase === "SwoopIn") s = tick(s, 16, NO_INPUT);
  expect(s.phase).toBe("Playing");
  return { ...s, player: { ...s.player, invincibleTimer: 0 } };
}

/** The last kill with a parked pickup on screen: the wave now waits for it. */
function waiting(base: StarSwarmState = quietPlaying()): StarSwarmState {
  const killed = {
    ...base,
    powerUps: [parked("salvage")],
    enemies: base.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
  };
  const s = tick(killed, 16, NO_INPUT);
  expect(s.phase).toBe("ClearAwaitingPickups");
  return s;
}

/** One tick in which the ship collects a `type` pickup sitting on it. */
function collect(s: StarSwarmState, type: BankablePowerUp): StarSwarmState {
  return tick({ ...s, powerUps: [...s.powerUps, onShip(s, type)] }, 16, NO_INPUT);
}

/** End the wait (the parked pickup gone), fly the extraction out: the next wave's first state. */
function toNextWave(s: StarSwarmState, onTick?: (s: StarSwarmState) => void): StarSwarmState {
  const wave = s.wave;
  s = { ...s, powerUps: [] };
  for (let i = 0; i < 3000 && s.wave === wave && s.phase !== "GameOver"; i++) {
    s = tick(s, 16, NO_INPUT);
    onTick?.(s);
  }
  expect(s.wave).toBe(wave + 1);
  expect(s.phase).toBe("SwoopIn");
  return s;
}

/** Tick the swoop-in until the transition into combat; returns that transition's state. */
function toCombat(s: StarSwarmState, onTick?: (s: StarSwarmState) => void): StarSwarmState {
  for (let i = 0; i < 3000 && s.phase === "SwoopIn"; i++) {
    s = tick(s, 16, NO_INPUT);
    onTick?.(s);
  }
  expect(s.phase).toBe("Playing");
  return s;
}

const pickupEntries = (s: StarSwarmState) =>
  (s.waveTimeline?.e ?? []).filter((e) => e[1] === TL.PICKUP);

describe("#3512 a power-up collected after the last kill is banked for the next wave", () => {
  it.each(KINDS)(
    "%s: does nothing this wave, and takes effect on the next wave's first combat tick",
    (kind) => {
      const wait = waiting();
      const enemyShot = { ...shotOnShip(wait), x: 20, y: 40, vy: 0 }; // in flight, far from the ship
      const before = { ...wait, enemyBullets: [enemyShot] };
      const banked = collect(before, kind);

      // banked: nothing happens this wave
      expect(banked.bankedPowerUp).toBe(kind);
      expect(banked.activePowerUp).toBeNull();
      expect(banked.buddyShips).toHaveLength(0);
      expect(banked.bombFlashTimer).toBe(0);
      expect(banked.enemyBullets).toHaveLength(1); // a bomb would have cleared it
      expect(banked.score).toBe(before.score);
      // wave N owns the collect: one collected, one PICKUP entry, nothing launched or buffed
      expect(banked.waveStats.powerUps.collected[kind]).toBe(1);
      expect(pickupEntries(banked)).toHaveLength(1);
      expect(pickupEntries(banked)[0]![2]).toBe(KIND_IDX[kind]);
      expect(banked.waveStats.buddy.launched).toBe(0);

      // it stays banked through the wait, the extraction and the swoop-in, doing nothing
      const swoop = toNextWave({ ...banked, enemyBullets: [] }, (t) => {
        expect(t.bankedPowerUp).toBe(kind);
        expect(t.activePowerUp).toBeNull();
        expect(t.buddyShips).toHaveLength(0);
      });
      const closed = swoop.lastClosedWave!;
      expect(closed.powerUps.collected[kind]).toBe(1);
      expect(closed.powerUps.activeMs[kind]).toBe(0);
      expect(closed.buddy.launched).toBe(0);
      const playing = toCombat(swoop, (t) => {
        if (t.phase === "SwoopIn") expect(t.bankedPowerUp).toBe(kind);
      });

      // applied, once, on the transition into combat: the first Playing tick runs with it
      expect(playing.bankedPowerUp).toBeNull();
      if (kind === "shield" || kind === "lightning") {
        expect(playing.activePowerUp).toEqual({
          type: kind,
          remainingMs: POWERUP_DURATION,
          shieldAbsorbed: 0,
        });
      }
      if (kind === "buddy") {
        expect(playing.buddyShips).toHaveLength(1);
        expect(playing.waveStats.buddy.launched).toBe(1);
        expect(playing.runStats.buddyLaunched).toBe(1);
      }
      if (kind === "bomb") {
        expect(playing.bombFlashTimer).toBe(BOMB_FLASH_DURATION);
        const bombKills = Object.values(playing.waveStats.combat.kills).reduce(
          (n, k) => n + k.bomb,
          0
        );
        expect(bombKills).toBeGreaterThan(0); // the wave's 1-hp grunts
        expect(playing.score).toBeGreaterThan(swoop.score);
      }
      // wave N + 1 owns the effect, never the collect: no collected count, no PICKUP entry
      expect(playing.waveStats.powerUps.collected[kind]).toBe(0);
      expect(pickupEntries(playing)).toHaveLength(0);

      // and it is applied once: the next ticks leave nothing banked and launch nothing more
      const later = tick(playing, 16, NO_INPUT);
      expect(later.bankedPowerUp).toBeNull();
      expect(later.waveStats.buddy.launched).toBe(kind === "buddy" ? 1 : 0);
    }
  );

  it.each(["shield", "lightning"] as const)(
    "%s: its full 5 s runs in combat, then it expires in the new wave (stats and timeline)",
    (kind) => {
      const playing = toCombat(toNextWave(collect(waiting(), kind)));
      let s = playing;
      let ms = 0;
      while (s.activePowerUp !== null && ms < 10_000) {
        s = tick({ ...s, enemyFireDisabled: true }, 16, NO_INPUT);
        ms += 16;
        expect(s.wave).toBe(playing.wave);
      }
      expect(ms).toBeGreaterThanOrEqual(POWERUP_DURATION);
      expect(ms).toBeLessThan(POWERUP_DURATION + 16);
      expect(s.waveStats.powerUps.activeMs[kind]).toBe(POWERUP_DURATION);
      expect(s.waveStats.powerUps.expired[kind]).toBe(1);
      const buffEnds = (s.waveTimeline?.e ?? []).filter((e) => e[1] === TL.BUFF_END);
      expect(buffEnds).toHaveLength(1);
      expect(buffEnds[0]![2]).toBe(KIND_IDX[kind]);
    }
  );

  it("a power-up already active at the last kill is not carried (regression)", () => {
    const base = quietPlaying();
    const shielded = {
      ...base,
      activePowerUp: { type: "shield" as const, remainingMs: POWERUP_DURATION, shieldAbsorbed: 0 },
    };
    const wait = waiting(shielded);
    expect(wait.activePowerUp?.type).toBe("shield"); // it runs on through the wait, as before
    expect(wait.bankedPowerUp).toBeNull();
    const playing = toCombat(toNextWave(wait));
    expect(playing.activePowerUp).toBeNull();
    expect(playing.bankedPowerUp).toBeNull();
  });

  it("a power-up collected during combat applies at once, as before", () => {
    const s = quietPlaying();
    const next = tick({ ...s, powerUps: [onShip(s, "shield")] }, 16, NO_INPUT);
    expect(next.phase).toBe("Playing");
    expect(next.activePowerUp?.type).toBe("shield");
    expect(next.bankedPowerUp).toBeNull();
  });

  it("salvage and hull plating collected after the last kill still apply at once", () => {
    const wait = waiting();
    const s = tick(
      {
        ...wait,
        powerUps: [
          ...wait.powerUps,
          pickup("salvage", "rock", wait.player.x, wait.player.y),
          pickup("hull", "carrier", wait.player.x - 4, wait.player.y),
        ],
      },
      16,
      NO_INPUT
    );
    // one pickup per tick: the first one touching the ship
    const s2 = tick(s, 16, NO_INPUT);
    expect(s2.player.guns).toBe(wait.player.guns + 1);
    expect(s2.player.hull).toBe(wait.player.hull + 1);
    expect(s2.bankedPowerUp).toBeNull();
  });

  it("a second banked power-up replaces the first; both count as collected", () => {
    const first = collect(waiting(), "shield");
    const second = collect(first, "bomb");
    expect(second.bankedPowerUp).toBe("bomb");
    expect(second.waveStats.powerUps.collected.shield).toBe(1);
    expect(second.waveStats.powerUps.collected.bomb).toBe(1);
    const playing = toCombat(toNextWave(second));
    expect(playing.activePowerUp).toBeNull();
    expect(playing.bombFlashTimer).toBe(BOMB_FLASH_DURATION);
  });

  it("is kept through a life lost during the wait", () => {
    const banked = collect(waiting(), "buddy");
    const hit = tick(
      { ...banked, player: { ...banked.player, lives: 3 }, enemyBullets: [shotOnShip(banked)] },
      16,
      NO_INPUT
    );
    expect(hit.player.lives).toBe(2);
    expect(hit.phase).toBe("ClearAwaitingPickups");
    expect(hit.bankedPowerUp).toBe("buddy");
    expect(toCombat(toNextWave(hit)).buddyShips).toHaveLength(1);
  });

  it("is kept through the extraction, including a life lost there", () => {
    const banked = collect(waiting(), "lightning");
    let s = tick({ ...banked, powerUps: [] }, 16, NO_INPUT);
    expect(s.phase).toBe("Extraction");
    s = tick(
      {
        ...s,
        player: { ...s.player, lives: 3, invincibleTimer: 0 },
        enemyBullets: [shotOnShip(s)],
      },
      16,
      NO_INPUT
    );
    expect(s.player.lives).toBe(2);
    expect(s.bankedPowerUp).toBe("lightning");
    const next = runExtraction(s);
    expect(next.bankedPowerUp).toBe("lightning");
    expect(toCombat(next).activePowerUp?.type).toBe("lightning");
  });

  it("is dropped when the run ends before the next wave's combat", () => {
    const banked = collect(waiting(), "buddy");
    const over = tick(
      {
        ...banked,
        player: { ...banked.player, lives: 1, hull: 0, invincibleTimer: 0 },
        enemyBullets: [shotOnShip(banked)],
      },
      16,
      NO_INPUT
    );
    expect(over.phase).toBe("GameOver");
    // GameOver is terminal: nothing applies it
    const after = tick(over, 16, NO_INPUT);
    expect(after).toBe(over);
    expect(after.buddyShips).toHaveLength(0);
  });

  it("is kept through a pause: saved and restored with the run", () => {
    const banked = toNextWave(collect(waiting(), "shield"));
    const saved: unknown = JSON.parse(JSON.stringify(banked));
    expect(fitsSaveShape(saved)).toBe(true);
    const restored = restoreSavedState(saved as StarSwarmState);
    expect(restored.bankedPowerUp).toBe("shield");
    expect(toCombat(restored).activePowerUp?.type).toBe("shield");
  });

  it("an old save without the field still loads, with nothing banked", () => {
    const { bankedPowerUp: _gone, ...older } = toNextWave(waiting());
    const saved: unknown = JSON.parse(JSON.stringify(older));
    expect(fitsSaveShape(saved)).toBe(true);
    expect(restoreSavedState(saved as StarSwarmState).bankedPowerUp).toBeNull();
    // the field is outside the fingerprint, so saves made before it keep loading
    expect(SAVE_FINGERPRINT).not.toContain("bankedPowerUp");
  });

  it("a stray saved value restores as nothing banked", () => {
    const s = toNextWave(waiting());
    for (const stray of ["salvage", "hull", "nope", 7, null]) {
      const saved = JSON.parse(JSON.stringify({ ...s, bankedPowerUp: stray }));
      expect(fitsSaveShape(saved)).toBe(true);
      expect(restoreSavedState(saved).bankedPowerUp).toBeNull();
    }
  });
});

describe("#3512 pickups fall faster once the wave is clear", () => {
  const falling = (s: StarSwarmState, y = 100): PowerUp =>
    pickup("salvage", "rock", 30, y, { vy: POWERUP_VY, despawnTimer: 8000 });

  it("the multiplier is one tuning constant, default 2", () => {
    expect(POST_CLEAR_PICKUP_SPEED_MULT).toBe(2);
  });

  it("combat-time pickups fall at the normal speed", () => {
    const s = quietPlaying();
    const next = tick({ ...s, powerUps: [falling(s)] }, 16, NO_INPUT);
    expect(next.phase).toBe("Playing");
    expect(next.powerUps[0]!.y).toBeCloseTo(100 + POWERUP_VY * 16);
    expect(next.powerUps[0]!.despawnTimer).toBe(8000 - 16);
  });

  it("after the last kill, a pickup already falling speeds up — fall and despawn timer alike", () => {
    const s = quietPlaying();
    const killed = {
      ...s,
      powerUps: [falling(s)],
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    };
    const kill = tick(killed, 16, NO_INPUT); // the kill's own tick is still combat
    expect(kill.phase).toBe("ClearAwaitingPickups");
    const p0 = kill.powerUps[0]!;
    const next = tick(kill, 16, NO_INPUT);
    const p1 = next.powerUps[0]!;
    expect(p1.y - p0.y).toBeCloseTo(POWERUP_VY * 16 * POST_CLEAR_PICKUP_SPEED_MULT);
    expect(p0.despawnTimer - p1.despawnTimer).toBe(16 * POST_CLEAR_PICKUP_SPEED_MULT);
  });

  it("the wait ends sooner, well inside its safety cap", () => {
    const wait = waiting();
    let s = { ...wait, powerUps: [falling(wait, POWERUP_H / 2)] };
    let ms = 0;
    while (s.phase === "ClearAwaitingPickups" && ms < 60_000) {
      s = tick(s, 16, { playerX: CANVAS_W - 20, fire: false }); // stay clear of it
      ms += 16;
    }
    const normal = powerUpDespawnMs(CANVAS_H);
    expect(ms).toBeLessThanOrEqual(Math.ceil(normal / POST_CLEAR_PICKUP_SPEED_MULT) + 32);
    expect(ms).toBeLessThan(pickupWaitMaxMs(CANVAS_H));
  });

  it.each([CANVAS_H, 480])(
    "reachable: a pickup released at the top at the last kill (canvas %i tall) reaches the ship line no sooner than the ship can cross the screen",
    (canvasH) => {
      const fallPx = canvasH - PLAYER_Y_FROM_BOTTOM - POWERUP_H / 2;
      const fallMs = fallPx / (POWERUP_VY * POST_CLEAR_PICKUP_SPEED_MULT);
      // full speed: the autopilot's brisk drag, slower than a direct drag; the web arrow keys
      // (6 px a frame, ~0.36 px/ms) are faster still
      const crossMs = CANVAS_W / PILOT_SPEED;
      expect(fallMs).toBeGreaterThanOrEqual(crossMs);
    }
  );
});

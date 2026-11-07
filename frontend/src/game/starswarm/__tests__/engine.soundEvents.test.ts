/**
 * #3526: the two one-shot sound signals the screen reads from consecutive states: a Smart Bomb
 * detonating (its blast sound replaces the generic explosion sound that tick) and an ordinary
 * power-up being collected (the shared pickup sound, banked or not).
 */
import {
  CANVAS_H,
  CANVAS_W,
  _resetIds,
  bombJustDetonated,
  initStarSwarm,
  powerUpCollected,
  seedRng,
  tick,
} from "../engine";
import type { BankablePowerUp, StarSwarmState } from "../types";
import { NO_INPUT } from "./helpers/engineFixtures";
import { onShip, parked } from "./helpers/powerUpFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

function quietPlaying(): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "LieutenantJG");
  s = { ...s, enemyFireDisabled: true, asteroidsDisabled: true, flakDisabled: true };
  while (s.phase === "SwoopIn") s = tick(s, 16, NO_INPUT);
  return { ...s, player: { ...s.player, invincibleTimer: 0 } };
}

const collect = (s: StarSwarmState, type: BankablePowerUp) =>
  tick({ ...s, powerUps: [...s.powerUps, onShip(s, type)] }, 16, NO_INPUT);

function waiting(base: StarSwarmState): StarSwarmState {
  const killed = {
    ...base,
    powerUps: [parked("salvage")],
    enemies: base.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
  };
  const s = tick(killed, 16, NO_INPUT);
  expect(s.phase).toBe("ClearAwaitingPickups");
  return s;
}

describe("bombJustDetonated", () => {
  it("is true on the tick a bomb is collected in combat, then false", () => {
    const before = quietPlaying();
    const after = collect(before, "bomb");
    expect(bombJustDetonated(before, after)).toBe(true);
    // the flash only counts down afterwards
    expect(bombJustDetonated(after, tick(after, 16, NO_INPUT))).toBe(false);
  });

  it("is false for the other power-ups and for a quiet tick", () => {
    const before = quietPlaying();
    for (const type of ["shield", "lightning", "buddy"] as const) {
      expect(bombJustDetonated(before, collect(before, type))).toBe(false);
    }
    expect(bombJustDetonated(before, tick(before, 16, NO_INPUT))).toBe(false);
  });

  it("a banked bomb is silent when banked and detonates on the next wave's first combat tick", () => {
    const banked = collect(waiting(quietPlaying()), "bomb");
    expect(banked.bankedPowerUp).toBe("bomb");
    expect(bombJustDetonated(banked, tick(banked, 16, NO_INPUT))).toBe(false);

    let s: StarSwarmState = { ...banked, powerUps: [] };
    for (let i = 0; i < 3000 && s.phase !== "SwoopIn"; i++) s = tick(s, 16, NO_INPUT);
    expect(s.bankedPowerUp).toBe("bomb");
    let detonations = 0;
    for (let i = 0; i < 3000 && s.phase === "SwoopIn"; i++) {
      const next = tick(s, 16, NO_INPUT);
      if (bombJustDetonated(s, next)) detonations++;
      s = next;
    }
    expect(s.phase).toBe("Playing");
    expect(detonations).toBe(1);
  });
});

describe("powerUpCollected", () => {
  it.each(["shield", "lightning", "buddy", "bomb"] as const)(
    "%s: reported on the tick it is collected, once",
    (type) => {
      const before = quietPlaying();
      const after = collect(before, type);
      expect(powerUpCollected(before, after)).toBe(type);
      expect(powerUpCollected(after, tick(after, 16, NO_INPUT))).toBeNull();
    }
  );

  it("a banked power-up is reported when banked, not again when it takes effect", () => {
    const wait = waiting(quietPlaying());
    const banked = collect(wait, "shield");
    expect(powerUpCollected(wait, banked)).toBe("shield");

    let s: StarSwarmState = { ...banked, powerUps: [] };
    const reported: unknown[] = [];
    for (let i = 0; i < 6000 && !(s.phase === "Playing" && s.wave === 2); i++) {
      const next = tick(s, 16, NO_INPUT);
      reported.push(powerUpCollected(s, next));
      s = next;
    }
    expect(s.activePowerUp?.type).toBe("shield");
    expect(reported.every((r) => r === null)).toBe(true);
  });

  it("salvage and plating are not ordinary power-ups", () => {
    const before = quietPlaying();
    const after = tick({ ...before, powerUps: [onShip(before, "salvage")] }, 16, NO_INPUT);
    expect(powerUpCollected(before, after)).toBeNull();
  });
});

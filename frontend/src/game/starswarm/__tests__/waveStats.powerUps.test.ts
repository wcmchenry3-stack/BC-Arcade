/**
 * #3246: the per-wave power-up lifecycle counters (`waveStats.powerUps`) — spawned by type and
 * source, then collected / missed / leftover, plus expiry, active ms and shield absorbs.
 */
import {
  CANVAS_H,
  CANVAS_W,
  POWERUP_SOURCES,
  POWERUP_TYPES,
  applyPowerUp,
  initStarSwarm,
  tick,
} from "../engine";
import { makeAsteroid } from "../engine/asteroids";
import { SAVE_FINGERPRINT, fitsSaveShape, restoreSavedState } from "../saveShape";
import type { PowerUp, StarSwarmState } from "../types";
import {
  NO_INPUT,
  advanceMs,
  clearWave,
  clearedSnapshot,
  diedSnapshot,
  shotOnShip,
  untilPlaying,
} from "./helpers/engineFixtures";
import {
  dropDue,
  expectConserved,
  lastCarrier,
  onShip,
  parked,
  pickup,
  playingWave,
  rockSalvage,
  spawnedOf,
  withCentredDrops,
} from "./helpers/powerUpFixtures";

const stats = (s: StarSwarmState) => s.waveStats.powerUps;

describe("spawned[type][source]", () => {
  it("counts a kill drop as source kill", () => {
    const s = withCentredDrops(() => tick(dropDue(playingWave()), 16, NO_INPUT));
    expect(s.powerUps).toHaveLength(1);
    const { type } = s.powerUps[0]!;
    expect(s.powerUps[0]!.source).toBe("kill");
    expect(stats(s).spawned[type].kill).toBe(1);
    expect(POWERUP_TYPES.reduce((n, t) => n + spawnedOf(stats(s).spawned, t), 0)).toBe(1);
  });

  it("counts salvage from a broken rock as source rock", () => {
    const s = rockSalvage(playingWave());
    expect(s.powerUps.find((p) => p.type === "salvage")!.source).toBe("rock");
    expect(stats(s).spawned.salvage.rock).toBeGreaterThanOrEqual(1);
    expect(stats(s).spawned.salvage.kill).toBe(0);
  });

  it("counts Carrier plating as source carrier", () => {
    // the dev bomb kills the lone Carrier, which plates however it dies
    const bombed = applyPowerUp(lastCarrier(playingWave()), "bomb");
    expect(stats(bombed).spawned.hull.carrier).toBe(1);
    expect(stats(bombed).spawned.hull.dev).toBe(0);
    expect(bombed.powerUps[0]!.source).toBe("carrier");
  });

  it("counts a dev-panel power-up as source dev, collected at once, for every type", () => {
    for (const type of POWERUP_TYPES) {
      const s = applyPowerUp(playingWave(), type);
      expect(stats(s).spawned[type].dev).toBe(1);
      expect(stats(s).collected[type]).toBe(1);
      expect(s.waveStats.dev).toBe(true);
      expectConserved(stats(s));
    }
  });

  it("knows every source the registry lists", () => {
    expect([...POWERUP_SOURCES].sort()).toEqual(["carrier", "dev", "kill", "rock"]);
  });
});

describe("collected / missed / leftover", () => {
  it("counts a pickup the ship touches as collected", () => {
    const s0 = playingWave();
    const s = tick({ ...s0, powerUps: [onShip(s0, "shield")] }, 16, NO_INPUT);
    expect(s.powerUps).toHaveLength(0);
    expect(stats(s).collected.shield).toBe(1);
    expect(stats(s).missed.shield).toBe(0);
  });

  it("counts a pickup whose despawn timer runs out as missed", () => {
    const s0 = playingWave();
    const s = tick(
      { ...s0, powerUps: [parked("bomb", "kill")].map((p) => ({ ...p, despawnTimer: 10 })) },
      16,
      NO_INPUT
    );
    expect(s.powerUps).toHaveLength(0);
    expect(stats(s).missed.bomb).toBe(1);
  });

  it("counts a pickup that falls off the bottom as missed", () => {
    const s0 = playingWave();
    const gone = pickup("buddy", "kill", 40, CANVAS_H + 40, { vy: 0.1 });
    const s = tick({ ...s0, powerUps: [gone] }, 16, NO_INPUT);
    expect(s.powerUps).toHaveLength(0);
    expect(stats(s).missed.buddy).toBe(1);
  });

  it("counts a pickup still on screen when the cleared wave closes as leftover", () => {
    const s0 = playingWave();
    const snap = clearedSnapshot({ ...s0, powerUps: [parked("lightning")] });
    expect(snap.outcome).toBe("cleared");
    expect(snap.powerUps.leftover.lightning).toBe(1);
    expect(snap.powerUps.missed.lightning).toBe(0);
  });

  it("counts a pickup still on screen when the run ends as leftover", () => {
    const s0 = playingWave();
    const snap = diedSnapshot({ ...s0, powerUps: [parked("hull", "carrier")] });
    expect(snap.outcome).toBe("died");
    expect(snap.powerUps.leftover.hull).toBe(1);
  });

  it("starts the next wave with no pickups and fresh power-up counters", () => {
    const s0 = playingWave();
    const next = clearWave({ ...s0, powerUps: [parked("lightning")] });
    expect(next.powerUps).toHaveLength(0);
    expect(stats(next).leftover.lightning).toBe(0);
    expect(stats(next).spawned.lightning.kill).toBe(0);
  });
});

describe("expired / activeMs / shieldAbsorbed", () => {
  it.each(["lightning", "shield"] as const)(
    "%s: counts the ms it was live and its expiry",
    (type) => {
      const s0 = playingWave();
      const s = advanceMs(
        { ...s0, activePowerUp: { type, remainingMs: 100, shieldAbsorbed: 0 } },
        200
      );
      expect(s.activePowerUp).toBeNull();
      expect(stats(s).activeMs[type]).toBe(100);
      expect(stats(s).expired[type]).toBe(1);
    }
  );

  it("a running buff is cut off at the wave boundary: its ms stay with the wave they happened in", () => {
    const s0 = playingWave();
    const buff = { type: "lightning" as const, remainingMs: 1e9, shieldAbsorbed: 0 };
    const snap = clearedSnapshot({ ...s0, activePowerUp: buff });
    expect(snap.powerUps.activeMs.lightning).toBeGreaterThan(0);
    expect(snap.powerUps.expired.lightning).toBe(0); // cut off, not run out
    const next = clearWave({ ...s0, activePowerUp: buff });
    expect(next.activePowerUp).toBeNull();
    expect(stats(next).activeMs.lightning).toBe(0);
  });

  it("counts the shots the shield soaks, wave by wave, and leaves the per-buff count alone", () => {
    const s0 = playingWave();
    const shielded: StarSwarmState = {
      ...s0,
      player: { ...s0.player, invincibleTimer: 0 },
      activePowerUp: { type: "shield", remainingMs: 5000, shieldAbsorbed: 0 },
      enemyBullets: [shotOnShip(s0), { ...shotOnShip(s0), id: 98_766 }],
    };
    const s = tick(shielded, 16, NO_INPUT);
    expect(stats(s).shieldAbsorbed).toBe(2);
    expect(s.activePowerUp?.shieldAbsorbed).toBe(2);
    expect(s.player.lives).toBe(s0.player.lives);
  });
});

describe("conservation: spawned = collected + missed + leftover", () => {
  /** A seeded Math.random (the engine's one unseeded call is the drop x). */
  function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it.each([1, 7, 42, 2026])(
    "holds for every type on every wave of a multi-wave run (seed %i)",
    (seed) => {
      const random = seededRandom(seed);
      const spy = jest.spyOn(Math, "random").mockImplementation(random);
      try {
        let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, seed, "Commander");
        const closed = [];
        let seen = 0;
        for (let tickNo = 0; tickNo < 9000 && closed.length < 4; tickNo++) {
          if (s.phase === "Playing") {
            if (tickNo % 40 === 0 && s.powerUps.length === 0) s = dropDue(s); // keep the pickups coming
            if (tickNo % 97 === 0)
              s = { ...s, asteroids: [...s.asteroids, ...rocksToBreak(random)] };
            if (tickNo % 400 === 399)
              s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
          }
          // chase the lowest pickup, so some are collected and some are missed
          const target = [...s.powerUps].sort((a, b) => b.y - a.y)[0];
          const input = {
            playerX: target && tickNo % 3 !== 0 ? target.x : CANVAS_W / 2,
            fire: tickNo % 5 === 0,
          };
          s = tick(s, 16, input);
          if (s.lastClosedWave && seen !== s.lastClosedWave.wave) {
            seen = s.lastClosedWave.wave;
            closed.push(s.lastClosedWave);
          }
          if (s.phase === "GameOver") break;
        }
        expect(closed.length).toBeGreaterThanOrEqual(2);
        // a last close with a pickup still in flight: the run ends on it
        // (unless the bot already died: that close is in `closed`)
        if (s.phase !== "GameOver") {
          const live = tick(dropDue(untilPlaying(s)), 16, NO_INPUT);
          expect(live.powerUps.length).toBeGreaterThan(0);
          closed.push(diedSnapshot(live));
        }
        let total = 0;
        for (const snap of closed) {
          expectConserved(snap.powerUps);
          total += POWERUP_TYPES.reduce((n, t) => n + spawnedOf(snap.powerUps.spawned, t), 0);
        }
        expect(total).toBeGreaterThan(0);
      } finally {
        spy.mockRestore();
      }
    }
  );
});

/** A broken large rock now and then, so salvage sometimes drops mid-run. */
function rocksToBreak(random: () => number) {
  return random() < 0.5 ? [{ ...makeAsteroid("large", 60, 80, 0, 0), hp: 0 }] : [];
}

describe("saves", () => {
  it("keeps the save fingerprint: a pickup's source is not part of it", () => {
    expect(SAVE_FINGERPRINT).toContain(
      '"POWER_UP":{"id":"required","type":"required","x":"required","y":"required","vy":"required","width":"required","height":"required","despawnTimer":"required"}'
    );
  });

  it("restores an older save's pickup without a source, reading it as a kill drop", () => {
    const s0 = playingWave();
    const { source: _source, ...old } = parked("bomb");
    const saved = JSON.parse(JSON.stringify({ ...s0, powerUps: [old] }));
    delete saved.waveStats;
    delete saved.lastClosedWave;
    expect(fitsSaveShape(saved)).toBe(true);
    const restored = restoreSavedState(saved);
    expect(restored.waveStats.powerUps.spawned.bomb.kill).toBe(1);
  });

  it("restores a pickup with an unknown source, reading it as a kill drop", () => {
    const s0 = playingWave();
    const saved = JSON.parse(
      JSON.stringify({ ...s0, powerUps: [{ ...parked("bomb"), source: "moon" }] })
    );
    expect(fitsSaveShape(saved)).toBe(true);
    expect(restoreSavedState(saved).powerUps[0]!.source).toBe("kill");
  });

  describe("kept stats", () => {
    /** A save with its wave stats kept and one source-less (pre-#3246) falling pickup. */
    const oldSave = (s0: StarSwarmState, over: Partial<PowerUp>) => {
      const { source: _source, ...old } = { ...parked("bomb"), ...over };
      return restoreSavedState(JSON.parse(JSON.stringify({ ...s0, powerUps: [old] })));
    };

    it("counts a source-less pickup as spawned, so it balances when collected", () => {
      const s0 = playingWave();
      const restored = oldSave(s0, onShip(s0, "shield"));
      expect(restored.waveStats.powerUps.spawned.shield.kill).toBe(1);
      const after = tick(restored, 16, NO_INPUT);
      expect(stats(after).collected.shield).toBe(1);
      expectConserved(stats(after));
    });

    it("counts a source-less pickup as spawned, so it balances when missed", () => {
      const restored = oldSave(playingWave(), { despawnTimer: 10 });
      const after = tick(restored, 16, NO_INPUT);
      expect(stats(after).missed.bomb).toBe(1);
      expectConserved(stats(after));
    });

    it("counts a source-less pickup as spawned, so it balances when left over", () => {
      const snap = diedSnapshot(oldSave(playingWave(), {}));
      expect(snap.powerUps.leftover.bomb).toBe(1);
      expectConserved(snap.powerUps);
    });

    it("does not recount a pickup that has a source", () => {
      const spawned = tick(
        withCentredDrops(() => dropDue(playingWave())),
        16,
        NO_INPUT
      );
      expect(spawned.powerUps).toHaveLength(1);
      const restored = restoreSavedState(JSON.parse(JSON.stringify(spawned)));
      expect(restored.waveStats).toEqual(spawned.waveStats);
    });
  });

  it("keeps a pickup's source across a save", () => {
    const s0 = playingWave();
    const saved = JSON.parse(JSON.stringify({ ...s0, powerUps: [parked("hull", "carrier")] }));
    expect(fitsSaveShape(saved)).toBe(true);
    expect(restoreSavedState(saved).powerUps[0]!.source).toBe("carrier");
  });
});

describe("wire integers (#3258)", () => {
  it("every numeric leaf of a closed snapshot from a fractional-dt run is an integer", () => {
    // EXPECTED TO FAIL until #3258 (closeWave rounds every numeric leaf) lands: activeMs is fractional
    let s: StarSwarmState = {
      ...playingWave(),
      activePowerUp: { type: "lightning", remainingMs: 1e9, shieldAbsorbed: 0 },
    };
    for (let i = 0; i < 41; i++) s = tick(s, 16.7, NO_INPUT);
    const snap = clearedSnapshot(s);
    const bad: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (typeof v === "number") {
        if (!Number.isInteger(v)) bad.push(`${path}=${v}`);
      } else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      }
    };
    walk(snap, "snap");
    expect(bad).toEqual([]);
  });
});

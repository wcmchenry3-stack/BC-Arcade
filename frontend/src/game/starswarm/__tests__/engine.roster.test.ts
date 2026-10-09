/**
 * Star Swarm engine tests: roster reads and the per-tick context (`engine/roster.ts`, #2988).
 *
 * `TickCtx` is derived once per tick (#2963) and must agree with the roster selectors it
 * replaces; `mapKeep` / `mapFilterKeep` must hand back the input array when nothing changed,
 * which the renderer's `sameFrame` identity gate relies on.
 */
import {
  CANVAS_H,
  CANVAS_W,
  _resetIds,
  carrierStage,
  initStarSwarm,
  isCarrierArmored,
  isLeaderTier,
  seedRng,
} from "../engine";
import { carrierStageOf, mapFilterKeep, mapKeep, tickCtx } from "../engine/roster";
import type { Enemy, StarSwarmState } from "../types";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

function killWhere(s: StarSwarmState, pred: (e: Enemy) => boolean): StarSwarmState {
  return {
    ...s,
    enemies: s.enemies.map((e) => (pred(e) ? { ...e, isAlive: false, hp: 0 } : e)),
  };
}

describe("isLeaderTier (#2484)", () => {
  it("Guardian and Carrier are leaders; Grunt and Elite are not", () => {
    expect(isLeaderTier("Guardian")).toBe(true);
    expect(isLeaderTier("Carrier")).toBe(true);
    expect(isLeaderTier("Grunt")).toBe(false);
    expect(isLeaderTier("Elite")).toBe(false);
  });
});

describe("tickCtx (#2963)", () => {
  it("tallies the starting roster: non-leaders, non-Carrier, grunts, holdouts and the Carrier's index", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H, 3);
    const ctx = tickCtx(s);
    const alive = s.enemies.filter((e) => e.isAlive);
    expect(ctx.alive.nonLeader).toBe(alive.filter((e) => !isLeaderTier(e.tier)).length);
    expect(ctx.alive.nonCarrier).toBe(alive.filter((e) => e.tier !== "Carrier").length);
    expect(ctx.alive.grunts).toBe(alive.filter((e) => e.tier === "Grunt").length);
    expect(ctx.alive.nonGrunts).toBe(alive.length - ctx.alive.grunts);
    expect(ctx.alive.holdouts).toBe(
      alive.filter((e) => e.tier !== "Carrier" && e.phase !== "Fleeing").length
    );
    expect(ctx.alive.carrierIdx).toBe(
      s.enemies.findIndex((e) => e.isAlive && e.tier === "Carrier")
    );
    expect(s.enemies[ctx.alive.carrierIdx]!.tier).toBe("Carrier");
    expect(ctx.armored).toBe(isCarrierArmored(s));
    expect(ctx.bossWave).toBe(false);
    expect(ctx.paramScale).toBeCloseTo(1.0); // LieutenantJG
  });

  it("carrierStageOf(ctx) agrees with carrierStage(state) through every stage", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 3, 42, "Captain");
    expect(carrierStageOf(tickCtx(s))).toBe("protected");
    expect(carrierStageOf(tickCtx(s))).toBe(carrierStage(s));
    s = killWhere(s, (e) => e.tier === "Guardian");
    expect(carrierStageOf(tickCtx(s))).toBe("exposed");
    expect(carrierStageOf(tickCtx(s))).toBe(carrierStage(s));
    // fleeing grunts do not hold the Carrier out of its final stand
    s = {
      ...s,
      enemies: s.enemies.map((e) => (e.tier === "Grunt" ? { ...e, phase: "Fleeing" as const } : e)),
    };
    s = killWhere(s, (e) => e.tier === "Elite");
    expect(carrierStageOf(tickCtx(s))).toBe("finalStand");
    expect(carrierStageOf(tickCtx(s))).toBe(carrierStage(s));
    s = killWhere(s, (e) => e.tier === "Carrier");
    expect(tickCtx(s).alive.carrierIdx).toBe(-1);
    expect(carrierStageOf(tickCtx(s))).toBeNull();
    expect(carrierStage(s)).toBeNull();
  });

  it("marks a boss wave", () => {
    expect(tickCtx(initStarSwarm(CANVAS_W, CANVAS_H, 5)).bossWave).toBe(true);
    expect(tickCtx(initStarSwarm(CANVAS_W, CANVAS_H, 6)).bossWave).toBe(false);
  });
});

describe("mapKeep / mapFilterKeep (#2963)", () => {
  it("mapKeep returns the input array itself when every element comes back unchanged", () => {
    const arr = [{ v: 1 }, { v: 2 }, { v: 3 }];
    expect(mapKeep(arr, (x) => x)).toBe(arr);
    expect(mapKeep([], (x) => x)).toEqual([]);
  });

  it("mapKeep copies only from the first changed element, keeping the earlier ones by identity", () => {
    const arr = [{ v: 1 }, { v: 2 }, { v: 3 }];
    const out = mapKeep(arr, (x) => (x.v === 2 ? { v: 20 } : x));
    expect(out).not.toBe(arr);
    expect(out).toEqual([{ v: 1 }, { v: 20 }, { v: 3 }]);
    expect(out[0]).toBe(arr[0]);
    expect(out[2]).toBe(arr[2]);
    expect(arr[1]).toEqual({ v: 2 }); // the input is untouched
  });

  it("mapFilterKeep returns the input when nothing changed and nothing was dropped", () => {
    const arr = [{ v: 1 }, { v: 2 }];
    expect(
      mapFilterKeep(
        arr,
        (x) => x,
        () => true
      )
    ).toBe(arr);
  });

  it("mapFilterKeep maps and filters in one pass, copying from the first change or drop", () => {
    const arr = [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }];
    const dropped = mapFilterKeep(
      arr,
      (x) => x,
      (x) => x.v !== 3
    );
    expect(dropped).toEqual([{ v: 1 }, { v: 2 }, { v: 4 }]);
    expect(dropped[0]).toBe(arr[0]);
    const mapped = mapFilterKeep(
      arr,
      (x) => ({ v: x.v * 10 }),
      (x) => x.v < 40
    );
    expect(mapped).toEqual([{ v: 10 }, { v: 20 }, { v: 30 }]);
    // the filter sees the mapped element
    expect(
      mapFilterKeep(
        arr,
        () => ({ v: 0 }),
        (x) => x.v > 0
      )
    ).toEqual([]);
  });
});

/**
 * #3392: the wave timeline captured by the engine at each trigger point
 * (docs/games/starswarm-diagnostics.md#trigger-points), the dev panel's infinite-lives revert,
 * and the guarantees around it: with `timelineOn` false nothing is captured or allocated, and
 * with it on the simulation is the same as with it off.
 */
import { CANVAS_H, CANVAS_W, HIT_CAUSES, applyPowerUp, initStarSwarm, tick } from "../engine";
import { bonusLifeThreshold } from "../engine/tuning";
import {
  NO_TIMELINE_OVERFLOW,
  TIMELINE_MAX_ENTRIES,
  TIMELINE_RUN_MAX_BYTES,
  TL,
  openTimelineRun,
  timelineT,
  timelineX,
} from "../engine/waveTimeline";
import { devRevert } from "../waveEvents";
import type { StarSwarmState } from "../types";
import {
  NO_INPUT,
  clearWave,
  killShip,
  makeBeam,
  runExtraction,
  untilPlaying,
} from "./helpers/engineFixtures";
import {
  arena,
  collide,
  enemyShot,
  lone,
  pickupOnShip,
  rock,
  shot,
} from "./helpers/waveStatsScenarios";
import { ASIDE, killWhere, preRout, quietWave, routTick } from "./helpers/carrierRoutScenarios";
import { lastCarrier } from "./helpers/powerUpFixtures";
import { seededRun } from "./helpers/timelineRuns";

/** `s` recording from here: a fresh buffer for the current wave, nothing closed yet. */
const rec = (s: StarSwarmState): StarSwarmState => ({ ...s, ...openTimelineRun(true) });

const tNow = (s: StarSwarmState) => timelineT(s.waveStats.pacing.durationMs);
const xNow = (s: StarSwarmState) => timelineX(s.player.x, s.canvasW);
const entries = (s: StarSwarmState) => s.waveTimeline!.e;
const codes = (s: StarSwarmState) => entries(s).map((e) => e[1]);
/** The entries `next` added to `prev`'s buffer. */
const added = (prev: StarSwarmState, next: StarSwarmState) =>
  entries(next).slice(entries(prev).length);

const TIMELINE_KEYS = [
  "waveTimeline",
  "timelineOn",
  "timelineLost",
  "closedTimelines",
  "closedTimelinesLens",
  "closedTimelinesBytes",
  "closedTimelinesOverflow",
] as const;

/** `s` without its timeline fields: the simulation proper. */
function played(s: StarSwarmState): Record<string, unknown> {
  const out: Record<string, unknown> = { ...s };
  for (const k of TIMELINE_KEYS) delete out[k];
  return out;
}

describe("capture at each trigger point", () => {
  it("1 HULL_HIT: plating took the hit, at the ship's column, hullAfter", () => {
    const s = rec(arena());
    const prev = {
      ...s,
      player: { ...s.player, hull: 2 as const },
      enemyBullets: [enemyShot(s.player.x, s.player.y)],
    };
    const next = tick(prev, 16, NO_INPUT);
    expect(added(prev, next)).toEqual([[tNow(next), TL.HULL_HIT, 0, xNow(next), 1]]);
  });

  it("2 LIFE_LOST: a life went, livesAfter; each cause's index", () => {
    for (const cause of ["bullet", "rock", "beam"] as const) {
      const s = rec(arena());
      const { x, y } = s.player;
      const hazard =
        cause === "bullet"
          ? { enemyBullets: [enemyShot(x, y)] }
          : cause === "rock"
            ? { asteroids: [rock("small", x, y)] }
            : { carrierBeams: [makeBeam(x, y)] };
      const next = tick({ ...s, ...hazard }, 16, NO_INPUT);
      expect(added(s, next)).toEqual([
        [tNow(next), TL.LIFE_LOST, HIT_CAUSES.indexOf(cause), xNow(next), 2],
      ]);
    }
  });

  it("2 LIFE_LOST by a ram (cause 3), and several hazards in one tick make one entry", () => {
    const base = rec(arena());
    const { state } = lone(base, "Grunt", { phase: "Diving", x: base.player.x, y: base.player.y });
    // the collision pass alone (a hand-placed diver has no path for the enemy tick to fly)
    const rammed = collide(state);
    expect(added(state, rammed)).toEqual([
      [tNow(state), TL.LIFE_LOST, 3, timelineX(state.player.x, state.canvasW), 2],
    ]);

    const { x, y } = base.player;
    const both = { ...base, enemyBullets: [enemyShot(x, y)], asteroids: [rock("small", x, y)] };
    const next = tick(both, 16, NO_INPUT);
    // one plate or one life a tick, charged to one cause (rock over bullet)
    expect(added(both, next)).toEqual([[tNow(next), TL.LIFE_LOST, 1, xNow(next), 2]]);
  });

  it("2 + 9: the lethal blow then RUN_LOST with the death cause, at the same t", () => {
    const prev = rec(arena());
    const over = killShip(prev);
    expect(over.phase).toBe("GameOver");
    const t = tNow(over);
    expect(added(prev, over)).toEqual([
      [t, TL.LIFE_LOST, 0, xNow(over), 0],
      [t, TL.RUN_LOST, 0],
    ]);
    expect(over.waveStats.damage.deathCause).toBe("bullet");
    // the run's died timeline is kept, with the wave's identity and the snapshot's terminal t
    const kept = over.closedTimelines.at(-1)!;
    // (the arena's dev toggles make it a dev wave)
    expect(kept).toMatchObject({ v: 1, ev: 1, wave: 1, outcome: "died", dev: true });
    expect(kept.dev).toBe(over.lastClosedWave!.dev);
    expect(kept.e).toEqual(entries(over));
    expect(t).toBe(Math.floor(over.lastClosedWave!.pacing.durationMs / 100));
    expect(over.closedTimelinesBytes).toBe(JSON.stringify(kept).length);
  });

  it("3 BONUS_LIFE: a same-tick rescue reads LIFE_LOST 0 then BONUS_LIFE, and no RUN_LOST", () => {
    const { state, ship } = lone(rec(arena()), "Grunt", { hp: 1 });
    const s: StarSwarmState = {
      ...state,
      score: bonusLifeThreshold(state.difficulty) - 1,
      bonusLivesAwarded: 0,
      player: { ...state.player, lives: 1 },
      playerBullets: [shot(ship.x, ship.y)],
      enemyBullets: [enemyShot(state.player.x, state.player.y)],
    };
    const out = tick(s, 16, NO_INPUT);
    expect(out.phase).not.toBe("GameOver");
    const t = tNow(out);
    const got = added(s, out);
    expect(got.slice(0, 2)).toEqual([
      [t, TL.LIFE_LOST, 0, xNow(out), 0],
      [t, TL.BONUS_LIFE, 1, 1],
    ]);
    expect(got.some((e) => e[1] === TL.RUN_LOST)).toBe(false);
    expect(out.closedTimelines).toEqual([]);
  });

  it("4 PLATING_UP and 20 PICKUP: collected pickups; salvage records nothing", () => {
    for (const [type, entry] of [
      ["hull", [TL.PLATING_UP, 1]],
      ["shield", [TL.PICKUP, 1]],
      ["lightning", [TL.PICKUP, 0]],
      ["buddy", [TL.PICKUP, 2]],
      ["salvage", null],
    ] as const) {
      const s = rec(arena());
      const prev = { ...s, powerUps: [pickupOnShip(s, type)] };
      const next = tick(prev, 16, NO_INPUT);
      expect(next.waveStats.powerUps.collected[type]).toBe(1);
      expect(added(prev, next)).toEqual(entry ? [[tNow(next), ...entry]] : []);
    }
  });

  it("4 then 1 in one tick: a plate collected the same tick is spent on the hit (pickup first)", () => {
    const s = rec(arena());
    const prev = {
      ...s,
      powerUps: [pickupOnShip(s, "hull")],
      enemyBullets: [enemyShot(s.player.x, s.player.y)],
    };
    const next = tick(prev, 16, NO_INPUT);
    const t = tNow(next);
    expect(added(prev, next)).toEqual([
      [t, TL.PLATING_UP, 1],
      [t, TL.HULL_HIT, 0, xNow(next), 0],
    ]);
  });

  it("20 then 12 then 10: a bomb's PICKUP, the Carrier it kills, and the wave's clear", () => {
    const s = lastCarrier(rec(arena()));
    const prev = { ...s, powerUps: [pickupOnShip(s, "bomb")] };
    const next = tick(prev, 16, NO_INPUT);
    const t = tNow(next);
    // the lone Carrier's final stand begins in the enemy tick, before the collision pass; it
    // drops plating, so the clear waits for it
    expect(added(prev, next)).toEqual([
      [t, TL.CARRIER_STAGE, 2],
      [t, TL.PICKUP, 3],
      [t, TL.CARRIER_DOWN, 3],
      [t, TL.PHASE, 2],
    ]);
  });

  it("12 CARRIER_DOWN by a player shot (method shot)", () => {
    const { state, ship } = lone(rec(arena()), "Carrier", { hp: 1 });
    const prev = { ...state, playerBullets: [shot(ship.x, ship.y)] };
    const next = tick(prev, 16, NO_INPUT);
    expect(added(prev, next).slice(0, 2)).toEqual([
      [tNow(next), TL.CARRIER_STAGE, 2],
      [tNow(next), TL.CARRIER_DOWN, 0],
    ]);
  });

  it("21 BUFF_END: a timed buff ran out; a buff replaced by a pickup is not one", () => {
    const s = rec(arena());
    const prev = {
      ...s,
      activePowerUp: { type: "shield" as const, remainingMs: 10, shieldAbsorbed: 0 },
    };
    const next = tick(prev, 16, NO_INPUT);
    expect(next.activePowerUp).toBeNull();
    expect(added(prev, next)).toEqual([[tNow(next), TL.BUFF_END, 1]]);

    const shielded = { ...prev, activePowerUp: { ...prev.activePowerUp, remainingMs: 5000 } };
    const swapped = tick({ ...shielded, powerUps: [pickupOnShip(s, "lightning")] }, 16, NO_INPUT);
    expect(swapped.activePowerUp?.type).toBe("lightning");
    expect(added(shielded, swapped)).toEqual([[tNow(swapped), TL.PICKUP, 0]]);
  });

  it("11 CARRIER_STAGE: exposed then final stand, once each, at the snapshot's own times", () => {
    let s = rec(quietWave(1));
    const park = (x: StarSwarmState): StarSwarmState => ({
      ...x,
      enemies: x.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
    });
    s = tick(park(s), 160, ASIDE);
    s = tick(park(killWhere(s, (e) => e.tier === "Guardian")), 160, ASIDE);
    s = tick(park(s), 160, ASIDE); // stays exposed: no second entry
    s = tick(park(killWhere(s, (e) => e.tier !== "Carrier")), 160, ASIDE);
    const stages = entries(s).filter((e) => e[1] === TL.CARRIER_STAGE);
    const reached = s.waveStats.carrier.stageReachedMs;
    expect(stages).toEqual([
      [timelineT(reached.exposed!), TL.CARRIER_STAGE, 1],
      [timelineT(reached.finalStand!), TL.CARRIER_STAGE, 2],
    ]);
  });

  it("11 CARRIER_STAGE: a boss wave's Carrier records only the final stand", () => {
    const s = rec(untilPlaying(initStarSwarm(CANVAS_W, CANVAS_H, 5, 42, "Ensign")));
    const quiet = { ...s, enemyFireDisabled: true, nextDiveTimer: 1e9, asteroidsDisabled: true };
    const next = tick(
      killWhere(quiet, (e) => e.tier !== "Carrier"),
      16,
      ASIDE
    );
    expect(entries(next).filter((e) => e[1] === TL.CARRIER_STAGE)).toEqual([
      [tNow(next), TL.CARRIER_STAGE, 2],
    ]);
  });

  it("13 ROUT: the rout latches once, at rout.atMs", () => {
    const prev = rec(preRout());
    let s = routTick(prev);
    for (let i = 0; i < 20; i++) s = routTick(s);
    const routs = entries(s).filter((e) => e[1] === TL.ROUT);
    expect(routs).toEqual([[timelineT(s.waveStats.rout.atMs!), TL.ROUT]]);
  });

  it("10 PHASE and 8 WAVE_CLEARED: swoop-in over, the clear, the extraction, the terminal entry", () => {
    const opened = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander", undefined, undefined, {
      timelineOn: true,
    });
    expect(opened.waveTimeline!.e).toEqual([]);
    const playing = untilPlaying(opened);
    expect(entries(playing)).toEqual([[tNow(playing), TL.PHASE, 1]]);
    // a plate lost, so the cleared wave is kept (D1-C)
    const hurt = tick(
      {
        ...playing,
        player: { ...playing.player, hull: 1 },
        enemyBullets: [enemyShot(playing.player.x, playing.player.y)],
      },
      16,
      NO_INPUT
    );
    const next = clearWave(hurt);
    expect(next.wave).toBe(2);
    const kept = next.closedTimelines[0]!;
    expect(kept).toMatchObject({ wave: 1, outcome: "cleared" });
    expect(kept.e.map((e) => e[1])).toEqual([TL.PHASE, TL.HULL_HIT, TL.PHASE, TL.WAVE_CLEARED]);
    expect(kept.e[2]![2]).toBe(3); // nothing on screen: straight to the extraction
    expect(kept.e.at(-1)![0]).toBe(Math.floor(next.lastClosedWave!.pacing.durationMs / 100));
    // the next wave opens a fresh buffer
    expect(next.waveTimeline!.e).toEqual([]);
  });

  it("10 PHASE: the pickup wait handing back from the extraction records each change", () => {
    const s = lastCarrier(rec(arena()));
    // the Carrier dies to a shot and drops plating: the wait begins
    const { state, ship } = lone(s, "Carrier", { hp: 1 });
    let w = tick({ ...state, playerBullets: [shot(ship.x, ship.y)] }, 16, ASIDE);
    expect(w.phase).toBe("ClearAwaitingPickups");
    // collect it: the extraction begins
    w = tick({ ...w, powerUps: [pickupOnShip(w, "hull")] }, 16, ASIDE);
    expect(w.phase).toBe("Extraction");
    // a salvage crate appears while the ship is on station: back to the wait
    w = tick(
      { ...w, powerUps: [{ ...pickupOnShip(w, "salvage"), x: 40, y: 60, vy: 0 }] },
      16,
      ASIDE
    );
    expect(w.phase).toBe("ClearAwaitingPickups");
    expect(
      entries(w)
        .filter((e) => e[1] === TL.PHASE)
        .map((e) => e[2])
    ).toEqual([2, 3, 2]);
  });

  it("dev panel: applyPowerUp records like a collected pickup (bomb before its Carrier kill)", () => {
    const s = rec(arena());
    expect(added(s, applyPowerUp(s, "shield"))).toEqual([[tNow(s), TL.PICKUP, 1]]);
    expect(added(s, applyPowerUp(s, "hull"))).toEqual([[tNow(s), TL.PLATING_UP, 1]]);
    expect(added(s, applyPowerUp(s, "buddy"))).toEqual([[tNow(s), TL.PICKUP, 2]]);
    expect(added(s, applyPowerUp(s, "salvage"))).toEqual([]);
    const c = lastCarrier(s);
    expect(added(c, applyPowerUp(c, "bomb"))).toEqual([
      [tNow(c), TL.PICKUP, 3],
      [tNow(c), TL.CARRIER_DOWN, 3],
    ]);
  });
});

describe("devRevert (the dev panel's infinite lives) and the timeline", () => {
  /** What the canvas does on a lost life with infinite lives on. */
  const revert = (prev: StarSwarmState, next: StarSwarmState) =>
    devRevert(prev, {
      ...next,
      phase: next.phase === "GameOver" ? prev.phase : next.phase,
      player: { ...next.player, lives: prev.player.lives, invincibleTimer: 2000 },
    });

  const expectBytesExact = (s: StarSwarmState) => {
    s.closedTimelines.forEach((tl, i) =>
      expect(s.closedTimelinesLens[i]).toBe(JSON.stringify(tl).length)
    );
    expect(s.closedTimelinesBytes).toBe(
      s.closedTimelines.reduce((n, tl) => n + JSON.stringify(tl).length, 0)
    );
    expect(s.waveTimeline!.eBytes).toBe(JSON.stringify(s.waveTimeline!.e).length);
  };

  it("pops the trailing RUN_LOST and flags the closed timeline dev", () => {
    // not the arena: its dev toggles would flag the wave dev already
    const prev = rec(untilPlaying(initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander")));
    const over = killShip(prev);
    expect(over.closedTimelines[0]!.dev).toBe(false);
    const back = revert({ ...prev, player: { ...prev.player, lives: 1 } }, over);
    expect(back.phase).toBe("Playing");
    expect(codes(back)).toEqual([TL.LIFE_LOST]);
    expect(back.waveTimeline!.term).toBe(false);
    expect(back.closedTimelines).toHaveLength(1);
    expect(back.closedTimelines[0]!.dev).toBe(true);
    expect(back.closedTimelines[0]!.e.at(-1)![1]).toBe(TL.RUN_LOST); // the died snapshot keeps it
    expect(back.closedTimelinesBytes).toBe(over.closedTimelinesBytes - 1);
    expectBytesExact(back);
  });

  it("repeated lethal hits in one wave keep one died timeline, the latest that fits", () => {
    let s = { ...rec(arena()), player: { ...arena().player, lives: 1 } };
    const HITS = 60;
    for (let i = 0; i < HITS; i++) {
      const prev = { ...s, player: { ...s.player, invincibleTimer: 0 } };
      s = revert(prev, killShip(prev));
      expectBytesExact(s);
      expect(s.closedTimelines).toHaveLength(1);
      expect(s.closedTimelinesBytes).toBeLessThanOrEqual(TIMELINE_RUN_MAX_BYTES);
      s = tick(s, 16, NO_INPUT);
    }
    expect(s.closedTimelinesOverflow).toEqual({ ...NO_TIMELINE_OVERFLOW, devRepeats: HITS - 1 });
    // the damage slots filled and the refusals show it
    expect(s.waveTimeline!.e.length).toBeLessThanOrEqual(TIMELINE_MAX_ENTRIES - 1);
    expect(s.waveTimeline!.ovf[0]).toBeGreaterThan(0);
    // infinite lives off: the real death is the timeline kept
    const prev = { ...s, player: { ...s.player, invincibleTimer: 0 } };
    const dead = killShip(prev);
    expect(dead.phase).toBe("GameOver");
    const kept = dead.closedTimelines[0]!;
    expect(kept.e.at(-1)![0]).toBe(Math.floor(dead.lastClosedWave!.pacing.durationMs / 100));
    expect(kept.e.at(-1)![1]).toBe(TL.RUN_LOST);
    expect(kept.dev).toBe(true); // the wave was touched by the dev panel
    expect(dead.closedTimelinesOverflow.devRepeats).toBe(HITS);
    expect(dead.closedTimelinesOverflow.waves).toBe(0);
  });
});

describe("seeded runs", () => {
  it("timelineOn false: no buffer, nothing closed, nothing counted — the fields never change", () => {
    const run = seededRun("Commander", false);
    const first = run.states[0]!;
    expect(run.closed.length).toBeGreaterThan(1);
    const changed = run.states.filter(
      (s) =>
        s.waveTimeline !== null ||
        s.timelineOn ||
        s.timelineLost ||
        s.closedTimelines !== first.closedTimelines ||
        s.closedTimelinesLens !== first.closedTimelinesLens ||
        s.closedTimelinesBytes !== 0 ||
        s.closedTimelinesOverflow !== NO_TIMELINE_OVERFLOW
    );
    expect(changed).toEqual([]);
    expect(run.end.phase).toBe("GameOver"); // the died close ran too
    expect(first.closedTimelines).toEqual([]);
  });

  it("the simulation is identical with the timeline on and off", () => {
    const off = seededRun("Commander", false);
    const on = seededRun("Commander", true);
    expect(on.counters).toEqual(off.counters);
    expect(on.states).toHaveLength(off.states.length);
    on.states.forEach((s, i) => {
      if (i % 25 === 0 || i === on.states.length - 1)
        expect(played(s)).toEqual(played(off.states[i]!));
    });
    expect(on.closed).toEqual(off.closed);
    expect(on.end.closedTimelines.length).toBeGreaterThan(0);
  });

  it("a tick with no transition hands back the same waveTimeline object", () => {
    const run = seededRun("Commander", true);
    let same = 0;
    for (let i = 1; i < run.states.length; i++) {
      const a = run.states[i - 1]!;
      const b = run.states[i]!;
      if (a.wave !== b.wave || a.waveTimeline === b.waveTimeline) {
        same += a.waveTimeline === b.waveTimeline ? 1 : 0;
        continue;
      }
      // a new buffer only for an admitted entry or a refusal
      const grew = b.waveTimeline!.e.length > a.waveTimeline!.e.length;
      const refused = b.waveTimeline!.ovf.some((n, k) => n !== a.waveTimeline!.ovf[k]);
      expect(grew || refused).toBe(true);
    }
    expect(same).toBeGreaterThan(run.states.length * 0.9);
  });

  it("an extraction close after the dev wave jump flags the timeline dev", () => {
    const opened = initStarSwarm(CANVAS_W, CANVAS_H, 3, 42, "Ensign", undefined, undefined, {
      timelineOn: true,
    });
    const playing = untilPlaying(opened);
    const hurt = tick(
      {
        ...playing,
        player: { ...playing.player, hull: 1 },
        enemyBullets: [enemyShot(playing.player.x, playing.player.y)],
      },
      16,
      NO_INPUT
    );
    const next = runExtraction(
      tick(
        { ...hurt, enemies: hurt.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) },
        16,
        NO_INPUT
      )
    );
    expect(next.closedTimelines[0]).toMatchObject({ wave: 3, outcome: "cleared", dev: true });
  });
});

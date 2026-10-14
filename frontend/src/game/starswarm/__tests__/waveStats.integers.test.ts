/**
 * Every number in a closed wave snapshot, and in its wire payload, is an integer (#3249 review):
 * the real frame loop's dt is fractional, and the backend takes `StrictInt`.
 */
import { closeWave, tick, toWirePayload, waveJustClosed } from "../engine";
import type { WaveStatsSnapshot } from "../engine";
import { preRout, quietWave } from "./helpers/carrierRoutScenarios";

/** Every numeric leaf of `v` that isn't an integer, as "path=value". */
function nonIntegers(v: unknown, at = ""): string[] {
  if (typeof v === "number") return Number.isInteger(v) ? [] : [`${at}=${v}`];
  if (v === null || typeof v !== "object") return [];
  return Object.entries(v).flatMap(([k, x]) => nonIntegers(x, `${at}.${k}`));
}

describe("integers on the wire", () => {
  it("closeWave rounds fractional stage times, rout atMs and duration", () => {
    const s = quietWave(1);
    const w = s.waveStats;
    const snap = closeWave(
      {
        ...s,
        waveStats: {
          ...w,
          pacing: { ...w.pacing, durationMs: 1234.567 },
          carrier: {
            ...w.carrier,
            stageReachedMs: { protected: 10.4, exposed: 20.5, finalStand: null },
          },
          rout: { ...w.rout, triggered: true, atMs: 99.9 },
        },
      },
      "cleared"
    );
    expect(nonIntegers(snap)).toEqual([]);
    expect(snap.pacing.durationMs).toBe(1235);
    expect(snap.carrier.stageReachedMs).toEqual({ protected: 10, exposed: 21, finalStand: null });
    expect(snap.rout.atMs).toBe(100);
    expect(nonIntegers(toWirePayload(snap))).toEqual([]);
  });

  it("a seeded run with fractional dt closes Carrier and routed waves with integers only", () => {
    const DT = 16.6667;
    const input = { playerX: 40, fire: false };
    const closed: WaveStatsSnapshot[] = [];
    // a Carrier wave: escorts down (exposed), then everything down so it clears
    const c = quietWave(1);
    const exposed = tick(
      {
        ...c,
        enemies: c.enemies.map((e) =>
          e.tier === "Guardian" ? { ...e, isAlive: false, hp: 0 } : e
        ),
      },
      DT,
      input
    );
    const carrierWave = {
      ...exposed,
      enemies: exposed.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    };
    // a routed wave
    const routed = tick(preRout(), DT, input);
    expect(routed.waveStats.rout.triggered).toBe(true);
    for (const from of [carrierWave, routed]) {
      let state = from;
      for (let i = 0; i < 3000 && state.wave === from.wave; i++) {
        const prev = state;
        state = tick(prev, DT, input);
        const snap = waveJustClosed(prev, state);
        if (snap) closed.push(snap);
      }
    }
    expect(closed).toHaveLength(2);
    expect(closed[0]!.carrier.stageReachedMs.protected).not.toBeNull();
    expect(closed[1]!.rout.atMs).not.toBeNull();
    for (const snap of closed) {
      expect(nonIntegers(snap)).toEqual([]);
      expect(nonIntegers(toWirePayload(snap))).toEqual([]);
    }
  });
});

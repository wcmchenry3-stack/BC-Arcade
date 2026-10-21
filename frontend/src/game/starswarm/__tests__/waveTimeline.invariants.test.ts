/**
 * #3392: the wave timeline over seeded multi-wave runs at every difficulty: every kept timeline
 * is well formed and its bytes are exact, it is kept exactly when the retention rule (D1-C) says,
 * and it agrees with its `wave_completed` (the reader's reconciliation checks, frontend side).
 * See docs/games/starswarm-diagnostics.md#reader-and-reconciliation-3395.
 */
import { DIFFICULTY_TIERS, HIT_CAUSES, POWERUP_TYPES } from "../engine";
import {
  TIMELINE_CODES,
  TIMELINE_MAX_ENTRIES,
  TIMELINE_POWERUP_MAX,
  TIMELINE_RUN_MAX_WAVES,
  TIMELINE_TRANSITION_MAX,
  TL,
  timelineT,
  type TimelineCode,
  type WaveTimelineWire,
} from "../engine/waveTimeline";
import type { DifficultyTier } from "../types";
import { seededRun } from "./helpers/timelineRuns";

describe.each(DIFFICULTY_TIERS.map((d) => [d]))("invariants at %s", (difficulty) => {
  const run = seededRun(difficulty as DifficultyTier, true);
  const end = run.end;
  const byKey = new Map<string, WaveTimelineWire>();
  for (const tl of end.closedTimelines) byKey.set(`${tl.wave}:${tl.outcome}`, tl);

  it("every kept timeline is well formed, and its bytes are exact", () => {
    expect(end.closedTimelines.length).toBeLessThanOrEqual(TIMELINE_RUN_MAX_WAVES);
    end.closedTimelines.forEach((tl, i) => {
      expect(end.closedTimelinesLens[i]).toBe(JSON.stringify(tl).length);
      expect(tl.e.length).toBeLessThanOrEqual(TIMELINE_MAX_ENTRIES);
      const cls = tl.e.map((e) => TIMELINE_CODES[e[1] as TimelineCode].cls);
      expect(cls.filter((c) => c === "P").length).toBeLessThanOrEqual(TIMELINE_POWERUP_MAX);
      expect(cls.filter((c) => c === "C").length).toBeLessThanOrEqual(TIMELINE_TRANSITION_MAX);
      expect(cls.filter((c) => c === "T")).toEqual(["T"]);
      expect(cls.at(-1)).toBe("T");
      expect(tl.e.at(-1)![1]).toBe(tl.outcome === "cleared" ? TL.WAVE_CLEARED : TL.RUN_LOST);
      for (let k = 0; k < tl.e.length; k++) {
        const e = tl.e[k]!;
        expect(e).toHaveLength(TIMELINE_CODES[e[1] as TimelineCode].arity);
        for (const n of e) expect(Number.isInteger(n) && n >= 0 && n <= 65_535).toBe(true);
        if (k > 0) expect(e[0]).toBeGreaterThanOrEqual(tl.e[k - 1]![0]!);
        // no two identical consecutive entries (the triggers fire on transitions)
        if (k > 0) expect(e).not.toEqual(tl.e[k - 1]);
      }
    });
    expect(end.closedTimelinesBytes).toBe(
      end.closedTimelines.reduce((n, tl) => n + JSON.stringify(tl).length, 0)
    );
  });

  it("kept exactly when D1-C says, and each agrees with its wave_completed", () => {
    let clean = 0;
    for (const snap of run.closed) {
      const hits = HIT_CAUSES.reduce(
        (n, c) => n + snap.damage.hits[c].plating + snap.damage.hits[c].life,
        0
      );
      const tl = byKey.get(`${snap.wave}:${snap.outcome}`);
      if (snap.outcome === "cleared" && hits === 0) {
        clean++;
        expect(tl).toBeUndefined();
        continue;
      }
      expect(tl).toBeDefined();
      const e = tl!.e;
      const count = (code: number, p?: number) =>
        e.filter((x) => x[1] === code && (p === undefined || x[2] === p)).length;
      expect(tl!.dev).toBe(snap.dev);
      expect(e.at(-1)![0]).toBe(Math.min(65_535, Math.floor(snap.pacing.durationMs / 100)));
      if (snap.outcome === "died") {
        expect(e.at(-1)![2]).toBe(HIT_CAUSES.indexOf(snap.damage.deathCause!));
        const lastHit = [...e].reverse().find((x) => x[1] === TL.LIFE_LOST);
        expect(lastHit![4]).toBe(0);
      }
      if (tl!.ovf[0] === 0) {
        HIT_CAUSES.forEach((c, i) => {
          expect(count(TL.HULL_HIT, i)).toBe(snap.damage.hits[c].plating);
          expect(count(TL.LIFE_LOST, i)).toBe(snap.damage.hits[c].life);
        });
        expect(count(TL.PLATING_UP)).toBe(snap.powerUps.collected.hull);
        expect(e.filter((x) => x[1] === TL.BONUS_LIFE).reduce((n, x) => n + x[2]!, 0)).toBe(
          snap.pacing.bonusLives
        );
      }
      if (tl!.ovf[2] === 0) {
        for (const type of ["lightning", "shield", "buddy", "bomb"] as const)
          expect(count(TL.PICKUP, POWERUP_TYPES.indexOf(type))).toBe(snap.powerUps.collected[type]);
        for (const type of ["lightning", "shield"] as const)
          expect(count(TL.BUFF_END, POWERUP_TYPES.indexOf(type))).toBe(snap.powerUps.expired[type]);
      }
      if (tl!.ovf[1] === 0) {
        const reached = snap.carrier.stageReachedMs;
        for (const [stage, i] of [
          ["exposed", 1],
          ["finalStand", 2],
        ] as const) {
          const st = e.filter((x) => x[1] === TL.CARRIER_STAGE && x[2] === i);
          expect(st).toEqual(
            reached[stage] === null ? [] : [[timelineT(reached[stage]!), TL.CARRIER_STAGE, i]]
          );
        }
        const rout = e.filter((x) => x[1] === TL.ROUT);
        expect(rout).toEqual(snap.rout.atMs === null ? [] : [[timelineT(snap.rout.atMs), TL.ROUT]]);
        const carrierKills = Object.values(snap.combat.kills.Carrier).reduce((a, b) => a + b, 0);
        expect(count(TL.CARRIER_DOWN)).toBe(carrierKills);
      }
    }
    expect(end.closedTimelinesOverflow).toMatchObject({ waves: 0, full: false, clean });
  });
});

it("the runs reach damaged cleared waves and deaths (the invariants don't pass on nothing)", () => {
  const run = seededRun("Commander", true);
  console.log(run.states.length, run.closed.length, run.end.phase);
  expect(run.end.closedTimelines.some((t) => t.outcome === "cleared")).toBe(true);
  const all = run.end.closedTimelines.flatMap((t) => t.e.map((e) => e[1]));
  for (const code of [TL.PHASE, TL.HULL_HIT, TL.LIFE_LOST, TL.WAVE_CLEARED, TL.CARRIER_STAGE]) {
    expect(all).toContain(code);
  }
});

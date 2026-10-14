/**
 * Wave-stats contract rows: `score` (#3245) — read from the score ledger (#2837) at close, never
 * counted twice. See ./contract.ts.
 */
import { CANVAS_H, CANVAS_W, initStarSwarm, tick } from "../../engine";
import type { Bullet, StarSwarmState } from "../../types";
import { NO_INPUT, clearWave, diedSnapshot, untilPlaying } from "../helpers/engineFixtures";
import { field, type ContractRow, type SectionContract } from "./contract";

const run = () => initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander");

/** One tick in which a player shot kills the first live Grunt in formation. */
function shootGrunt(state: StarSwarmState): StarSwarmState {
  const grunt = state.enemies.find((e) => e.isAlive && e.tier === "Grunt");
  if (!grunt) throw new Error("no live grunt");
  const shot: Bullet = {
    id: 27_182,
    x: grunt.x,
    y: grunt.y,
    vx: 0,
    vy: 0,
    owner: "player",
    width: grunt.width,
    height: grunt.height,
    damage: 10,
  };
  return tick({ ...state, playerBullets: [shot] }, 16, NO_INPUT);
}

/** Wave 1 cleared (a shot kill + the clear bonus), then wave 2 scores a kill and the run ends. */
function scoreRow(): ContractRow {
  let wave1Score = 0;
  let ledgerPts: Readonly<Record<string, number>> = {};
  let finalScore = 0;
  return {
    id: "pts is the wave's own ledger entry, total its sum, runningTotal the run's score",
    covers: [field("score", "pts"), field("score", "total"), field("score", "runningTotal")],
    scenario: () => {
      const wave2 = clearWave(shootGrunt(untilPlaying(run())));
      wave1Score = wave2.score;
      const scored = shootGrunt(untilPlaying(wave2));
      ledgerPts = scored.scoreLedger.waves.find((w) => w.wave === 2)?.pts ?? {};
      const snap = diedSnapshot(scored);
      finalScore = snap.score.runningTotal;
      return snap;
    },
    expect: (snap) => {
      expect(snap.wave).toBe(2);
      expect(snap.score.pts).toEqual(ledgerPts);
      expect(Object.keys(snap.score.pts)).toEqual(["Grunt"]); // wave 1's points aren't here
      expect(snap.score.total).toBe(snap.score.pts.Grunt);
      expect(snap.score.total).toBeGreaterThan(0);
      expect(finalScore).toBe(wave1Score + snap.score.total);
    },
  };
}

export const contract: SectionContract<"score"> = {
  section: "score",
  pending: null,
  rows: [scoreRow()],
};

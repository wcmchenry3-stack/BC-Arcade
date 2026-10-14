/**
 * Wave-stats contract rows: `pacing` (#3245). See ./contract.ts.
 */
import { CANVAS_H, CANVAS_W, initStarSwarm, tick } from "../../engine";
import type { Bullet, StarSwarmState } from "../../types";
import {
  NO_INPUT,
  advanceMs,
  clearWave,
  clearedSnapshot,
  diedSnapshot,
  untilPlaying,
} from "../helpers/engineFixtures";
import { field, type ContractRow, type SectionContract } from "./contract";

const run = (difficulty: StarSwarmState["difficulty"] = "Commander") =>
  initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, difficulty);

/** Wave 1 ticked from its first frame to its close in mixed steps, with the steps' dt summed. */
function durationRow(): ContractRow {
  let tickedMs = 0;
  return {
    id: "durationMs is the sum of every tick's dt, swoop-in through extraction",
    covers: [field("pacing", "durationMs")],
    scenario: () => {
      let s = run();
      for (let i = 0; i < 5000 && s.wave === 1; i++) {
        const dt = i % 3 === 0 ? 33 : 16;
        s = tick(s, dt, NO_INPUT);
        tickedMs += dt;
        // once combat is live, end the fight so the wave clears and extracts
        if (s.phase === "Playing" && s.enemies.some((e) => e.isAlive)) {
          s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
        }
      }
      if (!s.lastClosedWave || s.wave !== 2) throw new Error("wave 1 didn't close");
      return s.lastClosedWave;
    },
    expect: (snap) => {
      expect(snap.outcome).toBe("cleared");
      expect(snap.pacing.durationMs).toBe(tickedMs);
    },
  };
}

export const contract: SectionContract<"pacing"> = {
  section: "pacing",
  pending: null,
  rows: [
    durationRow(),
    {
      id: "start is the loadout the wave opened with, end the one it closed with",
      covers: [field("pacing", "start"), field("pacing", "end")],
      scenario: () => {
        // wave 1 ends with guns 3 and hull 2, so wave 2 opens with them; then the run ends on it
        const s = untilPlaying(run());
        const wave2 = clearWave({ ...s, player: { ...s.player, guns: 3, hull: 2 } });
        return diedSnapshot(untilPlaying(wave2));
      },
      expect: (snap) => {
        expect(snap.wave).toBe(2);
        expect(snap.outcome).toBe("died");
        expect(snap.pacing.start).toEqual({ lives: 3, guns: 3, hull: 2 });
        expect(snap.pacing.end.lives).toBe(0);
        expect(snap.pacing.end.hull).toBe(0);
      },
    },
    {
      id: "bonusLives counts the bonus lives granted on the wave",
      covers: [field("pacing", "bonusLives")],
      scenario: () => {
        let s = advanceMs(run("Ensign"), 8000);
        s = { ...s, score: 29_999 }; // the next kill crosses Ensign's first bonus-life threshold
        const enemy = s.enemies.find((e) => e.isAlive);
        if (!enemy) throw new Error("no live enemy");
        const kill: Bullet = {
          id: 31_337,
          x: enemy.x,
          y: enemy.y,
          vx: 0,
          vy: 0,
          owner: "player",
          width: enemy.width,
          height: enemy.height,
          damage: 10,
        };
        return clearedSnapshot(tick({ ...s, playerBullets: [kill] }, 16, NO_INPUT));
      },
      expect: (snap) => {
        expect(snap.pacing.bonusLives).toBe(1);
        expect(snap.outcome).toBe("cleared");
      },
    },
  ],
};

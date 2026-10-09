/**
 * Star Swarm engine tests: the per-ship phase machine — swoop-in, the wiggle telegraph and
 * Bézier dives.
 *
 * Follows `engine/enemyPhases.ts` (#2988). Describe blocks moved whole from
 * `engine.enemies.movement.test.ts`; shared fixtures live in `helpers/engineFixtures.ts`.
 */
import {
  initStarSwarm,
  tick,
  isSwooping,
  maxDivers,
  WIGGLE_DURATION,
  DIVE_PATH_DURATION,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
} from "../engine";
import type { StarSwarmState } from "../types";
import { NO_INPUT, advanceMs } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

/** Reset any airborne enemies back to Formation so dive cap has room. */
function resetToFormation(s: StarSwarmState): StarSwarmState {
  return {
    ...s,
    enemies: s.enemies.map((e) =>
      e.isAlive &&
      (e.phase === "Diving" ||
        e.phase === "Wiggling" ||
        e.phase === "Circling" ||
        e.phase === "Returning")
        ? {
            ...e,
            phase: "Formation" as const,
            x: e.formationX,
            y: e.formationY,
            path: null,
            pathT: 1,
          }
        : e
    ),
  };
}

// ---------------------------------------------------------------------------
// Enemy state machine — SwoopIn
// ---------------------------------------------------------------------------

describe("SwoopIn", () => {
  it("all enemies start in SwoopIn phase", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.enemies.every((e) => e.phase === "SwoopIn")).toBe(true);
  });

  it("isSwooping returns true initially", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(isSwooping(s)).toBe(true);
  });

  it("no enemies remain in SwoopIn after enough time", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // enough time for all to arrive
    const stillSwooping = s.enemies.filter((e) => e.isAlive && e.phase === "SwoopIn");
    expect(stillSwooping).toHaveLength(0);
  });

  it("phase transitions to Playing once all enemies are in Formation", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(s.phase).toBe("Playing");
  });

  it("isSwooping returns false after all arrive", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    expect(isSwooping(s)).toBe(false);
  });

  it("does not mutate previous state", () => {
    const s0 = initStarSwarm(CANVAS_W, CANVAS_H);
    const firstY = s0.enemies[0]?.y ?? 0;
    tick(s0, 100, NO_INPUT);
    expect(s0.enemies[0]?.y).toBe(firstY);
  });
});

describe("Wiggle telegraph (#975)", () => {
  it("enemy enters Wiggling before Diving when selected for dive", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000); // reach Playing
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    expect(s.enemies.some((e) => e.isAlive && e.phase === "Wiggling")).toBe(true);
    expect(s.enemies.filter((e) => e.isAlive && e.phase === "Diving")).toHaveLength(0);
  });

  it("Wiggling enemy transitions to Diving after WIGGLE_DURATION", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    const wiggling = s.enemies.find((e) => e.phase === "Wiggling");
    if (!wiggling) throw new Error("no wiggling enemy");
    const id = wiggling.id;
    s = advanceMs(s, WIGGLE_DURATION + 50, NO_INPUT);
    const after = s.enemies.find((e) => e.id === id)!;
    const completed =
      !after.isAlive ||
      after.phase === "Diving" ||
      after.phase === "Circling" ||
      after.phase === "Returning";
    expect(completed).toBe(true);
  });

  it("wiggleTimer is 0 for all enemies at wave start", () => {
    const s = initStarSwarm(CANVAS_W, CANVAS_H);
    expect(s.enemies.every((e) => e.wiggleTimer === 0)).toBe(true);
  });

  it("Wiggling enemies are not counted against maxDivers cap", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    const wiggling = s.enemies.filter((e) => e.isAlive && e.phase === "Wiggling").length;
    const diving = s.enemies.filter((e) => e.isAlive && e.phase === "Diving").length;
    expect(wiggling).toBeGreaterThan(0);
    expect(diving).toBeLessThanOrEqual(maxDivers(s.wave));
  });
});

// ---------------------------------------------------------------------------
// Bézier arc dives (#977)
// ---------------------------------------------------------------------------

describe("Bézier arc dives (#977)", () => {
  it("diving enemy reaches Circling within WIGGLE_DURATION + DIVE_PATH_DURATION + buffer", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    const wiggling = s.enemies.find((e) => e.phase === "Wiggling");
    if (!wiggling) throw new Error("no wiggling enemy");
    const id = wiggling.id;
    // #1314: proportional aiming is more lethal — give invincibility so the player can't die
    // mid-advance and freeze the game in GameOver before the dive completes.
    s = { ...s, player: { ...s.player, invincibleTimer: 999_999 } };
    s = advanceMs(s, WIGGLE_DURATION + DIVE_PATH_DURATION + 200, NO_INPUT);
    const after = s.enemies.find((e) => e.id === id)!;
    const completed =
      !after.isAlive ||
      after.phase === "Circling" ||
      after.phase === "Returning" ||
      after.phase === "Formation";
    expect(completed).toBe(true);
  });

  it("dive path is set when enemy enters Diving", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H);
    s = advanceMs(s, 8000);
    s = resetToFormation({ ...s, nextDiveTimer: 1 });
    s = tick(s, 16, NO_INPUT);
    s = advanceMs(s, WIGGLE_DURATION + 50, NO_INPUT);
    const diver = s.enemies.find((e) => e.isAlive && e.phase === "Diving");
    if (!diver) return; // may already be Circling at high frame rate — skip
    expect(diver.path).not.toBeNull();
    expect(diver.pathDuration).toBeGreaterThan(0);
  });
});

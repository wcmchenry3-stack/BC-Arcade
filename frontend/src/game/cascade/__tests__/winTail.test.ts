/**
 * After the win (#3920): the screen keeps stepping until the capstone has grown in, then stops
 * (`winTail.ts`). Driven here with the real engine, frame by frame, the way the screen's loop is.
 */
import { CascadeEngine } from "../engine";
import { FLOOR_THICKNESS, GROW_IN_STEPS, WORLD_HEIGHT } from "../constants";
import { CAPSTONE_TIER, tierRadius } from "../tiers";
import { WIN_SETTLE_MS, WIN_TAIL_MAX_FRAMES, createLoopGate, createWinTail } from "../winTail";

const FLOOR_TOP = WORLD_HEIGHT - FLOOR_THICKNESS;

/** Two tier-9 pieces touching on the floor: they merge into the capstone on the first step. */
function aboutToWin(): CascadeEngine {
  const r = tierRadius(CAPSTONE_TIER - 1);
  const engine = new CascadeEngine({});
  engine.restore(
    [
      { tier: CAPSTONE_TIER - 1, x: 200 - r + 0.5, y: FLOOR_TOP - r },
      { tier: CAPSTONE_TIER - 1, x: 200 + r - 0.5, y: FLOOR_TOP - r },
    ],
    0
  );
  return engine;
}

/** Runs the screen's loop rule; returns the frames run after the win's frame, and the board. */
function playOut(frameMs: number) {
  const engine = aboutToWin();
  const tail = createWinTail();
  let after = -1;
  for (let frame = 0; frame < 1000; frame++) {
    const won = engine.step(frameMs).events.some((e) => e.type === "win");
    if (won) after = 0;
    const state = engine.getState();
    if (!engine.hasWon()) continue;
    if (!won) after++;
    // The screen: schedule the next frame only while the tail says so.
    if (!tail.advance(frameMs, state.pieces)) return { after, state, tail };
  }
  throw new Error("the loop never stopped");
}

describe("the win tail (#3920)", () => {
  it.each([
    [60, 1000 / 60],
    [120, 1000 / 120],
  ])("at %i Hz, runs on until the capstone has grown in, then stops", (_hz, frameMs) => {
    const { after, state, tail } = playOut(frameMs);
    // The capstone is full size, and nothing else is growing in.
    const capstone = state.pieces.find((p) => p.tier === CAPSTONE_TIER)!;
    expect(capstone.scale ?? 1).toBe(1);
    expect(state.pieces.every((p) => (p.scale ?? 1) === 1)).toBe(true);
    // About GROW_IN_STEPS fixed steps of frames, plus the short settle, and no more.
    const growFrames = Math.round((GROW_IN_STEPS * (1000 / 60)) / frameMs);
    const settleFrames = Math.ceil(WIN_SETTLE_MS / frameMs);
    expect(after).toBeGreaterThanOrEqual(growFrames - 1);
    expect(after).toBeLessThanOrEqual(growFrames + settleFrames + 2);
    // Once ended it stays ended: a resume must not start the loop again.
    expect(tail.done).toBe(true);
    expect(tail.advance(frameMs, [{ scale: 0.5 }])).toBe(false);
  });

  it("always ends, even if a piece never finished growing", () => {
    const tail = createWinTail();
    let frames = 0;
    while (tail.advance(1000 / 60, [{ scale: 0.9 }])) frames++;
    expect(frames + 1).toBe(WIN_TAIL_MAX_FRAMES);
    expect(tail.done).toBe(true);
  });

  it("counts the settle only once nothing is growing in", () => {
    const tail = createWinTail();
    for (let i = 0; i < 50; i++) expect(tail.advance(50, [{ scale: 0.95 }])).toBe(true);
    expect(tail.advance(WIN_SETTLE_MS - 1, [{ scale: 1 }])).toBe(true);
    expect(tail.advance(1, [{}])).toBe(false);
  });
});

describe("the screen's loop gate (#3920)", () => {
  it("runs until game over before the win, and through the win tail after it", () => {
    let won = false;
    let over = false;
    const gate = createLoopGate({ hasWon: () => won }, () => over);
    expect(gate.runs()).toBe(true);
    expect(gate.afterFrame(16, [])).toBe(true);
    // The win: the screen also marks the game over, but the tail decides.
    won = true;
    over = true;
    expect(gate.runs()).toBe(true);
    expect(gate.afterFrame(16, [{ scale: 0.8 }])).toBe(true);
    let frames = 0;
    while (gate.afterFrame(16, [{ scale: 1 }])) frames++;
    expect(frames).toBeLessThan(10);
    expect(gate.runs()).toBe(false);
    expect(gate.afterFrame(16, [{ scale: 0.5 }])).toBe(false);
  });

  it("stops at game over when there was no win", () => {
    let over = false;
    const gate = createLoopGate({ hasWon: () => false }, () => over);
    over = true;
    expect(gate.afterFrame(16, [])).toBe(false);
    expect(gate.runs()).toBe(false);
  });
});

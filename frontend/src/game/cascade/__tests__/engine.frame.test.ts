/**
 * #2960: the engine's per-frame read allocates nothing, and the post-physics pass skips bodies
 * that stay asleep without changing the simulation.
 */
import * as Matter from "matter-js";
import { CascadeEngine } from "../engine";
import { createGameState } from "../render/frame";

function settle(engine: CascadeEngine, frames: number) {
  for (let i = 0; i < frames; i++) engine.step(16.67);
}

describe("getState(into)", () => {
  it("writes the same board as getState() into the caller's object and reuses it", () => {
    const engine = new CascadeEngine();
    engine.drop(0, 120);
    engine.drop(2, 260);
    settle(engine, 30);
    const into = createGameState();
    const out = engine.getState(into);
    expect(out).toBe(into);
    expect(out).toEqual(engine.getState());

    const pieces = out.pieces;
    const first = pieces[0];
    settle(engine, 5);
    const again = engine.getState(into);
    expect(again.pieces).toBe(pieces); // same array
    expect(again.pieces[0]).toBe(first); // same snapshot objects
    expect(again).toEqual(engine.getState());
    engine.destroy();
  });

  it("shrinks the reused array when pieces go away", () => {
    const engine = new CascadeEngine();
    engine.drop(0, 100);
    engine.drop(3, 300);
    settle(engine, 5);
    const into = engine.getState(createGameState());
    expect(into.pieces.length).toBe(2);
    engine.restore([{ tier: 4, x: 200, y: 500 }], 16);
    engine.getState(into);
    expect(into.pieces.length).toBe(1);
    expect(into.pieces[0]!.tier).toBe(4);
    expect(into.score).toBe(16);
    engine.destroy();
  });
});

describe("sleeping bodies in the post-physics pass", () => {
  it("are not touched once they have been checked asleep, and are again once awake", () => {
    const spy = jest.spyOn(Matter.Body, "setAngularVelocity");
    const engine = new CascadeEngine();
    engine.drop(0, 120);
    // Long enough for the piece to land and fall asleep.
    settle(engine, 400);
    expect(engine.getState().pieces[0]!.isSleeping).toBe(true);
    spy.mockClear();
    settle(engine, 60);
    expect(spy).not.toHaveBeenCalled();

    // A drop onto it wakes it: the pass runs on it again.
    engine.drop(1, 120);
    settle(engine, 60);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    engine.destroy();
  });
});

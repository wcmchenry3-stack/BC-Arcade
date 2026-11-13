/**
 * The demo set-ups (#3719): each restores a pile into the real engine, so what follows is the
 * live rules. Nothing here forces a game over.
 */
import { CascadeEngine, type EngineEvent } from "../engine";
import { OVERFLOW_LINE_Y, OVERFLOW_TICKS_THRESHOLD } from "../constants";
import { tierRadius } from "../tiers";
import { cascadeSetup, type CascadeSetupId } from "../testHooks";

const STEP = 1000 / 60;

function load(id: CascadeSetupId): { engine: CascadeEngine; events: EngineEvent[] } {
  const setup = cascadeSetup(id);
  const engine = new CascadeEngine({});
  engine.restore(setup.pieces, 0);
  const events: EngineEvent[] = [];
  for (let t = 0; t < setup.settleMs; t += STEP) events.push(...engine.step(STEP).events);
  return { engine, events };
}

function run(engine: CascadeEngine, seconds: number): EngineEvent[] {
  const out: EngineEvent[] = [];
  for (let t = 0; t < seconds * 1000 && !engine.getState().gameOver; t += STEP) {
    out.push(...engine.step(STEP).events);
  }
  return out;
}

describe("cascadeSetup('chain')", () => {
  it("scripts a queue of cherries and settles with no merge yet", () => {
    const setup = cascadeSetup("chain");
    expect(setup.queue?.slice(0, 2)).toEqual([0, 0]);
    const { engine, events } = load("chain");
    expect(events.filter((e) => e.type === "merge")).toHaveLength(0);
    expect(engine.getState().score).toBe(0);
    expect(engine.getState().pieces.map((p) => p.tier)).toEqual([1, 2, 3]);
  });

  it.each([197, 198, 199, 200, 201, 202, 203])(
    "two cherries dropped at x=%d chain 3 merges (14 points)",
    (x) => {
      const { engine } = load("chain");
      engine.drop(0, x);
      run(engine, 1.5);
      engine.drop(0, x);
      const merges = run(engine, 4).filter((e) => e.type === "merge");
      expect(merges).toHaveLength(3);
      expect(engine.getState().score).toBe(2 + 4 + 8);
      expect(engine.getState().gameOver).toBe(false);
    }
  );
});

describe("cascadeSetup('nearLid')", () => {
  it("leaves the clock ring draining, not yet game over, with a pile over the lid", () => {
    const { engine } = load("nearLid");
    const state = engine.getState();
    expect(state.gameOver).toBe(false);
    expect(state.dangerRatio).toBeGreaterThan(0.1);
    expect(state.dangerRatio).toBeLessThan(0.3);
    expect(Math.min(...state.pieces.map((p) => p.y))).toBeLessThan(OVERFLOW_LINE_Y + 100);
  });

  it("the lid then ends the game, within seconds, by the overflow rule", () => {
    const { engine } = load("nearLid");
    const over = run(engine, 6).find((e) => e.type === "gameOver");
    expect(over).toEqual({ type: "gameOver", reason: "overflow" });
  });
});

describe("cascadeSetup('fillBin')", () => {
  it("fills the bin above the lid with no merges", () => {
    const { engine, events } = load("fillBin");
    expect(events).toHaveLength(0);
    const tops = engine.getState().pieces.map((p) => p.y - tierRadius(p.tier));
    expect(Math.min(...tops)).toBeLessThan(OVERFLOW_LINE_Y);
    expect(engine.getState().gameOver).toBe(false);
  });

  it("the lid rule (not a forced game over) ends the game within 6 seconds", () => {
    const { engine } = load("fillBin");
    const events = run(engine, 6);
    const over = events.find((e) => e.type === "gameOver");
    expect(over).toBeDefined();
    expect(events.filter((e) => e.type === "merge")).toHaveLength(0);
    expect(engine.getState().gameOver).toBe(true);
    // Sanity: the count is a real count (3 s of it at least, from the grace).
    expect(OVERFLOW_TICKS_THRESHOLD * STEP).toBeGreaterThan(2000);
  });
});

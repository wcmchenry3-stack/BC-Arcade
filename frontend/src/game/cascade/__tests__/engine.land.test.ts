/**
 * #3701: the engine's `land` event — a falling piece's first contact, emitted after the step.
 * Events only: the physics is unchanged (the sim smoke baseline, `sim/__tests__`, is the check).
 */
import { CascadeEngine, type EngineEvent } from "../engine";
import { tierRadius } from "../tiers";

type Land = Extract<EngineEvent, { type: "land" }>;
const HZ60 = 1000 / 60;

function run(engine: CascadeEngine, steps: number): EngineEvent[] {
  const out: EngineEvent[] = [];
  for (let i = 0; i < steps; i++) out.push(...engine.step(HZ60).events);
  return out;
}
const lands = (events: EngineEvent[]) => events.filter((e): e is Land => e.type === "land");

describe("land event", () => {
  it("a dropped piece lands on the floor once, with its tier, id and speed", () => {
    const engine = new CascadeEngine({ seed: 1, bench: { noDropNudge: true } });
    engine.drop(2, 200);
    const id = engine.getState().pieces[0]!.id;
    const events = run(engine, 120);
    const l = lands(events);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ type: "land", id, tier: 2 });
    expect(l[0]!.speed).toBeGreaterThan(5);
    expect(l[0]!.y).toBeGreaterThan(580 - tierRadius(2) * 2);
    engine.destroy();
  });

  it("a piece landing on another lands once; the one below does not", () => {
    const engine = new CascadeEngine({ seed: 1, bench: { noDropNudge: true } });
    engine.restore([{ tier: 5, x: 200, y: 580 - tierRadius(5) - 1 }], 0);
    run(engine, 30);
    engine.drop(1, 200);
    const l = lands(run(engine, 120));
    expect(l.map((e) => e.tier)).toEqual([1]);
    engine.destroy();
  });

  it("restored pieces at rest emit no landing", () => {
    const engine = new CascadeEngine({ seed: 1 });
    engine.restore(
      [
        { tier: 3, x: 100, y: 580 - tierRadius(3) - 1 },
        { tier: 4, x: 300, y: 580 - tierRadius(4) - 1 },
      ],
      0
    );
    expect(lands(run(engine, 60))).toEqual([]);
    engine.destroy();
  });

  it("comes before the merge it may cause, in the same step", () => {
    const engine = new CascadeEngine({ seed: 1, bench: { noDropNudge: true } });
    engine.restore([{ tier: 1, x: 200, y: 580 - tierRadius(1) - 1 }], 0);
    run(engine, 10);
    engine.drop(1, 200);
    const events = run(engine, 120);
    const li = events.findIndex((e) => e.type === "land");
    const mi = events.findIndex((e) => e.type === "merge");
    expect(li).toBeGreaterThanOrEqual(0);
    expect(mi).toBeGreaterThan(li);
    engine.destroy();
  });

  it("adds no other event: the same drops make the same merges and score", () => {
    const play = () => {
      const engine = new CascadeEngine({ seed: 9 });
      const out: EngineEvent[] = [];
      for (const x of [120, 125, 260, 255, 200, 205]) {
        engine.drop(0, x);
        out.push(...run(engine, 45));
      }
      const state = engine.getState();
      engine.destroy();
      return { out, state };
    };
    const a = play();
    const b = play();
    expect(a.out.filter((e) => e.type !== "land")).toEqual(b.out.filter((e) => e.type !== "land"));
    expect(a.state.pieces.map((p) => [p.x, p.y])).toEqual(b.state.pieces.map((p) => [p.x, p.y]));
    expect(lands(a.out).length).toBeGreaterThanOrEqual(1);
  });

  // Review S3: a saved piece restored over the lid, touching nothing, is falling again (#3694).
  it("a restored piece still in the air lands once when it comes down", () => {
    const engine = new CascadeEngine({ seed: 1 });
    engine.restore(
      [
        { tier: 4, x: 100, y: 580 - tierRadius(4) - 1 },
        { tier: 2, x: 300, y: 40 },
      ],
      0
    );
    const ids = engine.getState().pieces.map((p) => p.id);
    const l = lands(run(engine, 120));
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ tier: 2, id: ids[1] });
    engine.destroy();
  });

  it("a piece that touches a wall first still lands once, on the floor", () => {
    const engine = new CascadeEngine({ seed: 1, bench: { noDropNudge: true } });
    engine.drop(3, 0); // clamped against the left wall: it slides down the wall
    const l = lands(run(engine, 150));
    expect(l).toHaveLength(1);
    expect(l[0]!.tier).toBe(3);
    expect(l[0]!.y).toBeGreaterThan(580 - tierRadius(3) * 2);
    engine.destroy();
  });
});

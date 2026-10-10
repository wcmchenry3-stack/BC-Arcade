import { initStarfield, layerOffset, starLayers, starY, tickStarfield } from "../starfield";

describe("initStarfield", () => {
  it("produces the expected total star count (50 + 30 + 15 = 95)", () => {
    const state = initStarfield(400, 800);
    expect(state.stars).toHaveLength(95);
  });

  it("all stars start within canvas bounds", () => {
    const state = initStarfield(400, 800);
    for (const s of state.stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(400);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(800);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = initStarfield(400, 800, 1);
    const b = initStarfield(400, 800, 1);
    expect(a.stars[0]).toEqual(b.stars[0]);
    expect(a.stars[94]).toEqual(b.stars[94]);
  });

  it("produces different layouts for different seeds", () => {
    const a = initStarfield(400, 800, 1);
    const b = initStarfield(400, 800, 2);
    expect(a.stars[0].x).not.toBeCloseTo(b.stars[0].x, 3);
  });

  it("stores width and height on state", () => {
    const state = initStarfield(320, 640);
    expect(state.width).toBe(320);
    expect(state.height).toBe(640);
  });
});

describe("tickStarfield", () => {
  it("advances only the scroll clock — the star layout is shared, not copied (#2963)", () => {
    const state = initStarfield(400, 800, 7);
    const next = tickStarfield(state, 100);
    expect(next).not.toBe(state); // a new identity tells the frame gate the stars moved
    expect(next.elapsedMs).toBe(100);
    expect(next.stars).toBe(state.stars);
    expect(tickStarfield(next, 16).elapsedMs).toBe(116);
  });

  it("scrolls stars downward by speed * dt", () => {
    const state = initStarfield(400, 800, 7);
    const first = state.stars[0];
    const next = tickStarfield(state, 100);
    expect(starY(first, next)).toBeCloseTo(first.y + first.speed * 100);
  });

  it("wraps stars that scroll past the bottom back to the top", () => {
    const state = initStarfield(400, 100, 7);
    // A star just above the bottom edge.
    const patched = {
      ...state,
      stars: [{ ...state.stars[0], y: 99, speed: 0.1 }, ...state.stars.slice(1)],
    };
    const next = tickStarfield(patched, 100); // moves +10px → y=109, wraps to 9
    expect(starY(next.stars[0], next)).toBeCloseTo(9, 1);
  });

  it("matches the old per-star scroll-and-wrap, frame after frame", () => {
    const sf0 = initStarfield(400, 300, 3);
    let sf = sf0;
    let ys = sf0.stars.map((s) => s.y);
    for (let f = 0; f < 2000; f++) {
      const dt = f % 7 === 6 ? 33 : 16;
      sf = tickStarfield(sf, dt);
      ys = ys.map((y, i) => {
        const n = y + sf0.stars[i].speed * dt;
        return n > sf0.height ? n - sf0.height : n;
      });
    }
    sf.stars.forEach((s, i) => expect(starY(s, sf)).toBeCloseTo(ys[i], 6));
  });

  it("does not mutate the original state", () => {
    const state = initStarfield(400, 800, 7);
    const originalY = state.stars[0].y;
    tickStarfield(state, 1000);
    expect(state.stars[0].y).toBe(originalY);
    expect(state.elapsedMs).toBe(0);
  });
});

describe("layerOffset / starLayers (#2963)", () => {
  it("a layer's offset is its scroll distance wrapped to [0, height)", () => {
    expect(layerOffset(0, 0.1, 800)).toBe(0);
    expect(layerOffset(100, 0.1, 800)).toBeCloseTo(10);
    expect(layerOffset(9000, 0.1, 800)).toBeCloseTo(100);
    expect(layerOffset(500, 0.1, 0)).toBe(0); // no canvas yet
  });

  it("groups the stars into the three depth layers, far first, in draw order", () => {
    const sf = initStarfield(400, 800);
    const layers = starLayers(sf);
    expect(layers.map((l) => l.speed)).toEqual([0.02, 0.05, 0.1]);
    expect(layers.map((l) => l.stars.length)).toEqual([50, 30, 15]);
    expect(layers.flatMap((l) => l.stars)).toEqual(sf.stars);
  });
});

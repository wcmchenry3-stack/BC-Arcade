import { calculateCascadeLayout, tapToWorldX } from "../layout";
import { WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH } from "../constants";

describe("calculateCascadeLayout (#3693)", () => {
  it("is all zero scale before the area is measured", () => {
    expect(calculateCascadeLayout({ containerWidth: 0, containerHeight: 0 }).scale).toBe(0);
    expect(calculateCascadeLayout({ containerWidth: 300, containerHeight: 0 }).scale).toBe(0);
    expect(calculateCascadeLayout({ containerWidth: 0, containerHeight: 500 }).scale).toBe(0);
  });

  it("small phone: height-limited, the board centred", () => {
    // 320 x 380 area: 320/400 = 0.8, 380/600 = 0.6333 -> height wins
    const l = calculateCascadeLayout({ containerWidth: 320, containerHeight: 380 });
    expect(l.scale).toBeCloseTo(380 / WORLD_HEIGHT, 10);
    expect(l.boardHeight).toBeCloseTo(380, 6);
    expect(l.boardWidth).toBeCloseTo(WORLD_WIDTH * (380 / WORLD_HEIGHT), 6);
    expect(l.offsetX).toBeCloseTo((320 - l.boardWidth) / 2, 6);
    expect(l.offsetX).toBeGreaterThan(0);
    expect(l.offsetY).toBeCloseTo(0, 6); // height-limited: no spare height
  });

  it("large phone: width-limited, flush to the sides", () => {
    // 430 x 800 area: 430/400 = 1.075, 800/600 = 1.333 -> width wins
    const l = calculateCascadeLayout({ containerWidth: 430, containerHeight: 800 });
    expect(l.scale).toBeCloseTo(1.075, 10);
    expect(l.boardWidth).toBeCloseTo(430, 6);
    expect(l.boardHeight).toBeCloseTo(600 * 1.075, 6);
    expect(l.offsetX).toBeCloseTo(0, 6);
    // bottom-anchored: the spare height (800 - 645) is above the bin, none below the floor
    expect(l.offsetY).toBeCloseTo(800 - 600 * 1.075, 6);
    expect(l.offsetY + l.boardHeight).toBeCloseTo(800, 6);
  });

  it("bottom-anchors the world: the board's bottom is the area's bottom", () => {
    for (const [w, h] of [
      [320, 380],
      [390, 520],
      [430, 800],
      [768, 1100],
    ]) {
      const l = calculateCascadeLayout({ containerWidth: w, containerHeight: h });
      expect(l.offsetY).toBeCloseTo(h - WORLD_HEIGHT * l.scale, 9);
      expect(l.offsetY + l.boardHeight).toBeCloseTo(h, 9);
      expect(l.offsetY).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("is zero offset before the area is measured", () => {
    const l = calculateCascadeLayout({ containerWidth: 0, containerHeight: 0 });
    expect(l.offsetY).toBe(0);
  });

  it("always fits the whole world", () => {
    for (const [w, h] of [
      [320, 380],
      [390, 520],
      [430, 800],
      [768, 900],
    ]) {
      const l = calculateCascadeLayout({ containerWidth: w, containerHeight: h });
      expect(l.boardWidth).toBeLessThanOrEqual(w + 1e-9);
      expect(l.boardHeight).toBeLessThanOrEqual(h + 1e-9);
    }
  });
});

describe("tapToWorldX", () => {
  it("converts px to world units", () => {
    expect(tapToWorldX(100, 0.5)).toBe(200);
  });
  it("clamps between the walls", () => {
    expect(tapToWorldX(0, 1)).toBe(WALL_THICKNESS);
    expect(tapToWorldX(10_000, 1)).toBe(WORLD_WIDTH - WALL_THICKNESS);
  });
});

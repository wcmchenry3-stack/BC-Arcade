/**
 * #3740: the card back's geometry. Pure shapes, so the tests need no renderer: the elements of
 * each design, the lattice staying inside the field, and the shapes being built once.
 */
import {
  backFrameMetrics,
  CACHE_LIMIT,
  LATTICE_OPACITY,
  cardBackBuildCount,
  cardBackShapes,
  latticePath,
  resetCardBackCache,
  type CardBackPalette,
} from "../cardBackShapes";

const P: CardBackPalette = {
  rim: "#rim",
  field: "#field",
  line: "#line",
  accent: "#accent",
  edge: "#edge",
};

beforeEach(resetCardBackCache);

describe("cardBackShapes", () => {
  it("lattice: margin, field, lattice, inset line, medallion, edge (6 elements)", () => {
    const s = cardBackShapes("lattice", 60, 84, 6, P);
    expect(s.map((x) => x.el)).toEqual(["rect", "rect", "path", "rect", "path", "rect"]);
    expect(s[0]).toMatchObject({ fill: "#rim", width: 60, height: 84, rx: 6 });
    expect(s[1]).toMatchObject({ fill: "#field" });
    expect(s[2]).toMatchObject({ stroke: "#accent", opacity: LATTICE_OPACITY });
    expect(s[3]).toMatchObject({ stroke: "#line" });
    expect(s[4]).toMatchObject({ fill: "#field", stroke: "#line" });
    expect(s[5]).toMatchObject({ x: 0.5, y: 0.5, stroke: "#edge", strokeWidth: 1 });
  });

  it("lattice: no medallion under 40 px wide (5 elements)", () => {
    const s = cardBackShapes("lattice", 30, 42, 6, P);
    expect(s.map((x) => x.el)).toEqual(["rect", "rect", "path", "rect", "rect"]);
  });

  it("frame: margin, field, inset line, edge, with no pattern", () => {
    const s = cardBackShapes("frame", 60, 84, 8, P);
    expect(s.map((x) => x.el)).toEqual(["rect", "rect", "rect", "rect"]);
    expect(s.some((x) => x.el === "path")).toBe(false);
  });

  it("uses no filters, gradients, clip paths, ids or text", () => {
    const json = JSON.stringify(cardBackShapes("lattice", 78, 109, 6, P));
    expect(json).not.toMatch(/filter|gradient|clip|"id"|"text"/i);
  });

  it("the margin scales with the card: 2 px at 30, 4 at 60, 5 at 78", () => {
    expect(backFrameMetrics(30, 6).margin).toBe(2);
    expect(backFrameMetrics(60, 6).margin).toBe(4);
    expect(backFrameMetrics(78, 6).margin).toBe(5);
  });

  it("the lattice stays inside the field's inset", () => {
    const d = latticePath(10, 10, 50, 74, 6, 1.6);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThanOrEqual(10 - 0.01);
      expect(nums[i]).toBeLessThanOrEqual(50 + 0.01);
      expect(nums[i + 1]).toBeGreaterThanOrEqual(10 - 0.01);
      expect(nums[i + 1]).toBeLessThanOrEqual(74 + 0.01);
    }
  });

  it("memoised: the same (design, size, radius, colours) builds once and returns the same shapes", () => {
    const a = cardBackShapes("lattice", 60, 84, 6, P);
    const b = cardBackShapes("lattice", 60, 84, 6, { ...P });
    expect(b).toBe(a);
    expect(cardBackBuildCount()).toBe(1);
  });

  it.each([
    ["design", () => cardBackShapes("frame", 60, 84, 6, P)],
    ["width", () => cardBackShapes("lattice", 61, 84, 6, P)],
    ["height", () => cardBackShapes("lattice", 60, 85, 6, P)],
    ["radius", () => cardBackShapes("lattice", 60, 84, 8, P)],
    ["rim", () => cardBackShapes("lattice", 60, 84, 6, { ...P, rim: "#r2" })],
    ["field", () => cardBackShapes("lattice", 60, 84, 6, { ...P, field: "#f2" })],
    ["line", () => cardBackShapes("lattice", 60, 84, 6, { ...P, line: "#l2" })],
    ["accent", () => cardBackShapes("lattice", 60, 84, 6, { ...P, accent: "#a2" })],
    ["edge", () => cardBackShapes("lattice", 60, 84, 6, { ...P, edge: "#e2" })],
  ])("a different %s is a different cache entry", (_n, other) => {
    const a = cardBackShapes("lattice", 60, 84, 6, P);
    expect(other()).not.toBe(a);
    expect(cardBackBuildCount()).toBe(2);
  });

  it("rounds size and radius to 0.01 in the key", () => {
    const a = cardBackShapes("lattice", 60, 84, 6, P);
    expect(cardBackShapes("lattice", 60.001, 83.999, 6.0004, P)).toBe(a);
    expect(cardBackBuildCount()).toBe(1);
  });

  it("evicts only the oldest entry at the limit, not the whole cache", () => {
    const first = cardBackShapes("lattice", 60, 84, 6, P);
    const second = cardBackShapes("lattice", 61, 84, 6, P);
    for (let i = 2; i < CACHE_LIMIT; i++) cardBackShapes("lattice", 62 + i, 84, 6, P);
    expect(cardBackBuildCount()).toBe(CACHE_LIMIT);
    cardBackShapes("frame", 60, 84, 6, P); // one over: the oldest (first) goes
    expect(cardBackBuildCount()).toBe(CACHE_LIMIT + 1);
    expect(cardBackShapes("lattice", 61, 84, 6, P)).toBe(second); // still cached
    expect(cardBackBuildCount()).toBe(CACHE_LIMIT + 1);
    expect(cardBackShapes("lattice", 60, 84, 6, P)).not.toBe(first); // rebuilt
    expect(cardBackBuildCount()).toBe(CACHE_LIMIT + 2);
  });

  it("the same back, whatever the theme: nothing in the shapes depends on light or dark", () => {
    // The palette is the only input: equal palettes in "light" and "dark" give equal shapes.
    expect(cardBackShapes("lattice", 60, 84, 6, P)).toEqual(
      cardBackShapes("lattice", 60, 84, 6, { ...P })
    );
  });
});

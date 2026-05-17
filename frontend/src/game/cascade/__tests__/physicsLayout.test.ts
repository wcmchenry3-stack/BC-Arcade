import {
  PACKING_HEIGHT_FACTOR,
  calculateBinDimensions,
  calculateMergeCentroid,
  calculateScalingIndex,
  packingTheoremClearance,
} from "../physicsLayout";

describe("PACKING_HEIGHT_FACTOR", () => {
  it("equals 2 + sqrt(3)", () => {
    expect(PACKING_HEIGHT_FACTOR).toBeCloseTo(2 + Math.sqrt(3), 10);
  });
});

describe("calculateBinDimensions", () => {
  it("returns expected dimensions for maxRadius=20", () => {
    const { width, height, wallThickness } = calculateBinDimensions(20);
    // wallThickness = max(4, round(20 * 0.4)) = 8
    expect(wallThickness).toBe(8);
    // innerWidth = round(20 * 2 * 4) = 160; width = 160 + 16 = 176
    expect(width).toBe(176);
    // height = round(176 * 1.75) = 308
    expect(height).toBe(308);
  });

  it("wallThickness is at least 4 for very small maxRadius", () => {
    const { wallThickness } = calculateBinDimensions(1);
    expect(wallThickness).toBeGreaterThanOrEqual(4);
  });

  it("width and height scale proportionally with maxRadius", () => {
    const small = calculateBinDimensions(10);
    const large = calculateBinDimensions(20);
    // Doubling maxRadius should roughly double width (rounding may cause slight differences)
    expect(large.width / small.width).toBeCloseTo(2, 0);
    expect(large.height / small.height).toBeCloseTo(2, 0);
  });

  it("height is always greater than width (tall bin)", () => {
    const { width, height } = calculateBinDimensions(50);
    expect(height).toBeGreaterThan(width);
  });
});

describe("calculateMergeCentroid", () => {
  it("equal masses → exact midpoint", () => {
    const centroid = calculateMergeCentroid({ x: 0, y: 0 }, 1, { x: 10, y: 10 }, 1);
    expect(centroid.x).toBe(5);
    expect(centroid.y).toBe(5);
  });

  it("unequal masses → weighted towards heavier body", () => {
    const centroid = calculateMergeCentroid({ x: 0, y: 0 }, 3, { x: 10, y: 10 }, 1);
    // centroid = (0*3 + 10*1) / 4 = 2.5
    expect(centroid.x).toBeCloseTo(2.5);
    expect(centroid.y).toBeCloseTo(2.5);
  });

  it("identical positions → centroid equals that position regardless of masses", () => {
    const pos = { x: 5, y: 7 };
    const centroid = calculateMergeCentroid(pos, 2, pos, 5);
    expect(centroid.x).toBeCloseTo(5);
    expect(centroid.y).toBeCloseTo(7);
  });
});

describe("calculateScalingIndex", () => {
  it("tier 0 → baseRadius (factor has no effect)", () => {
    expect(calculateScalingIndex(0, 18)).toBe(18);
  });

  it("tier 10, baseRadius=18, factor=1.25 → ~168 px", () => {
    expect(calculateScalingIndex(10, 18, 1.25)).toBeCloseTo(18 * Math.pow(1.25, 10), 5);
  });

  it("defaults to factor 1.25", () => {
    expect(calculateScalingIndex(1, 18)).toBeCloseTo(18 * 1.25);
  });

  it("accepts a custom factor", () => {
    expect(calculateScalingIndex(2, 10, 2)).toBeCloseTo(40);
  });
});

describe("packingTheoremClearance", () => {
  it("level-1 diameter 36 → 5.4 (15% of 36)", () => {
    expect(packingTheoremClearance(36)).toBeCloseTo(5.4);
  });

  it("scales linearly with input", () => {
    expect(packingTheoremClearance(100)).toBeCloseTo(15);
  });
});

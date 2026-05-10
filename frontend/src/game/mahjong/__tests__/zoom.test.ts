import {
  clamp,
  computeZoomBounds,
  MIN_READABLE_TILE_PX,
  MIN_ZOOM_HEADROOM,
  rubberClamp,
  RUBBER_FACTOR,
} from "../zoom";

describe("computeZoomBounds", () => {
  it("minZoom equals cameraScale", () => {
    const { minZoom } = computeZoomBounds(0.6, 28);
    expect(minZoom).toBe(0.6);
  });

  it("maxZoom is always at least cameraScale × MIN_ZOOM_HEADROOM", () => {
    for (const [scale, tileW] of [
      [1, 56],
      [0.8, 44],
      [0.5, 28],
    ] as [number, number][]) {
      const { minZoom, maxZoom } = computeZoomBounds(scale, tileW);
      expect(maxZoom).toBeGreaterThanOrEqual(minZoom * MIN_ZOOM_HEADROOM);
    }
  });

  it("maxZoom uses MIN_READABLE_TILE_PX/tileWidth when that exceeds headroom", () => {
    // cameraScale=0.5, tileWidth=28 → headroom=0.75, readable=48/28≈1.714 → readable wins
    const { maxZoom } = computeZoomBounds(0.5, 28);
    expect(maxZoom).toBeCloseTo(MIN_READABLE_TILE_PX / 28, 5);
  });

  it("maxZoom uses headroom on large screens where tiles already exceed readable limit", () => {
    // iPad: cameraScale=1, tileWidth=56 → headroom=1.5, readable=48/56≈0.857 → headroom wins
    const { maxZoom } = computeZoomBounds(1, 56);
    expect(maxZoom).toBeCloseTo(1 * MIN_ZOOM_HEADROOM, 5);
  });

  it("maxZoom is always strictly greater than minZoom", () => {
    for (const [scale, tileW] of [
      [1, 56],
      [0.8, 44],
      [0.5, 28],
      [0.3, 28],
    ] as [number, number][]) {
      const { minZoom, maxZoom } = computeZoomBounds(scale, tileW);
      expect(maxZoom).toBeGreaterThan(minZoom);
    }
  });
});

describe("rubberClamp", () => {
  it("passes through values within [min, max]", () => {
    expect(rubberClamp(1.0, 0.5, 2.0)).toBe(1.0);
  });

  it("at-min boundary returns min exactly", () => {
    expect(rubberClamp(0.5, 0.5, 2.0)).toBe(0.5);
  });

  it("at-max boundary returns max exactly", () => {
    expect(rubberClamp(2.0, 0.5, 2.0)).toBe(2.0);
  });

  it("allows overshoot below min with RUBBER_FACTOR resistance", () => {
    // min + (value - min) * RUBBER_FACTOR = 0.5 + (0.2 - 0.5) * 0.3 = 0.41
    const result = rubberClamp(0.2, 0.5, 2.0);
    expect(result).toBeCloseTo(0.5 + (0.2 - 0.5) * RUBBER_FACTOR, 10);
    expect(result).toBeLessThan(0.5);
    expect(result).toBeGreaterThan(0.2);
  });

  it("allows overshoot above max with RUBBER_FACTOR resistance", () => {
    // max + (value - max) * RUBBER_FACTOR = 2.0 + (3.0 - 2.0) * 0.3 = 2.3
    const result = rubberClamp(3.0, 0.5, 2.0);
    expect(result).toBeCloseTo(2.0 + (3.0 - 2.0) * RUBBER_FACTOR, 10);
    expect(result).toBeGreaterThan(2.0);
    expect(result).toBeLessThan(3.0);
  });
});

describe("clamp", () => {
  it("passes through values within range", () => {
    expect(clamp(1.0, 0.5, 2.0)).toBe(1.0);
  });

  it("clamps below min to min", () => {
    expect(clamp(0.2, 0.5, 2.0)).toBe(0.5);
  });

  it("clamps above max to max", () => {
    expect(clamp(3.0, 0.5, 2.0)).toBe(2.0);
  });

  it("clamps at boundary values exactly", () => {
    expect(clamp(0.5, 0.5, 2.0)).toBe(0.5);
    expect(clamp(2.0, 0.5, 2.0)).toBe(2.0);
  });
});

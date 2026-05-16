import {
  clamp,
  computePanBounds,
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

describe("computePanBounds", () => {
  // Board 800×600 scaled to exactly fill a 800×600 viewport → no pan allowed.
  it("returns zero at minZoom when board fits the viewport exactly", () => {
    const { maxTranslateX, maxTranslateY } = computePanBounds(800, 600, 800, 600, 1);
    expect(maxTranslateX).toBe(0);
    expect(maxTranslateY).toBe(0);
  });

  it("returns correct half-excess at 2× zoom", () => {
    // boardWidth * 2 = 1600, viewport = 800 → excess = 800, half = 400
    // boardHeight * 2 = 1200, viewport = 600 → excess = 600, half = 300
    const { maxTranslateX, maxTranslateY } = computePanBounds(800, 600, 800, 600, 2);
    expect(maxTranslateX).toBeCloseTo(400, 5);
    expect(maxTranslateY).toBeCloseTo(300, 5);
  });

  it("X and Y bounds are computed independently", () => {
    // Wide viewport: no X pan room; narrow viewport: Y pan room.
    const { maxTranslateX, maxTranslateY } = computePanBounds(400, 600, 400, 300, 2);
    expect(maxTranslateX).toBeCloseTo(200, 5); // (400*2 - 400) / 2
    expect(maxTranslateY).toBeCloseTo(450, 5); // (600*2 - 300) / 2
  });

  it("never returns a negative bound when board is smaller than viewport", () => {
    // Board fits entirely inside viewport even at scale 1 → clamp to 0.
    const { maxTranslateX, maxTranslateY } = computePanBounds(300, 200, 800, 600, 1);
    expect(maxTranslateX).toBe(0);
    expect(maxTranslateY).toBe(0);
  });

  it("bounds grow linearly with scale", () => {
    const at2 = computePanBounds(800, 600, 800, 600, 2);
    const at3 = computePanBounds(800, 600, 800, 600, 3);
    // at 3×: (800*3 - 800)/2 = 800; at 2×: 400 → ratio should be 2:1
    expect(at3.maxTranslateX / at2.maxTranslateX).toBeCloseTo(2, 5);
    expect(at3.maxTranslateY / at2.maxTranslateY).toBeCloseTo(2, 5);
  });

  it("board edge stays at viewport boundary — translate at maxTranslateX leaves no gap", () => {
    // At maxTranslateX, the right edge of the scaled board should align with
    // the right edge of the viewport (no black gap).
    const scale = 2;
    const boardWidth = 800;
    const viewportWidth = 800;
    const { maxTranslateX } = computePanBounds(boardWidth, 600, viewportWidth, 600, scale);
    // Scaled board right edge from center = (boardWidth * scale) / 2 = 800
    // Viewport right edge from center = viewportWidth / 2 = 400
    // Board right edge in viewport coords = (boardWidth * scale) / 2 - maxTranslateX
    //   should equal viewportWidth / 2
    const boardRightEdge = (boardWidth * scale) / 2 - maxTranslateX;
    expect(boardRightEdge).toBeCloseTo(viewportWidth / 2, 5);
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

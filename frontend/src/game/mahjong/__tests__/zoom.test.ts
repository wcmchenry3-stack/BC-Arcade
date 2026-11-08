import {
  boardResolution,
  clamp,
  computePanBounds,
  computeZoomBounds,
  fitRect,
  opensZoomedIn,
  OPENING_ZOOM_TILE_PX,
  MIN_READABLE_TILE_PX,
  MIN_ZOOM_HEADROOM,
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

describe("boardResolution (#3611)", () => {
  it("is the max zoom, so a canvas drawn at it is never stretched by zooming in", () => {
    for (const [scale, tileW] of [
      [0.5, 28],
      [0.8, 44],
      [1, 56],
    ] as [number, number][]) {
      expect(boardResolution(scale, tileW)).toBe(computeZoomBounds(scale, tileW).maxZoom);
    }
  });

  it("is never below 1 (the board's natural size), even when max zoom is", () => {
    // cameraScale=0.4, tileWidth=56 → max(0.6, 0.857) < 1
    expect(computeZoomBounds(0.4, 56).maxZoom).toBeLessThan(1);
    expect(boardResolution(0.4, 56)).toBe(1);
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

describe("fitRect (#3612)", () => {
  // A 400 x 300 board in a 200 x 150 viewport; zoom between 0.5 (whole board) and 1.2.
  const fit = (rect: { x: number; y: number; width: number; height: number }) =>
    fitRect(rect, 400, 300, 200, 150, 0.5, 1.2);

  it("fits the whole board at the minimum zoom, centred", () => {
    expect(fit({ x: 0, y: 0, width: 400, height: 300 })).toEqual({
      scale: 0.5,
      translateX: -0,
      translateY: -0,
    });
  });

  it("zooms to fit a smaller rect and centres it", () => {
    // 250 x 150 fits at 0.8; its centre (225, 160) is 25 right and 10 below the board's.
    const r = fit({ x: 100, y: 85, width: 250, height: 150 });
    expect(r.scale).toBeCloseTo(0.8, 5);
    expect(r.translateX).toBeCloseTo(-20, 5);
    expect(r.translateY).toBeCloseTo(-8, 5);
  });

  it("never zooms past the maximum, nor below the minimum", () => {
    expect(fit({ x: 190, y: 140, width: 20, height: 20 }).scale).toBe(1.2);
    expect(fit({ x: -100, y: -100, width: 900, height: 900 }).scale).toBe(0.5);
  });

  it("keeps the offset inside the pan bounds at that zoom", () => {
    // A corner wants (180, 135) at 1.2, but the zoomed board's edge allows (140, 105).
    const r = fit({ x: 0, y: 0, width: 100, height: 75 });
    expect(r).toEqual({ scale: 1.2, translateX: 140, translateY: 105 });
  });
});

describe("opensZoomedIn (#3612)", () => {
  it("opens zoomed in when tiles at fit are narrower than OPENING_ZOOM_TILE_PX", () => {
    expect(OPENING_ZOOM_TILE_PX).toBe(26);
    expect(opensZoomedIn(0.5, 40)).toBe(true); // 20 px
    expect(opensZoomedIn(0.6, 43)).toBe(true); // 25.8 px
    expect(opensZoomedIn(1, 28)).toBe(false); // 28 px
    expect(opensZoomedIn(0.65, 40)).toBe(false); // exactly 26 px
  });
});

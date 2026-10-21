/**
 * #3397 — computeDragOrigin: where the ghost starts, and when a measurement
 * is distrusted. Coordinates mirror a phone layout: a DragContainer below the
 * header + safe area (pageY 90), Solitaire cards 52×73, FreeCell 40×56.
 */
import {
  computeDragOrigin,
  dragTolerance,
  isValidContainerMeasure,
  MIN_DRAG_TOLERANCE,
} from "../dragGeometry";
import type { CachedContainer, DragOriginInput, PageRect } from "../dragGeometry";

const SOL = { width: 52, height: 73 };
const FC = { width: 40, height: 56 };

const CONTAINER: PageRect = { pageX: 0, pageY: 90, width: 390, height: 700 };
const CACHED: CachedContainer = { x: 0, y: 90, width: 390, height: 700 };
const NEVER_MEASURED: CachedContainer = { x: 0, y: 0, width: 0, height: 0 };

/** A card at page (px, py), grabbed at (gx, gy) inside it. */
function at(px: number, py: number, gx: number, gy: number, size = SOL) {
  return {
    card: { pageX: px, pageY: py, width: size.width, height: size.height },
    gesture: { absoluteX: px + gx, absoluteY: py + gy, x: gx, y: gy },
    cardSize: size,
  };
}

function input(over: Partial<DragOriginInput> & Pick<DragOriginInput, "gesture">): DragOriginInput {
  return {
    card: null,
    container: CONTAINER,
    cachedContainer: CACHED,
    cardSize: SOL,
    ...over,
  };
}

describe("dragTolerance", () => {
  it("is half a card, floored at the 24 px hitSlop", () => {
    expect(dragTolerance(73)).toBe(36.5);
    expect(dragTolerance(30)).toBe(MIN_DRAG_TOLERANCE);
  });
});

describe("computeDragOrigin (#3397)", () => {
  it("measured card + measured container: container-local origin, not anomalous", () => {
    const o = computeDragOrigin(input(at(80, 150, 20, 30)));
    expect(o).toMatchObject({
      x: 80,
      y: 60,
      containerX: 0,
      containerY: 90,
      cardSource: "measured",
      containerSource: "measured",
      mismatchX: 0,
      mismatchY: 0,
      anomalous: false,
    });
  });

  it("subtracts nonzero safe-area / container offsets on both axes", () => {
    const container = { pageX: 24, pageY: 137, width: 342, height: 600 };
    const o = computeDragOrigin(
      input({
        ...at(100, 200, 10, 10),
        container,
        cachedContainer: { x: 24, y: 137, width: 342, height: 600 },
      })
    );
    expect(o.x).toBe(76);
    expect(o.y).toBe(63);
    expect(o.anomalous).toBe(false);
  });

  it("scroll-like offset: a container scrolled above the window top still yields the right local origin", () => {
    const container = { pageX: 0, pageY: -240, width: 390, height: 1400 };
    const o = computeDragOrigin(
      input({
        ...at(80, 150, 20, 30),
        container,
        cachedContainer: { x: 0, y: -240, width: 390, height: 1400 },
      })
    );
    expect(o.y).toBe(390);
    expect(o.anomalous).toBe(false);
  });

  it("null card measure (freshly mounted waste card): uses the gesture origin, flagged but not anomalous", () => {
    const o = computeDragOrigin(input({ ...at(80, 150, 20, 30), card: null }));
    expect(o).toMatchObject({ x: 80, y: 60, cardSource: "gesture", anomalous: false });
  });

  it("null container measure: falls back to the cached offset and says so", () => {
    const o = computeDragOrigin(input({ ...at(80, 150, 20, 30), container: null }));
    expect(o).toMatchObject({ x: 80, y: 60, containerSource: "cached", anomalous: false });
  });

  it("zero-size fresh container measure (not laid out) is ignored: falls back to the cache", () => {
    for (const bad of [
      { pageX: 0, pageY: 0, width: 0, height: 0 },
      { pageX: 0, pageY: 0, width: 390, height: 0 },
      { pageX: 0, pageY: 0, width: 0, height: 700 },
    ]) {
      const o = computeDragOrigin(input({ ...at(80, 150, 20, 30), container: bad }));
      expect(o).toMatchObject({
        x: 80,
        y: 60,
        containerY: 90,
        containerSource: "cached",
        containerDriftX: 0,
        containerDriftY: 0,
        containerUnknown: false,
        anomalous: false,
      });
    }
    // With nothing cached either, the container is unknown.
    const o = computeDragOrigin(
      input({
        ...at(80, 150, 20, 30),
        container: { pageX: 0, pageY: 0, width: 0, height: 0 },
        cachedContainer: NEVER_MEASURED,
      })
    );
    expect(o.containerUnknown).toBe(true);
  });

  it("isValidContainerMeasure requires a non-null, positive-size rect", () => {
    expect(isValidContainerMeasure(null)).toBe(false);
    expect(isValidContainerMeasure({ pageX: 0, pageY: 0, width: 0, height: 5 })).toBe(false);
    expect(isValidContainerMeasure({ pageX: 0, pageY: 0, width: 5, height: 0 })).toBe(false);
    expect(isValidContainerMeasure(CONTAINER)).toBe(true);
  });

  it("stale cached container (600 from a nav transition) vs a fresh 90: the fresh measure wins", () => {
    const o = computeDragOrigin(
      input({ ...at(80, 150, 20, 30), cachedContainer: { x: 0, y: 600, width: 390, height: 700 } })
    );
    expect(o.y).toBe(60);
    expect(o.containerSource).toBe("measured");
    expect(o.containerDriftY).toBe(-510);
    // The live measure fixed it, so nothing is wrong on screen.
    expect(o.anomalous).toBe(false);
  });

  it("stale cached container with no fresh measure: origin lands outside the container → anomalous", () => {
    const o = computeDragOrigin(
      input({
        ...at(80, 150, 20, 30),
        container: null,
        cachedContainer: { x: 0, y: 600, width: 390, height: 700 },
      })
    );
    expect(o.y).toBe(-450);
    expect(o.originOutsideContainer).toBe(true);
    expect(o.anomalous).toBe(true);
  });

  it("no container measure ever (cached 0,0 initial): anomalous containerUnknown", () => {
    const o = computeDragOrigin(
      input({ ...at(80, 150, 20, 30), container: null, cachedContainer: NEVER_MEASURED })
    );
    expect(o.containerUnknown).toBe(true);
    expect(o.anomalous).toBe(true);
  });

  it("card measure 500 px off the gesture: the gesture origin is used and it is anomalous", () => {
    // The #3397 symptom: finger near the top, ghost near the bottom.
    const base = at(80, 150, 20, 30);
    const o = computeDragOrigin(input({ ...base, card: { ...base.card, pageY: 650 } }));
    expect(o.y).toBe(60); // the old code drew it at 650 - 90 = 560
    expect(o).toMatchObject({
      cardSource: "gesture",
      mismatchY: 500,
      cardMismatch: true,
      anomalous: true,
    });
  });

  it("a small measure/gesture disagreement within tolerance keeps the measured origin", () => {
    const base = at(80, 150, 20, 30);
    const o = computeDragOrigin(input({ ...base, card: { ...base.card, pageY: 160 } }));
    expect(o.cardSource).toBe("measured");
    expect(o.y).toBe(70);
    expect(o.mismatchY).toBe(10);
    expect(o.anomalous).toBe(false);
  });

  it("scaled cards: FreeCell (40 wide) uses the 24 px floor, Solitaire (52) half its height", () => {
    const fc = at(200, 300, 5, 5, FC);
    // 30 px off: beyond FreeCell's 28 px tolerance → rejected.
    expect(computeDragOrigin(input({ ...fc, card: { ...fc.card, pageY: 330 } })).cardSource).toBe(
      "gesture"
    );
    const sol = at(200, 300, 5, 5, SOL);
    // Same 30 px: inside Solitaire's 36.5 px tolerance → kept.
    expect(computeDragOrigin(input({ ...sol, card: { ...sol.card, pageY: 330 } })).cardSource).toBe(
      "measured"
    );
  });

  it("draw-3 fan: the top waste card sits 2 × fanOffset right of the pile", () => {
    const pileX = 76;
    const fanOffset = 16;
    const o = computeDragOrigin(input(at(pileX + 2 * fanOffset, 150, 26, 40)));
    expect(o.x).toBe(108);
    expect(o.anomalous).toBe(false);
  });

  it("a touch inside a 24 px hitSlop below the card is not anomalous", () => {
    const o = computeDragOrigin(input(at(80, 150, 20, SOL.height + 24)));
    expect(o.fingerOutsideCard).toBe(false);
    expect(o.anomalous).toBe(false);
  });

  it("gesture-local coordinates far outside the card are anomalous", () => {
    const o = computeDragOrigin(input({ ...at(80, 150, 20, 400), card: null }));
    expect(o.fingerOutsideCard).toBe(true);
    expect(o.anomalous).toBe(true);
  });

  it("the ghost never starts far from the finger, whatever the card measure says", () => {
    for (const offset of [-900, -300, 0, 37, 300, 900]) {
      const base = at(80, 150, 20, 30);
      const o = computeDragOrigin(input({ ...base, card: { ...base.card, pageY: 150 + offset } }));
      const fingerLocalY = base.gesture.absoluteY - CONTAINER.pageY;
      expect(Math.abs(fingerLocalY - o.y - base.gesture.y)).toBeLessThanOrEqual(
        dragTolerance(SOL.height)
      );
    }
  });
});

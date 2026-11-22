/**
 * #3397 — computeDragOrigin: where the ghost starts, and when a measurement
 * is distrusted. Coordinates mirror a phone layout: a DragContainer below the
 * header + safe area (pageY 90), Solitaire cards 52×73, FreeCell 40×56.
 */
import {
  computeDragOrigin,
  computeGhostOffset,
  ghostPosition,
  dragTolerance,
  dropOffset,
  GHOST_FOLLOW_UP_MIN_PROGRESS,
  GHOST_LAG_FRAMES,
  GHOST_LIFT,
  isValidContainerMeasure,
  judgeGhostFollowUp,
  MIN_DRAG_TOLERANCE,
  SURFACE_OFFSET_TOL,
  surfaceOffsetFails,
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

describe("computeGhostOffset (#3528)", () => {
  const tol = dragTolerance(SOL.height);
  // Finger at (120, 400), grabbed 20,30 into the card: the unlifted ghost
  // origin should be (100, 370) and it is drawn GHOST_LIFT higher.
  const base = { fingerX: 120, fingerY: 400, grabX: 20, grabY: 30, lift: GHOST_LIFT, tol };
  const rect = (pageX: number, pageY: number): PageRect => ({ pageX, pageY, width: 0, height: 0 });

  it("GHOST_LIFT is DragGhostHost's 8 px lift", () => {
    expect(GHOST_LIFT).toBe(8);
  });

  it("a ghost drawn exactly where the finger says is ok with zero delta", () => {
    const r = computeGhostOffset({ ...base, ghost: rect(100, 370 - GHOST_LIFT) });
    expect(r).toEqual({
      status: "ok",
      deltaX: 0,
      deltaY: 0,
      deltaMeasureX: 0,
      deltaMeasureY: 0,
      failGesture: false,
      failMeasure: false,
      expectedX: 100,
      expectedY: 370,
    });
  });

  it("small offsets within the tolerance are ok", () => {
    const r = computeGhostOffset({ ...base, ghost: rect(100 + tol, 370 - GHOST_LIFT - tol) });
    expect(r.status).toBe("ok");
    expect(r.deltaX).toBe(tol);
    expect(r.deltaY).toBe(-tol);
  });

  // #3532: measure() reads the shadow tree, whose transform can be several
  // frames old under load (CI saw Δ(19,58) dp at ~7.5 dp/frame, ~8 frames).
  describe("lag allowance", () => {
    // The finger went from (150, 500) to (120, 400), last step (-2.5, -7.5).
    const lagged = {
      ...base,
      stepX: -2.5,
      stepY: -7.5,
      lag: { minX: 120, maxX: 150, minY: 400, maxY: 500 },
    };
    const drawnFor = (fx: number, fy: number) => rect(fx - 20, fy - 30 - GHOST_LIFT);

    it("GHOST_LAG_FRAMES is 12: the CI run's 8 frames fit with headroom", () => {
      expect(GHOST_LAG_FRAMES).toBe(12);
      expect(GHOST_FOLLOW_UP_MIN_PROGRESS).toBe(0.5);
    });

    it("up to date is ok; the CI run's Δ(19,58) and the drag's start are lag (not a verdict)", () => {
      expect(computeGhostOffset({ ...lagged, ghost: drawnFor(120, 400) }).status).toBe("ok");
      const ci = computeGhostOffset({ ...lagged, ghost: drawnFor(139, 458) });
      expect([ci.status, ci.deltaX, ci.deltaY]).toEqual(["lag", 19, 58]);
      expect(computeGhostOffset({ ...lagged, ghost: drawnFor(150, 500) }).status).toBe("lag");
    });

    it("without the allowance the same lag fails (the #3528 rule)", () => {
      const { lag: _lag, ...noLag } = lagged;
      void _lag;
      expect(computeGhostOffset({ ...noLag, ghost: drawnFor(139, 458) }).status).toBe("fail");
    });

    it("a constant 120 px offset off the path fails at once", () => {
      const below = computeGhostOffset({ ...lagged, ghost: drawnFor(139, 458 + 120) });
      expect([below.status, below.failGesture, below.deltaY]).toEqual(["fail", true, 178]);
      const across = computeGhostOffset({ ...lagged, ghost: drawnFor(139 + 120, 458) });
      expect(across.status).toBe("fail");
    });

    it("inside the path box but more than 12 frames of recent motion behind fails", () => {
      // A long drag from y 800: a ghost drawn for y 650 is on the path, but
      // 250 behind is far beyond tol + 12 x 7.5.
      const long = { ...lagged, lag: { minX: 120, maxX: 150, minY: 400, maxY: 800 } };
      expect(computeGhostOffset({ ...long, ghost: drawnFor(130, 650) }).status).toBe("fail");
    });

    it("a drag that went out and came back: a ghost at a point already passed is lag", () => {
      // Finger went down to y 460 and is back at 400: the box covers 400..460.
      const back = { ...lagged, stepY: -7.5, lag: { minX: 120, maxX: 150, minY: 400, maxY: 460 } };
      expect(computeGhostOffset({ ...back, ghost: drawnFor(130, 450) }).status).toBe("lag");
    });
  });

  describe("judgeGhostFollowUp", () => {
    const first = { deltaX: 0, deltaY: 60, fingerX: 100, fingerY: 400 };

    it("caught up (second ok) is ok", () => {
      expect(
        judgeGhostFollowUp(first, { deltaX: 0, deltaY: 5, fingerX: 100, fingerY: 340 }, "ok", tol)
      ).toBe(true);
    });

    it("still trailing but moving with the finger is ok", () => {
      // Finger 400 -> 340 (60 up); the ghost 460 -> 400 (60 up).
      expect(
        judgeGhostFollowUp(first, { deltaX: 0, deltaY: 60, fingerX: 100, fingerY: 340 }, "lag", tol)
      ).toBe(true);
    });

    it("frozen (the ghost didn't move while the finger travelled) fails", () => {
      // Ghost still at 460 while the finger moved 400 -> 340.
      expect(
        judgeGhostFollowUp(
          first,
          { deltaX: 0, deltaY: 120, fingerX: 100, fingerY: 340 },
          "lag",
          tol
        )
      ).toBe(false);
    });

    it("moving the wrong way fails", () => {
      expect(
        judgeGhostFollowUp(
          first,
          { deltaX: 0, deltaY: 140, fingerX: 100, fingerY: 340 },
          "lag",
          tol
        )
      ).toBe(false);
    });

    it("finger stopped: the ghost must close half its gap", () => {
      const stopped = { fingerX: 100, fingerY: 400 };
      expect(judgeGhostFollowUp(first, { deltaX: 0, deltaY: 20, ...stopped }, "lag", tol)).toBe(
        true
      );
      expect(judgeGhostFollowUp(first, { deltaX: 0, deltaY: 60, ...stopped }, "lag", tol)).toBe(
        false
      );
    });

    it("a second sample that is a fail is never ok", () => {
      expect(
        judgeGhostFollowUp(
          first,
          { deltaX: 0, deltaY: 300, fingerX: 100, fingerY: 340 },
          "fail",
          tol
        )
      ).toBe(false);
    });
  });

  it("a constant +120 px Y render offset fails with the exact delta", () => {
    const r = computeGhostOffset({ ...base, ghost: rect(100, 370 - GHOST_LIFT + 120) });
    expect(r.status).toBe("fail");
    expect(r.deltaX).toBe(0);
    expect(r.deltaY).toBe(120);
  });

  it("an X offset alone fails", () => {
    const r = computeGhostOffset({ ...base, ghost: rect(100 - 60, 370 - GHOST_LIFT) });
    expect(r.status).toBe("fail");
    expect(r.deltaX).toBe(-60);
    expect(r.deltaY).toBe(0);
  });

  it("the lift is accounted for: an unlifted ghost reads as +lift, not as zero", () => {
    const r = computeGhostOffset({ ...base, ghost: rect(100, 370) });
    expect(r.deltaY).toBe(GHOST_LIFT);
    const noLift = computeGhostOffset({ ...base, lift: 0, ghost: rect(100, 370) });
    expect(noLift.deltaY).toBe(0);
  });

  it("a null measure is unmeasured, never an offset", () => {
    const r = computeGhostOffset({ ...base, ghost: null });
    expect(r).toEqual({
      status: "unmeasured",
      deltaX: 0,
      deltaY: 0,
      deltaMeasureX: 0,
      deltaMeasureY: 0,
      failGesture: false,
      failMeasure: false,
      expectedX: 100,
      expectedY: 370,
    });
  });

  it("a non-finite measure is unmeasured", () => {
    expect(computeGhostOffset({ ...base, ghost: rect(NaN, 10) }).status).toBe("unmeasured");
  });

  describe("measure space (a constant RNGH-vs-measure() offset)", () => {
    // RNGH reports the finger 60 px below measure() page space. grab comes
    // from the finger, so the gesture-space delta cancels; the card's own
    // measure does not. The ghost is drawn from the gesture origin, i.e. 60 px
    // below the card's measured position (+ the finger's movement).
    const eps = 60;
    const cardMeasured = { x: 100, y: 370 - eps };

    it("gesture-space delta ≈ 0, measure-space delta ≈ 60 → fail, both reported", () => {
      const r = computeGhostOffset({
        ...base,
        ghost: rect(100, 370 - GHOST_LIFT),
        measureExpected: cardMeasured,
      });
      expect(r.status).toBe("fail");
      expect(r.deltaX).toBe(0);
      expect(r.deltaY).toBe(0);
      expect(r.deltaMeasureX).toBe(0);
      expect(r.deltaMeasureY).toBe(eps);
      expect(r.failGesture).toBe(false);
      expect(r.failMeasure).toBe(true);
    });

    it("both spaces agreeing is ok", () => {
      const r = computeGhostOffset({
        ...base,
        ghost: rect(100, 370 - GHOST_LIFT),
        measureExpected: { x: 100, y: 370 },
      });
      expect(r.status).toBe("ok");
      expect(r.deltaMeasureY).toBe(0);
    });

    it("no card measure → only the gesture space is checked", () => {
      const r = computeGhostOffset({
        ...base,
        ghost: rect(100, 370 - GHOST_LIFT),
        measureExpected: null,
      });
      expect(r.status).toBe("ok");
      expect(r.failMeasure).toBe(false);
    });
  });

  describe("fast flick: tolerance grows by the last finger step", () => {
    // A flick faster than the tolerance per frame (tol = 36.5 px here); the
    // measured transform is one frame old, so the ghost sits one step behind
    // the finger in both spaces.
    const step = tol + 10;

    it("a ghost one frame behind is not an offset", () => {
      const lagging = rect(100, 370 - GHOST_LIFT - step);
      const r = computeGhostOffset({
        ...base,
        ghost: lagging,
        stepY: step,
        measureExpected: { x: 100, y: 370 },
      });
      expect(r.status).toBe("ok");
      expect(r.deltaY).toBe(-step);
      expect(r.deltaMeasureY).toBe(-step);
      // Without the step allowance the same frame would be reported.
      expect(computeGhostOffset({ ...base, ghost: lagging }).status).toBe("fail");
    });

    it("a real 120 px offset during a flick still fails", () => {
      // A 27 px/frame flick (the #3528 review's example), ghost one frame behind.
      const step = 27;
      const r = computeGhostOffset({
        ...base,
        ghost: rect(100, 370 - GHOST_LIFT + 120 - step),
        stepY: step,
      });
      expect(r.status).toBe("fail");
      expect(r.deltaY).toBe(120 - step);
    });

    it("the step only widens its own axis", () => {
      const r = computeGhostOffset({
        ...base,
        ghost: rect(100 + tol + 5, 370 - GHOST_LIFT),
        stepY: 80,
      });
      expect(r.status).toBe("fail");
    });
  });

  describe("transform ignored by measure()", () => {
    const container = { containerX: 0, containerY: 90 };

    it("a ghost measured at the container origin while its transform is large → transformIgnored", () => {
      const r = computeGhostOffset({
        ...base,
        ghost: rect(0, 90),
        rendered: { ...container, cardX: 100, cardY: 288 },
      });
      expect(r.status).toBe("transformIgnored");
      expect(r.deltaX).toBe(0);
      expect(r.deltaY).toBe(0);
    });

    it("a ghost legitimately near the container origin (small transform) is checked normally", () => {
      // cardY − lift ≈ 0: the transform is tiny, so measuring at the origin is right.
      const r = computeGhostOffset({
        fingerX: 20,
        fingerY: 90 + 30 + GHOST_LIFT,
        grabX: 20,
        grabY: 30,
        lift: GHOST_LIFT,
        tol,
        ghost: rect(0, 90),
        rendered: { ...container, cardX: 0, cardY: GHOST_LIFT },
      });
      expect(r.status).toBe("ok");
    });

    it("a ghost away from the container origin is not transformIgnored", () => {
      const r = computeGhostOffset({
        ...base,
        ghost: rect(100, 370 - GHOST_LIFT),
        rendered: { ...container, cardX: 100, cardY: 288 },
      });
      expect(r.status).toBe("ok");
    });
  });
});

describe("ghostPosition (#3531)", () => {
  it("is finger − grab, raised by the lift", () => {
    expect(ghostPosition(120, 400, 20, 30, GHOST_LIFT)).toEqual({ x: 100, y: 362 });
    expect(ghostPosition(120, 400, 20, 30, 0)).toEqual({ x: 100, y: 370 });
  });

  it("depends on nothing but the finger and the grab", () => {
    // A grab outside the card (a hitSlop touch) or a finger off the left edge.
    expect(ghostPosition(5, 10, -4, 80, 0)).toEqual({ x: 9, y: -70 });
    // Moving the finger moves the ghost by exactly as much.
    const a = ghostPosition(200, 300, 13, 41, GHOST_LIFT);
    const b = ghostPosition(200 + 37, 300 - 120, 13, 41, GHOST_LIFT);
    expect({ dx: b.x - a.x, dy: b.y - a.y }).toEqual({ dx: 37, dy: -120 });
  });

  it("is what computeGhostOffset expects the rendered ghost to match", () => {
    const g = ghostPosition(150, 420, 18, 25, GHOST_LIFT);
    const r = computeGhostOffset({
      ghost: { pageX: g.x, pageY: g.y, width: 52, height: 73 },
      fingerX: 150,
      fingerY: 420,
      grabX: 18,
      grabY: 25,
      lift: GHOST_LIFT,
      tol: dragTolerance(SOL.height),
      // The root host draws from 0,0: a ghost there with a large transform is
      // a transformIgnored render failure, anywhere else it is not.
      rendered: { containerX: 0, containerY: 0, cardX: 132, cardY: 395 },
    });
    expect(r).toMatchObject({ status: "ok", deltaX: 0, deltaY: 0 });
    const stuck = computeGhostOffset({
      ghost: { pageX: 0, pageY: 0, width: 52, height: 73 },
      fingerX: 150,
      fingerY: 420,
      grabX: 18,
      grabY: 25,
      lift: GHOST_LIFT,
      tol: dragTolerance(SOL.height),
      rendered: { containerX: 0, containerY: 0, cardX: 132, cardY: 395 },
    });
    expect(stuck.status).toBe("transformIgnored");
  });
});

describe("surface offset verdict (#3531 review 2)", () => {
  const base = {
    ghost: { pageX: 100, pageY: 362, width: 52, height: 73 },
    fingerX: 120,
    fingerY: 400,
    grabX: 20,
    grabY: 30,
    lift: GHOST_LIFT,
    tol: dragTolerance(SOL.height),
  };

  it("SURFACE_OFFSET_TOL is a fixed 12 px", () => {
    expect(SURFACE_OFFSET_TOL).toBe(12);
  });

  it("a surface offset beyond 12 px fails measure space, below the lag-inclusive tolerance", () => {
    const r = computeGhostOffset({ ...base, surfaceOffset: { x: 0, y: 30 }, surfaceTol: 12 });
    expect(r).toMatchObject({ status: "fail", failGesture: false, failMeasure: true });
    expect(surfaceOffsetFails({ x: -13, y: 0 }, SURFACE_OFFSET_TOL)).toBe(true);
  });

  it("up to 12 px on each axis passes, whatever the lag-inclusive deltaMeasure says", () => {
    const r = computeGhostOffset({
      ...base,
      // A deltaMeasure of 80 px (frame lag, a stale measure) is ignored.
      measureExpected: { x: 100, y: 290 },
      surfaceOffset: { x: 12, y: -11 },
      surfaceTol: 12,
    });
    expect(r).toMatchObject({ status: "ok", failMeasure: false, deltaMeasureY: 80 });
  });

  it("no card measure (surfaceOffset null): the measure side cannot fail", () => {
    const r = computeGhostOffset({ ...base, measureExpected: { x: 0, y: 0 }, surfaceOffset: null });
    expect(r.failMeasure).toBe(false);
    expect(r.status).toBe("ok");
    expect(surfaceOffsetFails(null, SURFACE_OFFSET_TOL)).toBe(false);
  });

  it("the render verdict keeps dragTolerance + |step|", () => {
    const tol = dragTolerance(SOL.height);
    const at = (dy: number) =>
      computeGhostOffset({
        ...base,
        ghost: { ...base.ghost, pageY: 362 + dy },
        surfaceOffset: { x: 0, y: 0 },
        stepY: 5,
      });
    expect(at(tol + 5).failGesture).toBe(false);
    expect(at(tol + 6).failGesture).toBe(true);
  });
});

// #3572: the drop offset a board settles a drop from (DraggableCard's onEnd hands it on).
describe("dropOffset", () => {
  it("is the ghost's unlifted offset from its pickup: finger − grab − origin", () => {
    // The finger 40, 20 into the card, which sat at (100, 300): picked up at (140, 320), let go
    // at (180, 260).
    const origin = { x: 140 - 40, y: 320 - 20 };
    expect(dropOffset(180, 260, 40, 20, origin.x, origin.y)).toEqual({ dx: 40, dy: -60 });
  });

  it("is zero for a drop where it was picked up", () => {
    expect(dropOffset(140, 320, 40, 20, 100, 300)).toEqual({ dx: 0, dy: 0 });
  });
});

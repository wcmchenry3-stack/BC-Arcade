/**
 * #3528 — `drag.ghostOffset` caps, sampling and shape, and the
 * `drag.ghostCheck` breadcrumb. Jest runs with `__DEV__ === true`, so the
 * default here is an internal build; `__forceStoreBuildForTests` gives the
 * store-build rules.
 */
import * as Sentry from "@sentry/react-native";

import { __forceStoreBuildForTests } from "../../buildFlavour";
import {
  GHOST_OFFSET_MAX_EVENTS_INTERNAL,
  GHOST_OFFSET_MAX_EVENTS_STORE,
  GHOST_MEASURE_SPACE_MAX_EVENTS_INTERNAL,
  GHOST_OFFSET_SAMPLE_RATE,
  recordGhostCheck,
  recordGhostOffset,
  resetDragDiagnosticsForTests,
} from "../dragDiagnostics";
import type { GhostOffsetReport } from "../dragDiagnostics";

const REPORT: GhostOffsetReport = {
  failKind: "render",
  deltaX: 0.4,
  deltaY: 120.2,
  deltaMeasureX: 0.4,
  deltaMeasureY: 120.2,
  failGesture: true,
  failMeasure: true,
  fingerX: 100,
  fingerY: 400,
  ghostPageX: 80,
  ghostPageY: 482.2,
  expectedX: 80,
  expectedY: 370,
  grabX: 20,
  grabY: 30,
  cardX: 80,
  cardY: 400.2,
  containerPageX: 0,
  containerPageY: 90,
  containerUsedX: 0,
  containerUsedY: 90,
  cardSource: "measured",
  containerSource: "measured",
  cardMismatch: false,
  cardMeasuredX: 76,
  cardMeasuredY: 150,
  fingerStepX: 3,
  fingerStepY: -2,
  tolX: 39.5,
  tolY: 38.5,
  velocityX: 120.6,
  velocityY: -2400.2,
  msSinceStart: 140,
  measures: 1,
  at: "update",
};

const ghostEvents = () =>
  (Sentry.captureMessage as jest.Mock).mock.calls.filter((c) => c[0] === "drag.ghostOffset");
const ghostCrumbs = () =>
  (Sentry.addBreadcrumb as jest.Mock).mock.calls
    .map((c) => c[0])
    .filter((b) => b.message === "drag.ghostCheck");

beforeEach(() => {
  resetDragDiagnosticsForTests();
  (Sentry.captureMessage as jest.Mock).mockClear();
  (Sentry.addBreadcrumb as jest.Mock).mockClear();
});

afterEach(() => {
  __forceStoreBuildForTests(false);
  jest.restoreAllMocks();
});

describe("drag.ghostOffset (#3528)", () => {
  it("internal build: always reports, up to 3 per process, then stops", () => {
    // Sampling never applies to internal builds, whatever random() says.
    jest.spyOn(Math, "random").mockReturnValue(0.99);
    for (let i = 0; i < 6; i++) recordGhostOffset(REPORT, "solitaire", "waste");
    expect(GHOST_OFFSET_MAX_EVENTS_INTERNAL).toBe(3);
    expect(ghostEvents()).toHaveLength(3);
    // Every failing check still leaves its breadcrumb.
    expect(ghostCrumbs()).toHaveLength(6);
  });

  it("store build, sampled-in process: at most 1 per process", () => {
    __forceStoreBuildForTests(true);
    jest.spyOn(Math, "random").mockReturnValue(GHOST_OFFSET_SAMPLE_RATE / 2);
    for (let i = 0; i < 4; i++) recordGhostOffset(REPORT, "freecell", "tableau");
    expect(GHOST_OFFSET_MAX_EVENTS_STORE).toBe(1);
    expect(ghostEvents()).toHaveLength(1);
  });

  it("store build, sampled-out process: nothing, and the decision is made once", () => {
    __forceStoreBuildForTests(true);
    const random = jest.spyOn(Math, "random").mockReturnValue(GHOST_OFFSET_SAMPLE_RATE + 0.01);
    for (let i = 0; i < 3; i++) recordGhostOffset(REPORT, "solitaire", "tableau");
    expect(ghostEvents()).toHaveLength(0);
    expect(random).toHaveBeenCalledTimes(1);
    expect(ghostCrumbs()).toHaveLength(3);
  });

  it("the sample rate is 25% of processes", () => {
    expect(GHOST_OFFSET_SAMPLE_RATE).toBe(0.25);
  });

  it("resetDragDiagnosticsForTests resets the ghost cap and sampling", () => {
    for (let i = 0; i < 3; i++) recordGhostOffset(REPORT, "solitaire", "waste");
    resetDragDiagnosticsForTests();
    recordGhostOffset(REPORT, "solitaire", "waste");
    expect(ghostEvents()).toHaveLength(4);
  });

  it("is grouped per game and source type, tagged and rounded", () => {
    recordGhostOffset(REPORT, "solitaire", "waste", { drawMode: "draw3" });
    const [[message, opts]] = ghostEvents();
    expect(message).toBe("drag.ghostOffset");
    expect(opts.level).toBe("warning");
    expect(opts.fingerprint).toEqual(["drag.ghostOffset", "render", "solitaire", "waste"]);
    expect(opts.tags).toEqual({
      subsystem: "drag",
      failKind: "render",
      game: "solitaire",
      sourceType: "waste",
      platform: expect.any(String),
      drawMode: "draw3",
    });
    expect(opts.extra).toMatchObject({
      deltaX: 0,
      deltaY: 120,
      fingerX: 100,
      fingerY: 400,
      ghostPageX: 80,
      ghostPageY: 482,
      expectedX: 80,
      expectedY: 370,
      grabX: 20,
      grabY: 30,
      containerPageX: 0,
      containerPageY: 90,
      containerUsedX: 0,
      containerUsedY: 90,
      cardSource: "measured",
      containerSource: "measured",
      deltaMeasureX: 0,
      deltaMeasureY: 120,
      failGesture: true,
      failMeasure: true,
      cardX: 80,
      cardY: 400,
      cardMismatch: false,
      cardMeasuredX: 76,
      cardMeasuredY: 150,
      tolX: 40,
      tolY: 39,
      velocityX: 121,
      velocityY: -2400,
      msSinceStart: 140,
      at: "update",
      orientation: expect.stringMatching(/^(portrait|landscape)$/),
    });
    for (const k of ["windowWidth", "windowHeight", "screenWidth", "screenHeight", "insetsTop"]) {
      expect(typeof opts.extra[k]).toBe("number");
    }
    expect(Array.isArray(opts.extra.trace)).toBe(true);
    for (const v of Object.values(opts.extra)) {
      if (typeof v === "number") expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("FreeCell's card size goes in the tags", () => {
    recordGhostOffset(REPORT, "freecell", "freecell", { cardSize: "large" });
    const [[, opts]] = ghostEvents();
    expect(opts.tags).toMatchObject({
      game: "freecell",
      sourceType: "freecell",
      cardSize: "large",
    });
    expect(opts.tags).not.toHaveProperty("drawMode");
  });

  it("the failKind is part of the fingerprint", () => {
    recordGhostOffset(REPORT, "solitaire", "waste");
    recordGhostOffset({ ...REPORT, failKind: "transformIgnored" }, "solitaire", "waste");
    recordGhostOffset({ ...REPORT, failKind: "measureSpace" }, "solitaire", "waste");
    const prints = ghostEvents().map((c) => c[1].fingerprint);
    expect(prints).toEqual([
      ["drag.ghostOffset", "render", "solitaire", "waste"],
      ["drag.ghostOffset", "transformIgnored", "solitaire", "waste"],
      ["drag.ghostOffset", "measureSpace", "solitaire", "waste"],
    ]);
    expect(ghostEvents().map((c) => c[1].tags.failKind)).toEqual([
      "render",
      "transformIgnored",
      "measureSpace",
    ]);
  });

  describe("measureSpace (informational) has its own budget", () => {
    const MS: GhostOffsetReport = { ...REPORT, failKind: "measureSpace", failGesture: false };

    it("internal build: at most 1 per process, with a breadcrumb for each", () => {
      expect(GHOST_MEASURE_SPACE_MAX_EVENTS_INTERNAL).toBe(1);
      for (let i = 0; i < 4; i++) recordGhostOffset(MS, "solitaire", "waste");
      expect(ghostEvents()).toHaveLength(1);
      expect(ghostEvents()[0][1].extra).toMatchObject({ failGesture: false, failMeasure: true });
      expect(ghostCrumbs()).toHaveLength(4);
      expect(ghostCrumbs()[0].data.kind).toBe("measureSpace");
    });

    it("does not consume the render slot: a later real offset still reports (3 of them)", () => {
      for (let i = 0; i < 5; i++) recordGhostOffset(MS, "solitaire", "waste");
      for (let i = 0; i < 5; i++) recordGhostOffset(REPORT, "solitaire", "waste");
      const kinds = ghostEvents().map((c) => c[1].tags.failKind);
      expect(kinds).toEqual(["measureSpace", "render", "render", "render"]);
    });

    it("a render event does not use up the measureSpace slot either", () => {
      for (let i = 0; i < 3; i++) recordGhostOffset(REPORT, "solitaire", "waste");
      recordGhostOffset(MS, "solitaire", "waste");
      expect(ghostEvents().map((c) => c[1].tags.failKind)).toEqual([
        "render",
        "render",
        "render",
        "measureSpace",
      ]);
    });

    it("store build: breadcrumb only, no event, no sampling draw", () => {
      __forceStoreBuildForTests(true);
      const random = jest.spyOn(Math, "random").mockReturnValue(0);
      for (let i = 0; i < 3; i++) recordGhostOffset(MS, "solitaire", "waste");
      expect(ghostEvents()).toHaveLength(0);
      expect(random).not.toHaveBeenCalled();
      expect(ghostCrumbs()).toHaveLength(3);
      // The render slot is untouched.
      recordGhostOffset(REPORT, "solitaire", "waste");
      expect(ghostEvents()).toHaveLength(1);
    });
  });

  it("transformIgnored shares the render budget (3 internal, then stops)", () => {
    const TI: GhostOffsetReport = { ...REPORT, failKind: "transformIgnored" };
    recordGhostOffset(TI, "solitaire", "waste");
    recordGhostOffset(REPORT, "solitaire", "waste");
    recordGhostOffset(TI, "solitaire", "waste");
    recordGhostOffset(REPORT, "solitaire", "waste");
    recordGhostOffset(TI, "solitaire", "waste");
    expect(ghostEvents()).toHaveLength(3);
  });

  it("transformIgnored in a store build: 1 per process, sampled", () => {
    __forceStoreBuildForTests(true);
    jest.spyOn(Math, "random").mockReturnValue(GHOST_OFFSET_SAMPLE_RATE / 2);
    const TI: GhostOffsetReport = { ...REPORT, failKind: "transformIgnored" };
    recordGhostOffset(TI, "solitaire", "waste");
    recordGhostOffset(REPORT, "solitaire", "waste");
    expect(ghostEvents()).toHaveLength(1);
  });

  it("a container that failed to measure is reported as -1, not NaN", () => {
    recordGhostOffset(
      { ...REPORT, containerPageX: NaN, containerPageY: NaN },
      "solitaire",
      "waste"
    );
    const [[, opts]] = ghostEvents();
    expect(opts.extra.containerPageX).toBe(-1);
    expect(opts.extra.containerPageY).toBe(-1);
  });
});

describe("drag.ghostCheck breadcrumb (#3528)", () => {
  it("a passing check is a breadcrumb only, never an event", () => {
    recordGhostCheck(
      { status: "ok", deltaX: 1.6, deltaY: -2.2, deltaMeasureX: 0.2, deltaMeasureY: 3.7 },
      "solitaire",
      "tableau"
    );
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(ghostCrumbs()).toEqual([
      {
        category: "drag",
        level: "info",
        message: "drag.ghostCheck",
        data: { status: "ok", dx: 2, dy: -2, dmx: 0, dmy: 4, game: "solitaire", src: "tableau" },
      },
    ]);
  });

  it("an unmeasured ghost is recorded as such, never as an offset", () => {
    recordGhostCheck(
      { status: "unmeasured", deltaX: 0, deltaY: 0, deltaMeasureX: 0, deltaMeasureY: 0 },
      "freecell",
      "tableau"
    );
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(ghostCrumbs()[0].data.status).toBe("unmeasured");
  });

  it("a failing check leaves a warning breadcrumb with the rounded delta", () => {
    recordGhostOffset(REPORT, "solitaire", "waste");
    expect(ghostCrumbs()).toEqual([
      expect.objectContaining({
        level: "warning",
        data: {
          status: "fail",
          dx: 0,
          dy: 120,
          dmx: 0,
          dmy: 120,
          game: "solitaire",
          src: "waste",
          kind: "render",
        },
      }),
    ]);
  });
});

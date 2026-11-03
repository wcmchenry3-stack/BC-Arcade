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
  GHOST_OFFSET_SAMPLE_RATE,
  recordGhostCheck,
  recordGhostOffset,
  resetDragDiagnosticsForTests,
} from "../dragDiagnostics";
import type { GhostOffsetReport } from "../dragDiagnostics";

const REPORT: GhostOffsetReport = {
  deltaX: 0.4,
  deltaY: 120.2,
  fingerX: 100,
  fingerY: 400,
  ghostPageX: 80,
  ghostPageY: 482.2,
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
  fingerStepX: 3,
  fingerStepY: -2,
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
    expect(opts.fingerprint).toEqual(["drag.ghostOffset", "solitaire", "waste"]);
    expect(opts.tags).toEqual({
      subsystem: "drag",
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
    recordGhostCheck({ status: "ok", deltaX: 1.6, deltaY: -2.2 }, "solitaire", "tableau");
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(ghostCrumbs()).toEqual([
      {
        category: "drag",
        level: "info",
        message: "drag.ghostCheck",
        data: { status: "ok", dx: 2, dy: -2, game: "solitaire", src: "tableau" },
      },
    ]);
  });

  it("an unmeasured ghost is recorded as such, never as an offset", () => {
    recordGhostCheck({ status: "unmeasured", deltaX: 0, deltaY: 0 }, "freecell", "tableau");
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(ghostCrumbs()[0].data.status).toBe("unmeasured");
  });

  it("a failing check leaves a warning breadcrumb with the rounded delta", () => {
    recordGhostOffset(REPORT, "solitaire", "waste");
    expect(ghostCrumbs()).toEqual([
      expect.objectContaining({
        level: "warning",
        data: { status: "fail", dx: 0, dy: 120, game: "solitaire", src: "waste" },
      }),
    ]);
  });
});

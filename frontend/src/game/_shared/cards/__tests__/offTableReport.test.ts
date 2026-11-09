/**
 * #3653 — `cards.offTable`: the overflow check, the per-process caps, the
 * store-build sample, the measured-only rule and the shape of the event. Jest
 * runs with `__DEV__ === true`, so the default here is an internal build;
 * `__forceStoreBuildForTests` gives the store-build rules.
 */
import * as Sentry from "@sentry/react-native";
import { PixelRatio } from "react-native";

import { __forceStoreBuildForTests } from "../../buildFlavour";
import { resetSentryThrottle } from "../../sentryThrottle";
import {
  __resetSentryDialForTests,
  acceptSentryDial,
  sentryDialFilter,
} from "../../../../utils/sentryDial";
import { CARDS_OFF_TABLE_MESSAGE } from "../../../../utils/sentryConfig";
import {
  OFF_TABLE_MAX_EVENTS_INTERNAL,
  OFF_TABLE_MAX_EVENTS_STORE,
  OFF_TABLE_SAMPLE_RATE,
  OFF_TABLE_TOLERANCE,
  offTableOverflow,
  reportCardsOffTable,
  reportTableauOffTable,
  type OffTableCheck,
} from "../offTableReport";
import { computeTableGeometry, faceUpStepFor } from "../tableLayout";

const capture = Sentry.captureMessage as jest.Mock;

/** A board 20 dp past the bottom of a 300 x 500 container. */
const OVERFLOW: OffTableCheck = {
  game: "solitaire",
  measured: true,
  container: { w: 300, h: 500 },
  content: { left: 10, top: 12, right: 290, bottom: 520 },
  deck: "minimal",
  context: { cardWidth: 36, cardHeight: 51, step: 18, compression: "faceUp", columnLengths: [19] },
};
const FITS: OffTableCheck = { ...OVERFLOW, content: { ...OVERFLOW.content, bottom: 498 } };

beforeEach(() => {
  capture.mockClear();
  resetSentryThrottle();
  __forceStoreBuildForTests(false);
});

afterEach(() => {
  __forceStoreBuildForTests(false);
  __resetSentryDialForTests();
  jest.restoreAllMocks();
});

describe("offTableOverflow", () => {
  it("is null while the content stays inside, or within the tolerance", () => {
    expect(offTableOverflow({ w: 300, h: 500 }, { left: 0, top: 0, right: 300, bottom: 500 })).toBe(
      null
    );
    const t = OFF_TABLE_TOLERANCE;
    expect(
      offTableOverflow({ w: 300, h: 500 }, { left: -t, top: -t, right: 300 + t, bottom: 500 + t })
    ).toBe(null);
  });

  it("names the edge that overflows most, and by how much", () => {
    expect(
      offTableOverflow({ w: 300, h: 500 }, { left: -5, top: 0, right: 310, bottom: 520 })
    ).toEqual({ edge: "bottom", overflow: 20, byEdge: { bottom: 20, right: 10, left: 5, top: 0 } });
    expect(
      offTableOverflow({ w: 300, h: 500 }, { left: 0, top: 0, right: 340, bottom: 500 })?.edge
    ).toBe("right");
    expect(
      offTableOverflow({ w: 300, h: 500 }, { left: -9, top: 0, right: 300, bottom: 500 })?.edge
    ).toBe("left");
    expect(
      offTableOverflow({ w: 300, h: 500 }, { left: 0, top: -9, right: 300, bottom: 500 })?.edge
    ).toBe("top");
  });
});

describe("reportCardsOffTable", () => {
  it("sends one warning with the fixed message, its tags and the layout's numbers", () => {
    jest.spyOn(PixelRatio, "getFontScale").mockReturnValue(1.3);
    expect(
      reportCardsOffTable({
        ...OVERFLOW,
        context: { ...OVERFLOW.context, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
      })
    ).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
    const [message, opts] = capture.mock.calls[0];
    expect(message).toBe(CARDS_OFF_TABLE_MESSAGE);
    expect(opts.level).toBe("warning");
    expect(opts.fingerprint).toEqual([CARDS_OFF_TABLE_MESSAGE]);
    expect(opts.tags).toEqual({
      game: "solitaire",
      edge: "bottom",
      deck: "minimal",
      largeCards: "false",
      platform: "ios",
    });
    expect(opts.extra).toMatchObject({
      overflow: 20,
      overflowBottom: 20,
      containerWidth: 300,
      containerHeight: 500,
      feltWidth: 300,
      feltHeight: 500,
      cardWidth: 36,
      cardHeight: 51,
      step: 18,
      compression: "faceUp",
      columnLengths: [19],
      fontScale: 1.3,
      insetsTop: 47,
      insetsBottom: 34,
      orientation: expect.stringMatching(/^(portrait|landscape)$/),
      windowWidth: expect.any(Number),
      windowHeight: expect.any(Number),
    });
    // About 3 KB of text at most (CLAUDE.md volume estimate): well under it.
    expect(JSON.stringify({ message, ...opts }).length).toBeLessThan(3000);
  });

  it("tags a report that must carry no screenshot", () => {
    reportCardsOffTable({ ...OVERFLOW, game: "hearts", skipScreenshot: "skipped-custom-names" });
    expect(capture.mock.calls[0][1].tags).toMatchObject({
      game: "hearts",
      screenshot: "skipped-custom-names",
    });
  });

  it("sends nothing when the content fits", () => {
    expect(reportCardsOffTable(FITS)).toBe(false);
    expect(capture).not.toHaveBeenCalled();
  });

  it("never reports the first-frame estimate: only measured layouts count", () => {
    expect(reportCardsOffTable({ ...OVERFLOW, measured: false })).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    // The measured layout that follows still can.
    expect(reportCardsOffTable(OVERFLOW)).toBe(true);
  });

  it("internal builds: at most one event per process", () => {
    expect(OFF_TABLE_MAX_EVENTS_INTERNAL).toBe(1);
    for (let i = 0; i < 5; i++) reportCardsOffTable({ ...OVERFLOW, game: "hearts" });
    reportCardsOffTable({ ...OVERFLOW, game: "blackjack" });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("store builds: decided once per process at the sample rate, then at most one", () => {
    expect(OFF_TABLE_SAMPLE_RATE).toBe(0.25);
    expect(OFF_TABLE_MAX_EVENTS_STORE).toBe(1);
    __forceStoreBuildForTests(true);
    // Sampled out: never sends this process, and is asked only once.
    const out = jest.spyOn(Math, "random").mockReturnValue(0.25);
    for (let i = 0; i < 5; i++) reportCardsOffTable(OVERFLOW);
    expect(capture).not.toHaveBeenCalled();
    expect(out).toHaveBeenCalledTimes(1);
    out.mockRestore();

    // A new process, sampled in: one event, then the cap.
    resetSentryThrottle();
    const inn = jest.spyOn(Math, "random").mockReturnValue(0.24);
    for (let i = 0; i < 5; i++) reportCardsOffTable(OVERFLOW);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(inn).toHaveBeenCalledTimes(1);
  });

  it("store builds: a layout that fits never spends the sample", () => {
    __forceStoreBuildForTests(true);
    const random = jest.spyOn(Math, "random");
    reportCardsOffTable(FITS);
    reportCardsOffTable({ ...OVERFLOW, measured: false });
    expect(random).not.toHaveBeenCalled();
  });

  it("the server dial off drops it in beforeSend", async () => {
    reportCardsOffTable(OVERFLOW);
    const [, opts] = capture.mock.calls[0];
    const event = { message: CARDS_OFF_TABLE_MESSAGE, level: opts.level };
    expect(sentryDialFilter(event)).toBe(event);
    await acceptSentryDial({ client_sentry: { enabled: false, sample_rate: 1 } });
    expect(sentryDialFilter(event)).toBeNull();
  });
});

describe("reportTableauOffTable", () => {
  const felt = { width: 375 - 12, height: 520 };
  const geometry = computeTableGeometry({ width: felt.width - 2, height: felt.height - 2 });
  const columns = [{ down: 6, up: 13 }];
  const base = {
    game: "solitaire" as const,
    measuredFelt: felt,
    feltBorder: 1,
    geometry,
    faceUpStep: faceUpStepFor(geometry, columns),
    columns,
    boardWidth: 7 * geometry.cardWidth + 6 * geometry.gap,
    checkWidth: true,
    deck: "minimal",
  };

  it("sends nothing for the geometry's own felt, even with the tallest column", () => {
    expect(reportTableauOffTable(base)).toBe(false);
    expect(reportTableauOffTable({ ...base, measuredFelt: null })).toBe(false);
    expect(capture).not.toHaveBeenCalled();
  });

  it("reports the tallest column below the band of a felt smaller than the geometry", () => {
    const shorter = { width: felt.width, height: felt.height - 40 };
    expect(reportTableauOffTable({ ...base, measuredFelt: shorter })).toBe(true);
    const { tags, extra } = capture.mock.calls[0][1];
    expect(tags.edge).toBe("bottom");
    expect(extra.overflow).toBe(40);
    expect(extra.containerHeight).toBe(
      shorter.height - 2 - Math.max(geometry.padding, geometry.bottomBand)
    );
    expect(extra.feltHeight).toBe(shorter.height);
    expect(extra.columnLengths).toEqual([19]);
    expect(extra.compression).toBe(geometry.compression);
  });

  it("reports a board wider than the felt, unless sideways scrolling is intended", () => {
    const narrow = { width: base.boardWidth - 20, height: felt.height };
    expect(reportTableauOffTable({ ...base, measuredFelt: narrow, checkWidth: false })).toBe(false);
    expect(reportTableauOffTable({ ...base, measuredFelt: narrow })).toBe(true);
    const { tags, extra } = capture.mock.calls[0][1];
    expect(tags.edge).toBe("right");
    // Centred: half the 22 dp excess (20 + the 2 dp rim) on each side.
    expect(extra.overflow).toBe(11);
  });
});

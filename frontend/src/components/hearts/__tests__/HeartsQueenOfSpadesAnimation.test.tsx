import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render } from "@testing-library/react-native";
import { HeartsQueenOfSpadesAnimation } from "../HeartsQueenOfSpadesAnimation";
import { QUEEN_TIMING } from "../momentTimeline";
import { advanceBy, flushReduceMotion, mockReduceMotion } from "./helpers/animationFixtures";
import { captureReduceMotionChange } from "../../../test-utils/reduceMotion";

// The Queen of Spades moment (#3588), in ms after the Q♠ is played: the gong strikes at 230
// (scrim, lift, first ring; the second ring 260 ms later), the caption at 580, everything
// returns from 1930 and the moment reports it is done at 2330. Reduced motion is the caption,
// still, reported at 1200.

const CAPTION = "The Queen of Spades · 13 points";
const CARD = { x: 160, y: 200, w: 66, h: 92, rotation: 8 };

describe("HeartsQueenOfSpadesAnimation", () => {
  let announce: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mockReduceMotion(false);
    // React Native's Jest setup already mocks it, so the spy is shared: start each test at 0.
    announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation();
    announce.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function show(onAnimationEnd = jest.fn(), visible = true) {
    const ui = (v: boolean) => (
      <HeartsQueenOfSpadesAnimation
        visible={v}
        card={CARD}
        captionTop={380}
        width={390}
        height={708}
        onAnimationEnd={onAnimationEnd}
      />
    );
    const view = await render(ui(visible));
    await flushReduceMotion();
    return { view, onAnimationEnd, rerender: (v: boolean) => view.rerender(ui(v)) };
  }

  it("never takes a touch", async () => {
    const { view } = await show();
    expect(view.getByTestId("hearts-queen-moment").props.pointerEvents).toBe("none");
  });

  it("lifts a copy of the Q♠ from its place in the trick, hidden from screen readers", async () => {
    const { view } = await show();
    const card = view.getByTestId("hearts-queen-card", { includeHiddenElements: true });
    expect(card).toHaveStyle({ left: CARD.x, top: CARD.y, width: CARD.w, height: CARD.h });
    expect(card.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(card.props.accessibilityElementsHidden).toBe(true);
  });

  it("plays in order: the strike and rings at 230, the caption at 580, the end at 2330", async () => {
    const { view, onAnimationEnd } = await show();
    expect(view.getByTestId("hearts-queen-scrim")).toBeTruthy();

    await advanceBy(QUEEN_TIMING.strike - 1);
    expect(view.queryByTestId("hearts-queen-ring-0")).toBeNull();
    await advanceBy(1); // 230: the gong strikes
    expect(view.getByTestId("hearts-queen-ring-0")).toBeTruthy();
    expect(view.getByTestId("hearts-queen-ring-1")).toBeTruthy();
    expect(view.queryByText(CAPTION)).toBeNull();

    await advanceBy(QUEEN_TIMING.caption - QUEEN_TIMING.strike - 1); // 579
    expect(view.queryByText(CAPTION)).toBeNull();
    expect(announce).not.toHaveBeenCalled();
    await advanceBy(1); // 580
    expect(view.getByText(CAPTION)).toBeTruthy();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(CAPTION);

    await advanceBy(QUEEN_TIMING.end - QUEEN_TIMING.caption - 1); // 2329
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1); // 2330
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);

    await advanceBy(10_000);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("holds 1.7 s from the strike before everything returns", () => {
    expect(QUEEN_TIMING.settle - QUEEN_TIMING.strike).toBe(1700);
    expect(QUEEN_TIMING.ringGap).toBe(260);
  });

  it("draws nothing while hidden", async () => {
    const { view, onAnimationEnd } = await show(jest.fn(), false);
    expect(view.queryByTestId("hearts-queen-moment")).toBeNull();
    await advanceBy(10_000);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it("starts when it becomes visible", async () => {
    const { onAnimationEnd, rerender } = await show(jest.fn(), false);
    await rerender(true);
    await advanceBy(QUEEN_TIMING.end - 1);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });

  it("clears and never reports when hidden mid-animation", async () => {
    const { view, onAnimationEnd, rerender } = await show();
    await advanceBy(1000);
    await rerender(false);
    expect(view.queryByTestId("hearts-queen-moment")).toBeNull();
    await advanceBy(10_000);
    expect(onAnimationEnd).not.toHaveBeenCalled();
  });

  it("never reports after it unmounts", async () => {
    const { view, onAnimationEnd } = await show();
    await advanceBy(400);
    await view.unmount();
    await advanceBy(10_000);
    expect(onAnimationEnd).not.toHaveBeenCalled();
  });

  describe("with reduce motion on", () => {
    beforeEach(() => {
      mockReduceMotion(true);
    });

    it("shows the caption at once with no lift or rings, and reports at 1200 ms", async () => {
      const { view, onAnimationEnd } = await show();
      expect(view.getByText(CAPTION)).toBeTruthy();
      expect(announce).toHaveBeenCalledTimes(1);
      expect(view.queryByTestId("hearts-queen-card", { includeHiddenElements: true })).toBeNull();

      await advanceBy(QUEEN_TIMING.strike);
      expect(view.queryByTestId("hearts-queen-ring-0")).toBeNull();

      await advanceBy(QUEEN_TIMING.reducedEnd - QUEEN_TIMING.strike - 1);
      expect(onAnimationEnd).not.toHaveBeenCalled();
      await advanceBy(1);
      expect(onAnimationEnd).toHaveBeenCalledTimes(1);

      // The full-motion timers the first render started were cancelled.
      await advanceBy(10_000);
      expect(onAnimationEnd).toHaveBeenCalledTimes(1);
    });

    it("never reports after it unmounts", async () => {
      const { view, onAnimationEnd } = await show();
      await view.unmount();
      await advanceBy(10_000);
      expect(onAnimationEnd).not.toHaveBeenCalled();
    });
  });

  it("switches to the still caption once reduce motion is turned on mid-session (#2984)", async () => {
    const emit = captureReduceMotionChange();
    const { view, onAnimationEnd } = await show();
    await advanceBy(500);

    await act(async () => emit(true));
    expect(view.getByText(CAPTION)).toBeTruthy();
    await advanceBy(QUEEN_TIMING.reducedEnd - 1);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
    // Announced once for the showing, not again for the switch.
    expect(announce).toHaveBeenCalledTimes(1);
  });
});

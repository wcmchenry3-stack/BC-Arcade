import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render } from "@testing-library/react-native";
import { HeartsBrokenAnimation } from "../HeartsBrokenAnimation";
import { BROKEN_TIMING } from "../momentTimeline";
import { advanceBy, flushReduceMotion, mockReduceMotion } from "./helpers/animationFixtures";
import { captureReduceMotionChange } from "../../../test-utils/reduceMotion";

// Hearts broken (#3588), in ms after the heartbeat starts: the heart pops and the edges pulse
// on the "lub" at 0, the crack draws on the "dub" at 160, the caption fades in from 200, the
// halves fall apart from 540 and the moment reports it is done at 1700. Reduced motion is
// the caption, still, reported at 1000.

const CAPTION = "Hearts are broken";

describe("HeartsBrokenAnimation", () => {
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
      <HeartsBrokenAnimation
        visible={v}
        centre={{ x: 195, y: 266 }}
        cardW={66}
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
    expect(view.getByTestId("hearts-broken-moment").props.pointerEvents).toBe("none");
  });

  it("pops a 150 dp heart centred over the trick (at the mockup's 66 dp cards)", async () => {
    const { view } = await show();
    expect(view.getByTestId("hearts-broken-heart")).toHaveStyle({
      left: 195 - 75,
      top: 266 - 75,
      width: 150,
      height: 150,
    });
    expect(view.getByTestId("hearts-broken-edges")).toBeTruthy();
  });

  it("plays in order: the heart on the lub, the crack on the dub, the caption, then the end", async () => {
    const { view, onAnimationEnd } = await show();
    expect(view.getByTestId("hearts-broken-heart")).toBeTruthy();
    expect(view.queryByTestId("hearts-broken-crack")).toBeNull();

    await advanceBy(BROKEN_TIMING.dub - 1);
    expect(view.queryByTestId("hearts-broken-crack")).toBeNull();
    await advanceBy(1); // 160: the dub
    expect(view.getByTestId("hearts-broken-crack")).toBeTruthy();
    expect(view.queryByText(CAPTION)).toBeNull();

    await advanceBy(BROKEN_TIMING.caption - BROKEN_TIMING.dub - 1); // 199
    expect(view.queryByText(CAPTION)).toBeNull();
    await advanceBy(1); // 200
    expect(view.getByText(CAPTION)).toBeTruthy();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(CAPTION);

    await advanceBy(BROKEN_TIMING.end - BROKEN_TIMING.caption - 1); // 1699
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1); // 1700
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);

    await advanceBy(10_000);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("draws nothing while hidden", async () => {
    const { view, onAnimationEnd } = await show(jest.fn(), false);
    expect(view.queryByTestId("hearts-broken-moment")).toBeNull();
    await advanceBy(10_000);
    expect(onAnimationEnd).not.toHaveBeenCalled();
  });

  it("starts when it becomes visible", async () => {
    const { onAnimationEnd, rerender } = await show(jest.fn(), false);
    await rerender(true);
    await advanceBy(BROKEN_TIMING.end - 1);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });

  it("clears and never reports when hidden mid-animation", async () => {
    const { view, onAnimationEnd, rerender } = await show();
    await advanceBy(1000);
    await rerender(false);
    expect(view.queryByTestId("hearts-broken-moment")).toBeNull();
    await advanceBy(10_000);
    expect(onAnimationEnd).not.toHaveBeenCalled();
  });

  it("never reports after it unmounts", async () => {
    const { view, onAnimationEnd } = await show();
    await advanceBy(1000);
    await view.unmount();
    await advanceBy(10_000);
    expect(onAnimationEnd).not.toHaveBeenCalled();
  });

  describe("with reduce motion on", () => {
    beforeEach(() => {
      mockReduceMotion(true);
    });

    it("shows the caption at once with no heart or edge pulse, and reports at 1000 ms", async () => {
      const { view, onAnimationEnd } = await show();
      expect(view.getByText(CAPTION)).toBeTruthy();
      expect(announce).toHaveBeenCalledTimes(1);
      expect(view.queryByTestId("hearts-broken-heart")).toBeNull();
      expect(view.queryByTestId("hearts-broken-edges")).toBeNull();

      await advanceBy(BROKEN_TIMING.reducedEnd - 1);
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

  describe("when reduce motion changes mid-session (#2984)", () => {
    it("switches to the still caption from the moment it is turned on", async () => {
      const emit = captureReduceMotionChange();
      const { view, onAnimationEnd } = await show();
      await advanceBy(1000);

      await act(async () => emit(true));
      // The full sequence is cancelled: no heart, and no report at 1700.
      expect(view.queryByTestId("hearts-broken-heart")).toBeNull();
      await advanceBy(BROKEN_TIMING.reducedEnd - 1);
      expect(onAnimationEnd).not.toHaveBeenCalled();
      await advanceBy(1);
      expect(onAnimationEnd).toHaveBeenCalledTimes(1);
      await advanceBy(10_000);
      expect(onAnimationEnd).toHaveBeenCalledTimes(1);
    });

    it("plays the full sequence once it is turned off again", async () => {
      mockReduceMotion(true);
      const emit = captureReduceMotionChange();
      const { view, onAnimationEnd } = await show();

      await act(async () => emit(false));
      expect(view.getByTestId("hearts-broken-heart")).toBeTruthy();
      await advanceBy(BROKEN_TIMING.end - 1);
      expect(onAnimationEnd).not.toHaveBeenCalled();
      await advanceBy(1);
      expect(onAnimationEnd).toHaveBeenCalledTimes(1);
    });
  });
});

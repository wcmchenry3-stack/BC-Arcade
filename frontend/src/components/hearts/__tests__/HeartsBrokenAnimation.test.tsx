import React from "react";
import { act, render } from "@testing-library/react-native";
import { HeartsBrokenAnimation } from "../HeartsBrokenAnimation";
import { advanceBy, flushReduceMotion, mockReduceMotion } from "./helpers/animationFixtures";
import { captureReduceMotionChange } from "../../../test-utils/reduceMotion";

// Phases (ms): burst at 0, the icon lingers at 25 % from 800, everything fades
// from 2900, and the overlay reports it is done at 3400. Reduced motion is a
// 300 ms tint flash with no icon.

const LABEL = "Hearts broken";

describe("HeartsBrokenAnimation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReduceMotion(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function show(onAnimationEnd = jest.fn(), visible = true) {
    const view = await render(
      <HeartsBrokenAnimation visible={visible} onAnimationEnd={onAnimationEnd} />
    );
    await flushReduceMotion();
    return {
      view,
      onAnimationEnd,
      rerender: (v: boolean) =>
        view.rerender(<HeartsBrokenAnimation visible={v} onAnimationEnd={onAnimationEnd} />),
    };
  }

  it("announces the event through a polite live region", async () => {
    const { view } = await show();
    const icon = view.getByLabelText(LABEL);
    expect(icon.props.accessibilityRole).toBe("text");
    expect(icon.props.accessibilityLiveRegion).toBe("polite");
  });

  it("bursts in, lingers, fades out, then reports it is done", async () => {
    const { view, onAnimationEnd, rerender } = await show();
    await rerender(true);
    expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 1 });

    await advanceBy(800);
    await rerender(true);
    expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 0.25 });
    expect(onAnimationEnd).not.toHaveBeenCalled();

    await advanceBy(2100); // 2900
    await rerender(true);
    expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 0 });
    expect(onAnimationEnd).not.toHaveBeenCalled();

    await advanceBy(499); // 3399
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1); // 3400
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);

    await advanceBy(10_000);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });

  it("does nothing while hidden", async () => {
    const { view, onAnimationEnd } = await show(jest.fn(), false);
    await advanceBy(10_000);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 0 });
  });

  it("starts when it becomes visible", async () => {
    const { onAnimationEnd, rerender } = await show(jest.fn(), false);
    await rerender(true);
    await advanceBy(3399);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });

  it("resets and never reports when hidden mid-animation", async () => {
    const { view, onAnimationEnd, rerender } = await show();
    await advanceBy(1000);
    await rerender(false);
    await rerender(false); // the reset is written by an effect, so it shows on the next render
    expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 0 });
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

    it("reports after the 300 ms flash, not after the full sequence", async () => {
      const { onAnimationEnd } = await show();

      await advanceBy(299);
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
    it("switches to the 300 ms flash from the moment it is turned on", async () => {
      const emit = captureReduceMotionChange();
      const { view, onAnimationEnd, rerender } = await show();
      await advanceBy(1000);

      await act(async () => emit(true));
      await rerender(true);
      // The full sequence is cancelled: no icon, and no report at 3400.
      expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 0 });
      await advanceBy(299);
      expect(onAnimationEnd).not.toHaveBeenCalled();
      await advanceBy(1);
      expect(onAnimationEnd).toHaveBeenCalledTimes(1);
      await advanceBy(10_000);
      expect(onAnimationEnd).toHaveBeenCalledTimes(1);
    });

    it("plays the full sequence once it is turned off again", async () => {
      mockReduceMotion(true);
      const emit = captureReduceMotionChange();
      const { view, onAnimationEnd, rerender } = await show();

      await act(async () => emit(false));
      await rerender(true);
      expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 1 });
      await advanceBy(3399);
      expect(onAnimationEnd).not.toHaveBeenCalled();
      await advanceBy(1);
      expect(onAnimationEnd).toHaveBeenCalledTimes(1);
    });
  });
});

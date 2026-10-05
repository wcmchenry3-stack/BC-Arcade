import React from "react";
import { render } from "@testing-library/react-native";
import { HeartsMoonShotAnimation } from "../HeartsMoonShotAnimation";
import { advanceBy, flushReduceMotion, mockReduceMotion } from "./helpers/animationFixtures";

// Phases (ms): the moon, stars and label burst in from 0, everything fades from
// 1700, and the overlay reports it is done at 2200. Reduced motion shows the
// finished frame at once and holds it until the same 2200.

const TEXT = "Dana shot the moon!";

describe("HeartsMoonShotAnimation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReduceMotion(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function show(onAnimationEnd = jest.fn(), visible = true) {
    const ui = (v: boolean) => (
      <HeartsMoonShotAnimation visible={v} shooterLabel="Dana" onAnimationEnd={onAnimationEnd} />
    );
    const view = await render(ui(visible));
    await flushReduceMotion();
    return { view, onAnimationEnd, rerender: (v: boolean) => view.rerender(ui(v)) };
  }

  it("names the shooter in the label and the live-region announcement", async () => {
    const { view } = await show();
    expect(view.getByText(TEXT)).toBeTruthy();
    const moon = view.getByLabelText(TEXT);
    expect(moon.props.accessibilityRole).toBe("text");
    expect(moon.props.accessibilityLiveRegion).toBe("polite");
  });

  it("shows the moon and label, fades them out, then reports it is done", async () => {
    const { view, onAnimationEnd, rerender } = await show();
    await rerender(true);
    expect(view.getByLabelText(TEXT)).toHaveStyle({ opacity: 1 });
    expect(view.getByText(TEXT)).toHaveStyle({ opacity: 1 });

    await advanceBy(1699);
    await rerender(true);
    expect(view.getByLabelText(TEXT)).toHaveStyle({ opacity: 1 });

    await advanceBy(1); // 1700
    await rerender(true);
    expect(view.getByLabelText(TEXT)).toHaveStyle({ opacity: 0 });
    expect(view.getByText(TEXT)).toHaveStyle({ opacity: 0 });
    expect(onAnimationEnd).not.toHaveBeenCalled();

    await advanceBy(499); // 2199
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1); // 2200
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);

    await advanceBy(10_000);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });

  it("does nothing while hidden", async () => {
    const { view, onAnimationEnd } = await show(jest.fn(), false);
    await advanceBy(10_000);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    expect(view.getByLabelText(TEXT)).toHaveStyle({ opacity: 0 });
  });

  it("starts when it becomes visible", async () => {
    const { onAnimationEnd, rerender } = await show(jest.fn(), false);
    await rerender(true);
    await advanceBy(2199);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });

  it("resets and never reports when hidden mid-animation", async () => {
    const { view, onAnimationEnd, rerender } = await show();
    await advanceBy(1000);
    await rerender(false);
    await rerender(false); // the reset is written by an effect, so it shows on the next render
    expect(view.getByLabelText(TEXT)).toHaveStyle({ opacity: 0 });
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

    it("holds the finished frame and reports at 2200 ms without a fade", async () => {
      const { view, onAnimationEnd, rerender } = await show();
      await rerender(true);
      expect(view.getByLabelText(TEXT)).toHaveStyle({ opacity: 1 });
      expect(view.getByText(TEXT)).toHaveStyle({ opacity: 1 });

      await advanceBy(1700); // where full motion would already be fading
      await rerender(true);
      expect(view.getByLabelText(TEXT)).toHaveStyle({ opacity: 1 });
      expect(onAnimationEnd).not.toHaveBeenCalled();

      await advanceBy(499);
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
});

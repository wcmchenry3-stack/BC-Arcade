import React from "react";
import { act, render } from "@testing-library/react-native";
import { FreeCellFoundationAnimation } from "../FreeCellFoundationAnimation";
import {
  advanceBy,
  flushReduceMotion,
  mockReduceMotion,
} from "../../hearts/__tests__/helpers/animationFixtures";
import { captureReduceMotionChange } from "../../../test-utils/reduceMotion";

// Phases (ms): burst at 0, everything fades from 1400, and the overlay reports
// it is done at 1800. Reduced motion is a 250 ms gold flash with no icon.

const LABEL = "Foundation complete";

describe("FreeCellFoundationAnimation", () => {
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
      <FreeCellFoundationAnimation visible={v} onAnimationEnd={onAnimationEnd} />
    );
    const view = await render(ui(visible));
    await flushReduceMotion();
    return { view, onAnimationEnd, rerender: (v: boolean) => view.rerender(ui(v)) };
  }

  it("announces the event through a polite live region", async () => {
    const { view } = await show();
    const icon = view.getByLabelText(LABEL);
    expect(icon.props.accessibilityRole).toBe("text");
    expect(icon.props.accessibilityLiveRegion).toBe("polite");
  });

  it("bursts in, fades out at 1400, then reports it is done at 1800", async () => {
    const { view, onAnimationEnd, rerender } = await show();
    await rerender(true);
    expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 1 });

    await advanceBy(1400);
    await rerender(true);
    expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 0 });
    expect(onAnimationEnd).not.toHaveBeenCalled();

    await advanceBy(399); // 1799
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1); // 1800
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
    await advanceBy(10_000);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });

  it("does nothing while hidden, and never reports once hidden mid-animation", async () => {
    const { onAnimationEnd, rerender } = await show(jest.fn(), false);
    await advanceBy(10_000);
    expect(onAnimationEnd).not.toHaveBeenCalled();

    await rerender(true);
    await advanceBy(1000);
    await rerender(false);
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

  it("reports after the 250 ms flash with reduce motion on", async () => {
    mockReduceMotion(true);
    const { view, onAnimationEnd, rerender } = await show();
    await rerender(true); // the reset is written by an effect, so it shows on the next render
    expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 0 });
    await advanceBy(249);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
    await advanceBy(10_000);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });

  it("switches to the flash once reduce motion is turned on mid-session (#2984)", async () => {
    const emit = captureReduceMotionChange();
    const { onAnimationEnd } = await show();
    await advanceBy(1000);
    await act(async () => emit(true));
    await advanceBy(249);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });
});

import React from "react";
import { act, render } from "@testing-library/react-native";
import { HeartsQueenOfSpadesAnimation } from "../HeartsQueenOfSpadesAnimation";
import { advanceBy, flushReduceMotion, mockReduceMotion } from "./helpers/animationFixtures";
import { captureReduceMotionChange } from "../../../test-utils/reduceMotion";

// Phases (ms): the card springs in from 0, shakes from 200, fades out from 700,
// and the overlay reports it is done at 1000. Reduced motion is a red flash with
// no card, reported at 800.

const LABEL = "Eli takes the Queen of Spades!";

describe("HeartsQueenOfSpadesAnimation", () => {
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
      <HeartsQueenOfSpadesAnimation visible={v} takerLabel="Eli" onAnimationEnd={onAnimationEnd} />
    );
    const view = await render(ui(visible));
    await flushReduceMotion();
    return { view, onAnimationEnd, rerender: (v: boolean) => view.rerender(ui(v)) };
  }

  it("draws the Queen of Spades and announces who took it", async () => {
    const { view } = await show();
    expect(view.getByText("Q")).toBeTruthy();
    expect(view.getByText("♠")).toBeTruthy();
    const card = view.getByLabelText(LABEL);
    expect(card.props.accessibilityRole).toBe("text");
    expect(card.props.accessibilityLiveRegion).toBe("polite");
  });

  it("springs the card in, fades it out, then reports it is done", async () => {
    const { view, onAnimationEnd, rerender } = await show();
    await rerender(true);
    expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 1 });

    await advanceBy(699);
    await rerender(true);
    expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 1 });

    await advanceBy(1); // 700
    await rerender(true);
    expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 0 });
    expect(onAnimationEnd).not.toHaveBeenCalled();

    await advanceBy(299); // 999
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1); // 1000
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
    await advanceBy(999);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });

  it("resets and never reports when hidden mid-animation", async () => {
    const { view, onAnimationEnd, rerender } = await show();
    await advanceBy(400);
    await rerender(false);
    await rerender(false); // the reset is written by an effect, so it shows on the next render
    expect(view.getByLabelText(LABEL)).toHaveStyle({ opacity: 0 });
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

    it("reports after the 800 ms flash, not after the full sequence", async () => {
      const { onAnimationEnd } = await show();

      await advanceBy(799);
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

  it("switches to the 800 ms flash once reduce motion is turned on mid-session (#2984)", async () => {
    const emit = captureReduceMotionChange();
    const { onAnimationEnd } = await show();
    await advanceBy(500);

    await act(async () => emit(true));
    await advanceBy(799);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });
});

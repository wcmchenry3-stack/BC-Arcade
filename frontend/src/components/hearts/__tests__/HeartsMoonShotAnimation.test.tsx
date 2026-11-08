import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render } from "@testing-library/react-native";
import { HeartsMoonShotAnimation } from "../HeartsMoonShotAnimation";
import { MOON_TIMING } from "../momentTimeline";
import { advanceBy, flushReduceMotion, mockReduceMotion } from "./helpers/animationFixtures";
import { captureReduceMotionChange } from "../../../test-utils/reduceMotion";

// The moon shot (#3588), in ms after the howl starts: night falls and the moon rises from 0,
// the first wolf at 700, "You shot the moon!" at 1200 (and "+26 to …" fading in from 1600),
// the answering wolf at 1450, the fade at 3300 and the report at 3700 — after which Hand
// Complete may open (#3586). Reduced motion is the finished scene, still, reported at 1200.

const TITLE = "You shot the moon!";
const PENALTY = "+26 to West, North and East";

describe("HeartsMoonShotAnimation", () => {
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

  async function show(
    onAnimationEnd = jest.fn(),
    visible = true,
    shooter: { label: string; human: boolean; others: [string, string, string] } = {
      label: "You",
      human: true,
      others: ["West", "North", "East"],
    }
  ) {
    const ui = (v: boolean) => (
      <HeartsMoonShotAnimation
        visible={v}
        shooterLabel={shooter.label}
        shooterIsHuman={shooter.human}
        otherLabels={shooter.others}
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
    expect(view.getByTestId("hearts-moon-moment").props.pointerEvents).toBe("none");
  });

  it("plays in order: night and moon, the wolf, the captions, the answering wolf, the end", async () => {
    const { view, onAnimationEnd } = await show();
    expect(view.getByTestId("hearts-moon-moon")).toBeTruthy();
    expect(view.getByTestId("hearts-moon-hill")).toBeTruthy();
    expect(view.queryByTestId("hearts-moon-wolf-0")).toBeNull();

    await advanceBy(MOON_TIMING.wolf - 1);
    expect(view.queryByTestId("hearts-moon-wolf-0")).toBeNull();
    await advanceBy(1); // 700: the first howl swells
    expect(view.getByTestId("hearts-moon-wolf-0")).toBeTruthy();
    expect(view.queryByText(TITLE)).toBeNull();

    await advanceBy(MOON_TIMING.title - MOON_TIMING.wolf - 1); // 1199
    expect(view.queryByText(TITLE)).toBeNull();
    await advanceBy(1); // 1200
    expect(view.getByText(TITLE)).toBeTruthy();
    expect(view.getByText(PENALTY)).toBeTruthy();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(`${TITLE} ${PENALTY}`);
    expect(view.queryByTestId("hearts-moon-wolf-1")).toBeNull();

    await advanceBy(MOON_TIMING.answer - MOON_TIMING.title - 1); // 1449
    expect(view.queryByTestId("hearts-moon-wolf-1")).toBeNull();
    await advanceBy(1); // 1450: the answering howl
    expect(view.getByTestId("hearts-moon-wolf-1")).toBeTruthy();

    await advanceBy(MOON_TIMING.end - MOON_TIMING.answer - 1); // 3699
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1); // 3700
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);

    await advanceBy(10_000);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("answers the first howl 1.45 s in and fades at 3.3 s", () => {
    expect(MOON_TIMING.answer).toBe(1450);
    expect(MOON_TIMING.fade).toBe(3300);
  });

  it("names a CPU shooter and the three who take 26", async () => {
    const { view } = await show(jest.fn(), true, {
      label: "North",
      human: false,
      others: ["East", "You", "West"],
    });
    await advanceBy(MOON_TIMING.title);
    expect(view.getByText("North shot the moon!")).toBeTruthy();
    expect(view.getByText("+26 to East, You and West")).toBeTruthy();
  });

  it("draws nothing while hidden", async () => {
    const { view, onAnimationEnd } = await show(jest.fn(), false);
    expect(view.queryByTestId("hearts-moon-moment")).toBeNull();
    await advanceBy(10_000);
    expect(onAnimationEnd).not.toHaveBeenCalled();
  });

  it("starts when it becomes visible", async () => {
    const { onAnimationEnd, rerender } = await show(jest.fn(), false);
    await rerender(true);
    await advanceBy(MOON_TIMING.end - 1);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });

  it("clears and never reports when hidden mid-animation", async () => {
    const { view, onAnimationEnd, rerender } = await show();
    await advanceBy(1000);
    await rerender(false);
    expect(view.queryByTestId("hearts-moon-moment")).toBeNull();
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

    it("shows the finished scene and captions at once, and reports at 1200 ms", async () => {
      const { view, onAnimationEnd } = await show();
      expect(view.getByText(TITLE)).toBeTruthy();
      expect(view.getByText(PENALTY)).toBeTruthy();
      expect(view.getByTestId("hearts-moon-wolf-0")).toBeTruthy();
      expect(view.getByTestId("hearts-moon-wolf-1")).toBeTruthy();
      expect(announce).toHaveBeenCalledTimes(1);

      await advanceBy(MOON_TIMING.reducedEnd - 1);
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

  it("shows the still scene once reduce motion is turned on mid-session (#2984)", async () => {
    const emit = captureReduceMotionChange();
    const { view, onAnimationEnd } = await show();
    await advanceBy(1000);

    await act(async () => emit(true));
    expect(view.getByText(TITLE)).toBeTruthy();
    // Re-armed from the change: reported 1200 ms later, not at the original 3700.
    await advanceBy(MOON_TIMING.reducedEnd - 1);
    expect(onAnimationEnd).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(onAnimationEnd).toHaveBeenCalledTimes(1);
  });
});

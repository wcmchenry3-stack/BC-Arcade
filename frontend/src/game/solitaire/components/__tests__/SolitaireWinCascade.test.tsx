import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../../theme/ThemeContext";
import { SolitaireWinCascade, WIN_CASCADE_MS } from "../SolitaireWinCascade";
import { captureReduceMotionChange } from "../../../../test-utils/reduceMotion";

async function renderCascade(onDone: () => void) {
  const r = await render(
    <ThemeProvider>
      <SolitaireWinCascade onDone={onDone} />
    </ThemeProvider>
  );
  await act(async () => {});
  return r;
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("SolitaireWinCascade (#2509)", () => {
  it("hands over to the result card once the cascade has played", async () => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    const onDone = jest.fn();
    await renderCascade(onDone);
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(WIN_CASCADE_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("skips straight to the card when reduce motion is on", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const onDone = jest.fn();
    const { toJSON } = await renderCascade(onDone);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toJSON()).toBeNull();
  });

  it("skips to the card once if reduce motion is turned on mid-cascade (#2984)", async () => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    const emit = captureReduceMotionChange();
    const onDone = jest.fn();
    const { toJSON } = await renderCascade(onDone);
    expect(toJSON()).not.toBeNull();

    await act(async () => emit(true));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toJSON()).toBeNull();

    // Turning it back off neither replays the cascade's hand-over nor calls again.
    await act(async () => emit(false));
    await act(async () => {
      jest.advanceTimersByTime(WIN_CASCADE_MS * 2);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

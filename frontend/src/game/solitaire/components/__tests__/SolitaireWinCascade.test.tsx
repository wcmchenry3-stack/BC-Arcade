import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../../theme/ThemeContext";
import { SolitaireWinCascade, WIN_CASCADE_MS } from "../SolitaireWinCascade";

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
});

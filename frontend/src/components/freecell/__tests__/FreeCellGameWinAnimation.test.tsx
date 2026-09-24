import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { FreeCellGameWinAnimation } from "../FreeCellGameWinAnimation";

async function renderAnimation(onDismiss: () => void) {
  return await render(
    <ThemeProvider>
      <FreeCellGameWinAnimation visible onDismiss={onDismiss} />
    </ThemeProvider>
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("FreeCellGameWinAnimation (#2508)", () => {
  it("draws nothing until the reduce-motion setting is known", async () => {
    let resolve: (v: boolean) => void = () => {};
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockReturnValue(new Promise<boolean>((r) => (resolve = r)));
    const onDismiss = jest.fn();
    await renderAnimation(onDismiss);
    expect(screen.queryByTestId("animation-overlay")).toBeNull();

    // Reduce motion on: never shows the burst, hands straight to the card.
    await act(async () => resolve(true));
    expect(screen.queryByTestId("animation-overlay")).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("plays the burst, then hands over to the result card", async () => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    const onDismiss = jest.fn();
    await renderAnimation(onDismiss);
    await act(async () => {});
    expect(screen.getByTestId("animation-overlay")).toBeTruthy();
    // Hidden from screen readers — the result card announces the win.
    expect(screen.getByText("You Win!", { includeHiddenElements: true })).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(2800);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

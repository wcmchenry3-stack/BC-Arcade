import React from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
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
  it("with Reduce Motion on, never shows the burst and hands straight to the card", async () => {
    // Read synchronously (Reanimated), so there is no frame before the setting is known.
    (useReducedMotion as jest.Mock).mockReturnValue(true);
    try {
      const onDismiss = jest.fn();
      await renderAnimation(onDismiss);
      expect(screen.queryByTestId("animation-overlay")).toBeNull();
      expect(screen.queryByTestId("animation-overlay-static")).toBeNull();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      (useReducedMotion as jest.Mock).mockReturnValue(false);
    }
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

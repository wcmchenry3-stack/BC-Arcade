import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { SolitaireWinCascade, WIN_CASCADE_MS } from "../SolitaireWinCascade";
import { captureReduceMotionChange } from "../../../test-utils/reduceMotion";
import { useReduceMotion } from "../../shared/useReduceMotion";

/** Another element on screen that tracks the setting before the win. */
function OtherConsumer() {
  useReduceMotion();
  return null;
}

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

  describe("Reduce Motion turned on after launch, before the win (stale launch value)", () => {
    it("waits for the current setting instead of starting the cascade", async () => {
      // Reanimated's launch value is false; the OS now says true.
      let answer: (enabled: boolean) => void = () => {};
      jest
        .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
        .mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const onDone = jest.fn();
      const r = await render(
        <ThemeProvider>
          <SolitaireWinCascade onDone={onDone} />
        </ThemeProvider>
      );
      // Before the query answers: no confetti on the stale value, no hand-over.
      expect(r.queryByTestId("solitaire-win-cascade", { includeHiddenElements: true })).toBeNull();
      expect(onDone).not.toHaveBeenCalled();
      await act(async () => answer(true));
      expect(r.toJSON()).toBeNull();
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("uses the value another consumer is already tracking", async () => {
      const emit = captureReduceMotionChange();
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
      const onDone = jest.fn();
      const ui = (withCascade: boolean) => (
        <ThemeProvider>
          <OtherConsumer />
          {withCascade && <SolitaireWinCascade onDone={onDone} />}
        </ThemeProvider>
      );
      const r = await render(ui(false));
      await act(async () => {});
      await act(async () => emit(true)); // turned on mid-game

      // The cascade's own query never answers; the shared value is enough.
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(new Promise(() => {}));
      await r.rerender(ui(true));
      expect(r.queryByTestId("solitaire-win-cascade", { includeHiddenElements: true })).toBeNull();
      await act(async () => {});
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });
});

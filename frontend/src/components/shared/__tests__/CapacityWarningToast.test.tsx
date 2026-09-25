import React from "react";
import { AppState, AppStateStatus } from "react-native";
import { render, act, fireEvent, waitFor } from "@testing-library/react-native";
import { CapacityWarningToast } from "../CapacityWarningToast";
import { ThemeProvider } from "../../../theme/ThemeContext";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

async function renderWith(
  shouldShowCheck: () => Promise<boolean>,
  markShown: () => Promise<void> = () => Promise.resolve()
) {
  return await render(
    <ThemeProvider>
      <CapacityWarningToast
        shouldShowCheck={shouldShowCheck}
        markShown={markShown}
        pollIntervalMs={50}
      />
    </ThemeProvider>
  );
}

describe("CapacityWarningToast", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders nothing when shouldShow returns false", async () => {
    const { queryByTestId } = await renderWith(() => Promise.resolve(false));
    // Let the initial check resolve.
    await act(async () => {
      await Promise.resolve();
    });
    expect(queryByTestId("capacity-warning-toast")).toBeNull();
  });

  it("renders the banner when shouldShow returns true", async () => {
    const { findByTestId, getByText } = await renderWith(() => Promise.resolve(true));
    await findByTestId("capacity-warning-toast");
    expect(getByText("Queued game data is filling up")).toBeTruthy();
    expect(getByText("Clear it in Settings to keep the app running smoothly.")).toBeTruthy();
  });

  /**
   * A check/markShown pair that behaves like eventStore (#2584): once the
   * warning is marked shown, the check stops asking for it. With a check that
   * always said "show", the 50 ms poll could fire between the dismiss and the
   * assertion under load and put the banner straight back.
   */
  function suppressedAfterMark() {
    let marked = false;
    return {
      check: () => Promise.resolve(!marked),
      markShown: jest.fn(async () => {
        marked = true;
      }),
    };
  }

  it("calls markShown and hides the banner when dismissed", async () => {
    const { check, markShown } = suppressedAfterMark();
    const { findByTestId, queryByTestId, getByTestId } = await renderWith(check, markShown);
    await findByTestId("capacity-warning-toast");
    await act(async () => {
      await fireEvent.press(getByTestId("capacity-warning-dismiss"));
    });
    // Banner is gone.
    expect(queryByTestId("capacity-warning-toast")).toBeNull();
    // Side effect fired.
    expect(markShown).toHaveBeenCalledTimes(1);
  });

  it("stays hidden after dismiss even if a later check still returns true", async () => {
    // shouldShow always returns true — but once dismissed, the toast
    // should not reappear on the same mount. (Re-appearance after 24 h
    // is enforced by eventStore.markWarningShown, which is not tested
    // here; that's covered by eventStore.test.ts.)
    const { check, markShown } = suppressedAfterMark();
    const { findByTestId, getByTestId, queryByTestId } = await renderWith(check, markShown);
    await findByTestId("capacity-warning-toast");
    await act(async () => {
      await fireEvent.press(getByTestId("capacity-warning-dismiss"));
    });
    expect(markShown).toHaveBeenCalledTimes(1);
    expect(queryByTestId("capacity-warning-toast")).toBeNull();

    // Let a few poll cycles run: with the suppression in place (as eventStore
    // applies for 24 h), the banner must stay hidden. The 24 h window itself
    // belongs to eventStore's unit tests.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(queryByTestId("capacity-warning-toast")).toBeNull();
  });

  it("polls the check function at the configured interval", async () => {
    const check = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(false) // mount — hide
      .mockResolvedValue(true); // subsequent ticks — show
    const { queryByTestId, findByTestId } = await renderWith(check);
    // Mount check: hidden.
    await act(async () => {
      await Promise.resolve();
    });
    expect(queryByTestId("capacity-warning-toast")).toBeNull();
    // After one or more poll intervals, a subsequent check fires → show.
    await findByTestId("capacity-warning-toast");
    expect(check.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // AppState pause / resume (battery drain fix — #1156)
  // -------------------------------------------------------------------------

  it("pauses the interval on background and resumes with an immediate check on active", async () => {
    jest.useFakeTimers();
    const check = jest.fn().mockResolvedValue(false);
    await renderWith(check);

    // Flush the initial runCheck promise
    await act(async () => {
      await Promise.resolve();
    });
    expect(check).toHaveBeenCalledTimes(1);

    // Let the interval tick once
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(check.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Capture the AppState listener registered inside the component
    const listener = (AppState.addEventListener as jest.Mock).mock.calls[0][1] as (
      s: AppStateStatus
    ) => void;

    // Simulate going to background — interval should be cleared
    await act(() => {
      listener("background");
    });
    const countAfterBackground = check.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(check.mock.calls.length).toBe(countAfterBackground);

    // Simulate returning to foreground — immediate check fires + interval restarts
    await act(() => {
      listener("active");
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(check.mock.calls.length).toBeGreaterThan(countAfterBackground);

    // Interval is live again — another tick should fire
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    const countAfterResume = check.mock.calls.length;
    expect(countAfterResume).toBeGreaterThan(countAfterBackground + 1);

    jest.useRealTimers();
  });

  it("swallows errors from the check function without crashing", async () => {
    const check = jest.fn().mockRejectedValue(new Error("boom"));
    const { queryByTestId } = await renderWith(check);
    await act(async () => {
      await waitFor(() => expect(check).toHaveBeenCalled());
    });
    // No crash, banner stays hidden.
    expect(queryByTestId("capacity-warning-toast")).toBeNull();
  });
});

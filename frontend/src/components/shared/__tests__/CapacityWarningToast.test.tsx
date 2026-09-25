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
   * warning is marked shown, the check stops asking for it.
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

  /** Let pending check promises and the state updates they cause settle. */
  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("hides the banner on dismiss, marks it shown, and keeps it hidden while the check says no", async () => {
    jest.useFakeTimers();
    try {
      const { check, markShown } = suppressedAfterMark();
      const { getByTestId, queryByTestId } = await renderWith(check, markShown);
      await flush();
      expect(getByTestId("capacity-warning-toast")).toBeTruthy();

      await act(async () => {
        fireEvent.press(getByTestId("capacity-warning-dismiss"));
      });
      expect(markShown).toHaveBeenCalledTimes(1);
      expect(queryByTestId("capacity-warning-toast")).toBeNull();

      // Several poll cycles, deterministically: still hidden.
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      await flush();
      expect(queryByTestId("capacity-warning-toast")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("ignores a check that was already running when the banner was dismissed", async () => {
    // The real eventStore check waits on a lock and a storage read, so a poll
    // can be in flight across the dismiss (#2584 review). It must not bring
    // the banner back when it resolves.
    jest.useFakeTimers();
    try {
      let resolveInFlight: (show: boolean) => void = () => {};
      const check = jest
        .fn<Promise<boolean>, []>()
        .mockResolvedValueOnce(true) // mount: show
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              resolveInFlight = resolve;
            })
        ) // first poll: still running at dismiss time
        .mockResolvedValue(false); // later polls: suppressed
      const { getByTestId, queryByTestId } = await renderWith(check);
      await flush();
      expect(getByTestId("capacity-warning-toast")).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(50);
      });
      expect(check).toHaveBeenCalledTimes(2);

      await act(async () => {
        fireEvent.press(getByTestId("capacity-warning-dismiss"));
      });
      expect(queryByTestId("capacity-warning-toast")).toBeNull();

      await act(async () => {
        resolveInFlight(true);
      });
      await flush();
      expect(queryByTestId("capacity-warning-toast")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
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

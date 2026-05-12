import React from "react";
import { AppState, AppStateStatus } from "react-native";
import { render, act } from "@testing-library/react-native";
import { NetworkProvider } from "../NetworkContext";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock("../syncWorker", () => ({
  syncWorker: {
    start: jest.fn(),
    stop: jest.fn(),
    flush: jest.fn().mockResolvedValue({ attempted: 0, accepted: 0 }),
  },
}));

jest.mock("../gameEventClient", () => ({
  gameEventClient: {
    init: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../scoreQueue", () => ({
  scoreQueue: {
    flush: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../testHooks", () => ({
  registerLogstoreTestHooks: jest.fn().mockReturnValue(() => {}),
}));

jest.mock("../../cascade/scoreSync", () => ({
  registerCascadeScoreHandler: jest.fn(),
}));

jest.mock("../../sudoku/scoreSync", () => ({
  registerSudokuScoreHandler: jest.fn(),
}));

jest.mock("../../mahjong/scoreSync", () => ({
  registerMahjongScoreHandler: jest.fn(),
}));

jest.mock("../../../components/shared/CapacityWarningToast", () => ({
  CapacityWarningToast: () => null,
}));

jest.mock("../useNetworkStatus", () => ({
  useNetworkStatus: jest.fn(() => ({ isOnline: true, isInitialized: true })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { syncWorker } from "../syncWorker";

function getAppStateListener(): (s: AppStateStatus) => void {
  const mock = AppState.addEventListener as jest.Mock;
  const changeCall = mock.mock.calls.find((c: unknown[]) => c[0] === "change");
  if (!changeCall) throw new Error("AppState.addEventListener('change', ...) not called");
  return changeCall[1] as (s: AppStateStatus) => void;
}

function renderProvider() {
  return render(
    <NetworkProvider>
      <></>
    </NetworkProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NetworkContext — foreground flush (#1159)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls syncWorker.flush() when AppState transitions to active", async () => {
    renderProvider();
    await act(async () => {
      await Promise.resolve();
    });

    const listener = getAppStateListener();

    act(() => {
      listener("background");
    });
    (syncWorker.flush as jest.Mock).mockClear();

    act(() => {
      listener("active");
    });

    expect(syncWorker.flush).toHaveBeenCalledTimes(1);
  });

  it("does not call syncWorker.flush() when transitioning to background", async () => {
    renderProvider();
    await act(async () => {
      await Promise.resolve();
    });

    const listener = getAppStateListener();
    (syncWorker.flush as jest.Mock).mockClear();

    act(() => {
      listener("background");
    });

    expect(syncWorker.flush).not.toHaveBeenCalled();
  });

  it("reports flush errors to Sentry with flush-on-foreground tag", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/react-native");
    const flushError = new Error("flush failed");
    (syncWorker.flush as jest.Mock).mockRejectedValueOnce(flushError);

    renderProvider();
    await act(async () => {
      await Promise.resolve();
    });

    const listener = getAppStateListener();
    act(() => {
      listener("background");
    });

    await act(async () => {
      listener("active");
      await Promise.resolve();
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(
      flushError,
      expect.objectContaining({
        tags: { subsystem: "syncWorker", op: "flush-on-foreground" },
      })
    );
  });
});

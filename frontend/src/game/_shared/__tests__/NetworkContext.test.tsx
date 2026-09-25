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
jest.mock("../../solitaire/scoreSync", () => ({
  registerSolitaireScoreHandler: jest.fn(),
}));
jest.mock("../../freecell/scoreSync", () => ({
  registerFreeCellScoreHandler: jest.fn(),
}));
jest.mock("../../sort/scoreSync", () => ({
  registerSortScoreHandler: jest.fn(),
}));
jest.mock("../../starswarm/scoreSync", () => ({
  registerStarSwarmScoreHandler: jest.fn(),
}));

jest.mock("../../../components/shared/CapacityWarningToast", () => ({
  CapacityWarningToast: () => null,
}));

jest.mock("../useNetworkStatus", () => ({
  useNetworkStatus: jest.fn(() => ({ isOnline: true, isInitialized: true })),
}));

jest.mock("../displayNameSync", () => ({
  registerDisplayNameSync: jest.fn(),
  syncDisplayNameOnLaunch: jest.fn().mockResolvedValue(true),
  flushDisplayNameSync: jest.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { syncWorker } from "../syncWorker";
import { scoreQueue } from "../scoreQueue";
import { useNetworkStatus } from "../useNetworkStatus";
import {
  flushDisplayNameSync,
  registerDisplayNameSync,
  syncDisplayNameOnLaunch,
} from "../displayNameSync";

// Read before any beforeEach clears the mocks' call records.
const nameSyncRegistrationsAtLoad = (registerDisplayNameSync as jest.Mock).mock.calls.length;

function getAppStateListener(): (s: AppStateStatus) => void {
  const mock = AppState.addEventListener as jest.Mock;
  const changeCall = mock.mock.calls.find((c: unknown[]) => c[0] === "change");
  if (!changeCall) throw new Error("AppState.addEventListener('change', ...) not called");
  return changeCall[1] as (s: AppStateStatus) => void;
}

async function renderProvider() {
  return await render(
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
    await renderProvider();
    await act(async () => {
      await Promise.resolve();
    });

    const listener = getAppStateListener();

    await act(() => {
      listener("background");
    });
    (syncWorker.flush as jest.Mock).mockClear();

    await act(() => {
      listener("active");
    });

    expect(syncWorker.flush).toHaveBeenCalledTimes(1);
  });

  it("does not call syncWorker.flush() when transitioning to background", async () => {
    await renderProvider();
    await act(async () => {
      await Promise.resolve();
    });

    const listener = getAppStateListener();
    (syncWorker.flush as jest.Mock).mockClear();

    await act(() => {
      listener("background");
    });

    expect(syncWorker.flush).not.toHaveBeenCalled();
  });

  it("reports flush errors to Sentry with flush-on-foreground tag", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/react-native");
    const flushError = new Error("flush failed");
    (syncWorker.flush as jest.Mock).mockRejectedValueOnce(flushError);

    await renderProvider();
    await act(async () => {
      await Promise.resolve();
    });

    const listener = getAppStateListener();
    await act(() => {
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

describe("NetworkContext — display name sync (#2624)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    (useNetworkStatus as jest.Mock).mockImplementation(() => ({
      isOnline: true,
      isInitialized: true,
    }));
  });

  it("installs the save sync once, at module load", () => {
    expect(nameSyncRegistrationsAtLoad).toBe(1);
  });

  it("syncs a never-synced stored name once on launch", async () => {
    await renderProvider();
    expect(syncDisplayNameOnLaunch).toHaveBeenCalledTimes(1);
  });

  it("flushes the pending name with the score queue on reconnect", async () => {
    (useNetworkStatus as jest.Mock).mockImplementation(() => ({
      isOnline: false,
      isInitialized: true,
    }));
    const view = await renderProvider();
    expect(flushDisplayNameSync).not.toHaveBeenCalled();

    (useNetworkStatus as jest.Mock).mockImplementation(() => ({
      isOnline: true,
      isInitialized: true,
    }));
    await view.rerender(
      <NetworkProvider>
        <></>
      </NetworkProvider>
    );
    expect(scoreQueue.flush).toHaveBeenCalledTimes(1);
    expect(flushDisplayNameSync).toHaveBeenCalledTimes(1);
  });

  it("flushes the pending name with SyncWorker on foreground", async () => {
    await renderProvider();
    const listener = getAppStateListener();
    await act(() => {
      listener("background");
    });
    expect(flushDisplayNameSync).not.toHaveBeenCalled();
    await act(() => {
      listener("active");
    });
    expect(flushDisplayNameSync).toHaveBeenCalledTimes(1);
  });
});

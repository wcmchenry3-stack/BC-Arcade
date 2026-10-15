/**
 * NetworkContext starts the replay dial (#3279): the stored dial and one
 * catalog fetch at launch, before `gameEventClient.init()`, and at most an
 * hourly refresh on a return to the foreground (the hour is replayDial's).
 */

import React from "react";
import { AppState, AppStateStatus } from "react-native";
import { act, render } from "@testing-library/react-native";

import { NetworkProvider } from "../NetworkContext";

const mockOrder: string[] = [];

jest.mock("../replayDialSync", () => ({
  startReplayDial: jest.fn(() => {
    mockOrder.push("startReplayDial");
    return Promise.resolve(true);
  }),
  refreshIfStale: jest.fn(() => Promise.resolve(false)),
}));
jest.mock("../syncWorker", () => ({
  syncWorker: {
    start: jest.fn(),
    stop: jest.fn(),
    flush: jest.fn().mockResolvedValue({ attempted: 0, accepted: 0 }),
  },
}));
jest.mock("../gameEventClient", () => ({
  gameEventClient: {
    init: jest.fn(() => {
      mockOrder.push("gameEventClient.init");
      return Promise.resolve();
    }),
  },
}));
jest.mock("../legacyScoreQueue", () => ({
  clearLegacyScoreQueue: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../testHooks", () => ({
  registerLogstoreTestHooks: jest.fn().mockReturnValue(() => {}),
}));
jest.mock("../../../components/shared/CapacityWarningToast", () => ({
  CapacityWarningToast: () => null,
}));
jest.mock("../useNetworkStatus", () => ({
  useNetworkStatus: jest.fn(() => ({ isOnline: true, isInitialized: true })),
}));
jest.mock("../displayNameSync", () => ({
  syncDisplayNameOnLaunch: jest.fn().mockResolvedValue(true),
  flushDisplayNameSync: jest.fn().mockResolvedValue(true),
}));

import { refreshIfStale, startReplayDial } from "../replayDialSync";

function appStateListener(): (s: AppStateStatus) => void {
  const call = (AppState.addEventListener as jest.Mock).mock.calls.find(
    (c: unknown[]) => c[0] === "change"
  );
  if (!call) throw new Error("no AppState listener");
  return call[1] as (s: AppStateStatus) => void;
}

describe("NetworkContext — the replay dial (#3279)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrder.length = 0;
  });

  it("starts the dial once at launch, before the game event client", async () => {
    await render(
      <NetworkProvider>
        <></>
      </NetworkProvider>
    );
    expect(startReplayDial).toHaveBeenCalledTimes(1);
    expect(mockOrder).toEqual(["startReplayDial", "gameEventClient.init"]);
    expect(refreshIfStale).not.toHaveBeenCalled();
  });

  it("asks for a refresh on a return to the foreground only", async () => {
    await render(
      <NetworkProvider>
        <></>
      </NetworkProvider>
    );
    const listener = appStateListener();
    await act(() => listener("background"));
    await act(() => listener("inactive"));
    expect(refreshIfStale).not.toHaveBeenCalled();
    await act(() => listener("active"));
    expect(refreshIfStale).toHaveBeenCalledTimes(1);
  });
});

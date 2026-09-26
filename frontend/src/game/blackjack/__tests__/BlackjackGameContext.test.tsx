import React from "react";
import { renderHook, act } from "@testing-library/react-native";

import { BlackjackGameProvider, useBlackjackGame } from "../BlackjackGameContext";
import { TABLE_CONFIGS } from "../tables";
import type { ProgressSnapshot } from "../../_shared/useGameSync";

// The context reaches into these; mocked so the test drives only the engine
// state and the progress-snapshot wiring, not disk or the real event client.
jest.mock("../storage", () => ({
  loadGame: jest.fn().mockResolvedValue(null),
  saveGame: jest.fn(),
  clearGame: jest.fn(),
  saveRun: jest.fn().mockResolvedValue(undefined),
  loadRuns: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../../entitlements/premiumLevels", () => ({
  isPremiumLevel: () => false,
}));

jest.mock("../../_shared/lastDifficulty", () => ({
  saveLastDifficulty: jest.fn(),
}));

const mockSetProgressSnapshot = jest.fn((_getter: () => ProgressSnapshot) => {});

jest.mock("../../_shared/useGameSync", () => ({
  useGameSync: () => ({
    start: jest.fn(),
    resume: jest.fn(() => false),
    markStarted: jest.fn(),
    enqueue: jest.fn(),
    complete: jest.fn(),
    close: jest.fn(),
    setProgressSnapshot: (getter: () => ProgressSnapshot) => mockSetProgressSnapshot(getter),
    getGameId: jest.fn(() => "game-1"),
    resetPlayWindow: jest.fn(),
  }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <BlackjackGameProvider>{children}</BlackjackGameProvider>;
}

/** The most recently registered progress-snapshot getter (#2682). */
function latestSnapshot(): ProgressSnapshot {
  const getter = mockSetProgressSnapshot.mock.calls.at(-1)?.[0];
  if (!getter) throw new Error("setProgressSnapshot was never called");
  return getter();
}

describe("BlackjackGameContext progress snapshot (#2682)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports no outcome override before the run's goal is reached", async () => {
    const { result } = await renderHook(() => useBlackjackGame(), { wrapper });
    await act(async () => {});
    await act(async () => {
      result.current.handleTableSelect(TABLE_CONFIGS[0]!);
    });

    expect(latestSnapshot().outcome).toBeUndefined();
  });

  it("reports outcome: win once the run reaches its goal, so a killed-process sweep records a win", async () => {
    const { result } = await renderHook(() => useBlackjackGame(), { wrapper });
    await act(async () => {});
    await act(async () => {
      result.current.handleTableSelect(TABLE_CONFIGS[0]!);
    });

    // Simulate the run reaching its goal (skips actual hand-by-hand play —
    // covered by engine.test.ts — to isolate the snapshot wiring).
    await act(async () => {
      result.current.apply((s) => ({ ...s, phase: "victory" }));
    });

    expect(latestSnapshot().outcome).toBe("win");
  });

  it("keeps reporting win after Keep Playing, even though phase leaves victory", async () => {
    const { result } = await renderHook(() => useBlackjackGame(), { wrapper });
    await act(async () => {});
    await act(async () => {
      result.current.handleTableSelect(TABLE_CONFIGS[0]!);
    });
    await act(async () => {
      result.current.apply((s) => ({ ...s, phase: "victory" }));
    });
    await act(async () => {
      result.current.handleKeepPlaying();
    });

    expect(latestSnapshot().outcome).toBe("win");
  });
});

import React from "react";
import { renderHook, act } from "@testing-library/react-native";

import { BlackjackGameProvider, useBlackjackGame } from "../BlackjackGameContext";
import { TABLE_CONFIGS } from "../tables";

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

const mockEnqueue = jest.fn();
const mockEnqueueMany = jest.fn(() => true);

jest.mock("../../_shared/useGameSync", () => ({
  useGameSync: () => ({
    start: jest.fn(),
    resume: () => false,
    markStarted: jest.fn(),
    enqueue: (...args: unknown[]) => mockEnqueue(...args),
    enqueueMany: () => mockEnqueueMany(),
    complete: jest.fn(),
    close: jest.fn(),
    setProgressSnapshot: jest.fn(),
    getGameId: jest.fn(() => "game-1"),
    resetPlayWindow: jest.fn(),
  }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <BlackjackGameProvider>{children}</BlackjackGameProvider>;
}

describe("BlackjackGameContext devSetEngine (#3576)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("replaces the engine without recording an event or counting a round", async () => {
    const { result } = await renderHook(() => useBlackjackGame(), { wrapper });
    await act(async () => {});
    await act(async () => {
      result.current.handleTableSelect(TABLE_CONFIGS[0]!);
    });
    const enqueued = mockEnqueue.mock.calls.length;
    const saved = mockEnqueueMany.mock.calls.length;
    const before = result.current.engine!;

    await act(async () => {
      result.current.devSetEngine((s) => ({
        ...s,
        deck: [...s.deck, { rank: "A", suit: "♠" }],
      }));
    });

    expect(result.current.engine!.deck.at(-1)).toEqual({ rank: "A", suit: "♠" });
    expect(result.current.engine!.round).toBe(before.round);
    expect(result.current.engine!.phase).toBe("betting");
    expect(mockEnqueue.mock.calls.length).toBe(enqueued);
    expect(mockEnqueueMany.mock.calls.length).toBe(saved);
  });
});

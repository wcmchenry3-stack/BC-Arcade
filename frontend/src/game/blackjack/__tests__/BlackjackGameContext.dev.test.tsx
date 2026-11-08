import React from "react";
import { renderHook, act } from "@testing-library/react-native";

import { BlackjackGameProvider, useBlackjackGame } from "../BlackjackGameContext";
import { TABLE_CONFIGS } from "../tables";
import { hit, placeBet } from "../engine";
import { saveGame } from "../storage";

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

const A = { rank: "A", suit: "♠" };
// Non-natural deal: player 5,6 vs dealer 9,7; a hit draws the 4.
const STACK = [
  { rank: "5", suit: "♠" },
  { rank: "9", suit: "♥" },
  { rank: "6", suit: "♦" },
  { rank: "7", suit: "♣" },
  { rank: "4", suit: "♠" },
];

async function startRun() {
  const hook = await renderHook(() => useBlackjackGame(), { wrapper });
  await act(async () => {});
  await act(async () => {
    hook.result.current.handleTableSelect(TABLE_CONFIGS[0]!);
  });
  return hook.result;
}

describe("BlackjackGameContext devSetEngine (#3576)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("replaces the engine, saves it, and records no event or round", async () => {
    const result = await startRun();
    const enqueued = mockEnqueue.mock.calls.length;
    const saved = mockEnqueueMany.mock.calls.length;
    const before = result.current.engine!;
    (saveGame as jest.Mock).mockClear();

    await act(async () => {
      result.current.devSetEngine((s) => ({ ...s, deck: [...s.deck, A] }));
    });

    expect(result.current.engine!.deck.at(-1)).toEqual(A);
    expect(result.current.engine!.round).toBe(before.round);
    expect(result.current.engine!.phase).toBe("betting");
    expect(mockEnqueue.mock.calls.length).toBe(enqueued);
    expect(mockEnqueueMany.mock.calls.length).toBe(saved);
    expect(saveGame).toHaveBeenCalledTimes(1);
    const savedState = (saveGame as jest.Mock).mock.calls[0]![0];
    expect(savedState.deck.at(-1)).toEqual(A);
    expect(savedState.events).toBeUndefined();
  });

  it("a later apply() deals from the stacked deck, and only that bet counts the round", async () => {
    const result = await startRun();
    await act(async () => {
      result.current.devSetEngine((s) => ({ ...s, deck: [...s.deck, ...[...STACK].reverse()] }));
    });
    expect(result.current.engine!.round).toBeUndefined();
    await act(async () => {
      result.current.apply((s) => placeBet(s, s.betMin));
    });
    const e = result.current.engine!;
    expect(e.player_hand).toEqual([STACK[0], STACK[2]]);
    expect(e.dealer_hand).toEqual([STACK[1], STACK[3]]);
    expect(e.round).toBe(1);
  });

  it("stacking in the player phase emits nothing and leaves the round alone", async () => {
    const result = await startRun();
    await act(async () => {
      result.current.devSetEngine((s) => ({ ...s, deck: [...s.deck, ...[...STACK].reverse()] }));
    });
    await act(async () => {
      result.current.apply((s) => placeBet(s, s.betMin));
    });
    expect(result.current.engine!.phase).toBe("player");
    const roundBefore = result.current.engine!.round;
    const enqueued = mockEnqueue.mock.calls.length;
    const saved = mockEnqueueMany.mock.calls.length;

    await act(async () => {
      result.current.devSetEngine((s) => ({ ...s, deck: [...s.deck, A] }));
    });
    expect(mockEnqueue.mock.calls.length).toBe(enqueued);
    expect(mockEnqueueMany.mock.calls.length).toBe(saved);
    expect(result.current.engine!.round).toBe(roundBefore);
    expect(result.current.engine!.phase).toBe("player");

    await act(async () => {
      result.current.apply(hit, "hit");
    });
    expect(result.current.engine!.player_hand.at(-1)).toEqual(A);
  });

  it("never counts a round, even if the setter leaves the betting phase (unlike apply)", async () => {
    const result = await startRun();
    await act(async () => {
      result.current.devSetEngine((s) => ({ ...s, phase: "player" }));
    });
    expect(result.current.engine!.phase).toBe("player");
    expect(result.current.engine!.round).toBeUndefined();
  });
});

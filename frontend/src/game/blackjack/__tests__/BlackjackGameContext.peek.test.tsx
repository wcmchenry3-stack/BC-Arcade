/**
 * #3741 review: a save from before the dealer's peek, mid-hand against a dealer natural, is settled
 * on load (`settleUnpeekedDealerNatural`) and then played out as a round just dealt: the session
 * the killed process left open resumes, the hand is counted (session stats, `hand_resolved`, the
 * round recorded as a peeked natural) and an all-in loss ends the run as a loss, saves the run and
 * clears the save, as the same loss in play does.
 */
import React from "react";
import { renderHook, act } from "@testing-library/react-native";

import { BlackjackGameProvider, useBlackjackGame } from "../BlackjackGameContext";
import { TABLE_CONFIGS } from "../tables";
import { newGame, placeBet, type Card, type EngineState } from "../engine";
import { clearGame, loadGame, saveGame, saveRun } from "../storage";
import type { ProgressSnapshot } from "../../_shared/useGameSync";

jest.mock("../storage", () => ({
  loadGame: jest.fn().mockResolvedValue(null),
  saveGame: jest.fn(),
  clearGame: jest.fn(),
  saveRun: jest.fn().mockResolvedValue(undefined),
  loadRuns: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../../entitlements/premiumLevels", () => ({ isPremiumLevel: () => false }));
jest.mock("../../_shared/lastDifficulty", () => ({ saveLastDifficulty: jest.fn() }));

interface Saved {
  type: string;
  data: Record<string, unknown>;
}
const mockSaves: Saved[][] = [];
const mockComplete = jest.fn();
const mockStart = jest.fn();
const mockResume = jest.fn(() => true);
jest.mock("../../_shared/useGameSync", () => ({
  useGameSync: () => ({
    start: (...a: unknown[]) => mockStart(...a),
    resume: () => mockResume(),
    markStarted: jest.fn(),
    enqueue: jest.fn(),
    enqueueMany: (events: Saved[]) => {
      mockSaves.push([...events]);
      return true;
    },
    complete: (...a: unknown[]) => mockComplete(...a),
    close: jest.fn(),
    setProgressSnapshot: (_g: () => ProgressSnapshot) => undefined,
    getGameId: () => "game-1",
    resetPlayWindow: jest.fn(),
  }),
}));

// The recorder's idle moments (requestIdleCallback), run by the test.
const idleTasks: (() => void)[] = [];
async function idle() {
  await act(async () => {
    while (idleTasks.length > 0) idleTasks.shift()!();
  });
}

const c = (rank: string, suit = "♠"): Card => ({ rank, suit });
const BEGINNER = TABLE_CONFIGS[0]!;

/**
 * A run at the beginner table with `chips`, bet 10 (or all in), dealt 10 8 against the dealer's
 * 7 9 and then saved, as an older build saved it, against the dealer's natural it never peeked at.
 * `round` is the saved round count (absent: a save from before #3284).
 */
function oldSave(chips: number, round?: number): EngineState {
  const deck = [
    ...Array.from({ length: 60 }, () => c("2", "♣")),
    c("9", "♦"),
    c("8", "♥"),
    c("7", "♣"),
    c("10"),
  ];
  const game = newGame(deck, {
    startingChips: BEGINNER.startingChips,
    runGoal: BEGINNER.runGoal,
    betMin: BEGINNER.betMin,
    betMax: BEGINNER.betMax,
    milestones: BEGINNER.milestones,
  });
  const dealt = placeBet({ ...game, chips }, Math.min(10, chips));
  expect(dealt.phase).toBe("player");
  const saved = { ...dealt, dealer_hand: [c("K", "♣"), c("A", "♦")], events: undefined };
  if (round !== undefined) saved.round = round;
  return saved;
}

async function mountWith(saved: EngineState) {
  (loadGame as jest.Mock).mockResolvedValueOnce(saved);
  const view = await renderHook(() => useBlackjackGame(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <BlackjackGameProvider>{children}</BlackjackGameProvider>
    ),
  });
  await act(async () => {});
  return view;
}

const recorded = () => mockSaves.flat();

beforeEach(() => {
  jest.clearAllMocks();
  mockSaves.length = 0;
  idleTasks.length = 0;
  mockResume.mockReturnValue(true);
  (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = (cb: () => void) => {
    idleTasks.push(cb);
    return idleTasks.length;
  };
});

afterEach(() => {
  delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
});

describe("a save from before the peek, all in against a dealer natural", () => {
  it("loads settled, ends the session as a loss, saves the run and clears the save", async () => {
    const { result } = await mountWith(oldSave(10, 4));
    expect(result.current.engine?.phase).toBe("result");
    expect(result.current.engine?.outcome).toBe("lose");
    expect(result.current.engine?.chips).toBe(0);
    // The session the killed process left open carries on, and ends as a loss.
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [payload, ended] = mockComplete.mock.calls[0]!;
    expect(payload).toMatchObject({ outcome: "loss", finalScore: 0 });
    expect(ended).toMatchObject({ total_hands: 1, outcome: "loss", final_chips: 0 });
    expect(saveRun).toHaveBeenCalledTimes(1);
    expect((saveRun as jest.Mock).mock.calls[0]![0]).toMatchObject({
      outcome: "loss",
      finalChips: 0,
      handsPlayed: 1,
    });
    expect(clearGame).toHaveBeenCalled();
  });
});

describe("a save from before the peek, chips left", () => {
  it("resumes the session, which stays open, and keeps the settled game", async () => {
    const { result } = await mountWith(oldSave(100, 4));
    expect(result.current.engine?.phase).toBe("result");
    expect(result.current.engine?.chips).toBe(90);
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(mockComplete).not.toHaveBeenCalled();
    expect(saveRun).not.toHaveBeenCalled();
    expect(clearGame).not.toHaveBeenCalled();
    // Saved settled, so a relaunch does not settle (and count) the round again.
    expect(saveGame).toHaveBeenCalledWith(expect.objectContaining({ phase: "result", chips: 90 }));
  });

  it("counts the hand: session stats, and the round recorded as a peeked natural", async () => {
    const { result } = await mountWith(oldSave(100, 4));
    expect(result.current.sessionStats).toMatchObject({ handsPlayed: 1, handsLost: 1, chips: 90 });
    await idle();
    const rows = recorded();
    expect(rows.map((r) => r.type)).toEqual(["round_played", "hand_resolved"]);
    expect(rows[0]!.data).toMatchObject({
      unit: 4,
      b: [10, 100],
      p: ["TS", "8H"],
      d: ["KC", "AD"],
    });
    expect(rows[0]!.data).not.toHaveProperty("a");
    expect(rows[0]!.data).not.toHaveProperty("dl");
    expect(rows[1]!.data).toMatchObject({ unit: 4, i: 0, o: "lose", p: -10, ch: 90 });
  });

  it("a save from before #3284 (no round count) is round 1, so the next bet is round 2", async () => {
    const { result } = await mountWith(oldSave(100));
    expect(result.current.engine?.round).toBe(1);
    await idle();
    expect(recorded()[0]!.data).toMatchObject({ unit: 1 });
  });
});

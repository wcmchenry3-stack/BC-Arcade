/**
 * #3764: 21 stands on its own. A save from an older build, mid-hand with the hand to play already
 * on 21 (it waited for a Stand then), is stood on load (`standOnTwentyOne`): the session the killed
 * process left open resumes, and the stand is recorded as the resumed round's action, `["s", i]`,
 * as a tapped Stand is. A single hand settles (counted, recorded with the dealer's play, an all-in
 * loss ends the run); a split hand moves play on to the next hand. In play, a hit to 21 records
 * the hit and then the stand.
 */
import React from "react";
import { renderHook, act } from "@testing-library/react-native";

import { BlackjackGameProvider, useBlackjackGame } from "../BlackjackGameContext";
import { TABLE_CONFIGS } from "../tables";
import { hit, newGame, placeBet, stand, type Card, type EngineState } from "../engine";
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
// Blackjack's visibility in this build (#3328): a hidden game starts no session.
const mockVisible = jest.fn(() => true);
jest.mock("../../../entitlements/gameVisibility", () => ({
  isGameVisible: () => mockVisible(),
}));

interface Saved {
  type: string;
  data: Record<string, unknown>;
}
const mockSaves: Saved[][] = [];
const mockComplete = jest.fn();
const mockStart = jest.fn();
const mockResume = jest.fn(() => true);
// The progress snapshot each markStarted persists (useGameSync's ping), as a killed process
// would leave it for the sweep (#2745).
let mockSnapshotGetter: (() => ProgressSnapshot) | undefined;
const mockSnapshots: ProgressSnapshot[] = [];
jest.mock("../../_shared/useGameSync", () => ({
  useGameSync: () => ({
    start: (...a: unknown[]) => mockStart(...a),
    resume: () => mockResume(),
    markStarted: () => {
      if (mockSnapshotGetter) mockSnapshots.push(mockSnapshotGetter());
    },
    enqueue: jest.fn(),
    enqueueMany: (events: Saved[]) => {
      mockSaves.push([...events]);
      return true;
    },
    complete: (...a: unknown[]) => mockComplete(...a),
    close: jest.fn(),
    setProgressSnapshot: (g: () => ProgressSnapshot) => {
      mockSnapshotGetter = g;
    },
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

/** A run at the beginner table with `chips`, whose shoe deals `draws` in order. */
function game(chips: number, draws: Card[]): EngineState {
  const deck = [...Array.from({ length: 60 }, () => c("2", "♣")), ...[...draws].reverse()];
  const g = newGame(deck, {
    startingChips: BEGINNER.startingChips,
    runGoal: BEGINNER.runGoal,
    betMin: BEGINNER.betMin,
    betMax: BEGINNER.betMax,
    milestones: BEGINNER.milestones,
  });
  return { ...g, chips };
}

/**
 * A single hand saved on 21 by a build before #3764: 7 4, hit a 10, waiting for a Stand. The
 * dealer has 10 6 and draws `dealerDraw` next.
 */
function savedOn21(chips: number, dealerDraw: Card, round = 5): EngineState {
  const dealt = placeBet(
    game(chips, [c("7"), c("10", "♣"), c("4", "♥"), c("6", "♦"), c("10", "♦"), dealerDraw]),
    Math.min(10, chips)
  );
  expect(dealt.phase).toBe("player");
  const drawn = dealt.deck[dealt.deck.length - 1]!;
  return {
    ...dealt,
    deck: dealt.deck.slice(0, -1),
    player_hand: [...dealt.player_hand, drawn],
    events: undefined,
    round,
  };
}

async function mountWith(saved: EngineState | null) {
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
  mockSnapshots.length = 0;
  idleTasks.length = 0;
  mockResume.mockReturnValue(true);
  mockVisible.mockReturnValue(true);
  (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = (cb: () => void) => {
    idleTasks.push(cb);
    return idleTasks.length;
  };
});

afterEach(() => {
  delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
});

describe("a single hand saved on 21 before #3764", () => {
  it("is stood on load: the dealer plays, the round settles and is saved settled", async () => {
    // The dealer's 16 draws a 2: 18, so the 21 wins.
    const { result } = await mountWith(savedOn21(100, c("2", "♥")));
    expect(result.current.engine?.phase).toBe("result");
    expect(result.current.engine?.outcome).toBe("win");
    expect(result.current.engine?.chips).toBe(110);
    // The session the killed process left open carries on.
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(mockStart).not.toHaveBeenCalled();
    // Saved settled, so a relaunch does not stand (and count) the round again.
    expect(saveGame).toHaveBeenCalledWith(expect.objectContaining({ phase: "result", chips: 110 }));
  });

  it("records the stand as the resumed round's action, then the dealer's play and the hand", async () => {
    const { result } = await mountWith(savedOn21(100, c("2", "♥"), 5));
    expect(result.current.sessionStats).toMatchObject({ handsPlayed: 1, handsWon: 1 });
    await idle();
    const rows = recorded();
    expect(rows.map((r) => r.type)).toEqual(["round_played", "hand_resolved"]);
    expect(rows[0]!.data).toMatchObject({
      unit: 5,
      b: [10, 100],
      d: ["TC", "6D"],
      a: [["s", 0]],
      dl: { d: ["2H"], t: 18 },
      r: 1,
    });
    expect(rows[0]!.data).not.toHaveProperty("p");
    expect(rows[1]!.data).toMatchObject({ unit: 5, i: 0, o: "win", p: 10, ch: 110 });
  });

  it("the progress snapshot persisted while it plays out carries the settled chips", async () => {
    await mountWith(savedOn21(100, c("2", "♥")));
    expect(mockSnapshots.length).toBeGreaterThan(0);
    for (const snap of mockSnapshots) {
      expect(snap.result).toMatchObject({ final_chips: 110 });
    }
  });

  it("in a build where Blackjack is hidden (#3328): stood and saved, but no session, nothing recorded or counted", async () => {
    mockVisible.mockReturnValue(false);
    const { result } = await mountWith(savedOn21(100, c("2", "♥")));
    expect(result.current.engine?.phase).toBe("result");
    expect(result.current.engine?.chips).toBe(110);
    expect(saveGame).toHaveBeenCalledWith(expect.objectContaining({ phase: "result", chips: 110 }));
    expect(mockResume).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
    expect(result.current.sessionStats).toMatchObject({ handsPlayed: 0 });
    expect(mockSnapshots).toEqual([]);
    await idle();
    expect(recorded()).toEqual([]);
  });

  it("all in: a 21 never loses here, so the run goes on (a push against the dealer's 3-card 21)", async () => {
    // A 21 loses only to the dealer's natural, and a save against one is settled on load by
    // `settleUnpeekedDealerNatural` first (#3741). The dealer's 16 draws a 5: 21, a push.
    const { result } = await mountWith(savedOn21(10, c("5", "♥")));
    expect(result.current.engine?.outcome).toBe("push");
    expect(result.current.engine?.chips).toBe(10);
    expect(mockComplete).not.toHaveBeenCalled();
    expect(saveRun).not.toHaveBeenCalled();
    expect(clearGame).not.toHaveBeenCalled();
  });
});

describe("a split hand saved on 21 before #3764", () => {
  /** 8s split: hand 1 8 3 then K (21, waiting for a Stand), hand 2 8 2. Dealer 6 9. */
  function splitOn21(): EngineState {
    const dealt = placeBet(game(100, [c("8"), c("6", "♣"), c("8", "♥"), c("9", "♦")]), 10);
    return {
      ...dealt,
      deck: [...dealt.deck, c("5", "♦")],
      split_count: 1,
      player_hands: [
        [c("8"), c("3", "♦"), c("K", "♣")],
        [c("8", "♥"), c("2", "♣")],
      ],
      hand_bets: [10, 10],
      hand_outcomes: [null, null],
      hand_payouts: [0, 0],
      active_hand_index: 0,
      split_from_aces: [false, false],
      events: undefined,
      round: 2,
    };
  }

  it("moves play on to the next hand on load; the round records both stands when it ends", async () => {
    const { result } = await mountWith(splitOn21());
    expect(result.current.engine?.phase).toBe("player");
    expect(result.current.engine?.active_hand_index).toBe(1);
    expect(saveGame).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "player", active_hand_index: 1 })
    );
    await idle();
    expect(recorded()).toEqual([]);
    await act(async () => result.current.apply(stand, "stand"));
    await idle();
    const rows = recorded();
    expect(rows[0]!.type).toBe("round_played");
    expect(rows[0]!.data).toMatchObject({
      unit: 2,
      a: [
        ["s", 0],
        ["s", 1],
      ],
      r: 1,
    });
  });
});

describe("a save below 21 is not touched", () => {
  it("stays in the player's phase, waiting for the player", async () => {
    const dealt = placeBet(game(100, [c("7"), c("10", "♣"), c("4", "♥"), c("6", "♦")]), 10);
    const saved = { ...dealt, events: undefined, round: 3 };
    const { result } = await mountWith(saved);
    expect(result.current.engine?.phase).toBe("player");
    expect(result.current.engine?.player_hand).toHaveLength(2);
    expect(saveGame).not.toHaveBeenCalled();
  });
});

describe("in play, a hit to 21", () => {
  it("settles at once and records the hit and the stand", async () => {
    const { result } = await mountWith(null);
    await act(async () => result.current.handleTableSelect(BEGINNER));
    await act(async () =>
      result.current.devSetEngine(() =>
        game(result.current.engine!.chips, [
          c("7"),
          c("10", "♣"),
          c("4", "♥"),
          c("6", "♦"),
          c("10", "♦"),
          c("2", "♥"),
        ])
      )
    );
    await act(async () => result.current.apply((s) => placeBet(s, 10)));
    expect(result.current.engine?.phase).toBe("player");
    await act(async () => result.current.apply(hit, "hit"));
    expect(result.current.engine?.phase).toBe("result");
    expect(result.current.engine?.outcome).toBe("win");
    await idle();
    const played = recorded().find((r) => r.type === "round_played")!;
    expect(played.data).toMatchObject({
      a: [
        ["h", 0, "TD"],
        ["s", 0],
      ],
      dl: { d: ["2H"], t: 18 },
    });
  });
});

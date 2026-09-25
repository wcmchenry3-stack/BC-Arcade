import React from "react";
import { render, fireEvent, act, waitFor, within } from "@testing-library/react-native";
import HeartsScreen from "../HeartsScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { HeartsRoundsProvider } from "../../game/hearts/RoundsContext";
import { createSeededRng, setRng } from "../../game/hearts/engine";
import * as engine from "../../game/hearts/engine";
import { AppState } from "react-native";
import {
  loadFinishedGameId,
  loadGame,
  saveFinishedGameId,
  saveGame,
} from "../../game/hearts/storage";
import type { Card, HeartsState, Suit } from "../../game/hearts/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";
import { scoreQueue } from "../../game/_shared/scoreQueue";
import type { ProgressSnapshot } from "../../game/_shared/useGameSync";
import type { GameRankResponse } from "../../api/types";
import { __setPremiumLevelsForTests } from "../../entitlements/premiumLevels";

jest.mock("../../game/hearts/storage", () => ({
  loadGame: jest.fn().mockResolvedValue(null),
  saveGame: jest.fn().mockResolvedValue(undefined),
  clearGame: jest.fn().mockResolvedValue(undefined),
  loadFinishedGameId: jest.fn().mockResolvedValue(null),
  saveFinishedGameId: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../game/hearts/playerNames", () => ({
  DEFAULT_NAMES: ["You", "West", "North", "East"],
  loadPlayerNames: jest.fn().mockResolvedValue(["You", "West", "North", "East"]),
  savePlayerNames: jest.fn().mockResolvedValue(undefined),
  validateName: jest.fn((v: string, def: string) => v.trim() || def),
}));

// The result card's rank lookup (#2677's sessionBoardAdapter, #2629).
const mockGetGameRank = jest.fn<Promise<GameRankResponse>, [string]>();
jest.mock("../../api/stats", () => ({
  statsApi: { getGameRank: (gameId: string) => mockGetGameRank(gameId) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => ({
  flushQueuedGames: () => Promise.resolve(),
}));
jest.mock("../../game/_shared/displayNameSync", () => ({
  ...jest.requireActual("../../game/_shared/displayNameSync"),
  flushDisplayNameSync: () => Promise.resolve(true),
}));

// A stand-in for useGameSync that keeps the real hook's session rules:
// start() and a successful resume() open a session, complete() closes it
// (getGameId() is null afterwards).
let mockOpenGameId: string | null = null;
const mockSyncStart = jest.fn((_eventData?: unknown, _metadata?: unknown) => {
  mockOpenGameId = "hearts-game";
});
const mockSyncComplete = jest.fn((_summary: unknown, _payload?: unknown) => {
  mockOpenGameId = null;
});
const mockSyncGetGameId = jest.fn((): string | null => mockOpenGameId);
// No killed-process session to continue by default (#2654).
const mockSyncResume = jest.fn(() => false);
const mockSetProgressSnapshot = jest.fn((_getter: () => ProgressSnapshot) => {});
const mockSyncMarkStarted = jest.fn();
const mockSyncRestart = jest.fn();
jest.mock("../../game/_shared/useGameSync", () => ({
  useGameSync: () => ({
    start: mockSyncStart,
    resume: mockSyncResume,
    markStarted: mockSyncMarkStarted,
    complete: mockSyncComplete,
    restart: mockSyncRestart,
    getGameId: mockSyncGetGameId,
    setProgressSnapshot: mockSetProgressSnapshot,
  }),
}));

/** The app was killed mid-game; reopening continues that session (#2654). */
function resumeKilledSession() {
  mockSyncResume.mockImplementation(() => {
    mockOpenGameId = "hearts-game";
    return true;
  });
}

function resetSyncMocks() {
  mockOpenGameId = null;
  mockSyncResume.mockReset();
  mockSyncResume.mockReturnValue(false);
  mockSyncStart.mockClear();
  mockSyncComplete.mockClear();
  mockSetProgressSnapshot.mockClear();
}

const mockNavigate = jest.fn();
const mockPopToTop = jest.fn();
const mockAddListener = jest.fn((_event: string, _cb: unknown) => jest.fn());
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: jest.fn(),
    popToTop: mockPopToTop,
    navigate: mockNavigate,
    addListener: mockAddListener,
  }),
  // No-op stub: blur-time save behavior is verified via manual TESTING.md repro.
  useFocusEffect: jest.fn(),
}));

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.useFakeTimers();

async function renderScreen() {
  return await render(
    <ThemeProvider>
      <HeartsRoundsProvider>
        <HeartsScreen />
      </HeartsRoundsProvider>
    </ThemeProvider>
  );
}

describe("HeartsScreen — pre-game persona selector (#1654)", () => {
  beforeEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(null);
  });

  it("renders all four preset options including Mixed Table", async () => {
    const { getAllByRole } = await renderScreen();
    await waitFor(() => {
      const labels = getAllByRole("radio").map((r) => r.props.accessibilityLabel as string);
      expect(labels.some((l) => /cautious/i.test(l))).toBe(true);
      expect(labels.some((l) => /schemer/i.test(l))).toBe(true);
      expect(labels.some((l) => /daring/i.test(l))).toBe(true);
      expect(labels.some((l) => /mixed table/i.test(l))).toBe(true);
    });
  });

  it("Mixed Table can be selected and reflects selected state", async () => {
    const { getAllByRole } = await renderScreen();
    await waitFor(() =>
      expect(
        getAllByRole("radio").some((r) => /mixed table/i.test(r.props.accessibilityLabel))
      ).toBe(true)
    );
    const mixedBtn = getAllByRole("radio").find((r) =>
      /mixed table/i.test(r.props.accessibilityLabel)
    )!;
    await fireEvent.press(mixedBtn);
    await waitFor(() => {
      const updated = getAllByRole("radio").find((r) =>
        /mixed table/i.test(r.props.accessibilityLabel)
      )!;
      expect(updated.props.accessibilityState.checked).toBe(true);
    });
  });

  it("opens on the opponent style of the last game (#1129)", async () => {
    await AsyncStorage.setItem("hearts.difficulty", "daring");
    const { getByTestId } = await renderScreen();
    await waitFor(() =>
      expect(getByTestId("hearts-difficulty-daring").props.accessibilityState.checked).toBe(true)
    );
  });

  it("remembers the opponent style a game starts with (#1129)", async () => {
    await AsyncStorage.removeItem("hearts.difficulty");
    const { getByTestId } = await renderScreen();
    await waitFor(() => getByTestId("hearts-difficulty-cautious"));
    await fireEvent.press(getByTestId("hearts-difficulty-cautious"));
    expect(await AsyncStorage.getItem("hearts.difficulty")).toBeNull();
    await fireEvent.press(getByTestId("hearts-start-game"));
    expect(await AsyncStorage.getItem("hearts.difficulty")).toBe("cautious");
  });
});

describe("HeartsScreen — passing phase (inline banner)", () => {
  beforeEach(() => {
    setRng(createSeededRng(42));
    // Provide a saved game in passing phase so the screen skips the pre-game picker.
    (loadGame as jest.Mock).mockResolvedValue(engine.dealGame());
  });

  afterEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(null);
  });

  it("shows inline banner with direction instruction", async () => {
    const { getByText } = await renderScreen();
    await waitFor(() => expect(getByText(/pass left/i)).toBeTruthy());
  });

  it("confirm button starts disabled (no cards selected)", async () => {
    const { getByRole } = await renderScreen();
    await waitFor(() => {
      const btn = getByRole("button", { name: /confirm/i });
      expect(btn.props.accessibilityState.disabled).toBe(true);
    });
  });

  it("renders no Modal during passing phase", async () => {
    const { queryByRole } = await renderScreen();
    await waitFor(() => {
      expect(queryByRole("dialog")).toBeNull();
    });
  });

  it("tapping a card increments the selection counter", async () => {
    const { getByText, queryAllByRole } = await renderScreen();
    await waitFor(() => expect(getByText(/0 of 3 selected/i)).toBeTruthy());
    const cardBtns = queryAllByRole("button").filter(
      (el) =>
        typeof el.props.accessibilityLabel === "string" &&
        /of\s+\w+/i.test(el.props.accessibilityLabel)
    );
    expect(cardBtns.length).toBeGreaterThan(0);
    await fireEvent.press(cardBtns[0]!);
    expect(getByText(/1 of 3 selected/i)).toBeTruthy();
  });

  it("unmounts cleanly while AI loop is pending", async () => {
    const { unmount } = await renderScreen();
    await waitFor(() => expect(loadGame).toHaveBeenCalled());
    await act(() => {
      jest.runAllTimers();
    });
    expect(() => unmount()).not.toThrow();
  });
});

describe("HeartsScreen — playing phase (no modal)", () => {
  function makePlayingState() {
    setRng(createSeededRng(42));
    const realState = engine.dealGame();
    return {
      ...realState,
      phase: "playing" as const,
      passDirection: "none" as const,
      passingComplete: true,
      currentPlayerIndex: 0,
    };
  }

  beforeEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(makePlayingState());
  });

  afterEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(null);
  });

  it("renders the Hearts title in the header", async () => {
    const { getAllByText } = await renderScreen();
    await waitFor(() => expect(getAllByText("Hearts").length).toBeGreaterThan(0));
  });

  it("⋯ menu Scoreboard item navigates to ScoreboardScreen with hearts gameKey", async () => {
    mockNavigate.mockClear();
    const { getByLabelText, getByText } = await renderScreen();
    await waitFor(() => getByLabelText("More options"));
    await fireEvent.press(getByLabelText("More options")); // open ⋯ menu
    await fireEvent.press(getByText("Scoreboard")); // tap Scoreboard item
    expect(mockNavigate).toHaveBeenCalledWith("Scoreboard", { gameKey: "hearts" });
  });

  it("⋯ menu Edit Names item opens the rename modal", async () => {
    const { getByLabelText, getByText } = await renderScreen();
    await waitFor(() => getByLabelText("More options"));
    await fireEvent.press(getByLabelText("More options")); // open ⋯ menu
    await fireEvent.press(getByText("Edit Names")); // tap Edit Names item
    // Rename modal title is in hearts.json under settings.rename_title
    expect(getByText("Player Names")).toBeTruthy();
  });

  it("human hand cards are rendered", async () => {
    const { queryAllByRole } = await renderScreen();
    await waitFor(() => {
      const cardBtns = queryAllByRole("button").filter(
        (el) =>
          el.props.accessibilityLabel &&
          !["More options", "Go back to home screen"].includes(el.props.accessibilityLabel)
      );
      expect(cardBtns.length).toBeGreaterThan(0);
    });
  });

  it("does not render numeric score badges next to seat labels during play", async () => {
    // Override with distinct non-trivial scores so any score rendered next to a
    // seat label would be clearly visible — and clearly not a card rank (1–13).
    const stateWithScores = {
      ...makePlayingState(),
      cumulativeScores: [59, 25, 41, 17],
    };
    (loadGame as jest.Mock).mockResolvedValue(stateWithScores);

    const { queryByText } = await renderScreen();
    await waitFor(() => expect(queryByText("59")).toBeNull());
    expect(queryByText("25")).toBeNull();
    expect(queryByText("41")).toBeNull();
    expect(queryByText("17")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regression: AI loop frozen when human taps card during trick animation
// ---------------------------------------------------------------------------
//
// Root cause: the AI loop awaits a Promise (trickAnimResolverRef.current) while
// showing the completed-trick animation. If the human tapped a card BEFORE the
// animation fired handleTrickAnimationComplete, handleCardPress would call
// setLastTrick(null) — clearing the animation — WITHOUT ever resolving the
// Promise. This left loopActiveRef.current === true permanently, freezing all
// subsequent AI turns.
//
// Fix: handleCardPress now returns early when lastTrick !== null, so the human
// cannot interact with the hand while the animation is in progress. Once the
// animation completes normally (handleTrickAnimationComplete → resolver →
// setLastTrick(null)), the human can play and the AI loop is free.
describe("HeartsScreen — AI loop frozen regression (race condition)", () => {
  // State: trick 13 is in progress — the human has already played the leading
  // card (♥5), and AI 1/2/3 each have one card left to follow.
  // currentPlayerIndex === 1 (AI 1's turn), so the AI loop should run 3 turns
  // and complete the hand (tricksPlayedInHand → 13 → phase "dealing").
  function makeFinalTrickInProgressState(): HeartsState {
    return {
      _v: 3,
      aiDifficulty: "medium",
      phase: "playing",
      handNumber: 1,
      passDirection: "none",
      cumulativeScores: [0, 0, 0, 0],
      handScores: [0, 0, 0, 0],
      scoreHistory: [],
      passSelections: [[], [], [], []],
      passingComplete: true,
      heartsBroken: true,
      isComplete: false,
      winnerIndex: null,
      events: [],
      tricksPlayedInHand: 12, // 12 complete, trick 13 started
      currentLeaderIndex: 0,
      currentPlayerIndex: 1, // AI 1 to play
      currentTrick: [
        { card: { suit: "hearts", rank: 5 }, playerIndex: 0 }, // human led ♥5
      ],
      playerHands: [
        [], // human has no cards left
        [{ suit: "diamonds", rank: 7 }], // AI 1
        [{ suit: "diamonds", rank: 8 }], // AI 2
        [{ suit: "diamonds", rank: 9 }], // AI 3
      ],
      wonCards: [[], [], [], []],
    };
  }

  beforeEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(makeFinalTrickInProgressState());
  });

  afterEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(null);
  });

  it("AI completes the final trick and the hand-end overlay appears", async () => {
    const { getByText } = await renderScreen();

    // Wait for the saved game to load.
    await waitFor(() => expect(loadGame).toHaveBeenCalled());

    // Advance timers past all 3 AI delays (3 × 400 ms) plus a buffer.
    // Before the fix, if the game reached this state after the human had tapped
    // a card mid-animation, loopActiveRef would be stuck true and no AI turn
    // would ever run — the game would freeze indefinitely here.
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    // AI 1/2/3 each void in hearts → each plays their diamond freely.
    // Human wins the trick (only ♥5 in the led suit).
    // tricksPlayedInHand reaches 13 → applyHandScoring → phase "dealing"
    // → "Hand Complete" modal rendered.
    await waitFor(() => expect(getByText("Hand Complete")).toBeTruthy());
  });
});

// ---------------------------------------------------------------------------
// CI investigation (#2372 follow-up): e2e/maestro/flows/hearts/ai-hand.yaml
// stalled waiting for "Your hand, 12 cards" after only the trick-1 leader's
// card appeared — the loop never advanced to the next AI's turn. This test
// reproduces the flow's exact interaction (tap a hand card immediately, before
// it's the human's turn — Maestro does this because PlayerHand's tapped card
// is a plain testID, not gated on turn state) against a real deal where an AI
// leads trick 1, to determine whether runAiTurns itself ever stalls or
// whether the flow was just racing a slow-but-eventually-fine AI loop.
// ---------------------------------------------------------------------------
describe("HeartsScreen — AI turn loop when an AI leads trick 1 (#2372 CI investigation)", () => {
  // Deals a full, valid 52-card deck round-robin across 4 hands, then swaps
  // whichever hand holds 2♣ into seat 2 (North) — the seat whose lead
  // requires 2 more AI turns (North → East) before the human's turn, matching
  // the CI screenshot (only North's 2♣ was ever visible in the trick).
  function makeTrick1AiLeadState(): HeartsState {
    const suits: Suit[] = ["clubs", "diamonds", "spades", "hearts"];
    const deck: Card[] = suits.flatMap((suit) =>
      Array.from({ length: 13 }, (_, i) => ({ suit, rank: (i + 1) as Card["rank"] }))
    );
    const hands: [Card[], Card[], Card[], Card[]] = [[], [], [], []];
    deck.forEach((card, i) => hands[i % 4]!.push(card));
    const holderIdx = hands.findIndex((h) => h.some((c) => c.suit === "clubs" && c.rank === 2));
    if (holderIdx !== 2) {
      const tmp = hands[2]!;
      hands[2] = hands[holderIdx]!;
      hands[holderIdx] = tmp;
    }
    return {
      _v: 3,
      aiDifficulty: "schemer", // matches HeartsScreen's default selectedDifficulty
      phase: "playing",
      handNumber: 1,
      passDirection: "left",
      cumulativeScores: [0, 0, 0, 0],
      handScores: [0, 0, 0, 0],
      scoreHistory: [],
      passSelections: [[], [], [], []],
      passingComplete: true,
      heartsBroken: false,
      isComplete: false,
      winnerIndex: null,
      events: [],
      tricksPlayedInHand: 0,
      currentLeaderIndex: 2,
      currentPlayerIndex: 2, // North (seat 2) leads trick 1 with 2♣
      currentTrick: [],
      playerHands: hands,
      wonCards: [[], [], [], []],
    };
  }

  beforeEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(makeTrick1AiLeadState());
  });

  afterEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(null);
  });

  it("North then East auto-play, reaching the human's turn, even after an early (ignored) tap", async () => {
    const { getByLabelText, getByTestId } = await renderScreen();
    await waitFor(() => expect(loadGame).toHaveBeenCalled());

    // Mirror the Maestro flow: tap hand-card slot 4 before it's the human's
    // turn. Every card is `disabled` (validCards === [] since
    // currentPlayerIndex !== HUMAN), so RN's Pressable never calls onPress —
    // a true no-op, not just a JS-level early-return in handleCardPress.
    const cardSlot = getByTestId("hearts-hand-card-4");
    const pressable = within(cardSlot).getByRole("button");
    await act(async () => {
      fireEvent.press(pressable);
    });

    // Advance well past North's delay(400) + East's delay(400) + re-renders.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    // If runAiTurns completed both AI turns, it's now the human's turn and
    // their hand is still 13 cards (they haven't played yet this trick).
    await waitFor(() => expect(getByLabelText("Your hand, 13 cards")).toBeTruthy());
  });
});

// ---------------------------------------------------------------------------
// #2506 — game over: the shared result card; #2629 — it shows the session
// board's rank for the finished game
// ---------------------------------------------------------------------------

function ranked(rank: number, is_best = true): GameRankResponse {
  return { rank, is_best, ranked: true, reason: null };
}

function noName(): GameRankResponse {
  return { rank: null, is_best: null, ranked: false, reason: "no_name" };
}

describe("HeartsScreen — result card (#2506, #2629)", () => {
  /**
   * The last trick of a hand with West already at 100, so the hand's end ends
   * the game. The human led ♥5 and wins the trick (+1 point); the AIs follow
   * with diamonds.
   */
  function lastTrickState(cumulativeScores: number[]): HeartsState {
    return {
      _v: 3,
      aiDifficulty: "daring",
      phase: "playing",
      handNumber: 7,
      passDirection: "none",
      cumulativeScores,
      handScores: [0, 0, 0, 0],
      scoreHistory: [],
      passSelections: [[], [], [], []],
      passingComplete: true,
      heartsBroken: true,
      isComplete: false,
      winnerIndex: null,
      events: [],
      tricksPlayedInHand: 12,
      currentLeaderIndex: 0,
      currentPlayerIndex: 1,
      currentTrick: [{ card: { suit: "hearts", rank: 5 }, playerIndex: 0 }],
      playerHands: [
        [],
        [{ suit: "diamonds", rank: 7 }],
        [{ suit: "diamonds", rank: 8 }],
        [{ suit: "diamonds", rank: 9 }],
      ],
      wonCards: [[], [], [], []],
    } as unknown as HeartsState;
  }

  /**
   * A reopened game (its killed session resumed, #2654) whose last trick the
   * AIs play out, ending the game.
   */
  async function finishGame(cumulativeScores: number[]) {
    resumeKilledSession();
    (loadGame as jest.Mock).mockResolvedValue(lastTrickState(cumulativeScores));
    const r = await renderScreen();
    await waitFor(() => expect(loadGame).toHaveBeenCalled());
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    return r;
  }

  function gameOverState(): HeartsState {
    return {
      ...lastTrickState([46, 100, 63, 52]),
      phase: "game_over",
      isComplete: true,
      winnerIndex: 0,
      currentTrick: [],
      playerHands: [[], [], [], []],
    } as unknown as HeartsState;
  }

  // Every request the app makes (only the display-name sync reaches it here).
  const fetchMock = jest.fn((_input: unknown, _init?: unknown) =>
    Promise.reject(new Error("no network in tests"))
  );
  const realFetch = global.fetch;
  /** Requests to the legacy Hearts routes (`POST /hearts/score`). */
  const heartsRequests = () =>
    fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => url.includes("/hearts/"));

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetDisplayNameCacheForTests();
    resetSyncMocks();
    mockGetGameRank.mockReset();
    mockGetGameRank.mockResolvedValue(noName());
    (saveFinishedGameId as jest.Mock).mockClear();
    (loadFinishedGameId as jest.Mock).mockResolvedValue(null);
    mockPopToTop.mockClear();
    fetchMock.mockClear();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(null);
    (loadFinishedGameId as jest.Mock).mockResolvedValue(null);
    global.fetch = realFetch;
  });

  it("shows You Win with the standings when the human finishes lowest", async () => {
    const r = await finishGame([45, 100, 63, 52]);
    const card = within(await r.findByTestId("hearts-result"));
    expect(card.getByTestId("hearts-result-title")).toHaveTextContent("You Win!");
    expect(card.getByText("West reached 100 · lowest score wins")).toBeTruthy();
    // Ranked lowest first: You 46, East 52, North 63, West 100.
    const rows = card.getAllByTestId(/^hearts-standing-/).map((row) => row.props.testID);
    expect(rows).toEqual([
      "hearts-standing-0",
      "hearts-standing-3",
      "hearts-standing-2",
      "hearts-standing-1",
    ]);
    expect(card.getByLabelText("1. You, 46 points")).toBeTruthy();
  });

  it("names the winner on a loss", async () => {
    const r = await finishGame([70, 100, 38, 52]);
    const card = within(await r.findByTestId("hearts-result"));
    expect(card.getByTestId("hearts-result-title")).toHaveTextContent("North Wins");
  });

  it("shows a tie when the human shares the lowest score", async () => {
    const r = await finishGame([37, 100, 38, 52]);
    const card = within(await r.findByTestId("hearts-result"));
    expect(card.getByTestId("hearts-result-title")).toHaveTextContent("It's a Tie!");
  });

  // #2517: the games row records who won — a tie is `push`.
  it.each([
    ["win", [45, 100, 63, 52]],
    ["loss", [70, 100, 38, 52]],
    ["push", [37, 100, 38, 52]],
  ])("records a %s on the games row", async (recorded, scores) => {
    await finishGame(scores as number[]);
    await waitFor(() => expect(mockSyncComplete).toHaveBeenCalled());
    expect(mockSyncComplete.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ outcome: recorded })
    );
  });

  // #2629: Hearts keeps no play clock, so it sends no duration — never 0.
  // #2629: the play clock's active time, never a hard-coded 0.
  it("records 100 minus the human's points with the game's play time", async () => {
    await finishGame([45, 100, 63, 52]);
    await waitFor(() => expect(mockSyncComplete).toHaveBeenCalledTimes(1));
    const [summary, payload] = mockSyncComplete.mock.calls[0]!;
    expect(summary).toEqual({
      outcome: "win",
      finalScore: 54,
      durationMs: expect.any(Number),
      result: { final_score: 54, vs_result: "win" },
    });
    // The AIs' three 400 ms turns ran on the clock (plus the test's own waits).
    const { durationMs } = summary as { durationMs: number };
    expect(durationMs).toBeGreaterThanOrEqual(1200);
    expect(durationMs).toBeLessThan(10_000);
    expect(payload).toEqual({ final_score: 54, vs_result: "win" });
  });

  it("a restored game's play time carries on from its save", async () => {
    resumeKilledSession();
    (loadGame as jest.Mock).mockResolvedValue({
      ...lastTrickState([45, 100, 63, 52]),
      accumulatedMs: 600_000,
    });
    await renderScreen();
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    await waitFor(() => expect(mockSyncComplete).toHaveBeenCalledTimes(1));
    const { durationMs } = mockSyncComplete.mock.calls[0]![0] as { durationMs: number };
    expect(durationMs).toBeGreaterThanOrEqual(601_200);
    expect(durationMs).toBeLessThan(610_000);
    // The final trick's save carries the play time, for a reopened game.
    const saved = (saveGame as jest.Mock).mock.calls.at(-1)![0] as HeartsState;
    expect(saved.accumulatedMs).toBeGreaterThanOrEqual(601_200);
  });

  /** Captures the screen's AppState listeners; call the returned restore after. */
  function captureAppState() {
    const listeners: ((state: string) => void)[] = [];
    const real = AppState.addEventListener;
    AppState.addEventListener = ((_type: string, handler: (state: string) => void) => {
      listeners.push(handler);
      return { remove: jest.fn() };
    }) as unknown as typeof AppState.addEventListener;
    return {
      emit: (state: string) => listeners.forEach((l) => l(state)),
      restore: () => {
        AppState.addEventListener = real;
      },
    };
  }

  it("time with the app in the background is not play time", async () => {
    const appState = captureAppState();
    try {
      resumeKilledSession();
      let release: (s: HeartsState) => void = () => {};
      (loadGame as jest.Mock).mockReturnValue(
        new Promise<HeartsState>((resolve) => {
          release = resolve;
        })
      );
      await renderScreen();
      // In the background before the saved game even loads: the ten minutes
      // away (the AIs finish the game meanwhile) add nothing to its 60 s.
      await act(async () => {
        appState.emit("background");
      });
      await act(async () => {
        release({ ...lastTrickState([45, 100, 63, 52]), accumulatedMs: 60_000 });
      });
      await act(async () => {
        jest.advanceTimersByTime(600_000);
      });
      await waitFor(() => expect(mockSyncComplete).toHaveBeenCalledTimes(1));
      expect(mockSyncComplete.mock.calls[0]![0]).toEqual(
        expect.objectContaining({ durationMs: 60_000 })
      );
    } finally {
      appState.restore();
    }
  });

  it("shows the finished game's rank under the display name, submitting nothing", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    mockGetGameRank.mockResolvedValue(ranked(4));
    const r = await finishGame([45, 100, 63, 52]);
    await waitFor(() => expect(r.getByText("Saved as Riley · #4 on the leaderboard")).toBeTruthy());
    // The id is read before complete() closes the session.
    expect(mockGetGameRank).toHaveBeenCalledWith("hearts-game");
    expect(r.queryByPlaceholderText("Enter your name")).toBeNull();
    // No POST /hearts/score, and nothing queued for one.
    expect(heartsRequests()).toEqual([]);
    expect(await scoreQueue.peek()).toEqual([]);
  });

  it("keeps the finished game's id so a reopened card can ask again", async () => {
    await finishGame([45, 100, 63, 52]);
    await waitFor(() => expect(saveFinishedGameId).toHaveBeenCalledWith("hearts-game"));
  });

  it("a game over with no open session asks for no rank", async () => {
    // No session to complete (e.g. an older build's saved game): no lookup.
    (loadGame as jest.Mock).mockResolvedValue(lastTrickState([45, 100, 63, 52]));
    const r = await renderScreen();
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(await r.findByTestId("hearts-result")).toBeTruthy();
    expect(mockSyncComplete).not.toHaveBeenCalled();
    expect(mockGetGameRank).not.toHaveBeenCalled();
    expect(saveFinishedGameId).not.toHaveBeenCalled();
  });

  it("a finished game resumed from storage asks for its rank again, submitting nothing", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    mockGetGameRank.mockResolvedValue(ranked(2));
    (loadFinishedGameId as jest.Mock).mockResolvedValue("hearts-game");
    (loadGame as jest.Mock).mockResolvedValue(gameOverState());
    const r = await renderScreen();
    expect(await r.findByTestId("hearts-result")).toBeTruthy();
    await waitFor(() => expect(r.getByText("Saved as Riley · #2 on the leaderboard")).toBeTruthy());
    expect(mockGetGameRank).toHaveBeenCalledWith("hearts-game");
    expect(mockSyncComplete).not.toHaveBeenCalled();
    expect(heartsRequests()).toEqual([]);
  });

  it("a finished game resumed without a saved id shows no leaderboard line", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    (loadGame as jest.Mock).mockResolvedValue(gameOverState());
    const r = await renderScreen();
    expect(await r.findByTestId("hearts-result")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockGetGameRank).not.toHaveBeenCalled();
    expect(r.queryByText(/Saved as/)).toBeNull();
  });

  // #2560 review, #2629: the app closed while the card asked for a display
  // name. Nothing was owed — the row synced itself — so the reopened card
  // just asks for the name again and then shows the rank; no scoreQueue item.
  it("resumes the name prompt and the rank lookup after a remount", async () => {
    const first = await finishGame([45, 100, 63, 52]);
    expect(await first.findByLabelText("Pick a display name for leaderboards")).toBeTruthy();
    await waitFor(() => expect(saveFinishedGameId).toHaveBeenCalledWith("hearts-game"));
    await first.unmount();

    // Reopened: the saved game-over state and its game id load.
    resetSyncMocks();
    mockGetGameRank.mockReset();
    mockGetGameRank.mockResolvedValue(ranked(1));
    (loadFinishedGameId as jest.Mock).mockResolvedValue("hearts-game");
    (loadGame as jest.Mock).mockResolvedValue(gameOverState());
    const again = await renderScreen();
    const input = await again.findByLabelText("Pick a display name for leaderboards");
    await act(async () => {
      await fireEvent.changeText(input, "Riley");
    });
    await act(async () => {
      await fireEvent.press(again.getByRole("button", { name: "Save" }));
    });
    await waitFor(() =>
      expect(again.getByText("Saved as Riley · #1 on the leaderboard")).toBeTruthy()
    );
    expect(mockGetGameRank).toHaveBeenCalledTimes(1);
    expect(mockGetGameRank).toHaveBeenCalledWith("hearts-game");
    expect(mockSyncComplete).not.toHaveBeenCalled();
    expect(await scoreQueue.peek()).toEqual([]);
    expect(heartsRequests()).toEqual([]);
  });

  it("Play Again deals a new game at the same difficulty", async () => {
    const r = await finishGame([45, 100, 63, 52]);
    await r.findByTestId("hearts-result");
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
    });
    expect(r.queryByTestId("hearts-result")).toBeNull();
    expect(r.getByLabelText("Your hand, 13 cards")).toBeTruthy();
    expect(await AsyncStorage.getItem("hearts.difficulty")).toBe("daring");
  });

  it("Play Again at a style that became premium deals at the default instead (#1129)", async () => {
    __setPremiumLevelsForTests({ hearts: ["daring"] });
    const dealGame = jest.spyOn(engine, "dealGame");
    try {
      const r = await finishGame([45, 100, 63, 52]);
      await r.findByTestId("hearts-result");
      await act(async () => {
        await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
      });
      expect(dealGame).toHaveBeenLastCalledWith("schemer");
      expect(await AsyncStorage.getItem("hearts.difficulty")).toBe("schemer");
    } finally {
      dealGame.mockRestore();
      __setPremiumLevelsForTests(null);
    }
  });

  it("Change Difficulty returns to the difficulty picker", async () => {
    const r = await finishGame([45, 100, 63, 52]);
    await r.findByTestId("hearts-result");
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Change Difficulty" }));
    });
    expect(r.getByTestId("hearts-start-game")).toBeTruthy();
  });

  it("Home returns to the lobby", async () => {
    const r = await finishGame([45, 100, 63, 52]);
    await r.findByTestId("hearts-result");
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Home" }));
    });
    expect(mockPopToTop).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #2629 — the session: ai_difficulty on start(), the hook's own abandon
// ---------------------------------------------------------------------------

describe("HeartsScreen — game session (#2629)", () => {
  /** The human holds the last card of the hand; the AIs have played. */
  function humanLastCardState(aiDifficulty: HeartsState["aiDifficulty"]): HeartsState {
    return {
      _v: 3,
      aiDifficulty,
      phase: "playing",
      handNumber: 3,
      passDirection: "none",
      cumulativeScores: [10, 20, 30, 40],
      handScores: [0, 0, 0, 0],
      scoreHistory: [
        [4, 6, 8, 8],
        [6, 14, 2, 4],
      ],
      passSelections: [[], [], [], []],
      passingComplete: true,
      heartsBroken: true,
      isComplete: false,
      winnerIndex: null,
      events: [],
      tricksPlayedInHand: 12,
      currentLeaderIndex: 1,
      currentPlayerIndex: 0,
      currentTrick: [
        { card: { suit: "diamonds", rank: 7 }, playerIndex: 1 },
        { card: { suit: "diamonds", rank: 8 }, playerIndex: 2 },
        { card: { suit: "diamonds", rank: 9 }, playerIndex: 3 },
      ],
      playerHands: [[{ suit: "hearts", rank: 5 }], [], [], []],
      wonCards: [[], [], [], []],
    } as unknown as HeartsState;
  }

  beforeEach(() => {
    resetSyncMocks();
    mockAddListener.mockClear();
  });

  afterEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(null);
  });

  it.each(["cautious", "mixed"] as const)(
    "the first card played starts the session with ai_difficulty %s",
    async (difficulty) => {
      (loadGame as jest.Mock).mockResolvedValue(humanLastCardState(difficulty));
      const r = await renderScreen();
      const slot = await r.findByTestId("hearts-hand-card-0");
      await act(async () => {
        fireEvent.press(within(slot).getByRole("button"));
      });
      expect(mockSyncStart).toHaveBeenCalledTimes(1);
      expect(mockSyncStart).toHaveBeenCalledWith(
        { initial_score: 0 },
        { ai_difficulty: difficulty }
      );
      expect(mockSyncMarkStarted).toHaveBeenCalled();
    }
  );

  it("leaves abandons to the hook: no beforeRemove listener", async () => {
    (loadGame as jest.Mock).mockResolvedValue(humanLastCardState("schemer"));
    const r = await renderScreen();
    await r.findByTestId("hearts-hand-card-0");
    expect(mockAddListener).not.toHaveBeenCalledWith("beforeRemove", expect.anything());
  });

  it("going to the background saves the game with its play time and stops the clock", async () => {
    const listeners: ((state: string) => void)[] = [];
    const real = AppState.addEventListener;
    AppState.addEventListener = ((_type: string, handler: (state: string) => void) => {
      listeners.push(handler);
      return { remove: jest.fn() };
    }) as unknown as typeof AppState.addEventListener;
    try {
      (loadGame as jest.Mock).mockResolvedValue({
        ...humanLastCardState("schemer"),
        accumulatedMs: 40_000,
      });
      const r = await renderScreen();
      await r.findByTestId("hearts-hand-card-0");
      await act(async () => {
        jest.advanceTimersByTime(5_000);
      });
      (saveGame as jest.Mock).mockClear();
      await act(async () => {
        listeners.forEach((l) => l("background"));
      });
      expect(saveGame).toHaveBeenCalledTimes(1);
      const saved = (saveGame as jest.Mock).mock.calls[0]![0] as HeartsState;
      expect(saved.accumulatedMs).toBeGreaterThanOrEqual(45_000);

      // An hour away, then back: the clock resumes where it stopped.
      await act(async () => {
        jest.advanceTimersByTime(3_600_000);
      });
      await act(async () => {
        listeners.forEach((l) => l("active"));
      });
      const getSnapshot = mockSetProgressSnapshot.mock.calls.at(-1)![0];
      expect(getSnapshot().durationMs).toBe(saved.accumulatedMs);
    } finally {
      AppState.addEventListener = real;
    }
  });

  it("registers a progress snapshot for the hook's abandon: play time, no score", async () => {
    (loadGame as jest.Mock).mockResolvedValue({
      ...humanLastCardState("schemer"),
      accumulatedMs: 40_000,
    });
    const r = await renderScreen();
    await r.findByTestId("hearts-hand-card-0");
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(mockSetProgressSnapshot).toHaveBeenCalled();
    const getSnapshot = mockSetProgressSnapshot.mock.calls.at(-1)![0];
    expect(getSnapshot()).toEqual({ result: { hands_played: 2 }, durationMs: 45_000 });
  });

  it("New Game mid-game abandons the game in play with its own progress", async () => {
    resumeKilledSession();
    (loadGame as jest.Mock).mockResolvedValue({
      ...humanLastCardState("schemer"),
      accumulatedMs: 40_000,
    });
    const r = await renderScreen();
    await r.findByTestId("hearts-hand-card-0");
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    await act(async () => {
      await fireEvent.press(r.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(r.getByText("New Game"));
    });
    await act(async () => {
      await fireEvent.press(r.getByLabelText("Start New")); // confirm the abandon dialog
    });
    expect(r.getByTestId("hearts-start-game")).toBeTruthy();
    expect(mockSyncComplete).toHaveBeenCalledTimes(1);
    expect(mockSyncComplete).toHaveBeenCalledWith(
      { outcome: "abandoned", durationMs: 45_000, result: { hands_played: 2 } },
      { hands_played: 2, outcome: "abandoned" }
    );
  });

  it("the source keeps no pendingSubmission queue or legacy Hearts API", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "HeartsScreen.tsx"), "utf8");
    expect(src).not.toMatch(/pendingSubmission/);
    expect(src).not.toMatch(/hearts\/(api|leaderboard|scoreSync)"/);
    expect(src).not.toMatch(/durationMs:\s*0/);
  });
});

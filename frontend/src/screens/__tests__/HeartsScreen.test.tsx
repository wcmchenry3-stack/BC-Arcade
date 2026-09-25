import React from "react";
import { render, fireEvent, act, waitFor, within } from "@testing-library/react-native";
import HeartsScreen from "../HeartsScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { HeartsRoundsProvider } from "../../game/hearts/RoundsContext";
import { createSeededRng, setRng } from "../../game/hearts/engine";
import * as engine from "../../game/hearts/engine";
import { loadGame } from "../../game/hearts/storage";
import type { Card, HeartsState, Suit } from "../../game/hearts/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { heartsApi } from "../../game/hearts/api";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";

jest.mock("../../game/hearts/storage", () => ({
  loadGame: jest.fn().mockResolvedValue(null),
  saveGame: jest.fn().mockResolvedValue(undefined),
  clearGame: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../game/hearts/playerNames", () => ({
  DEFAULT_NAMES: ["You", "West", "North", "East"],
  loadPlayerNames: jest.fn().mockResolvedValue(["You", "West", "North", "East"]),
  savePlayerNames: jest.fn().mockResolvedValue(undefined),
  validateName: jest.fn((v: string, def: string) => v.trim() || def),
}));

jest.mock("../../game/hearts/api", () => ({
  heartsApi: {
    submitScore: jest.fn().mockResolvedValue({ player_name: "test", score: 0, rank: 1 }),
  },
}));

// Shared so tests can assert how a finished game is recorded (#2517).
const mockSyncComplete = jest.fn();
const mockSyncGetGameId = jest.fn((): string | null => null);
// No killed-process session to continue (#2654). Stable, like the real hook's.
const mockSyncResume = jest.fn(() => false);
jest.mock("../../game/_shared/useGameSync", () => ({
  useGameSync: () => ({
    start: jest.fn(),
    resume: mockSyncResume,
    markStarted: jest.fn(),
    complete: mockSyncComplete,
    restart: jest.fn(),
    getGameId: mockSyncGetGameId,
  }),
}));

const mockNavigate = jest.fn();
const mockPopToTop = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: jest.fn(),
    popToTop: mockPopToTop,
    navigate: mockNavigate,
    addListener: jest.fn(() => jest.fn()),
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
      expect(updated.props.accessibilityState.selected).toBe(true);
    });
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
// #2506 — game over: the shared result card and leaderboard auto-submit
// ---------------------------------------------------------------------------

describe("HeartsScreen — result card (#2506)", () => {
  const submitScore = heartsApi.submitScore as jest.Mock;

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

  async function finishGame(cumulativeScores: number[]) {
    (loadGame as jest.Mock).mockResolvedValue(lastTrickState(cumulativeScores));
    const r = await renderScreen();
    await waitFor(() => expect(loadGame).toHaveBeenCalled());
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    return r;
  }

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetDisplayNameCacheForTests();
    submitScore.mockClear();
    mockPopToTop.mockClear();
  });

  afterEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(null);
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

  it("submits 100 minus the human's points under the display name", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    submitScore.mockResolvedValueOnce({ player_name: "Riley", score: 54, rank: 4 });
    const r = await finishGame([45, 100, 63, 52]);
    await waitFor(() => expect(r.getByText("Saved as Riley · #4 on the leaderboard")).toBeTruthy());
    expect(submitScore).toHaveBeenCalledTimes(1);
    expect(submitScore).toHaveBeenCalledWith("Riley", 54);
    expect(r.queryByPlaceholderText("Enter your name")).toBeNull();
  });

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

  it("does not resubmit a finished game resumed from storage", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    (loadGame as jest.Mock).mockResolvedValue(gameOverState());
    const r = await renderScreen();
    expect(await r.findByTestId("hearts-result")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(submitScore).not.toHaveBeenCalled();
  });

  it("clears the owed score once it is saved, so reopening sends nothing", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    const r = await finishGame([45, 100, 63, 52]);
    await waitFor(() => expect(r.getByText(/Saved as Riley/)).toBeTruthy());
    await waitFor(async () =>
      expect(await AsyncStorage.getItem("hearts_pending_submission")).toBeNull()
    );
  });

  // #2560 review: the app closed while the card still owed the score.
  it("resumes an interrupted submission when the finished game is reopened", async () => {
    // First visit: no display name, so the card asks for one — and the
    // player leaves without answering.
    const first = await finishGame([45, 100, 63, 52]);
    expect(await first.findByLabelText("Pick a display name for leaderboards")).toBeTruthy();
    await first.unmount();
    expect(submitScore).not.toHaveBeenCalled();

    // Reopened: the saved game-over state loads and the prompt is back.
    (loadGame as jest.Mock).mockResolvedValue(gameOverState());
    const again = await renderScreen();
    const input = await again.findByLabelText("Pick a display name for leaderboards");
    await act(async () => {
      await fireEvent.changeText(input, "Riley");
    });
    await act(async () => {
      await fireEvent.press(again.getByRole("button", { name: "Save" }));
    });
    await waitFor(() => expect(submitScore).toHaveBeenCalledWith("Riley", 54));
    expect(submitScore).toHaveBeenCalledTimes(1);
  });

  it("Play Again deals a new game at the same difficulty", async () => {
    const r = await finishGame([45, 100, 63, 52]);
    await r.findByTestId("hearts-result");
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
    });
    expect(r.queryByTestId("hearts-result")).toBeNull();
    expect(r.getByLabelText("Your hand, 13 cards")).toBeTruthy();
  });

  it("Change Difficulty returns to the difficulty picker", async () => {
    const r = await finishGame([45, 100, 63, 52]);
    await r.findByTestId("hearts-result");
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Change Difficulty" }));
    });
    expect(r.getByTestId("hearts-start-game")).toBeTruthy();
  });

  // #2517: the games row records who won — a tie is `push`.
  it.each([
    ["win", [45, 100, 63, 52]],
    ["loss", [70, 100, 38, 52]],
    ["push", [37, 100, 38, 52]],
  ])("records a %s on the games row", async (recorded, scores) => {
    mockSyncGetGameId.mockReturnValue("hearts-game");
    try {
      await finishGame(scores as number[]);
      await waitFor(() => expect(mockSyncComplete).toHaveBeenCalled());
      expect(mockSyncComplete.mock.calls[0]![0]).toEqual(
        expect.objectContaining({ outcome: recorded })
      );
    } finally {
      mockSyncGetGameId.mockReturnValue(null);
      mockSyncComplete.mockClear();
    }
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

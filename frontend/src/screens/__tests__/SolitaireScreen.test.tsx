/**
 * SolitaireScreen — screen-level interaction and lifecycle tests.
 *
 * The engine itself is pure and well-tested (#593); these tests focus on
 * the screen's selection state machine, HUD wiring, modals, save/resume
 * plumbing, and the result card with its leaderboard auto-submit.
 */

import React from "react";
import { render, fireEvent, act, waitFor, within } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo } from "react-native";

import SolitaireScreen from "../SolitaireScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { SolitaireScoreboardProvider } from "../../game/solitaire/SolitaireScoreboardContext";
import { createSeededRng, dealGame, setRng } from "../../game/solitaire/engine";
import { loadStats, saveStats } from "../../game/solitaire/storage";
import { WIN_CASCADE_MS } from "../../game/solitaire/components/SolitaireWinCascade";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";

// SolitaireScreen's first render pulls in the heaviest module graph in the
// suite (skia cascade, reanimated, sound, gesture handling); on a
// contended CI runner that first `render()` can exceed Jest's 5000ms
// default, independent of any actual behavioral slowness. Give this file
// more headroom rather than papering over it with retries.
jest.setTimeout(15000);

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// Capture the beforeRemove listener so tests can invoke it to simulate
// back-navigation without rendering a full navigation container.
const mockNavListeners = new Map<string, Array<() => void>>();
const mockAddListener = jest.fn((event: string, handler: () => void) => {
  const arr = mockNavListeners.get(event) ?? [];
  arr.push(handler);
  mockNavListeners.set(event, arr);
  return () => {
    const current = mockNavListeners.get(event) ?? [];
    mockNavListeners.set(
      event,
      current.filter((h) => h !== handler)
    );
  };
});

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: mockAddListener,
  }),
}));

jest.mock("@sentry/react-native", () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  init: jest.fn(),
  wrap: <T,>(x: T) => x,
}));

// Mock gameEventClient so we can assert start/complete calls from the
// useGameSync wiring without needing the real client to init.
const mockStartGame = jest.fn<string, [string, Record<string, unknown>, Record<string, unknown>]>();
const mockEnqueueEvent = jest.fn();
const mockCompleteGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => (mockStartGame as unknown as jest.Mock)(...args),
    enqueueEvent: (...args: unknown[]) => (mockEnqueueEvent as unknown as jest.Mock)(...args),
    completeGame: (...args: unknown[]) => (mockCompleteGame as unknown as jest.Mock)(...args),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

// The result card reads the synced game's rank (#2632, sessionBoardAdapter).
const mockGetGameRank = jest.fn();
jest.mock("../../api/stats", () => ({
  statsApi: { getGameRank: (gameId: string) => mockGetGameRank(gameId) },
}));
jest.mock("../../api/players", () => ({
  playersApi: { putMe: jest.fn((name: string) => Promise.resolve({ display_name: name })) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => ({
  flushQueuedGames: jest.fn(() => Promise.resolve()),
}));

async function renderScreen() {
  return await render(
    <ThemeProvider>
      <SolitaireScoreboardProvider>
        <SolitaireScreen />
      </SolitaireScoreboardProvider>
    </ThemeProvider>
  );
}

/** Flush the initial `loadGame()` promise so the pre-game modal (or a
 * resumed state, if mocked) is rendered before assertions run. */
async function mount() {
  const api = await renderScreen();
  await act(async () => {
    await Promise.resolve();
  });
  return api;
}

async function chooseDraw1(api: ReturnType<typeof renderScreen>) {
  await act(async () => {
    await fireEvent.press(api.getByLabelText("Draw 1"));
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  mockNavListeners.clear();
  mockAddListener.mockClear();
  mockStartGame.mockReset();
  mockStartGame.mockReturnValue("game-uuid-test");
  mockEnqueueEvent.mockReset();
  mockCompleteGame.mockReset();
  mockGetGameRank.mockReset();
});

describe("SolitaireScreen — pre-game modal", () => {
  it("renders the draw-mode modal on mount", async () => {
    const api = await mount();
    expect(api.getByLabelText("Draw 1")).toBeTruthy();
    expect(api.getByLabelText("Draw 3")).toBeTruthy();
  });

  it("deals a game after choosing Draw 1", async () => {
    const api = await mount();
    await chooseDraw1(api);
    expect(api.getByLabelText("Score: 0")).toBeTruthy();
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("deals a game after choosing Draw 3", async () => {
    const api = await mount();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Draw 3"));
    });
    expect(api.getByLabelText("Score: 0")).toBeTruthy();
  });
});

describe("SolitaireScreen — board layout", () => {
  it("renders 7 tableau columns with correct initial sizes", async () => {
    const api = await mount();
    await chooseDraw1(api);
    for (let i = 0; i < 7; i++) {
      expect(api.getByLabelText(`Tableau column ${i + 1}, ${i + 1} cards`)).toBeTruthy();
    }
  });

  it("renders 4 empty foundation placeholders (one per suit)", async () => {
    const api = await mount();
    await chooseDraw1(api);
    expect(api.getByLabelText("Empty Spades foundation")).toBeTruthy();
    expect(api.getByLabelText("Empty Hearts foundation")).toBeTruthy();
    expect(api.getByLabelText("Empty Diamonds foundation")).toBeTruthy();
    expect(api.getByLabelText("Empty Clubs foundation")).toBeTruthy();
  });

  it("shows the stock pile with 24 draw cards remaining", async () => {
    const api = await mount();
    await chooseDraw1(api);
    expect(api.getByLabelText("Draw 1 from stock, 24 cards remaining")).toBeTruthy();
  });
});

describe("SolitaireScreen — stock & waste", () => {
  it("tapping the stock draws a card onto the waste", async () => {
    const api = await mount();
    await chooseDraw1(api);
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    expect(api.getByLabelText("Draw 1 from stock, 23 cards remaining")).toBeTruthy();
  });
});

describe("SolitaireScreen — hint button", () => {
  it("renders an enabled Hint button in the header when hints exist on a fresh deal", async () => {
    const api = await mount();
    await chooseDraw1(api);
    const hint = api.getByLabelText("Hint");
    expect(hint.props.accessibilityState?.disabled).toBe(false);
  });

  it("disables Hint after the game is complete", async () => {
    const suits = ["spades", "hearts", "diamonds", "clubs"] as const;
    const rankSeq = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
    const full = suits.flatMap((suit) => rankSeq.map((rank) => ({ suit, rank, faceUp: true })));
    const winState = {
      _v: 1,
      drawMode: 1,
      tableau: [[], [], [], [], [], [], []],
      foundations: {
        spades: full.filter((c) => c.suit === "spades"),
        hearts: full.filter((c) => c.suit === "hearts"),
        diamonds: full.filter((c) => c.suit === "diamonds"),
        clubs: full.filter((c) => c.suit === "clubs"),
      },
      stock: [],
      waste: [],
      score: 820,
      recycleCount: 0,
      undoStack: [],
      isComplete: true,
      startedAt: null,
      accumulatedMs: 0,
    };
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(winState));
    const api = await mount();
    // The result card uses accessibilityViewIsModal, which hides the header from
    // accessibility queries; includeHiddenElements bypasses that restriction
    const hint = api.getByTestId("solitaire-hint-button", {
      includeHiddenElements: true,
    });
    expect(hint.props.accessibilityState?.disabled).toBe(true);
  });
});

describe("SolitaireScreen — undo affordance", () => {
  it("renders an Undo button in the header that is disabled on a fresh deal", async () => {
    const api = await mount();
    await chooseDraw1(api);
    const undo = api.getByLabelText("Undo");
    expect(undo.props.accessibilityState?.disabled).toBe(true);
  });

  it("enables Undo after a stock draw and reverts the draw on press", async () => {
    const api = await mount();
    await chooseDraw1(api);
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    const undo = api.getByLabelText("Undo");
    expect(undo.props.accessibilityState?.disabled).toBe(false);
    await act(async () => {
      await fireEvent.press(undo);
    });
    expect(api.getByLabelText("Draw 1 from stock, 24 cards remaining")).toBeTruthy();
  });
});

describe("SolitaireScreen — auto-complete", () => {
  it("does not render the auto-complete button on a fresh deal (face-down cards exist)", async () => {
    const api = await mount();
    await chooseDraw1(api);
    expect(api.queryByLabelText("Auto-Complete")).toBeNull();
  });
});

describe("SolitaireScreen — new game confirmation", () => {
  it("returns to the pre-game modal after confirming via ⋯ menu", async () => {
    const api = await mount();
    await chooseDraw1(api);
    await act(async () => {
      await fireEvent.press(api.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(api.getByText("New Game"));
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Start New"));
    });
    expect(api.getByLabelText("Draw 1")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// #597 — lifecycle
// ---------------------------------------------------------------------------

describe("SolitaireScreen — save/resume lifecycle", () => {
  it("resumes a saved game silently on mount (no pre-game modal)", async () => {
    const saved = dealGame(3, 12345);
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(saved));
    const api = await mount();
    // The pre-game modal is not shown — HUD is.
    expect(api.queryByLabelText("Draw 1")).toBeNull();
    expect(api.getByLabelText("Score: 0")).toBeTruthy();
    expect(api.getByLabelText("Draw 3 from stock, 24 cards remaining")).toBeTruthy();
  });

  it("persists state to AsyncStorage after a stock draw", async () => {
    const api = await mount();
    await chooseDraw1(api);
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem("solitaire_game");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.stock.length).toBe(23);
    });
  });

  it("clears AsyncStorage when the user starts a New Game via ⋯ menu", async () => {
    const api = await mount();
    await chooseDraw1(api);
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    await waitFor(async () => {
      expect(await AsyncStorage.getItem("solitaire_game")).not.toBeNull();
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(api.getByText("New Game"));
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Start New"));
    });
    expect(await AsyncStorage.getItem("solitaire_game")).toBeNull();
  });
});

describe("SolitaireScreen — useGameSync lifecycle", () => {
  it("starts a sync session on the first move (not on mount)", async () => {
    const api = await mount();
    await chooseDraw1(api);
    expect(mockStartGame).not.toHaveBeenCalled();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    const [gameType] = mockStartGame.mock.calls[0] ?? [];
    expect(gameType).toBe("solitaire");
  });

  // #2632: draw_mode is the row's metadata (SolitaireMetadata), not only event data.
  it.each([
    ["Draw 1", 1, "Draw 1 from stock, 24 cards remaining"],
    ["Draw 3", 3, "Draw 3 from stock, 24 cards remaining"],
  ])("sends %s as draw_mode in the start metadata", async (label, drawMode, stockLabel) => {
    const api = await mount();
    await act(async () => {
      await fireEvent.press(api.getByLabelText(label));
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText(stockLabel));
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    const [, metadata, eventData] = mockStartGame.mock.calls[0] ?? [];
    expect(metadata).toEqual({ draw_mode: drawMode });
    expect(eventData).toEqual({ draw_mode: drawMode });
  });

  it("does not start a second session on subsequent moves", async () => {
    const api = await mount();
    await chooseDraw1(api);
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Draw 1 from stock, 23 cards remaining"));
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);
  });

  // #2632: no screen-level beforeRemove abandon (it sent the score so far).
  it("does not complete the session on beforeRemove", async () => {
    const api = await mount();
    await chooseDraw1(api);
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    expect(mockAddListener).not.toHaveBeenCalledWith("beforeRemove", expect.anything());
    await act(async () => {
      for (const h of mockNavListeners.get("beforeRemove") ?? []) h();
    });
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  // Regression (#2632): back-navigation unmounts the screen, and the hook's own
  // abandon records the game with the progress snapshot and no score.
  it("back-navigation mid-game abandons via the hook with the snapshot and no score", async () => {
    const api = await mount();
    await chooseDraw1(api);
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    await act(async () => {
      api.unmount();
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [gameId, summary] = mockCompleteGame.mock.calls[0];
    expect(gameId).toBe("game-uuid-test");
    // #2450 — the result block satisfies backend SolitaireResult (won + moves).
    expect(summary).toEqual({ outcome: "abandoned", result: { won: false, moves: 1 } });
  });

  it("does not record an abandon before any moves are made", async () => {
    const api = await mount();
    await chooseDraw1(api);
    await act(async () => {
      api.unmount();
    });
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });
});

describe("SolitaireScreen — result card (#2509)", () => {
  const suits = ["spades", "hearts", "diamonds", "clubs"] as const;
  const rankSeq = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
  const full = suits.flatMap((suit) => rankSeq.map((rank) => ({ suit, rank, faceUp: true })));
  const foundation = (suit: (typeof suits)[number]) => full.filter((c) => c.suit === suit);

  /** A saved game that is already won (resumed after the app was killed). */
  async function mountAtWonState(drawMode: 1 | 3 = 1) {
    const winState = {
      _v: 1,
      drawMode,
      tableau: [[], [], [], [], [], [], []],
      foundations: {
        spades: foundation("spades"),
        hearts: foundation("hearts"),
        diamonds: foundation("diamonds"),
        clubs: foundation("clubs"),
      },
      stock: [],
      waste: [],
      score: 820,
      recycleCount: 0,
      undoStack: [],
      isComplete: true,
      startedAt: null,
      accumulatedMs: 95000,
      // Saved with the winning move's events, as a real save would be.
      events: ["foundationComplete", "gameWin"],
    };
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(winState));
    return await mount();
  }

  /** A saved game one move from winning: the King of Clubs waits on the waste. */
  async function mountOneMoveFromWin() {
    const nearWin = {
      _v: 1,
      drawMode: 1,
      tableau: [[], [], [], [], [], [], []],
      foundations: {
        spades: foundation("spades"),
        hearts: foundation("hearts"),
        diamonds: foundation("diamonds"),
        clubs: foundation("clubs").slice(0, 12),
      },
      stock: [],
      waste: [{ suit: "clubs", rank: 13, faceUp: true }],
      score: 800,
      recycleCount: 0,
      undoStack: [],
      isComplete: false,
      startedAt: null,
      accumulatedMs: 61000,
    };
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(nearWin));
    return await mount();
  }

  async function playWinningMove(api: Awaited<ReturnType<typeof mount>>) {
    const king = api.getByLabelText("K of Clubs");
    await act(async () => {
      await fireEvent.press(king); // select
    });
    await act(async () => {
      await fireEvent.press(king); // double-tap → foundation
    });
  }

  /** Wins in-session and waits for the card (the cascade is skipped under reduce motion). */
  async function winNow() {
    const api = await mountOneMoveFromWin();
    await playWinningMove(api);
    await api.findByTestId("solitaire-result");
    return api;
  }

  let reduceMotion: jest.SpyInstance;

  afterEach(() => reduceMotion.mockRestore());

  beforeEach(() => {
    resetDisplayNameCacheForTests();
    reduceMotion = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    mockGetGameRank.mockResolvedValue({ ranked: true, rank: 3, is_best: true, reason: null });
  });

  it("shows the shared card with the score, draw mode and actions", async () => {
    const api = await mountAtWonState(3);
    const card = within(await api.findByTestId("solitaire-result"));
    expect(card.getByTestId("solitaire-result-title")).toHaveTextContent("You Win!");
    expect(card.getByText(/Draw 3/)).toBeTruthy();
    expect(card.getByText("820")).toBeTruthy();
    expect(card.getByText("1:35")).toBeTruthy();
    expect(card.getByRole("button", { name: "Play Again" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Change Mode" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Home" })).toBeTruthy();
  });

  // #2632: the card reads the synced game's rank; nothing is posted to /solitaire/score.
  it("shows the synced game's rank under the saved display name with no name entry", async () => {
    await AsyncStorage.setItem("player_display_name", "Alice");
    const api = await winNow();
    await waitFor(() => {
      expect(api.getByText("Saved as Alice · #3 on the leaderboard")).toBeTruthy();
    });
    expect(mockGetGameRank).toHaveBeenCalledTimes(1);
    expect(mockGetGameRank).toHaveBeenCalledWith("game-uuid-test");
    expect(api.queryByLabelText("Your name")).toBeNull();
  });

  it("completes the win with the score before the card reads its rank", async () => {
    await AsyncStorage.setItem("player_display_name", "Alice");
    await winNow();
    await waitFor(() => expect(mockGetGameRank).toHaveBeenCalled());
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [gameId, summary] = mockCompleteGame.mock.calls[0];
    expect(gameId).toBe("game-uuid-test");
    expect(summary).toEqual(
      expect.objectContaining({
        outcome: "completed",
        finalScore: expect.any(Number),
        result: expect.objectContaining({ won: true }),
      })
    );
  });

  it("asks for a display name once when none is set, then shows the rank", async () => {
    const api = await winNow();
    const input = await api.findByLabelText("Pick a display name for leaderboards");
    expect(mockGetGameRank).not.toHaveBeenCalled();

    await act(async () => {
      await fireEvent.changeText(input, "Alice");
    });
    await act(async () => {
      await fireEvent.press(api.getByRole("button", { name: "Save" }));
    });
    await waitFor(() => {
      expect(api.getByText("Saved as Alice · #3 on the leaderboard")).toBeTruthy();
    });
    expect(mockGetGameRank).toHaveBeenCalledWith("game-uuid-test");
  });

  // #2556 review: the app closed after a win but before the save was cleared.
  it("does not resubmit or replay the cascade for a resumed, already-won game", async () => {
    reduceMotion.mockResolvedValue(false);
    await AsyncStorage.setItem("player_display_name", "Alice");
    const api = await mountAtWonState();

    // Straight to the card — no cascade despite the saved gameWin event.
    expect(api.getByTestId("solitaire-result")).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mockGetGameRank).not.toHaveBeenCalled();
    expect(api.queryByText(/Saved as/)).toBeNull();
  });

  it("plays the win cascade, then reveals the card and records the win once", async () => {
    reduceMotion.mockResolvedValue(false);
    await AsyncStorage.setItem("player_display_name", "Alice");
    await saveStats({ bestTimeMs: 90000, bestMoves: 80, gamesPlayed: 3, gamesWon: 1 });
    const api = await mountOneMoveFromWin();
    await playWinningMove(api);

    // The cascade plays over the board before the card appears.
    expect(api.queryByTestId("solitaire-result")).toBeNull();
    const card = within(
      await api.findByTestId("solitaire-result", undefined, { timeout: WIN_CASCADE_MS + 2000 })
    );

    // 61 s beats the 90 s best.
    expect(card.getByText("New best")).toBeTruthy();
    expect(card.getByText("Moves")).toBeTruthy();
    await waitFor(() => expect(mockGetGameRank).toHaveBeenCalledTimes(1));
    expect((await loadStats()).gamesWon).toBe(2);
  });

  it("Play Again deals a new game in the same draw mode, skipping the picker", async () => {
    await AsyncStorage.setItem("player_display_name", "Alice");
    const api = await mountAtWonState(3);
    await api.findByTestId("solitaire-result");
    await act(async () => {
      await fireEvent.press(api.getByRole("button", { name: "Play Again" }));
    });

    expect(api.queryByTestId("solitaire-result")).toBeNull();
    expect(api.queryByLabelText("Draw 1")).toBeNull();
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
    await waitFor(async () => {
      const saved = JSON.parse((await AsyncStorage.getItem("solitaire_game")) ?? "null");
      expect(saved).toEqual(expect.objectContaining({ drawMode: 3, isComplete: false }));
    });
  });

  // Regression #741: starting a new game from the win screen used to throw
  // `Property 'setShowNewGameConfirm' doesn't exist`.
  it("Change Mode returns to the draw-mode picker and clears the saved game", async () => {
    const api = await mountAtWonState();
    await act(async () => {
      await fireEvent.press(await api.findByRole("button", { name: "Change Mode" }));
    });
    expect(api.getByLabelText("Draw 1")).toBeTruthy();
    expect(await AsyncStorage.getItem("solitaire_game")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #761 — stats tracking
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Story 8 — selection state machine: face-down no-op + re-select on invalid
// ---------------------------------------------------------------------------

describe("SolitaireScreen — selection state machine (Story 8)", () => {
  it("face-down tableau card with active selection is a no-op (selection preserved)", async () => {
    // Col 0: 3♥ (face-up valid destination for 2♠)
    // Col 1: 9♦ (face-down)  ← pressing this should be a no-op
    // Waste: 2♠
    const state = {
      _v: 1,
      drawMode: 1,
      tableau: [
        [{ suit: "hearts", rank: 3, faceUp: true }],
        [{ suit: "diamonds", rank: 9, faceUp: false }],
        [],
        [],
        [],
        [],
        [],
      ],
      foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
      stock: [],
      waste: [{ suit: "spades", rank: 2, faceUp: true }],
      score: 0,
      recycleCount: 0,
      undoStack: [],
      isComplete: false,
      startedAt: null,
      accumulatedMs: 0,
    };
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(state));
    const api = await mount();

    await act(async () => {
      await fireEvent.press(api.getByLabelText("2 of Spades")); // select waste
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Face-down card")); // no-op: face-down card
    });
    // If selection was preserved, the next press on a valid destination executes the move.
    await act(async () => {
      await fireEvent.press(api.getByLabelText("3 of Hearts")); // waste-to-tableau: 2♠ on 3♥
    });
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
  });

  it("tapping an invalid face-up destination re-selects to that card", async () => {
    // Col 0: 8♣ (black rank 8 — cannot land on rank 5)
    // Col 1: 5♥ (red rank 5 — invalid destination for 8♣)
    const state = {
      _v: 1,
      drawMode: 1,
      tableau: [
        [{ suit: "clubs", rank: 8, faceUp: true }],
        [{ suit: "hearts", rank: 5, faceUp: true }],
        [],
        [],
        [],
        [],
        [],
      ],
      foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
      stock: [],
      waste: [],
      score: 0,
      recycleCount: 0,
      undoStack: [],
      isComplete: false,
      startedAt: null,
      accumulatedMs: 0,
    };
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(state));
    const api = await mount();

    await act(async () => {
      await fireEvent.press(api.getByLabelText("8 of Clubs")); // select col 0
    });
    expect(api.getByLabelText("8 of Clubs (selected)")).toBeTruthy();

    await act(async () => {
      await fireEvent.press(api.getByLabelText("5 of Hearts")); // invalid destination → re-select col 1
    });
    expect(api.getByLabelText("5 of Hearts (selected)")).toBeTruthy();
    expect(api.queryByLabelText("8 of Clubs (selected)")).toBeNull();
  });

  // Regression #1927 — double-fire in DraggableCard caused a single tap on the
  // waste card to trigger the double-tap handler and auto-move to foundation.
  // DraggableCard.test.tsx guards the device-level double-fire; these tests
  // guard the handleWastePress logic that interprets the tap count.
  function buildAceOfSpadesState() {
    return {
      _v: 1,
      drawMode: 1,
      tableau: [[], [], [], [], [], [], []],
      foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
      stock: [],
      waste: [{ suit: "spades", rank: 1, faceUp: true }],
      score: 0,
      recycleCount: 0,
      undoStack: [],
      isComplete: false,
      startedAt: null,
      accumulatedMs: 0,
    };
  }

  it("double-tap on waste card with valid foundation move moves it", async () => {
    // First tap selects waste; second tap (within 300ms) triggers double-tap → waste-to-foundation.
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(buildAceOfSpadesState()));
    const api = await mount();

    await act(async () => {
      await fireEvent.press(api.getByLabelText("A of Spades")); // tap 1 → select
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText("A of Spades")); // tap 2 → double-tap → foundation
    });

    expect(api.queryByLabelText("Empty Spades foundation")).toBeNull();
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
  });
});

describe("SolitaireScreen — tap-to-select and two-tap moves", () => {
  function buildSmartTapState(
    overrides: Partial<import("../../game/solitaire/types").SolitaireState> = {}
  ) {
    return {
      _v: 1,
      drawMode: 1,
      tableau: [[], [], [], [], [], [], []],
      foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
      stock: [],
      waste: [],
      score: 0,
      recycleCount: 0,
      undoStack: [],
      isComplete: false,
      startedAt: null,
      accumulatedMs: 0,
      ...overrides,
    };
  }

  it("single tap on tableau card selects instead of auto-moving", async () => {
    // 8♥ (red) in col 0 can go onto 9♠ (col 1) or 9♣ (col 2) — both run-length 1 → ambiguous → select.
    const state = buildSmartTapState({
      tableau: [
        [{ suit: "hearts", rank: 8, faceUp: true }],
        [{ suit: "spades", rank: 9, faceUp: true }],
        [{ suit: "clubs", rank: 9, faceUp: true }],
        [],
        [],
        [],
        [],
      ],
    });
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(state));
    const api = await mount();

    await act(async () => {
      await fireEvent.press(api.getByLabelText("8 of Hearts"));
    });

    // Selection highlights the card rather than moving it — moves stays at 0.
    expect(api.getByLabelText("8 of Hearts (selected)")).toBeTruthy();
    expect(api.queryByLabelText("Moves: 1")).toBeNull();
  });

  it("second tap on valid destination resolves after ambiguous first tap", async () => {
    // 8♥ (red) in col 0 ambiguous → select. Tap 9♠ in col 1 → execute tableau move.
    const state = buildSmartTapState({
      tableau: [
        [{ suit: "hearts", rank: 8, faceUp: true }],
        [{ suit: "spades", rank: 9, faceUp: true }],
        [{ suit: "clubs", rank: 9, faceUp: true }],
        [],
        [],
        [],
        [],
      ],
    });
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(state));
    const api = await mount();

    await act(async () => {
      await fireEvent.press(api.getByLabelText("8 of Hearts")); // select
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText("9 of Spades")); // resolve
    });

    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
    expect(api.queryByLabelText("8 of Hearts (selected)")).toBeNull();
  });

  it("single tap on waste card with ambiguous destinations selects it instead of auto-moving", async () => {
    // 5♥ (red) in waste; 6♠ (col 0) and 6♣ (col 1) are both valid — equal run length → ambiguous → select.
    const state = buildSmartTapState({
      waste: [{ suit: "hearts", rank: 5, faceUp: true }],
      tableau: [
        [{ suit: "spades", rank: 6, faceUp: true }],
        [{ suit: "clubs", rank: 6, faceUp: true }],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(state));
    const api = await mount();

    await act(async () => {
      await fireEvent.press(api.getByLabelText("5 of Hearts"));
    });

    // Card is still in waste — not auto-moved.
    expect(api.getByLabelText("5 of Hearts")).toBeTruthy();
    expect(api.queryByLabelText("Moves: 1")).toBeNull();
  });

  it("second tap on valid destination resolves ambiguous waste selection", async () => {
    // 5♥ ambiguous → select, then tap 6♠ → waste-to-tableau executes.
    const state = buildSmartTapState({
      waste: [{ suit: "hearts", rank: 5, faceUp: true }],
      tableau: [
        [{ suit: "spades", rank: 6, faceUp: true }],
        [{ suit: "clubs", rank: 6, faceUp: true }],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(state));
    const api = await mount();

    await act(async () => {
      await fireEvent.press(api.getByLabelText("5 of Hearts")); // ambiguous → select
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText("6 of Spades")); // resolve → waste-to-tableau
    });

    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
  });

  it("stock tap still draws — smart tap does not intercept stock", async () => {
    const state = buildSmartTapState({
      stock: [
        { suit: "hearts", rank: 3, faceUp: false },
        { suit: "clubs", rank: 7, faceUp: false },
      ],
    });
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(state));
    const api = await mount();

    await act(async () => {
      await fireEvent.press(api.getByLabelText("Draw 1 from stock, 2 cards remaining"));
    });

    expect(api.getByLabelText("Draw 1 from stock, 1 cards remaining")).toBeTruthy();
  });
});

describe("SolitaireScreen — stats tracking", () => {
  it("increments gamesPlayed when the player chooses a draw mode", async () => {
    const api = await mount();
    await chooseDraw1(api);
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem("solitaire_stats_v1");
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!).gamesPlayed).toBe(1);
    });
  });

  it("does not double-count gamesPlayed when resuming a saved game", async () => {
    const saved = dealGame(1, 12345);
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(saved));
    await mount();
    const raw = await AsyncStorage.getItem("solitaire_stats_v1");
    // No new deal was started — stats not yet written or gamesPlayed is still 0.
    const gamesPlayed = raw ? JSON.parse(raw).gamesPlayed : 0;
    expect(gamesPlayed).toBe(0);
  });

  it("does not double-count gamesWon when resuming an already-complete game", async () => {
    // Pre-seed stats as if a win was already counted in a prior session.
    await saveStats({ bestTimeMs: 95000, bestMoves: 42, gamesPlayed: 1, gamesWon: 1 });
    // Seed a complete game (edge case: game wasn't cleared before app killed).
    const suits = ["spades", "hearts", "diamonds", "clubs"] as const;
    const rankSeq = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
    const full = suits.flatMap((suit) => rankSeq.map((rank) => ({ suit, rank, faceUp: true })));
    const winState = {
      _v: 1,
      drawMode: 1,
      tableau: [[], [], [], [], [], [], []],
      foundations: {
        spades: full.filter((c) => c.suit === "spades"),
        hearts: full.filter((c) => c.suit === "hearts"),
        diamonds: full.filter((c) => c.suit === "diamonds"),
        clubs: full.filter((c) => c.suit === "clubs"),
      },
      stock: [],
      waste: [],
      score: 820,
      recycleCount: 0,
      undoStack: [],
      isComplete: true,
      startedAt: null,
      accumulatedMs: 95000,
    };
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(winState));
    await mount();
    // gamesWon must remain 1, not 2.
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem("solitaire_stats_v1");
      const stats = raw ? JSON.parse(raw) : { gamesWon: 1 };
      expect(stats.gamesWon).toBe(1);
    });
  });
});

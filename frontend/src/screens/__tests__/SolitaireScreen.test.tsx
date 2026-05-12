/**
 * SolitaireScreen — screen-level interaction and lifecycle tests.
 *
 * The engine itself is pure and well-tested (#593); these tests focus on
 * the screen's selection state machine, HUD wiring, modals, save/resume
 * plumbing, and the POST /solitaire/score submission flow.
 */

import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import SolitaireScreen from "../SolitaireScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { SolitaireScoreboardProvider } from "../../game/solitaire/SolitaireScoreboardContext";
import { createSeededRng, dealGame, setRng } from "../../game/solitaire/engine";
import { saveStats } from "../../game/solitaire/storage";
import { solitaireApi } from "../../game/solitaire/api";

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

jest.mock("../../game/solitaire/api", () => ({
  solitaireApi: {
    submitScore: jest.fn(),
    getLeaderboard: jest.fn(),
  },
}));

function renderScreen() {
  return render(
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
  const api = renderScreen();
  await act(async () => {
    await Promise.resolve();
  });
  return api;
}

async function chooseDraw1(api: ReturnType<typeof renderScreen>) {
  await act(async () => {
    fireEvent.press(api.getByLabelText("Draw 1"));
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
  (solitaireApi.submitScore as jest.Mock).mockReset();
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
      fireEvent.press(api.getByLabelText("Draw 3"));
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
      fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    expect(api.getByLabelText("Draw 1 from stock, 23 cards remaining")).toBeTruthy();
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
      fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    const undo = api.getByLabelText("Undo");
    expect(undo.props.accessibilityState?.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(undo);
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
      fireEvent.press(api.getByLabelText("More options"));
    });
    await act(async () => {
      fireEvent.press(api.getByText("New Game"));
    });
    await act(async () => {
      fireEvent.press(api.getByLabelText("Start New"));
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
      fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
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
      fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    await waitFor(async () => {
      expect(await AsyncStorage.getItem("solitaire_game")).not.toBeNull();
    });
    await act(async () => {
      fireEvent.press(api.getByLabelText("More options"));
    });
    await act(async () => {
      fireEvent.press(api.getByText("New Game"));
    });
    await act(async () => {
      fireEvent.press(api.getByLabelText("Start New"));
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
      fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    const [gameType] = mockStartGame.mock.calls[0] ?? [];
    expect(gameType).toBe("solitaire");
  });

  it("does not start a second session on subsequent moves", async () => {
    const api = await mount();
    await chooseDraw1(api);
    await act(async () => {
      fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    await act(async () => {
      fireEvent.press(api.getByLabelText("Draw 1 from stock, 23 cards remaining"));
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);
  });

  it("completes the session as abandoned on beforeRemove when moves >= 1", async () => {
    const api = await mount();
    await chooseDraw1(api);
    await act(async () => {
      fireEvent.press(api.getByLabelText("Draw 1 from stock, 24 cards remaining"));
    });
    // Simulate the screen being removed from the navigation stack.
    const handlers = mockNavListeners.get("beforeRemove") ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    await act(async () => {
      for (const h of handlers) h();
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [, summary] = mockCompleteGame.mock.calls[0];
    expect(summary).toEqual(expect.objectContaining({ outcome: "abandoned" }));
  });

  it("does not fire an abandon event before any moves are made", async () => {
    const api = await mount();
    await chooseDraw1(api);
    const handlers = mockNavListeners.get("beforeRemove") ?? [];
    await act(async () => {
      for (const h of handlers) h();
    });
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });
});

describe("SolitaireScreen — win-modal score submission", () => {
  // Preload a state that is one tap away from a win so we can drive the
  // screen into the win modal without simulating hundreds of moves.
  async function mountAtWinState() {
    // Build a nearly-complete state: one clubs foundation empty-slot and a
    // single Ace-of-Clubs tableau column. Tapping the ace → foundation
    // auto-move via double-tap completes all 52.
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
    };
    await AsyncStorage.setItem("solitaire_game", JSON.stringify(winState));
    return await mount();
  }

  it("POSTs the score with the entered name on Submit and shows the saved rank", async () => {
    (solitaireApi.submitScore as jest.Mock).mockResolvedValueOnce({
      player_name: "Alice",
      score: 820,
      rank: 3,
    });
    const api = await mountAtWinState();
    await act(async () => {
      fireEvent.changeText(api.getByLabelText("Your name"), "Alice");
    });
    await act(async () => {
      fireEvent.press(api.getByLabelText("Submit Score"));
    });
    await waitFor(() => {
      expect(solitaireApi.submitScore).toHaveBeenCalledWith("Alice", 820);
    });
    await waitFor(() => {
      expect(api.getByText(/#3/)).toBeTruthy();
    });
  });

  it("surfaces an error and a Retry button when the POST fails", async () => {
    (solitaireApi.submitScore as jest.Mock).mockRejectedValueOnce(new Error("network"));
    const api = await mountAtWinState();
    await act(async () => {
      fireEvent.changeText(api.getByLabelText("Your name"), "Bob");
    });
    await act(async () => {
      fireEvent.press(api.getByLabelText("Submit Score"));
    });
    await waitFor(() => {
      expect(api.getByRole("alert")).toBeTruthy();
      expect(api.getByLabelText("Retry")).toBeTruthy();
    });
  });

  // Regression #741: tapping "New Game" in the WinModal used to throw
  // `Property 'setShowNewGameConfirm' doesn't exist` because a stray setter
  // call survived the #711 overflow-menu cleanup.
  it("returns to the pre-game modal when New Game is tapped in the WinModal", async () => {
    const api = await mountAtWinState();
    await act(async () => {
      fireEvent.press(api.getByLabelText("New Game"));
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
      fireEvent.press(api.getByLabelText("2 of Spades")); // select waste
    });
    await act(async () => {
      fireEvent.press(api.getByLabelText("Face-down card")); // no-op: face-down card
    });
    // If selection was preserved, the next press on a valid destination executes the move.
    await act(async () => {
      fireEvent.press(api.getByLabelText("3 of Hearts")); // waste-to-tableau: 2♠ on 3♥
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
      fireEvent.press(api.getByLabelText("8 of Clubs")); // select col 0
    });
    expect(api.getByLabelText("8 of Clubs (selected)")).toBeTruthy();

    await act(async () => {
      fireEvent.press(api.getByLabelText("5 of Hearts")); // invalid destination → re-select col 1
    });
    expect(api.getByLabelText("5 of Hearts (selected)")).toBeTruthy();
    expect(api.queryByLabelText("8 of Clubs (selected)")).toBeNull();
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

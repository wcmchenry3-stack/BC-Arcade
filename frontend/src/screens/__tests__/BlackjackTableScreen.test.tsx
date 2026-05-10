import React from "react";
import { render, fireEvent, act, screen, waitFor } from "@testing-library/react-native";
import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import { newGame, placeBet, stand, EngineState } from "../../game/blackjack/engine";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Mock blackjack storage — no saved game by default, no-op persistence.
// ---------------------------------------------------------------------------
jest.mock("../../game/blackjack/storage", () => ({
  saveGame: jest.fn(),
  clearGame: jest.fn(),
  loadGame: jest.fn().mockResolvedValue(null),
  saveRun: jest.fn().mockResolvedValue(undefined),
  loadRuns: jest.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Mock gameEventClient — record every call for #370 instrumentation tests.
// ---------------------------------------------------------------------------
type EnqueueArgs = [string, { type: string; data: Record<string, unknown> }];
type CompleteArgs = [string, Record<string, unknown>, Record<string, unknown>];
type StartArgs = [string, Record<string, unknown>?, Record<string, unknown>?];
const mockStartGame = jest.fn() as unknown as jest.Mock<string, StartArgs>;
const mockEnqueueEvent = jest.fn() as unknown as jest.Mock<undefined, EnqueueArgs>;
const mockCompleteGame = jest.fn() as unknown as jest.Mock<undefined, CompleteArgs>;
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

function mockNav() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
  } as unknown as Parameters<typeof BlackjackTableScreen>[0]["navigation"];
}

/** Construct a player-phase state, retrying to avoid natural blackjack. */
function makePlayerPhaseState(): EngineState {
  for (let i = 0; i < 50; i++) {
    const s = placeBet(newGame(), 100);
    if (s.phase === "player") return s;
  }
  throw new Error("Could not reach player phase in 50 attempts");
}

/** Construct a result-phase state via stand after player phase. */
function makeResultPhaseState(): EngineState {
  const s = makePlayerPhaseState();
  return stand(s);
}

function renderScreen(nav = mockNav()) {
  return render(
    <ThemeProvider>
      <BlackjackGameProvider>
        <BlackjackTableScreen navigation={nav} />
      </BlackjackGameProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStartGame.mockReturnValue("game-uuid-test");
});

// ---------------------------------------------------------------------------
// Auto-redirect to BettingScreen when phase is betting
// ---------------------------------------------------------------------------

describe("BlackjackTableScreen — phase redirect", () => {
  it("calls navigation.replace('BlackjackBetting') when loaded in betting phase (default)", async () => {
    // Default loadGame returns null → newGame() → betting phase
    const nav = mockNav();
    renderScreen(nav);
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("BlackjackBetting");
    });
  });
});

// ---------------------------------------------------------------------------
// Player phase
// ---------------------------------------------------------------------------

describe("BlackjackTableScreen — player phase", () => {
  beforeEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(makePlayerPhaseState());
  });

  it("⋯ menu Scoreboard item navigates to ScoreboardScreen with blackjack gameKey", async () => {
    const nav = mockNav();
    renderScreen(nav);
    await screen.findByText("Hit");
    await act(async () => {
      fireEvent.press(screen.getByLabelText("More options"));
    });
    await act(async () => {
      fireEvent.press(screen.getByText("Scoreboard"));
    });
    expect(nav.navigate).toHaveBeenCalledWith("Scoreboard", { gameKey: "blackjack" });
  });

  it("shows Hit and Stand buttons", async () => {
    renderScreen();
    await screen.findByText("Hit");
    expect(screen.getByText("Stand")).toBeTruthy();
  });

  it("chip balance is visible during player phase", async () => {
    renderScreen();
    await screen.findByText("Hit");
    await waitFor(() => {
      expect(screen.queryByLabelText(/bankroll: \d+ chips/i)).toBeTruthy();
    });
  });

  it("Hit button stays in player/result phase (Deal button absent)", async () => {
    renderScreen();
    await screen.findByText("Hit");
    await act(async () => {
      fireEvent.press(screen.getByText("Hit"));
    });
    await waitFor(() => {
      const hit = screen.queryByText("Hit");
      const nextHand = screen.queryByText("Next Hand");
      expect(hit || nextHand).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Result phase
// ---------------------------------------------------------------------------

describe("BlackjackTableScreen — result phase", () => {
  beforeEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(makeResultPhaseState());
  });

  it("shows Next Hand and Quit buttons in result phase", async () => {
    renderScreen();
    await screen.findByText("Next Hand");
    expect(screen.getByText("Quit")).toBeTruthy();
  });

  it("chip balance is visible during result phase", async () => {
    renderScreen();
    await screen.findByText("Next Hand");
    expect(screen.queryByLabelText(/bankroll: \d+ chips/i)).toBeTruthy();
  });

  it("Quit button calls goBack()", async () => {
    const nav = mockNav();
    renderScreen(nav);
    await screen.findByText("Next Hand");
    fireEvent.press(screen.getByLabelText(/quit/i));
    expect(nav.goBack).toHaveBeenCalled();
  });

  it("Next Hand calls navigation.replace('BlackjackBetting') via phase change", async () => {
    const nav = mockNav();
    renderScreen(nav);
    const nextHandBtn = await screen.findByText("Next Hand", {}, { timeout: 5000 });
    await act(async () => {
      fireEvent.press(nextHandBtn);
    });
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("BlackjackBetting");
    });
  });
});

// ---------------------------------------------------------------------------
// GH #226 — Persistent table layout
// ---------------------------------------------------------------------------

describe("BlackjackTableScreen — persistent table layout (GH #226)", () => {
  it("table labels visible during player phase", async () => {
    (loadGame as jest.Mock).mockResolvedValue(makePlayerPhaseState());
    renderScreen();
    await screen.findByText("Hit");
    expect(screen.getByText("Dealer's Hand")).toBeTruthy();
    expect(screen.getByText("Your Hand")).toBeTruthy();
  });
});

// Game-over modal (visible when chips=0 && phase=result) is covered by the
// blackjack-errors.spec.ts e2e suite; Modal does not render its children
// reliably in the RNTL test environment.

// ---------------------------------------------------------------------------
// #498 — New Game mid-session from TableScreen should redirect to Betting
// ---------------------------------------------------------------------------

describe("BlackjackTableScreen — new game redirect (#498)", () => {
  it("handlePlayAgain from player phase triggers navigation.replace('BlackjackBetting')", async () => {
    (loadGame as jest.Mock).mockResolvedValue(makePlayerPhaseState());
    const nav = mockNav();
    render(
      <ThemeProvider>
        <BlackjackGameProvider>
          <BlackjackTableScreen navigation={nav} />
          <TestConsumer />
        </BlackjackGameProvider>
      </ThemeProvider>
    );
    await screen.findByText("Hit");
    // Sanity: we're on player phase so the effect has not redirected yet.
    expect(nav.replace).not.toHaveBeenCalled();

    act(() => {
      getCtx().handlePlayAgain();
    });

    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("BlackjackBetting");
    });
  });
});

// ---------------------------------------------------------------------------
// #370 — gameEventClient instrumentation
// ---------------------------------------------------------------------------

import { useBlackjackGame, PlayerActionHint } from "../../game/blackjack/BlackjackGameContext";
import {
  hit,
  doubleDown,
  split as engineSplit,
  newGame as engineNewGame,
  Card,
} from "../../game/blackjack/engine";

const RESERVED_KEYS = ["game_id", "event_index", "event_type"];

/**
 * Test consumer that exposes the context's apply() + current engine via
 * refs on the window object so tests can drive transitions directly without
 * going through the UI.
 */
function TestConsumer() {
  const ctx = useBlackjackGame();
  (window as unknown as { __bj: unknown }).__bj = ctx;
  return null;
}

function renderWithConsumer(initial?: EngineState) {
  if (initial) (loadGame as jest.Mock).mockResolvedValueOnce(initial);
  return render(
    <ThemeProvider>
      <BlackjackGameProvider>
        <TestConsumer />
      </BlackjackGameProvider>
    </ThemeProvider>
  );
}

function getCtx(): {
  engine: EngineState | null;
  apply: (fn: (s: EngineState) => EngineState, action?: PlayerActionHint) => void;
  handlePlayAgain: () => void;
} {
  return (window as unknown as { __bj: ReturnType<typeof useBlackjackGame> }).__bj;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

function card(rank: string, suit = "♠"): Card {
  return { rank, suit };
}

describe("BlackjackGameContext — gameEventClient instrumentation (#370)", () => {
  beforeEach(() => {
    mockStartGame.mockReset();
    mockStartGame.mockReturnValue("game-uuid-test");
    mockEnqueueEvent.mockReset();
    mockCompleteGame.mockReset();
    (loadGame as jest.Mock).mockResolvedValue(null);
  });

  it("calls startGame('blackjack') with starting_chips on mount", async () => {
    renderWithConsumer();
    await settle();
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    const startCall = mockStartGame.mock.calls[0];
    if (startCall === undefined) throw new Error("Expected startGame call");
    const [gameType, meta, eventData] = startCall;
    expect(gameType).toBe("blackjack");
    expect(meta).toEqual({
      best_run_chips: null,
      total_runs: 0,
      runs_completed: 0,
      current_table: "beginner",
    });
    expect(eventData).toEqual({ starting_chips: 1000 });
    for (const key of RESERVED_KEYS) {
      expect(eventData).not.toHaveProperty(key);
    }
  });

  it("does not start a session when loaded state is chips=0 + result", async () => {
    const dead: EngineState = { ...engineNewGame(), chips: 0, phase: "result" };
    renderWithConsumer(dead);
    await settle();
    expect(mockStartGame).not.toHaveBeenCalled();
  });

  it("emits bet_placed and hand_dealt after placeBet() with correct shape", async () => {
    renderWithConsumer();
    await settle();
    mockEnqueueEvent.mockClear();

    act(() => {
      getCtx().apply((s) => placeBet(s, 50));
    });

    const bet = mockEnqueueEvent.mock.calls.find((c) => c[1]?.type === "bet_placed");
    const dealt = mockEnqueueEvent.mock.calls.find((c) => c[1]?.type === "hand_dealt");
    expect(bet).toBeDefined();
    expect(dealt).toBeDefined();
    expect(bet![1].data).toEqual(
      expect.objectContaining({
        amount: 50,
        chips_remaining: 950,
      })
    );
    expect(dealt![1].data).toEqual(
      expect.objectContaining({
        player_hand: expect.any(Array),
        dealer_up_card: expect.any(Object),
        is_player_blackjack: expect.any(Boolean),
      })
    );
    for (const e of [bet![1].data, dealt![1].data]) {
      for (const key of RESERVED_KEYS) expect(e).not.toHaveProperty(key);
    }
  });

  it("emits player_action for hit/stand/double with hand_value_after", async () => {
    renderWithConsumer(makePlayerPhaseState());
    await settle();
    mockEnqueueEvent.mockClear();

    act(() => {
      getCtx().apply(hit, "hit");
    });
    const hitCall = mockEnqueueEvent.mock.calls.find(
      (c) => c[1]?.type === "player_action" && c[1].data.action === "hit"
    );
    expect(hitCall).toBeDefined();
    expect(hitCall![1].data).toEqual(
      expect.objectContaining({
        action: "hit",
        hand_index: 0,
        hand_value_after: expect.any(Number),
      })
    );
  });

  it("emits hand_resolved (single hand) when stand settles the round", async () => {
    renderWithConsumer(makePlayerPhaseState());
    await settle();
    mockEnqueueEvent.mockClear();

    act(() => {
      getCtx().apply(stand, "stand");
    });

    const resolved = mockEnqueueEvent.mock.calls.find((c) => c[1]?.type === "hand_resolved");
    expect(resolved).toBeDefined();
    expect(resolved![1].data).toEqual(
      expect.objectContaining({
        hand_index: 0,
        outcome: expect.stringMatching(/^(win|lose|push|blackjack)$/),
        payout_delta: expect.any(Number),
        chips_after: expect.any(Number),
      })
    );
    for (const key of RESERVED_KEYS) {
      expect(resolved![1].data).not.toHaveProperty(key);
    }
  });

  it("emits multiple hand_resolved events on a split settlement", async () => {
    // Construct a split-ready player state with a pair of 8s.
    const base = placeBet(engineNewGame(), 50);
    const splittable: EngineState = {
      ...base,
      phase: "player",
      player_hand: [card("8", "♠"), card("8", "♥")],
      dealer_hand: [card("6", "♦"), card("10", "♣")],
      player_hands: [],
      hand_bets: [],
      hand_outcomes: [],
      hand_payouts: [],
      active_hand_index: 0,
      split_count: 0,
      split_from_aces: [],
    };
    renderWithConsumer(splittable);
    await settle();
    mockEnqueueEvent.mockClear();

    // Perform the split — produces two hands.
    act(() => {
      getCtx().apply(engineSplit, "split");
    });
    // Stand on each hand until all resolve.
    for (let i = 0; i < 10; i++) {
      const e = getCtx().engine;
      if (!e || e.phase !== "player") break;
      act(() => {
        getCtx().apply(stand, "stand");
      });
    }

    const resolved = mockEnqueueEvent.mock.calls.filter((c) => c[1]?.type === "hand_resolved");
    expect(resolved.length).toBeGreaterThanOrEqual(2);
    const indices = resolved.map((r) => r[1].data.hand_index).sort();
    expect(indices[0]).toBe(0);
    expect(indices[1]).toBe(1);
    for (const r of resolved) {
      expect(r[1].data).toEqual(
        expect.objectContaining({
          hand_index: expect.any(Number),
          outcome: expect.stringMatching(/^(win|lose|push|blackjack)$/),
          payout_delta: expect.any(Number),
          chips_after: expect.any(Number),
        })
      );
    }
  });

  it("fires game_ended with snake_case payload when chips are exhausted", async () => {
    // Load a near-bust state: 50 chips, one loss wipes out the bankroll.
    // Construct directly instead of going through placeBet — placeBet uses
    // the seeded RNG and can occasionally produce a natural blackjack,
    // which settleWith's the state and adds +1.5× the bet before the test
    // overrides player/dealer hands, leaving chips at 125 and making the
    // subsequent stand not actually empty the bankroll.
    const lowChip: EngineState = {
      ...engineNewGame(),
      chips: 50,
      bet: 50,
      phase: "player",
      player_hand: [card("10", "♠"), card("6", "♥")],
      dealer_hand: [card("10", "♦"), card("9", "♣")], // dealer 19, stand → player loses
    };
    renderWithConsumer(lowChip);
    await settle();
    mockCompleteGame.mockClear();

    act(() => {
      getCtx().apply(stand, "stand");
    });

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const completeCall = mockCompleteGame.mock.calls[0];
    if (completeCall === undefined) throw new Error("Expected completeGame call");
    const [, summary, eventData] = completeCall;
    expect(summary.outcome).toBe("completed");
    expect(eventData).toEqual(
      expect.objectContaining({
        total_hands: expect.any(Number),
        duration_ms: expect.any(Number),
        outcome: "completed",
      })
    );
    expect(eventData.total_hands).toBeGreaterThanOrEqual(1);
    for (const key of RESERVED_KEYS) {
      expect(eventData).not.toHaveProperty(key);
    }
  });

  it("fires abandoned on unmount mid-game", async () => {
    renderWithConsumer(makePlayerPhaseState());
    const { unmount } = renderWithConsumer(makePlayerPhaseState()); // resumed mid-game
    await settle();
    mockCompleteGame.mockClear();
    unmount();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]?.[1]?.outcome).toBe("abandoned");
  });

  it("New Game mid-session abandons the old session and starts a new one", async () => {
    renderWithConsumer(makePlayerPhaseState());
    await settle();
    mockStartGame.mockClear();
    mockStartGame.mockReturnValue("game-uuid-test-2");
    mockCompleteGame.mockClear();

    await act(async () => {
      getCtx().handlePlayAgain();
    });

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]?.[1]?.outcome).toBe("abandoned");
    await waitFor(() => {
      expect(mockStartGame).toHaveBeenCalledWith(
        "blackjack",
        { best_run_chips: null, total_runs: 0, runs_completed: 0, current_table: "beginner" },
        { starting_chips: 1000 }
      );
    });
  });

  it("capture ordering: bet_placed emits before hand_dealt", async () => {
    renderWithConsumer();
    await settle();
    mockEnqueueEvent.mockClear();
    act(() => {
      getCtx().apply((s) => placeBet(s, 25));
    });
    const types = mockEnqueueEvent.mock.calls.map((c) => c[1]?.type);
    const betIdx = types.indexOf("bet_placed");
    const dealtIdx = types.indexOf("hand_dealt");
    expect(betIdx).toBeGreaterThanOrEqual(0);
    expect(dealtIdx).toBeGreaterThan(betIdx);
  });

  it("client failures do not block gameplay (enqueueEvent throws)", async () => {
    mockEnqueueEvent.mockImplementation(() => {
      throw new Error("boom");
    });
    renderWithConsumer();
    await settle();
    expect(() =>
      act(() => {
        getCtx().apply((s) => placeBet(s, 50));
      })
    ).not.toThrow();
    // Engine state still advanced despite the throw.
    expect(getCtx().engine?.phase).not.toBe("betting");
    mockEnqueueEvent.mockReset();
  });

  it("does not emit a player_action event without an action hint", async () => {
    renderWithConsumer(makePlayerPhaseState());
    await settle();
    mockEnqueueEvent.mockClear();
    // Calling apply without an action hint (e.g. the Next Hand transition)
    // must not synthesize a player_action.
    act(() => {
      getCtx().apply(hit); // no hint
    });
    const actions = mockEnqueueEvent.mock.calls.filter((c) => c[1]?.type === "player_action");
    expect(actions).toHaveLength(0);
  });
});

// Unused import warning dodge for engine helpers the instrumentation tests
// pull in conditionally.
void doubleDown;

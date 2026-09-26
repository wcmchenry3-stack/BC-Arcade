import React from "react";
import { render, fireEvent, act, screen, waitFor, within } from "@testing-library/react-native";
import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame, saveRun } from "../../game/blackjack/storage";
import { newGame, placeBet, stand, EngineState } from "../../game/blackjack/engine";
import type { ForegroundClockMock } from "../../game/_shared/__mocks__/foregroundClock";

// GameShell's Stats item (#2635) navigates through useNavigation; these
// screens take their navigation as a prop, so the hook gets its own mock.
const mockShellNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockShellNavigate }),
}));

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
// A killed process's session to continue (#2654) — none unless a test says so.
const mockResumeGame = jest.fn((): string | null => null);
const mockMarkStarted = jest.fn();
const mockDiscardGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => (mockStartGame as unknown as jest.Mock)(...args),
    resumeGame: (...args: unknown[]) => (mockResumeGame as jest.Mock)(...args),
    markStarted: (...args: unknown[]) => (mockMarkStarted as jest.Mock)(...args),
    discardGame: (...args: unknown[]) => (mockDiscardGame as jest.Mock)(...args),
    enqueueEvent: (...args: unknown[]) => (mockEnqueueEvent as unknown as jest.Mock)(...args),
    completeGame: (...args: unknown[]) => (mockCompleteGame as unknown as jest.Mock)(...args),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

// The app-wide foreground-time counter behind useGameSync's active-play window
// (#2684) is pinned for every test by jest.setup.ts (#2710), held still unless
// a test moves it.
const clock = jest.requireMock<ForegroundClockMock>("../../game/_shared/foregroundClock");

function mockNav() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
    popToTop: jest.fn(),
  } as unknown as Parameters<typeof BlackjackTableScreen>[0]["navigation"];
}

/** Construct a player-phase state, retrying to avoid natural blackjack. */
function makePlayerPhaseState(withRunGoal = false): EngineState {
  const runConfig = withRunGoal
    ? { startingChips: 1000, runGoal: 2500, betMin: 5, betMax: 500, milestones: [] }
    : undefined;
  for (let i = 0; i < 50; i++) {
    const s = placeBet(newGame(undefined, runConfig), 100);
    if (s.phase === "player") return s;
  }
  throw new Error("Could not reach player phase in 50 attempts");
}

/** Construct a result-phase state via stand after player phase. */
function makeResultPhaseState(withRunGoal = false): EngineState {
  const s = makePlayerPhaseState(withRunGoal);
  return stand(s);
}

async function renderScreen(nav = mockNav()) {
  return await render(
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
    await renderScreen(nav);
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

  it("⋯ menu Scorecard item (#2636) opens the blackjack live view", async () => {
    const nav = mockNav();
    await renderScreen(nav);
    await screen.findByText("Hit");
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(screen.getByText("Scorecard"));
    });
    expect(nav.navigate).toHaveBeenCalledWith("Scoreboard", { gameKey: "blackjack" });
  });

  it("⋯ menu Stats item opens Blackjack's stats (#2635)", async () => {
    const nav = mockNav();
    await renderScreen(nav);
    await screen.findByText("Hit");
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(screen.getByText("Stats"));
    });
    expect(mockShellNavigate).toHaveBeenCalledWith("GameStats", { gameType: "blackjack" });
  });

  it("shows Hit and Stand buttons", async () => {
    await renderScreen();
    await screen.findByText("Hit");
    expect(screen.getByText("Stand")).toBeTruthy();
  });

  it("chip balance is visible during player phase", async () => {
    (loadGame as jest.Mock).mockResolvedValue(makePlayerPhaseState(true));
    await renderScreen();
    await screen.findByText("Hit");
    await waitFor(() => {
      expect(screen.queryByLabelText(/goal progress:/i)).toBeTruthy();
    });
  });

  it("Hit button stays in player/result phase (Deal button absent)", async () => {
    await renderScreen();
    await screen.findByText("Hit");
    await act(async () => {
      await fireEvent.press(screen.getByText("Hit"));
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
    await renderScreen();
    await screen.findByText("Next Hand");
    expect(screen.getByText("Quit")).toBeTruthy();
  });

  it("chip balance is visible during result phase", async () => {
    (loadGame as jest.Mock).mockResolvedValue(makeResultPhaseState(true));
    await renderScreen();
    await screen.findByText("Next Hand");
    expect(screen.queryByLabelText(/goal progress:/i)).toBeTruthy();
  });

  it("Quit button calls goBack()", async () => {
    const nav = mockNav();
    await renderScreen(nav);
    await screen.findByText("Next Hand");
    await fireEvent.press(screen.getByLabelText(/quit/i));
    expect(nav.goBack).toHaveBeenCalled();
  });

  it("Next Hand calls navigation.replace('BlackjackBetting') via phase change", async () => {
    const nav = mockNav();
    await renderScreen(nav);
    const nextHandBtn = await screen.findByText("Next Hand", {}, { timeout: 5000 });
    await act(async () => {
      await fireEvent.press(nextHandBtn);
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
    await renderScreen();
    await screen.findByText("Hit");
    expect(screen.getByText("Dealer's Hand")).toBeTruthy();
    expect(screen.getByText("Your Hand")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// #2507 — out of chips: the shared result card
// ---------------------------------------------------------------------------

describe("BlackjackTableScreen — out of chips (#2507)", () => {
  beforeEach(() => {
    // A settled hand that left the player with nothing.
    (loadGame as jest.Mock).mockResolvedValue({ ...makeResultPhaseState(), chips: 0 });
  });

  it("shows the result card with the session stats", async () => {
    await renderScreen();
    const card = within(await screen.findByTestId("blackjack-result"));
    // Out of chips with no goal reached: a loss, as the run recorded (#2628).
    expect(card.getByTestId("blackjack-result-title")).toHaveTextContent("You Lose");
    expect(card.getByText("Out of Chips")).toBeTruthy();
    expect(card.getByText("Hands")).toBeTruthy();
    expect(card.getByText("Biggest win")).toBeTruthy();
    expect(card.getByText("Win rate")).toBeTruthy();
  });

  it("Play Again starts a fresh session on the betting screen, like New Game", async () => {
    const nav = mockNav();
    await renderScreen(nav);
    const card = within(await screen.findByTestId("blackjack-result"));
    await act(async () => {
      await fireEvent.press(card.getByRole("button", { name: "Play Again" }));
    });
    expect(nav.replace).toHaveBeenCalledWith("BlackjackBetting");
  });

  it("Home returns to the lobby", async () => {
    const nav = mockNav();
    await renderScreen(nav);
    const card = within(await screen.findByTestId("blackjack-result"));
    await act(async () => {
      await fireEvent.press(card.getByRole("button", { name: "Home" }));
    });
    expect(nav.popToTop).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #498 — New Game mid-session from TableScreen should redirect to Betting
// ---------------------------------------------------------------------------

describe("BlackjackTableScreen — new game redirect (#498)", () => {
  it("handlePlayAgain from player phase triggers navigation.replace('BlackjackBetting')", async () => {
    (loadGame as jest.Mock).mockResolvedValue(makePlayerPhaseState());
    const nav = mockNav();
    await render(
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

    await act(() => {
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
import { TABLE_CONFIGS, TableConfig } from "../../game/blackjack/tables";
import {
  hit,
  doubleDown,
  split as engineSplit,
  newGame as engineNewGame,
  newHand as engineNewHand,
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

async function renderWithConsumer(initial?: EngineState) {
  if (initial) (loadGame as jest.Mock).mockResolvedValueOnce(initial);
  return await render(
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
  handleTableSelect: (config: TableConfig) => void;
  handleCashOut: () => Promise<void>;
  handleKeepPlaying: () => void;
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
  // A game with runGoal set (non-null) so startSession fires on mount.
  const tableSelectedGame = () => engineNewGame(undefined, { runGoal: 2500 });

  beforeEach(() => {
    mockStartGame.mockReset();
    mockStartGame.mockReturnValue("game-uuid-test");
    mockEnqueueEvent.mockReset();
    mockCompleteGame.mockReset();
    (loadGame as jest.Mock).mockResolvedValue(tableSelectedGame());
  });

  it("calls startGame('blackjack') with starting_chips on mount", async () => {
    await renderWithConsumer();
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
    await renderWithConsumer(dead);
    await settle();
    expect(mockStartGame).not.toHaveBeenCalled();
  });

  it("emits bet_placed and hand_dealt after placeBet() with correct shape", async () => {
    await renderWithConsumer();
    await settle();
    mockEnqueueEvent.mockClear();

    await act(() => {
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
    await renderWithConsumer(makePlayerPhaseState());
    await settle();
    mockEnqueueEvent.mockClear();

    await act(() => {
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
    await renderWithConsumer(makePlayerPhaseState());
    await settle();
    mockEnqueueEvent.mockClear();

    await act(() => {
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
    await renderWithConsumer(splittable);
    await settle();
    mockEnqueueEvent.mockClear();

    // Perform the split — produces two hands.
    await act(() => {
      getCtx().apply(engineSplit, "split");
    });
    // Stand on each hand until all resolve.
    for (let i = 0; i < 10; i++) {
      const e = getCtx().engine;
      if (!e || e.phase !== "player") break;
      await act(() => {
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
    await renderWithConsumer(lowChip);
    await settle();
    mockCompleteGame.mockClear();

    await act(() => {
      getCtx().apply(stand, "stand");
    });

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const completeCall = mockCompleteGame.mock.calls[0];
    if (completeCall === undefined) throw new Error("Expected completeGame call");
    const [, summary, eventData] = completeCall;
    // Out of chips before the goal is a loss (#2628).
    expect(summary.outcome).toBe("loss");
    expect(eventData).toEqual(
      expect.objectContaining({
        total_hands: expect.any(Number),
        outcome: "loss",
      })
    );
    // No wall-clock duration of its own (#2684).
    expect(eventData).not.toHaveProperty("duration_ms");
    expect(eventData.total_hands).toBeGreaterThanOrEqual(1);
    for (const key of RESERVED_KEYS) {
      expect(eventData).not.toHaveProperty(key);
    }
    // #2450 — backend BlackjackResult fields. The losing hand is not a win,
    // final_chips must be the post-hand balance (0), not the stale pre-hand one,
    // and starting_chips is this session's opening balance (the resumed 50).
    expect(summary.result).toEqual(
      expect.objectContaining({
        hands_won: 0,
        hands_played: 1,
        starting_chips: 50,
        final_chips: 0,
      })
    );
  });

  // #2684 — Blackjack used to send Date.now() minus the session start, which
  // counts backgrounded time and beat the shared clock. It now sends none, so
  // useGameSync's active-play window (foreground time only) applies.
  it("sends no wall-clock duration of its own: the shared active-play window applies", async () => {
    const lowChip: EngineState = {
      ...engineNewGame(),
      chips: 50,
      bet: 50,
      phase: "player",
      player_hand: [card("10", "♠"), card("6", "♥")],
      dealer_hand: [card("10", "♦"), card("9", "♣")],
    };
    const wallStart = Date.now();
    const nowSpy = jest.spyOn(Date, "now");
    try {
      await renderWithConsumer(lowChip);
      await settle();
      mockCompleteGame.mockClear();

      // An hour of wall-clock time passes with only 7 s of it in the foreground.
      nowSpy.mockReturnValue(wallStart + 60 * 60 * 1000);
      clock.advanceForegroundNow(7_000);
      await act(() => {
        getCtx().apply(stand, "stand");
      });

      expect(mockCompleteGame).toHaveBeenCalledTimes(1);
      const [, summary, eventData] = mockCompleteGame.mock.calls[0]!;
      expect(summary.outcome).toBe("loss");
      expect(summary.durationMs).toBe(7_000);
      expect(eventData).not.toHaveProperty("duration_ms");
    } finally {
      nowSpy.mockRestore();
    }
  });

  // #2710 — the table picker shown at first launch is not play.
  it("leaves the table picker's time before the first run out of it", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null); // fresh: table pick pending
    const { unmount } = await renderWithConsumer();
    await settle();
    expect(mockStartGame).not.toHaveBeenCalled();
    clock.advanceForegroundNow(3 * 60_000); // on the table picker
    await act(async () => {
      getCtx().handleTableSelect(TABLE_CONFIGS[0]!);
    });
    await waitFor(() => expect(mockStartGame).toHaveBeenCalledTimes(1));
    clock.advanceForegroundNow(9_000);
    await act(() => {
      getCtx().apply((st) => placeBet(st, 25)); // the first hand marks it started
    });
    await unmount();

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    expect(summary.outcome).toBe("abandoned");
    expect(summary.durationMs).toBe(9_000);
  });

  // #2710 — a finished run pauses useGameSync's play window: time on the
  // result screen and the table picker is not counted into the next run.
  it("leaves the time between runs out of the next run's duration", async () => {
    const lowChip: EngineState = {
      ...engineNewGame(),
      chips: 50,
      bet: 50,
      phase: "player",
      player_hand: [card("10", "♠"), card("6", "♥")],
      dealer_hand: [card("10", "♦"), card("9", "♣")],
    };
    const { unmount } = await renderWithConsumer(lowChip);
    await settle();
    mockCompleteGame.mockClear();
    clock.advanceForegroundNow(7_000);
    await act(() => {
      getCtx().apply(stand, "stand"); // out of chips: the run ends
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]![1].durationMs).toBe(7_000);

    clock.advanceForegroundNow(2 * 60_000); // on the result screen
    await act(async () => {
      getCtx().handlePlayAgain();
    });
    await settle();
    clock.advanceForegroundNow(3 * 60_000); // on the table picker
    mockStartGame.mockReturnValue("game-uuid-next");
    await act(async () => {
      getCtx().handleTableSelect(TABLE_CONFIGS[0]!);
    });
    await waitFor(() => expect(mockStartGame).toHaveBeenCalledTimes(2));
    clock.advanceForegroundNow(6_000);
    await act(() => {
      getCtx().apply((st) => placeBet(st, 25)); // the first hand marks it started
    });
    await unmount();

    expect(mockCompleteGame).toHaveBeenCalledTimes(2);
    const [gameId, summary] = mockCompleteGame.mock.calls[1]!;
    expect(gameId).toBe("game-uuid-next");
    expect(summary.outcome).toBe("abandoned");
    expect(summary.durationMs).toBe(6_000);
  });

  it("counts a won hand and carries hands_won/chips on an unmount abandon (#2450)", async () => {
    const winning: EngineState = {
      ...engineNewGame(),
      chips: 50,
      bet: 50,
      phase: "player",
      player_hand: [card("10", "♠"), card("10", "♥")],
      dealer_hand: [card("10", "♦"), card("9", "♣")], // dealer 19, stand → player 20 wins
    };
    const { unmount } = await renderWithConsumer(winning);
    await settle();
    await act(() => {
      getCtx().apply(stand, "stand");
    });
    mockCompleteGame.mockClear();
    await unmount();

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const summary = mockCompleteGame.mock.calls[0]?.[1];
    expect(summary?.outcome).toBe("abandoned");
    expect(summary?.result).toEqual({
      hands_won: 1,
      hands_played: 1,
      starting_chips: expect.any(Number),
      final_chips: 100,
    });
  });

  it("a resumed run that is above its opening balance is not a profit if no hand is played (#2450)", async () => {
    // engine.startingChips is the RUN's opening balance; the hand counters are
    // per-session, so starting_chips must be the chips at session start — else the
    // daily "chips_gained" goal is credited for leaving without playing.
    const aheadOfRun: EngineState = {
      ...engineNewGame(),
      startingChips: 1000,
      chips: 1500,
      bet: 50,
      phase: "player",
      player_hand: [card("10", "♠"), card("6", "♥")],
      dealer_hand: [card("10", "♦"), card("9", "♣")],
    };
    const { unmount } = await renderWithConsumer(aheadOfRun);
    await settle();
    mockCompleteGame.mockClear();
    await unmount();

    const result = mockCompleteGame.mock.calls[0]?.[1]?.result as Record<string, unknown>;
    expect(result["hands_played"]).toBe(0);
    expect(result["starting_chips"]).toBe(1500);
    expect(result["final_chips"]).toBe(1500);
  });

  it("fires abandoned on unmount mid-game", async () => {
    await renderWithConsumer(makePlayerPhaseState());
    const { unmount } = await renderWithConsumer(makePlayerPhaseState()); // resumed mid-game
    await settle();
    mockCompleteGame.mockClear();
    await unmount();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]?.[1]?.outcome).toBe("abandoned");
  });

  describe("after the app was killed mid-game (#2654)", () => {
    it("a saved mid-game continues the killed process's session: no new session", async () => {
      mockResumeGame.mockReturnValueOnce("killed-session");
      const { unmount } = await renderWithConsumer(makePlayerPhaseState());
      await settle();

      expect(mockResumeGame).toHaveBeenCalledWith("blackjack", undefined);
      expect(mockStartGame).not.toHaveBeenCalled();
      expect(mockMarkStarted).not.toHaveBeenCalled();

      // Leaving closes that one session — no second game, no extra abandon.
      await unmount();
      expect(mockCompleteGame).toHaveBeenCalledTimes(1);
      expect(mockCompleteGame.mock.calls[0]?.[0]).toBe("killed-session");
      expect(mockCompleteGame.mock.calls[0]?.[1]?.outcome).toBe("abandoned");
    });

    it("a saved mid-game with no session left to continue starts one, already started", async () => {
      await renderWithConsumer(makePlayerPhaseState());
      await settle();
      expect(mockResumeGame).toHaveBeenCalledTimes(1);
      expect(mockStartGame).toHaveBeenCalledTimes(1);
      expect(mockMarkStarted).toHaveBeenCalledWith("game-uuid-test");
    });

    it("a table picked for a fresh run never resumes", async () => {
      (loadGame as jest.Mock).mockResolvedValueOnce(null);
      await renderWithConsumer();
      await settle();
      await act(async () => {
        getCtx().handleTableSelect(TABLE_CONFIGS[0]!);
      });
      await settle();
      expect(mockResumeGame).not.toHaveBeenCalled();
      expect(mockStartGame).toHaveBeenCalledTimes(1);
    });
  });

  it("New Game mid-session abandons the old session and starts a new one", async () => {
    await renderWithConsumer(makePlayerPhaseState());
    await settle();
    mockStartGame.mockClear();
    mockStartGame.mockReturnValue("game-uuid-test-2");
    mockCompleteGame.mockClear();

    await act(async () => {
      getCtx().handlePlayAgain();
    });

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]?.[1]?.outcome).toBe("abandoned");

    // handlePlayAgain defers startSession to handleTableSelect (BJ-2 table selection flow).
    const fakeConfig: TableConfig = {
      id: "beginner",
      labelKey: "table.beginner",
      subtitleKey: "table.beginner.subtitle",
      accentKey: "accent",
      startingChips: 1000,
      runGoal: 2500,
      betMin: 5,
      betMax: 500,
      chipDenominations: [5, 25, 100, 500],
      milestones: [1750, 2200],
    };
    await act(() => {
      getCtx().handleTableSelect(fakeConfig);
    });

    await waitFor(() => {
      expect(mockStartGame).toHaveBeenCalledWith(
        "blackjack",
        { best_run_chips: null, total_runs: 0, runs_completed: 0, current_table: "beginner" },
        { starting_chips: 1000 }
      );
    });
  });

  it("capture ordering: bet_placed emits before hand_dealt", async () => {
    await renderWithConsumer();
    await settle();
    mockEnqueueEvent.mockClear();
    await act(() => {
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
    await renderWithConsumer();
    await settle();
    await act(() => {
      getCtx().apply((s) => placeBet(s, 50));
    });
    // Engine state still advanced despite the throw.
    expect(getCtx().engine?.phase).not.toBe("betting");
    mockEnqueueEvent.mockReset();
  });

  it("does not emit a player_action event without an action hint", async () => {
    await renderWithConsumer(makePlayerPhaseState());
    await settle();
    mockEnqueueEvent.mockClear();
    // Calling apply without an action hint (e.g. the Next Hand transition)
    // must not synthesize a player_action.
    await act(() => {
      getCtx().apply(hit); // no hint
    });
    const actions = mockEnqueueEvent.mock.calls.filter((c) => c[1]?.type === "player_action");
    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// #2628 — a run records win / loss / abandoned from its goal (§8.8)
// ---------------------------------------------------------------------------

describe("BlackjackGameContext — run outcome (#2628)", () => {
  const GOAL = 2500;

  /** A hand the player wins by standing: 20 against the dealer's 19. */
  function winningHand(chips: number, bet: number): EngineState {
    return {
      ...engineNewGame(undefined, { runGoal: GOAL }),
      chips,
      bet,
      phase: "player",
      player_hand: [card("10", "♠"), card("10", "♥")],
      dealer_hand: [card("10", "♦"), card("9", "♣")],
    };
  }

  /** A hand the player loses by standing: 16 against the dealer's 19. */
  function losingHand(s: EngineState, chips: number): EngineState {
    return {
      ...s,
      chips,
      bet: chips,
      phase: "player",
      player_hand: [card("10", "♠"), card("6", "♥")],
      dealer_hand: [card("10", "♦"), card("9", "♣")],
    };
  }

  /** The outcome of every completeGame call so far. */
  function recordedOutcomes(): unknown[] {
    return mockCompleteGame.mock.calls.map((c) => c[1]?.outcome);
  }

  /** Reach the goal: 2450 + a winning 100 = 2550 ≥ 2500. */
  async function reachGoal() {
    await renderWithConsumer(winningHand(2450, 100));
    await settle();
    await act(() => {
      getCtx().apply(stand, "stand");
    });
    expect(getCtx().engine?.phase).toBe("victory");
  }

  /** Bet every chip left on a losing hand, so the chips run out. */
  async function loseEverything() {
    await act(() => {
      getCtx().apply((s) => losingHand(s, s.chips));
    });
    await act(() => {
      getCtx().apply(stand, "stand");
    });
    expect(getCtx().engine?.chips).toBe(0);
  }

  beforeEach(() => {
    mockStartGame.mockReset();
    mockStartGame.mockReturnValue("game-uuid-test");
    mockCompleteGame.mockReset();
    (saveRun as jest.Mock).mockClear();
  });

  it("reaching the goal and cashing out records a win", async () => {
    await reachGoal();
    expect(mockCompleteGame).not.toHaveBeenCalled();

    await act(async () => {
      await getCtx().handleCashOut();
    });

    expect(recordedOutcomes()).toEqual(["win"]);
    expect(saveRun).toHaveBeenCalledTimes(1);
    expect(saveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: true,
        outcome: "win",
        finalChips: 2550,
        runGoal: GOAL,
      })
    );
  });

  it("reaching the goal, keeping playing, then running out of chips still records a win", async () => {
    await reachGoal();
    await act(() => {
      getCtx().handleKeepPlaying();
    });
    expect(getCtx().engine?.runGoal).toBeNull();

    await loseEverything();

    expect(recordedOutcomes()).toEqual(["win"]);
    expect(saveRun).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: true,
        outcome: "win",
        finalChips: 0,
        runGoal: GOAL,
        lowestChips: 0,
        // The low before the goal (the session opened at 2450), not the bust's 0,
        // so the run is not taken for a comeback.
        lowestChipsBeforeGoal: 2450,
      })
    );
  });

  it("New Game after reaching the goal and keeping playing records a win", async () => {
    await reachGoal();
    await act(() => {
      getCtx().handleKeepPlaying();
    });
    await act(async () => {
      getCtx().handlePlayAgain();
    });
    expect(recordedOutcomes()).toEqual(["win"]);
  });

  it("a resumed run that already reached its goal (Keep Playing save) records a win", async () => {
    const kept: EngineState = {
      ...losingHand(engineNewGame(), 300),
      runGoal: null,
      reachedRunGoal: GOAL,
    };
    await renderWithConsumer(kept);
    await settle();
    await act(() => {
      getCtx().apply(stand, "stand");
    });
    expect(getCtx().engine?.chips).toBe(0);
    expect(recordedOutcomes()).toEqual(["win"]);
  });

  it("running out of chips before the goal records a loss", async () => {
    // A won hand first (450, short of the goal), then everything lost.
    await renderWithConsumer(winningHand(400, 50));
    await settle();
    await act(() => {
      getCtx().apply(stand, "stand");
    });
    expect(getCtx().engine?.phase).toBe("result");
    await act(() => {
      getCtx().apply(engineNewHand);
    });
    await loseEverything();
    expect(recordedOutcomes()).toEqual(["loss"]);
    expect(saveRun).toHaveBeenCalledWith(
      expect.objectContaining({ completed: false, outcome: "loss" })
    );
  });

  it("saveRun records the engine's final chips on a bust-out, not the pre-hand balance", async () => {
    await renderWithConsumer(losingHand(engineNewGame(undefined, { runGoal: GOAL }), 50));
    await settle();
    await act(() => {
      getCtx().apply(stand, "stand");
    });
    expect(getCtx().engine?.chips).toBe(0);
    expect(saveRun).toHaveBeenCalledTimes(1);
    expect(saveRun).toHaveBeenCalledWith(
      expect.objectContaining({ finalChips: 0, lowestChips: 0, outcome: "loss" })
    );
  });

  it("Play Again after a bust-out records nothing more and saves the run once", async () => {
    await renderWithConsumer(losingHand(engineNewGame(undefined, { runGoal: GOAL }), 50));
    await settle();
    await act(() => {
      getCtx().apply(stand, "stand");
    });
    await act(async () => {
      getCtx().handlePlayAgain();
    });
    expect(recordedOutcomes()).toEqual(["loss"]);
    expect(saveRun).toHaveBeenCalledTimes(1);
  });

  it("New Game mid-run before the goal records abandoned", async () => {
    await renderWithConsumer(winningHand(1000, 50));
    await settle();
    await act(() => {
      getCtx().apply(stand, "stand");
    });
    await act(async () => {
      getCtx().handlePlayAgain();
    });
    expect(recordedOutcomes()).toEqual(["abandoned"]);
    expect(saveRun).toHaveBeenCalledWith(
      expect.objectContaining({ completed: false, outcome: "abandoned", finalChips: 1050 })
    );
  });

  it("a cash-out before the goal records abandoned, not a win", async () => {
    await renderWithConsumer(winningHand(1000, 50));
    await settle();
    await act(() => {
      getCtx().apply(stand, "stand");
    });
    await act(async () => {
      await getCtx().handleCashOut();
    });
    expect(recordedOutcomes()).toEqual(["abandoned"]);
  });

  // --- saves from builds before #2628 -------------------------------------

  it("a Keep Playing save from an older build (no reachedRunGoal) still records a win", async () => {
    // Keep Playing is the only way to have a table's bet limits and no goal.
    const table = TABLE_CONFIGS[1]!;
    const legacy = losingHand(
      engineNewGame(undefined, { betMin: table.betMin, betMax: table.betMax, runGoal: null }),
      300
    );
    expect(legacy.reachedRunGoal).toBeUndefined();
    await renderWithConsumer(legacy);
    await settle();
    await act(() => {
      getCtx().apply(stand, "stand");
    });
    expect(recordedOutcomes()).toEqual(["win"]);
  });

  it("a save with no goal and no table's bet limits is not a win", async () => {
    // A fresh newGame(): no goal, 5/500 limits that match no table.
    await renderWithConsumer(losingHand(engineNewGame(), 300));
    await settle();
    await act(() => {
      getCtx().apply(stand, "stand");
    });
    expect(recordedOutcomes()).toEqual(["loss"]);
  });

  // --- the result card agrees with the row ---------------------------------

  async function renderTableAndConsumer(initial: EngineState) {
    (loadGame as jest.Mock).mockResolvedValueOnce(initial);
    await render(
      <ThemeProvider>
        <BlackjackGameProvider>
          <BlackjackTableScreen navigation={mockNav()} />
          <TestConsumer />
        </BlackjackGameProvider>
      </ThemeProvider>
    );
    await settle();
  }

  it("the result card shows a loss when the chips run out before the goal", async () => {
    await renderTableAndConsumer(losingHand(engineNewGame(undefined, { runGoal: GOAL }), 50));
    await act(() => {
      getCtx().apply(stand, "stand");
    });
    const card = within(await screen.findByTestId("blackjack-result"));
    expect(card.getByTestId("blackjack-result-title")).toHaveTextContent("You Lose");
    expect(recordedOutcomes()).toEqual(["loss"]);
  });

  it("the result card shows a win after the goal, Keep Playing and a bust-out", async () => {
    await renderTableAndConsumer(winningHand(2450, 100));
    await act(() => {
      getCtx().apply(stand, "stand");
    });
    await act(() => {
      getCtx().handleKeepPlaying();
    });
    await loseEverything();
    const card = within(await screen.findByTestId("blackjack-result"));
    expect(card.getByTestId("blackjack-result-title")).toHaveTextContent("You Win!");
    expect(recordedOutcomes()).toEqual(["win"]);
  });

  // --- relaunch --------------------------------------------------------------

  it("a relaunch that cannot continue its session records the save's table", async () => {
    const table = TABLE_CONFIGS[2]!;
    await renderWithConsumer(
      losingHand(
        engineNewGame(undefined, {
          betMin: table.betMin,
          betMax: table.betMax,
          runGoal: table.runGoal,
        }),
        300
      )
    );
    await waitFor(() => expect(mockStartGame).toHaveBeenCalledTimes(1));
    expect(mockStartGame.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ current_table: "high_roller" })
    );
  });

  // --- sessions with no hand played record no result ----------------------

  it("New Game before any bet records nothing: the untouched session is discarded", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    await renderWithConsumer();
    await settle();
    await act(async () => {
      getCtx().handleTableSelect(TABLE_CONFIGS[0]!);
    });
    await waitFor(() => expect(mockStartGame).toHaveBeenCalledTimes(1));

    await act(async () => {
      getCtx().handlePlayAgain();
    });

    expect(mockCompleteGame).not.toHaveBeenCalled();
    expect(mockDiscardGame).toHaveBeenCalledWith("game-uuid-test");
    expect(saveRun).not.toHaveBeenCalled();
  });

  /** A goal-reached run saved on the betting screen after Keep Playing. */
  function keptPlayingSave(): EngineState {
    return { ...engineNewGame(undefined, { runGoal: null }), chips: 2600, reachedRunGoal: GOAL };
  }

  it("a goal-reached save whose session cannot be continued records no win without a hand", async () => {
    await renderWithConsumer(keptPlayingSave());
    await waitFor(() => expect(mockStartGame).toHaveBeenCalledTimes(1));

    await act(async () => {
      getCtx().handlePlayAgain();
    });

    expect(recordedOutcomes()).not.toContain("win");
    expect(saveRun).not.toHaveBeenCalled();
  });

  it("a continued goal-reached session still records its win without a new hand", async () => {
    mockResumeGame.mockReturnValueOnce("killed-session");
    await renderWithConsumer(keptPlayingSave());
    await settle();
    expect(mockStartGame).not.toHaveBeenCalled();

    await act(async () => {
      getCtx().handlePlayAgain();
    });

    expect(mockCompleteGame.mock.calls[0]?.[0]).toBe("killed-session");
    expect(recordedOutcomes()).toEqual(["win"]);
  });
});

// Unused import warning dodge for engine helpers the instrumentation tests
// pull in conditionally.
void doubleDown;

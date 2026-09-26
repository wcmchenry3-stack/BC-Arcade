import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, renderHook, fireEvent, act, screen, waitFor } from "@testing-library/react-native";
import BlackjackBettingScreen from "../BlackjackBettingScreen";
import { BlackjackGameProvider, useBlackjackGame } from "../../game/blackjack/BlackjackGameContext";
import { TABLE_CONFIGS } from "../../game/blackjack/tables";
import { __setPremiumLevelsForTests } from "../../entitlements/premiumLevels";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import { newGame } from "../../game/blackjack/engine";
import { EngineState } from "../../game/blackjack/engine";

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
  loadGame: jest.fn(),
  saveRun: jest.fn().mockResolvedValue(undefined),
  loadRuns: jest.fn().mockResolvedValue([]),
}));

function mockNav() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
  } as unknown as Parameters<typeof BlackjackBettingScreen>[0]["navigation"];
}

async function renderScreen(nav = mockNav()) {
  return await render(
    <ThemeProvider>
      <BlackjackGameProvider>
        <BlackjackBettingScreen navigation={nav} />
      </BlackjackGameProvider>
    </ThemeProvider>
  );
}

// Default: return a beginner-table-selected game so most tests see the betting panel.
const beginnerGame = () =>
  newGame(undefined, { startingChips: 100, runGoal: 250, betMin: 5, betMax: 25 });

beforeEach(() => {
  jest.clearAllMocks();
  (loadGame as jest.Mock).mockResolvedValue(beginnerGame());
});

// ---------------------------------------------------------------------------
// Initial load
// ---------------------------------------------------------------------------

describe("BlackjackBettingScreen — initial load", () => {
  it("renders BettingPanel when a table-selected game is loaded", async () => {
    await renderScreen();
    expect(await screen.findByText("Deal")).toBeTruthy();
  });

  it("renders TableSelectPanel when no saved game exists (fresh install)", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    await renderScreen();
    expect(await screen.findByText("CHOOSE A TABLE")).toBeTruthy();
    expect(screen.getByText("Beginner")).toBeTruthy();
    expect(screen.getByText("Intermediate")).toBeTruthy();
    expect(screen.getByText("High Roller")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Header / navigation
// ---------------------------------------------------------------------------

describe("BlackjackBettingScreen — header / navigation", () => {
  it("shows Blackjack title", async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText("Blackjack")).toBeTruthy());
  });

  it("⋯ menu Scoreboard item navigates to ScoreboardScreen with blackjack gameKey", async () => {
    const nav = mockNav();
    await renderScreen(nav);
    await screen.findByText("Deal");
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(screen.getByText("Scoreboard"));
    });
    expect(nav.navigate).toHaveBeenCalledWith("Scoreboard", { gameKey: "blackjack" });
  });

  it("⋯ menu Stats item opens Blackjack's stats (#2635)", async () => {
    const nav = mockNav();
    await renderScreen(nav);
    await screen.findByText("Deal");
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(screen.getByText("Stats"));
    });
    expect(mockShellNavigate).toHaveBeenCalledWith("GameStats", { gameType: "blackjack" });
  });
});

// ---------------------------------------------------------------------------
// Auto-redirect when phase is not betting (e.g. app restart mid-hand)
// ---------------------------------------------------------------------------

describe("BlackjackBettingScreen — phase redirect", () => {
  it("calls navigation.replace('BlackjackTable') when loaded in player phase", async () => {
    const playerState: EngineState = { ...newGame(), phase: "player", bet: 100 };
    (loadGame as jest.Mock).mockResolvedValueOnce(playerState);
    const nav = mockNav();
    await renderScreen(nav);
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("BlackjackTable");
    });
  });

  it("calls navigation.replace('BlackjackTable') when loaded in result phase", async () => {
    const resultState: EngineState = {
      ...newGame(),
      phase: "result",
      bet: 100,
      outcome: "win",
    };
    (loadGame as jest.Mock).mockResolvedValueOnce(resultState);
    const nav = mockNav();
    await renderScreen(nav);
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("BlackjackTable");
    });
  });

  it("calls navigation.replace('BlackjackTable') after Deal transitions phase", async () => {
    const nav = mockNav();
    await renderScreen(nav);
    await screen.findByText("Deal");
    // Place a chip first so Deal becomes enabled (beginner table: max bet 25)
    await act(async () => {
      await fireEvent.press(screen.getByLabelText(/add 25 to bet/i));
    });
    await act(async () => {
      await fireEvent.press(screen.getByLabelText(/deal cards with 25-chip bet/i));
    });
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("BlackjackTable");
    });
  });
});

// ---------------------------------------------------------------------------
// GH #227 — Chip balance visible during betting phase
// ---------------------------------------------------------------------------

describe("BlackjackBettingScreen — chip balance visibility (GH #227)", () => {
  it("chip/goal progress is visible in HUD during betting phase", async () => {
    await renderScreen();
    await screen.findByText("Deal");
    // HUD shows goal progress when a table with a runGoal is active
    expect(screen.getByLabelText(/goal progress:/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GH #226 — Persistent table layout; GH #1912 — labels hidden before deal
// ---------------------------------------------------------------------------

describe("BlackjackBettingScreen — persistent table, no pre-deal labels", () => {
  it("hand labels are hidden during betting phase when no cards are dealt", async () => {
    await renderScreen();
    await screen.findByText("Deal");
    expect(screen.queryByText("Dealer's Hand")).toBeNull();
    expect(screen.queryByText("Your Hand")).toBeNull();
  });
});

describe("BlackjackGameContext — table start (#1129)", () => {
  const intermediate = TABLE_CONFIGS[1]!;

  beforeEach(async () => {
    await AsyncStorage.clear();
    (loadGame as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    __setPremiumLevelsForTests(null);
  });

  async function renderGame() {
    const hook = await renderHook(() => useBlackjackGame(), {
      wrapper: ({ children }) => <BlackjackGameProvider>{children}</BlackjackGameProvider>,
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  it("remembers the table every start goes to, Next Table included", async () => {
    const { result } = await renderGame();
    await act(async () => result.current.handleTableSelect(intermediate));
    expect(result.current.engine?.betMin).toBe(intermediate.betMin);
    await waitFor(async () =>
      expect(await AsyncStorage.getItem("blackjack.difficulty")).toBe("intermediate")
    );
  });

  it("never starts a premium table", async () => {
    __setPremiumLevelsForTests({ blackjack: ["intermediate"] });
    const { result } = await renderGame();
    const before = result.current.engine;
    await act(async () => result.current.handleTableSelect(intermediate));
    expect(result.current.engine).toBe(before);
    expect(await AsyncStorage.getItem("blackjack.difficulty")).toBeNull();
  });
});

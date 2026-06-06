import React from "react";
import { render, fireEvent, act, screen, waitFor } from "@testing-library/react-native";
import BlackjackBettingScreen from "../BlackjackBettingScreen";
import { BlackjackGameProvider } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import { newGame } from "../../game/blackjack/engine";
import { EngineState } from "../../game/blackjack/engine";

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

function renderScreen(nav = mockNav()) {
  return render(
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
    renderScreen();
    expect(await screen.findByText("Deal")).toBeTruthy();
  });

  it("renders TableSelectPanel when no saved game exists (fresh install)", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    renderScreen();
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
    renderScreen();
    await waitFor(() => expect(screen.getByText("Blackjack")).toBeTruthy());
  });

  it("⋯ menu Scoreboard item navigates to ScoreboardScreen with blackjack gameKey", async () => {
    const nav = mockNav();
    renderScreen(nav);
    await screen.findByText("Deal");
    await act(async () => {
      fireEvent.press(screen.getByLabelText("More options"));
    });
    await act(async () => {
      fireEvent.press(screen.getByText("Scoreboard"));
    });
    expect(nav.navigate).toHaveBeenCalledWith("Scoreboard", { gameKey: "blackjack" });
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
    renderScreen(nav);
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
    renderScreen(nav);
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("BlackjackTable");
    });
  });

  it("calls navigation.replace('BlackjackTable') after Deal transitions phase", async () => {
    const nav = mockNav();
    renderScreen(nav);
    await screen.findByText("Deal");
    // Place a chip first so Deal becomes enabled (beginner table: max bet 25)
    await act(async () => {
      fireEvent.press(screen.getByLabelText(/add 25 to bet/i));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText(/deal cards with 25-chip bet/i));
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
    renderScreen();
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
    renderScreen();
    await screen.findByText("Deal");
    expect(screen.queryByText("Dealer's Hand")).toBeNull();
    expect(screen.queryByText("Your Hand")).toBeNull();
  });
});

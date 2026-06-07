import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react-native";
import BlackjackStatsScreen from "../BlackjackStatsScreen";
import { BlackjackGameProvider } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame, loadRuns } from "../../game/blackjack/storage";
import type { RunRecord } from "../../game/blackjack/storage";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../../game/blackjack/storage", () => ({
  saveGame: jest.fn(),
  clearGame: jest.fn(),
  loadGame: jest.fn().mockResolvedValue(null),
  saveRun: jest.fn().mockResolvedValue(undefined),
  loadRuns: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: jest.fn().mockReturnValue("session-id"),
    enqueueEvent: jest.fn(),
    completeGame: jest.fn(),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

// Make useFocusEffect behave like useEffect so it fires synchronously in tests.
jest.mock("@react-navigation/native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mockReact = require("react") as typeof React;
  return {
    ...jest.requireActual("@react-navigation/native"),
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockReact.useEffect(cb, []);
    },
  };
});

function mockNav() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
  } as unknown as Parameters<typeof BlackjackStatsScreen>[0]["navigation"];
}

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    table: "beginner",
    startingChips: 100,
    finalChips: 250,
    runGoal: 250,
    completed: true,
    handsPlayed: 20,
    biggestWin: 50,
    lowestChips: 80,
    startedAt: 1700000000000,
    endedAt: 1700003600000,
    ...overrides,
  };
}

async function renderScreen(nav = mockNav()) {
  return await render(
    <ThemeProvider>
      <BlackjackGameProvider>
        <BlackjackStatsScreen navigation={nav} />
      </BlackjackGameProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (loadGame as jest.Mock).mockResolvedValue(null);
  (loadRuns as jest.Mock).mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("BlackjackStatsScreen — empty state", () => {
  it("shows current run empty message when no hands played", async () => {
    await renderScreen();
    expect(await screen.findByText("Start a run to see your stats here.")).toBeTruthy();
  });

  it("shows run history empty message when no completed runs", async () => {
    await renderScreen();
    expect(await screen.findByText("Complete a run to see your history.")).toBeTruthy();
  });

  it("does not render All-Time Best section when there are no runs", async () => {
    await renderScreen();
    await screen.findByText("Run Statistics");
    expect(screen.queryByText("All-Time Best")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// outcomeFor — badge logic
//
// The badge text sits inside accessibilityElementsHidden, so RNTL text queries
// skip it. We assert on the run row's accessibilityLabel instead, which is
// composed with the translated outcome string.
// ---------------------------------------------------------------------------

describe("BlackjackStatsScreen — outcome badges", () => {
  it("shows Completed outcome for a successful run with no comeback", async () => {
    (loadRuns as jest.Mock).mockResolvedValueOnce([makeRun({ completed: true, lowestChips: 80 })]);
    await renderScreen();
    expect(await screen.findByLabelText(/Completed/)).toBeTruthy();
  });

  it("shows Busted outcome for a run that ended in bankruptcy", async () => {
    (loadRuns as jest.Mock).mockResolvedValueOnce([makeRun({ completed: false, finalChips: 0 })]);
    await renderScreen();
    expect(await screen.findByLabelText(/Busted/)).toBeTruthy();
  });

  it("shows Comeback outcome when lowestChips < 25% of startingChips", async () => {
    (loadRuns as jest.Mock).mockResolvedValueOnce([
      makeRun({ completed: true, startingChips: 100, lowestChips: 24 }),
    ]);
    await renderScreen();
    expect(await screen.findByLabelText(/Comeback/)).toBeTruthy();
  });

  it("shows Completed (not Comeback) when lowestChips is exactly 25% of startingChips", async () => {
    (loadRuns as jest.Mock).mockResolvedValueOnce([
      makeRun({ completed: true, startingChips: 100, lowestChips: 25 }),
    ]);
    await renderScreen();
    await screen.findByLabelText(/Completed/);
    expect(screen.queryByLabelText(/Comeback/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// All-Time Best section
// ---------------------------------------------------------------------------

describe("BlackjackStatsScreen — All-Time Best", () => {
  it("renders the section when at least one run exists", async () => {
    (loadRuns as jest.Mock).mockResolvedValueOnce([makeRun()]);
    await renderScreen();
    expect(await screen.findByText("All-Time Best")).toBeTruthy();
  });

  it("shows the best completed run's chip count", async () => {
    (loadRuns as jest.Mock).mockResolvedValueOnce([makeRun({ finalChips: 350 })]);
    await renderScreen();
    await screen.findByText("All-Time Best");
    // "350 chips" appears in both the All-Time Best row and the run history row.
    expect(screen.getAllByText("350 chips").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Most Hands row with the run that has the most hands played", async () => {
    (loadRuns as jest.Mock).mockResolvedValueOnce([makeRun({ handsPlayed: 42 })]);
    await renderScreen();
    await screen.findByText("Most Hands");
    expect(screen.getByText("42 hands")).toBeTruthy();
  });

  it("shows Biggest Comeback row for comeback runs", async () => {
    (loadRuns as jest.Mock).mockResolvedValueOnce([
      makeRun({ completed: true, startingChips: 100, lowestChips: 20 }),
    ]);
    await renderScreen();
    expect(await screen.findByText("Biggest Comeback")).toBeTruthy();
    expect(screen.getByText("20 chips low")).toBeTruthy();
  });

  it("does not show Biggest Comeback when no run qualifies", async () => {
    (loadRuns as jest.Mock).mockResolvedValueOnce([
      makeRun({ completed: true, startingChips: 100, lowestChips: 50 }),
    ]);
    await renderScreen();
    await screen.findByText("All-Time Best");
    expect(screen.queryByText("Biggest Comeback")).toBeNull();
  });

  it("picks the run with lowest chip point as the biggest comeback", async () => {
    const worse = makeRun({ completed: true, startingChips: 100, lowestChips: 20, startedAt: 1 });
    const better = makeRun({ completed: true, startingChips: 100, lowestChips: 10, startedAt: 2 });
    (loadRuns as jest.Mock).mockResolvedValueOnce([worse, better]);
    await renderScreen();
    await screen.findByText("Biggest Comeback");
    expect(screen.getByText("10 chips low")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Run history list
// ---------------------------------------------------------------------------

describe("BlackjackStatsScreen — run history list", () => {
  it("shows the table name for each run row", async () => {
    (loadRuns as jest.Mock).mockResolvedValueOnce([makeRun({ table: "beginner" })]);
    await renderScreen();
    expect(await screen.findByText("Beginner")).toBeTruthy();
  });

  it("sorts runs newest-first", async () => {
    const older = makeRun({ startedAt: 1_000_000_000_000, table: "beginner" });
    const newer = makeRun({ startedAt: 2_000_000_000_000, table: "intermediate" });
    (loadRuns as jest.Mock).mockResolvedValueOnce([older, newer]);
    await renderScreen();
    await screen.findByText("Intermediate");
    const labels = screen
      .getAllByText(/Beginner|Intermediate/)
      .map((el) => el.props.children as string);
    expect(labels[0]).toBe("Intermediate");
    expect(labels[1]).toBe("Beginner");
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("BlackjackStatsScreen — navigation", () => {
  it("calls navigation.goBack when back button is pressed", async () => {
    const nav = mockNav();
    await renderScreen(nav);
    await screen.findByText("Run Statistics");
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Go back to home screen"));
    });
    expect(nav.goBack).toHaveBeenCalled();
  });
});

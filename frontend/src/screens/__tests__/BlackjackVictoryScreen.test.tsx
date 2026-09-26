import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import BlackjackVictoryScreen from "../BlackjackVictoryScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { initialSessionStats } from "../../game/blackjack/sessionStats";
import { __setPremiumLevelsForTests } from "../../entitlements/premiumLevels";

// Goal Reached (#2507): its own screen, built from the shared result card.

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

jest.mock("../../game/blackjack/storage", () => ({
  loadRuns: jest.fn().mockResolvedValue([]),
}));

const mockCtx = {
  engine: null as null | Record<string, unknown>,
  sessionStats: initialSessionStats(100),
  lowestChips: 80,
  handleCashOut: jest.fn().mockResolvedValue(undefined),
  handleKeepPlaying: jest.fn(),
  handleTableSelect: jest.fn(),
};
jest.mock("../../game/blackjack/BlackjackGameContext", () => ({
  useBlackjackGame: () => mockCtx,
}));

const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");

function mockNav() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
    popToTop: jest.fn(),
  } as unknown as Parameters<typeof BlackjackVictoryScreen>[0]["navigation"];
}

/** A run that reached its goal at the given table's bet range. */
function atTable(betMin: number, betMax: number, startingChips: number, runGoal: number) {
  mockCtx.engine = { betMin, betMax, startingChips, runGoal, chips: runGoal + 20 };
  mockCtx.sessionStats = {
    ...initialSessionStats(startingChips),
    handsPlayed: 20,
    handsWon: 12,
    biggestWin: 50,
  };
}

async function renderScreen(nav = mockNav()) {
  const r = await render(
    <ThemeProvider>
      <BlackjackVictoryScreen navigation={nav} />
    </ThemeProvider>
  );
  await act(async () => {});
  return { ...r, nav };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCtx.handleCashOut.mockResolvedValue(undefined);
});

describe("BlackjackVictoryScreen (#2507)", () => {
  it("shows the win card: title, table, chips against the goal, and the run's stats", async () => {
    atTable(5, 25, 100, 250); // Beginner
    await renderScreen();
    const card = within(screen.getByTestId("blackjack-victory"));
    expect(card.getByTestId("blackjack-victory-title")).toHaveTextContent("You Win!");
    expect(card.getByText("You completed the Beginner table")).toBeTruthy();
    expect(card.getByText("Goal: 250 chips")).toBeTruthy();
    expect(card.getByText("270")).toBeTruthy();
    expect(card.getByText("60%")).toBeTruthy(); // 12 of 20 hands
    expect(card.getByText("+50")).toBeTruthy();
    expect(card.getByText("+170")).toBeTruthy(); // 270 − 100
  });

  it("announces the win once", async () => {
    atTable(5, 25, 100, 250);
    await renderScreen();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0]![0]).toContain("You Win!");
  });

  it("plays the next table from the primary button", async () => {
    atTable(5, 25, 100, 250);
    const { nav } = await renderScreen();
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: /Play Intermediate Table/ }));
    });
    expect(mockCtx.handleCashOut).toHaveBeenCalled();
    expect(mockCtx.handleTableSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "intermediate" })
    );
    expect(nav.replace).toHaveBeenCalledWith("BlackjackBetting");
  });

  it("Keep Playing continues at this table", async () => {
    atTable(5, 25, 100, 250);
    const { nav } = await renderScreen();
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: /Keep Playing/ }));
    });
    expect(mockCtx.handleKeepPlaying).toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalledWith("BlackjackBetting");
  });

  it("Home cashes out and returns to the lobby", async () => {
    atTable(5, 25, 100, 250);
    const { nav } = await renderScreen();
    await act(async () => {
      await fireEvent.press(screen.getByTestId("blackjack-victory-home"));
    });
    expect(mockCtx.handleCashOut).toHaveBeenCalled();
    expect(nav.popToTop).toHaveBeenCalled();
  });

  it("on the last table, Keep Playing is the primary button", async () => {
    atTable(25, 200, 500, 1500); // High Roller
    await renderScreen();
    expect(screen.queryByRole("button", { name: /Play .* Table/ })).toBeNull();
    expect(screen.getByTestId("game-result-primary")).toHaveTextContent("Keep Playing");
  });
});

describe("BlackjackVictoryScreen — premium next table (#1129)", () => {
  afterEach(() => {
    __setPremiumLevelsForTests(null);
  });

  it("explains a premium next table and keeps the run going", async () => {
    __setPremiumLevelsForTests({ blackjack: ["intermediate"] });
    atTable(5, 25, 100, 250);
    const { nav } = await renderScreen();
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: /Play Intermediate Table/ }));
    });
    expect(screen.getByText("This level is part of BC Arcade Premium, coming soon.")).toBeTruthy();
    expect(mockCtx.handleCashOut).not.toHaveBeenCalled();
    expect(mockCtx.handleTableSelect).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

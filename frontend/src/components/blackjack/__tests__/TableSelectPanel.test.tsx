import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import TableSelectPanel from "../TableSelectPanel";
import type { RunRecord } from "../../../game/blackjack/storage";
import { __setPremiumLevelsForTests } from "../../../entitlements/premiumLevels";

function completedRun(table: string): RunRecord {
  return {
    table,
    startingChips: 500,
    finalChips: 1000,
    runGoal: 1000,
    completed: true,
    handsPlayed: 10,
    biggestWin: 100,
    lowestChips: 400,
    startedAt: 0,
    endedAt: 1,
  };
}

// Beginner and Intermediate open, High Roller progress-locked.
const RUNS = [completedRun("beginner")];

async function renderPanel() {
  const onSelectTable = jest.fn();
  await render(
    <ThemeProvider>
      <TableSelectPanel runs={RUNS} onSelectTable={onSelectTable} onViewHistory={() => {}} />
    </ThemeProvider>
  );
  await act(async () => {});
  return { onSelectTable };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

afterEach(() => {
  __setPremiumLevelsForTests(null);
});

describe("TableSelectPanel — last table (#1129)", () => {
  it("marks no table before the first run", async () => {
    await renderPanel();
    expect(screen.queryByText("Last played")).toBeNull();
  });

  it("marks the table the last run was played at", async () => {
    await AsyncStorage.setItem("blackjack.difficulty", "intermediate");
    await renderPanel();
    expect(screen.getByText("Last played")).toBeTruthy();
    expect(screen.getByTestId("blackjack-table-intermediate").props.accessibilityHint).toBe(
      "Last played"
    );
    expect(screen.getByTestId("blackjack-table-beginner").props.accessibilityHint).toBeUndefined();
  });

  it("starts the table picked (the start remembers it; see BlackjackBettingScreen tests)", async () => {
    const { onSelectTable } = await renderPanel();
    await fireEvent.press(screen.getByTestId("blackjack-table-intermediate"));
    expect(onSelectTable).toHaveBeenCalledWith(expect.objectContaining({ id: "intermediate" }));
  });

  it("keeps a progress-locked table disabled", async () => {
    await renderPanel();
    const highRoller = screen.getByTestId("blackjack-table-high_roller");
    expect(highRoller.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true })
    );
  });
});

describe("TableSelectPanel — premium table (#1129)", () => {
  it("explains the lock on tap instead of starting a run", async () => {
    __setPremiumLevelsForTests({ blackjack: ["intermediate"] });
    const { onSelectTable } = await renderPanel();
    const table = screen.getByTestId("blackjack-table-intermediate");
    expect(table.props.accessibilityLabel).toBe("Intermediate, locked. Part of BC Arcade Premium.");

    await fireEvent.press(table);
    expect(onSelectTable).not.toHaveBeenCalled();
    expect(screen.getByText("This level is part of BC Arcade Premium, coming soon.")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("blackjack-premium-ok"));
    expect(screen.queryByText("This level is part of BC Arcade Premium, coming soon.")).toBeNull();
  });

  it("does not mark a now-premium table as last played", async () => {
    await AsyncStorage.setItem("blackjack.difficulty", "intermediate");
    __setPremiumLevelsForTests({ blackjack: ["intermediate"] });
    await renderPanel();
    expect(screen.queryByText("Last played")).toBeNull();
  });
});

import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import VsScorecard from "../yacht/VsScorecard";
import { ThemeProvider } from "../../theme/ThemeContext";

const ALL_CATEGORIES = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
  "three_of_a_kind",
  "four_of_a_kind",
  "full_house",
  "small_straight",
  "large_straight",
  "yacht",
  "chance",
];

const emptyScores = Object.fromEntries(ALL_CATEGORIES.map((k) => [k, null]));

function renderVs(overrides: Partial<React.ComponentProps<typeof VsScorecard>> = {}) {
  const defaults: React.ComponentProps<typeof VsScorecard> = {
    playerScores: emptyScores,
    playerPossibleScores: {},
    playerRollsUsed: 0,
    playerGameOver: false,
    playerUpperBonus: 0,
    playerTotalScore: 0,
    cpuScores: emptyScores,
    cpuUpperBonus: 0,
    cpuTotalScore: 0,
    isAiTurn: false,
    onScore: jest.fn(),
  };
  return render(
    <ThemeProvider>
      <VsScorecard {...defaults} {...overrides} />
    </ThemeProvider>
  );
}

describe("VsScorecard — ghost scores", () => {
  it("shows +X ghost when playerRollsUsed > 0 and cell is open", () => {
    const { getByText } = renderVs({
      playerRollsUsed: 1,
      playerPossibleScores: { ones: 14, twos: 22 },
    });
    expect(getByText("+14")).toBeTruthy();
    expect(getByText("+22")).toBeTruthy();
  });

  it("does not show ghost when playerRollsUsed === 0", () => {
    const { queryByText } = renderVs({
      playerRollsUsed: 0,
      playerPossibleScores: { ones: 14 },
    });
    expect(queryByText("+14")).toBeNull();
  });

  it("does not show ghost for an already-scored category", () => {
    const { queryByText } = renderVs({
      playerRollsUsed: 1,
      playerScores: { ...emptyScores, ones: 3 },
      playerPossibleScores: { ones: 14 },
    });
    expect(queryByText("+14")).toBeNull();
  });
});

describe("VsScorecard — scoring interaction", () => {
  it("calls onScore with the correct key when an open YOU cell is tapped", () => {
    const onScore = jest.fn();
    const { getAllByRole } = renderVs({
      playerRollsUsed: 1,
      playerPossibleScores: { ones: 3 },
      onScore,
    });
    const buttons = getAllByRole("button").filter((b) => b.props.accessibilityLabel === "Ones");
    fireEvent.press(buttons[0]!);
    expect(onScore).toHaveBeenCalledWith("ones");
  });

  it("does not call onScore when rollsUsed === 0", () => {
    const onScore = jest.fn();
    const { getAllByRole } = renderVs({ playerRollsUsed: 0, onScore });
    const buttons = getAllByRole("button").filter((b) => b.props.accessibilityLabel === "Ones");
    fireEvent.press(buttons[0]!);
    expect(onScore).not.toHaveBeenCalled();
  });

  it("does not call onScore for an already-scored category", () => {
    const onScore = jest.fn();
    const { getAllByRole } = renderVs({
      playerRollsUsed: 1,
      playerScores: { ...emptyScores, ones: 5 },
      playerPossibleScores: { twos: 8 },
      onScore,
    });
    const onesButtons = getAllByRole("button").filter((b) => b.props.accessibilityLabel === "Ones");
    fireEvent.press(onesButtons[0]!);
    expect(onScore).not.toHaveBeenCalled();
  });
});

describe("VsScorecard — AI turn lock", () => {
  it("disables all YOU cells during the AI turn", () => {
    const onScore = jest.fn();
    const { getAllByRole } = renderVs({
      playerRollsUsed: 1,
      playerPossibleScores: { ones: 3, twos: 6 },
      isAiTurn: true,
      onScore,
    });
    const buttons = getAllByRole("button");
    buttons.forEach((b) => fireEvent.press(b));
    expect(onScore).not.toHaveBeenCalled();
  });

  it("marks YOU cells as disabled when isAiTurn", () => {
    const { getAllByRole } = renderVs({
      playerRollsUsed: 1,
      playerPossibleScores: { ones: 3 },
      isAiTurn: true,
    });
    const hotCells = getAllByRole("button").filter(
      (b) => b.props.accessibilityState?.disabled === false
    );
    expect(hotCells.length).toBe(0);
  });
});

describe("VsScorecard — TOTAL row", () => {
  it("renders both totals", () => {
    const { getByText } = renderVs({ playerTotalScore: 142, cpuTotalScore: 98 });
    expect(getByText("142")).toBeTruthy();
    expect(getByText("98")).toBeTruthy();
  });

  it("renders zero totals when no scores are filled", () => {
    const { getAllByText } = renderVs({ playerTotalScore: 0, cpuTotalScore: 0 });
    expect(getAllByText("0").length).toBeGreaterThanOrEqual(2);
  });
});

describe("VsScorecard — upper subtotal progress", () => {
  it("shows bonus unlock text when playerUpperBonus > 0", () => {
    const filledUpper = {
      ...emptyScores,
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      sixes: 18,
    };
    const { getByText } = renderVs({
      playerScores: filledUpper,
      playerUpperBonus: 35,
    });
    expect(getByText(/✓/)).toBeTruthy();
  });

  it("shows countdown text when bonus is not yet unlocked", () => {
    const { getByText } = renderVs({
      playerScores: { ...emptyScores, ones: 3 },
      playerUpperBonus: 0,
    });
    expect(getByText(/to 63/i)).toBeTruthy();
  });
});

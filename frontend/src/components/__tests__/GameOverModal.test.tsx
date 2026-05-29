import React from "react";
import { render, within } from "@testing-library/react-native";
import GameOverModal from "../yacht/GameOverModal";
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
const filledScores = Object.fromEntries(ALL_CATEGORIES.map((k) => [k, 0]));

function renderModal(overrides: Partial<React.ComponentProps<typeof GameOverModal>> = {}) {
  const defaults: React.ComponentProps<typeof GameOverModal> = {
    visible: true,
    totalScore: 250,
    upperBonus: 0,
    yachtBonusCount: 0,
    yachtBonusTotal: 0,
    scores: filledScores,
    onPlayAgain: jest.fn(),
    onDismiss: jest.fn(),
  };
  return render(
    <ThemeProvider>
      <GameOverModal {...defaults} {...overrides} />
    </ThemeProvider>
  );
}

describe("GameOverModal — joker bonus row", () => {
  it("does not show joker bonus row when yachtBonusTotal is 0", () => {
    const { queryByText } = renderModal({ yachtBonusTotal: 0, yachtBonusCount: 0 });
    expect(queryByText("+100")).toBeNull();
    expect(queryByText("+200")).toBeNull();
  });

  it("shows joker bonus row with '+100' when yachtBonusTotal is 100", () => {
    const { getByText } = renderModal({ yachtBonusTotal: 100, yachtBonusCount: 1 });
    expect(getByText("+100")).toBeTruthy();
  });

  it("shows joker bonus row with '+200' when yachtBonusTotal is 200", () => {
    const { getByText } = renderModal({ yachtBonusTotal: 200, yachtBonusCount: 2 });
    expect(getByText("+200")).toBeTruthy();
  });

  it("shows 'Yacht Bonus' label when joker row is present", () => {
    const { getByText } = renderModal({ yachtBonusTotal: 100, yachtBonusCount: 1 });
    expect(getByText("Yacht Bonus")).toBeTruthy();
  });

  it("does not show 'Yacht Bonus' scorecard row when yachtBonusTotal is 0", () => {
    const { queryAllByText } = renderModal({ yachtBonusTotal: 0 });
    expect(queryAllByText("Yacht Bonus")).toHaveLength(0);
  });
});

describe("GameOverModal — joker bonus row in VS mode", () => {
  const vsDefaults = {
    vsResult: "win" as const,
    aiTotalScore: 180,
    aiUpperBonus: 0,
    aiScores: filledScores,
  };

  it("shows joker row with player '+100' and CPU '—' when only player has jokers", () => {
    const { getByTestId } = renderModal({
      ...vsDefaults,
      yachtBonusTotal: 100,
      yachtBonusCount: 1,
      aiYachtBonusTotal: 0,
    });
    const bonusRow = getByTestId("yacht-bonus-row");
    expect(within(bonusRow).getByText("+100")).toBeTruthy();
    expect(within(bonusRow).getByText("—")).toBeTruthy();
  });

  it("shows joker row with both '+100' values when both players have jokers", () => {
    const { getAllByText } = renderModal({
      ...vsDefaults,
      yachtBonusTotal: 100,
      yachtBonusCount: 1,
      aiYachtBonusTotal: 100,
    });
    expect(getAllByText("+100")).toHaveLength(2);
  });

  it("shows joker row when only CPU has jokers (player shows '—', CPU shows '+100')", () => {
    const { getByText } = renderModal({
      ...vsDefaults,
      yachtBonusTotal: 0,
      yachtBonusCount: 0,
      aiYachtBonusTotal: 100,
    });
    expect(getByText("+100")).toBeTruthy();
  });

  it("hides joker row when neither player has jokers in VS mode", () => {
    const { queryByText } = renderModal({
      ...vsDefaults,
      yachtBonusTotal: 0,
      yachtBonusCount: 0,
      aiYachtBonusTotal: 0,
    });
    expect(queryByText("+100")).toBeNull();
    expect(queryByText("Yacht Bonus")).toBeNull();
  });
});

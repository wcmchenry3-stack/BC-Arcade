import React from "react";
import { render, within } from "@testing-library/react-native";
import YachtFinalScorecard, { type FinalCard } from "../YachtFinalScorecard";
import { ThemeProvider } from "../../../theme/ThemeContext";

// Ported from the retired yacht GameOverModal tests (#1819) when the final
// scorecard moved into the shared result card's detail slot (#2505).

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

function card(overrides: Partial<FinalCard> = {}): FinalCard {
  return { scores: filledScores, upperBonus: 0, yachtBonusTotal: 0, totalScore: 250, ...overrides };
}

async function renderCard(player: FinalCard, opponent?: FinalCard) {
  return await render(
    <ThemeProvider>
      <YachtFinalScorecard player={player} opponent={opponent} />
    </ThemeProvider>
  );
}

describe("YachtFinalScorecard — solo", () => {
  it("lists every category plus the total", async () => {
    const { getByText } = await renderCard(card({ scores: { ...filledScores, chance: 23 } }));
    expect(getByText("Chance")).toBeTruthy();
    expect(getByText("23")).toBeTruthy();
    expect(getByText("250")).toBeTruthy();
  });

  it("shows the upper bonus when earned", async () => {
    const { getByText } = await renderCard(card({ upperBonus: 35 }));
    expect(getByText("+35")).toBeTruthy();
  });

  it("does not show the Yacht Bonus row without jokers", async () => {
    const { queryByText, queryByTestId } = await renderCard(card());
    expect(queryByTestId("yacht-bonus-row")).toBeNull();
    expect(queryByText("Yacht Bonus")).toBeNull();
  });

  it.each([100, 200])("shows the Yacht Bonus row with +%i", async (total) => {
    const { getByTestId } = await renderCard(card({ yachtBonusTotal: total }));
    const row = getByTestId("yacht-bonus-row");
    expect(within(row).getByText("Yacht Bonus")).toBeTruthy();
    expect(within(row).getByText(`+${total}`)).toBeTruthy();
  });
});

describe("YachtFinalScorecard — vs mode", () => {
  it("adds You and CPU columns", async () => {
    const { getByText } = await renderCard(card(), card({ totalScore: 180 }));
    expect(getByText("You")).toBeTruthy();
    expect(getByText("CPU")).toBeTruthy();
    expect(getByText("180")).toBeTruthy();
  });

  it("shows the player's jokers and a dash for the CPU", async () => {
    const { getByTestId } = await renderCard(
      card({ yachtBonusTotal: 100 }),
      card({ yachtBonusTotal: 0 })
    );
    const row = getByTestId("yacht-bonus-row");
    expect(within(row).getByText("+100")).toBeTruthy();
    expect(within(row).getByText("—")).toBeTruthy();
  });

  it("shows both players' jokers", async () => {
    const { getAllByText } = await renderCard(
      card({ yachtBonusTotal: 100 }),
      card({ yachtBonusTotal: 100 })
    );
    expect(getAllByText("+100")).toHaveLength(2);
  });

  it("shows the row when only the CPU has jokers", async () => {
    const { getByTestId } = await renderCard(card(), card({ yachtBonusTotal: 100 }));
    expect(within(getByTestId("yacht-bonus-row")).getByText("+100")).toBeTruthy();
  });

  it("hides the row when neither player has jokers", async () => {
    const { queryByTestId } = await renderCard(card(), card());
    expect(queryByTestId("yacht-bonus-row")).toBeNull();
  });
});

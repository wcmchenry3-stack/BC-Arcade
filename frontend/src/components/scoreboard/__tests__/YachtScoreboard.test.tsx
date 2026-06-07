import React from "react";
import { render } from "@testing-library/react-native";
import YachtScoreboard, { YachtScoreboardSide } from "../YachtScoreboard";
import { ThemeProvider } from "../../../theme/ThemeContext";

async function wrap(ui: React.ReactElement) {
  return await render(<ThemeProvider>{ui}</ThemeProvider>);
}

function makeSide(overrides: Partial<YachtScoreboardSide> = {}): YachtScoreboardSide {
  const scores: Record<string, number | null> = {
    ones: null,
    twos: null,
    threes: null,
    fours: null,
    fives: null,
    sixes: null,
    three_of_a_kind: null,
    four_of_a_kind: null,
    full_house: null,
    small_straight: null,
    large_straight: null,
    yacht: null,
    chance: null,
  };
  return {
    scores,
    upperSubtotal: 0,
    upperBonus: 0,
    yachtBonusCount: 0,
    totalScore: 0,
    ...overrides,
  };
}

describe("YachtScoreboard", () => {
  describe("empty cells", () => {
    it("renders an em-dash placeholder for each unscored category", async () => {
      const { getAllByText } = await wrap(<YachtScoreboard you={makeSide()} />);
      // 13 categories all unscored → 13 em-dashes.
      expect(getAllByText("—").length).toBe(13);
    });
  });

  describe("upper bonus row", () => {
    it("shows '+35' in bonus color once the upper sum reaches 63", async () => {
      const you = makeSide({
        scores: {
          ones: 3,
          twos: 6,
          threes: 9,
          fours: 12,
          fives: 15,
          sixes: 18,
        },
        upperSubtotal: 63,
        upperBonus: 35,
        totalScore: 98,
      });
      const { getByText } = await wrap(<YachtScoreboard you={you} />);
      expect(getByText("+35")).toBeTruthy();
    });

    it("shows the countdown text when below threshold", async () => {
      const you = makeSide({
        scores: { ones: 3, twos: 6, threes: 9 },
        upperSubtotal: 18,
        totalScore: 18,
      });
      // bonusCountdown = 63 - 18 = 45. The English template formats "45 more for +35".
      const { getByText } = await wrap(<YachtScoreboard you={you} />);
      expect(getByText(/45/)).toBeTruthy();
    });
  });

  describe("totals row", () => {
    it("renders only the You column when no opponent is provided", async () => {
      const you = makeSide({ totalScore: 240 });
      const { getByText, queryByText } = await wrap(
        <YachtScoreboard you={you} youLabel="You" opponentLabel="AI" />
      );
      expect(getByText("240")).toBeTruthy();
      // Opponent label/header should NOT render in single-column mode.
      expect(queryByText("AI")).toBeNull();
    });

    it("renders both columns when an opponent is provided", async () => {
      const you = makeSide({ totalScore: 240 });
      const opp = makeSide({ totalScore: 199 });
      const { getByText } = await wrap(
        <YachtScoreboard you={you} opponent={opp} youLabel="You" opponentLabel="AI" />
      );
      expect(getByText("240")).toBeTruthy();
      expect(getByText("199")).toBeTruthy();
      expect(getByText("AI")).toBeTruthy();
    });
  });
});

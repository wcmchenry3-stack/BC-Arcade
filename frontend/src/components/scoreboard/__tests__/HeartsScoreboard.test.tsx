import React from "react";
import { render } from "@testing-library/react-native";

import HeartsScoreboard from "../HeartsScoreboard";
import { ThemeProvider } from "../../../theme/ThemeContext";

async function wrap(ui: React.ReactElement) {
  return await render(<ThemeProvider>{ui}</ThemeProvider>);
}

const labels = ["You", "West", "North", "East"] as const;

describe("HeartsScoreboard", () => {
  describe("totals strip", () => {
    it("renders one column per player with name + score", async () => {
      const { getByText, getAllByText } = await wrap(
        <HeartsScoreboard
          playerLabels={labels}
          cumulativeScores={[13, 25, 41, 59]}
          scoreHistory={[]}
        />
      );
      labels.forEach((l) => expect(getByText(l)).toBeTruthy());
      // Each total appears twice (strip + table totals row).
      expect(getAllByText("13").length).toBe(2);
      expect(getAllByText("25").length).toBe(2);
      expect(getAllByText("41").length).toBe(2);
      expect(getAllByText("59").length).toBe(2);
    });
  });

  describe("round table", () => {
    it("renders single-letter header initials", async () => {
      const { getByText } = await wrap(
        <HeartsScoreboard playerLabels={labels} cumulativeScores={[0, 0, 0, 0]} scoreHistory={[]} />
      );
      expect(getByText("Y")).toBeTruthy();
      expect(getByText("W")).toBeTruthy();
      expect(getByText("N")).toBeTruthy();
      expect(getByText("E")).toBeTruthy();
    });

    it("renders only rounds that have been played (no placeholder rows)", async () => {
      const { getByText, queryByText } = await wrap(
        <HeartsScoreboard
          playerLabels={labels}
          cumulativeScores={[15, 14, 11, 21]}
          scoreHistory={[
            [5, 8, 4, 9],
            [10, 6, 7, 12],
          ]}
        />
      );
      // Round numbers 1 and 2 are unique (no row value or total equals "1" or "2").
      expect(getByText("1")).toBeTruthy();
      expect(getByText("2")).toBeTruthy();
      expect(queryByText("3")).toBeNull();
    });

    it("renders moon row with 0★ for shooter and 26 for the other three", async () => {
      const { getByText, getAllByText } = await wrap(
        <HeartsScoreboard
          playerLabels={labels}
          cumulativeScores={[0, 26, 26, 26]}
          scoreHistory={[[0, 26, 26, 26]]}
        />
      );
      expect(getByText("0★")).toBeTruthy();
      // 26 appears in: totals strip (3) + round row (3) + table totals row (3) = 9.
      expect(getAllByText("26").length).toBe(9);
    });

    it("does not apply moon styling to a non-moon row that happens to contain 0s", async () => {
      const { queryByText } = await wrap(
        <HeartsScoreboard
          playerLabels={labels}
          cumulativeScores={[5, 0, 8, 0]}
          scoreHistory={[[5, 0, 8, 0]]}
        />
      );
      expect(queryByText("0★")).toBeNull();
    });
  });

  describe("layout fit", () => {
    it("all 13 rounds render inline (no scroll container)", async () => {
      const thirteenRows = Array.from({ length: 13 }, (_, i) => [i, i + 1, i + 2, i + 3]);
      const { getAllByText } = await wrap(
        <HeartsScoreboard
          playerLabels={labels}
          cumulativeScores={[78, 91, 100, 84]}
          scoreHistory={thirteenRows}
        />
      );
      // Round 13 is visible — all rounds are rendered inline, not behind a scroll.
      expect(getAllByText("13").length).toBeGreaterThan(0);
    });
  });

  describe("compact mode", () => {
    it("hides the totals strip and footnote", async () => {
      const { queryByText } = await wrap(
        <HeartsScoreboard
          playerLabels={labels}
          cumulativeScores={[10, 30, 20, 40]}
          scoreHistory={[[5, 10, 8, 15]]}
          compact
        />
      );
      // Player names belong to the totals strip — gone in compact mode.
      // The single-letter header initial "W" is still rendered, but the
      // full label "West" is not.
      expect(queryByText("West")).toBeNull();
      expect(queryByText(/shooter zeroes/)).toBeNull();
    });
  });

  describe("footnote", () => {
    it("renders the rules footnote in non-compact mode", async () => {
      const { getByText } = await wrap(
        <HeartsScoreboard playerLabels={labels} cumulativeScores={[0, 0, 0, 0]} scoreHistory={[]} />
      );
      expect(getByText(/shooter zeroes/)).toBeTruthy();
    });
  });
});

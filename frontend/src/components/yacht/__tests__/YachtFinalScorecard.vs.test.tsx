import React from "react";
import { StyleSheet } from "react-native";
import { render, within } from "@testing-library/react-native";
import YachtFinalScorecard, { type FinalCard } from "../YachtFinalScorecard";
import { ThemeProvider, dark } from "../../../theme/ThemeContext";

// #3748: the final card shows both players in a game against the computer: each one's subtotals,
// who won each row, and a total whose colour follows who won (it was always muted for the computer).

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
const zero = Object.fromEntries(ALL_CATEGORIES.map((k) => [k, 0]));

function card(over: Partial<FinalCard> & { s?: Record<string, number> } = {}): FinalCard {
  const { s, ...rest } = over;
  return {
    scores: { ...zero, ...s },
    upperBonus: 0,
    yachtBonusTotal: 0,
    totalScore: 100,
    ...rest,
  };
}

async function renderCard(player: FinalCard, opponent?: FinalCard) {
  return await render(
    <ThemeProvider>
      <YachtFinalScorecard player={player} opponent={opponent} />
    </ThemeProvider>
  );
}

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never);

describe("YachtFinalScorecard — a game against the computer (#3748)", () => {
  it("shows the upper and lower subtotals of both players (audit bug 13)", async () => {
    const { getByTestId } = await renderCard(
      card({ s: { ones: 3, twos: 6, chance: 22, full_house: 25 } }),
      card({ s: { sixes: 18, fives: 15, small_straight: 30 } })
    );
    const upper = within(getByTestId("yacht-final-upper-subtotal"));
    expect(upper.getByText("Upper subtotal")).toBeTruthy();
    expect(upper.getByText("9")).toBeTruthy(); // you: 3 + 6
    expect(upper.getByText("33")).toBeTruthy(); // the computer: 18 + 15
    const lower = within(getByTestId("yacht-final-lower-subtotal"));
    expect(lower.getByText("47")).toBeTruthy(); // you: 22 + 25
    expect(lower.getByText("30")).toBeTruthy();
  });

  it("solo has no subtotal rows (the result card's own Upper / Lower / Bonus stats cover it)", async () => {
    const { queryByTestId } = await renderCard(card());
    expect(queryByTestId("yacht-final-upper-subtotal")).toBeNull();
    expect(queryByTestId("yacht-final-lower-subtotal")).toBeNull();
  });

  describe("row winners", () => {
    it("marks the higher score of a row: green for you, purple for the computer", async () => {
      const { getByTestId } = await renderCard(
        card({ s: { ones: 4, twos: 2 } }),
        card({ s: { ones: 1, twos: 8 } })
      );
      const youWin = flat(getByTestId("yacht-final-you-ones"));
      expect(youWin.color).toBe(dark.outcomeWin);
      expect(youWin.backgroundColor).toBe(dark.outcomeWinTint);
      // ... and the computer's cell in the same row is not marked.
      expect(flat(getByTestId("yacht-final-cpu-ones")).backgroundColor).toBeUndefined();

      const cpuWin = flat(getByTestId("yacht-final-cpu-twos"));
      expect(cpuWin.color).toBe(dark.outcomeDraw);
      expect(cpuWin.backgroundColor).toBe(dark.outcomeDrawTint);
      expect(flat(getByTestId("yacht-final-you-twos")).backgroundColor).toBeUndefined();
    });

    it("marks neither side of a tied row", async () => {
      const { getByTestId } = await renderCard(
        card({ s: { fours: 12 } }),
        card({ s: { fours: 12 } })
      );
      expect(flat(getByTestId("yacht-final-you-fours")).backgroundColor).toBeUndefined();
      expect(flat(getByTestId("yacht-final-cpu-fours")).backgroundColor).toBeUndefined();
    });

    it("says who won a row to a screen reader, and only in a game against the computer", async () => {
      const vs = await renderCard(
        card({ s: { ones: 4, twos: 2, threes: 6 } }),
        card({ s: { ones: 1, twos: 8, threes: 6 } })
      );
      expect(vs.getByTestId("yacht-final-row-ones").props.accessibilityLabel).toBe(
        "Ones: you 4, computer 1, you win the row"
      );
      expect(vs.getByTestId("yacht-final-row-twos").props.accessibilityLabel).toBe(
        "Twos: you 2, computer 8, the computer wins the row"
      );
      expect(vs.getByTestId("yacht-final-row-threes").props.accessibilityLabel).toBe(
        "Threes: you 6, computer 6, tied"
      );
      await vs.unmount();
      const solo = await renderCard(card({ s: { ones: 4 } }));
      expect(solo.getByTestId("yacht-final-row-ones").props.accessibilityLabel).toBeUndefined();
    });

    it("does not mark a row either side has not scored", async () => {
      const { getByTestId } = await renderCard(
        card({ scores: { ...zero, ones: 4 } }),
        card({ scores: { ...zero, ones: null as unknown as number } })
      );
      expect(flat(getByTestId("yacht-final-you-ones")).backgroundColor).toBeUndefined();
      expect(getByTestId("yacht-final-row-ones").props.accessibilityLabel).toBeUndefined();
    });
  });

  describe("the total", () => {
    it("is marked for the computer when it wins (it was always muted)", async () => {
      const { getByTestId } = await renderCard(card({ totalScore: 90 }), card({ totalScore: 120 }));
      const cpu = flat(getByTestId("yacht-final-cpu-total"));
      expect(cpu.color).toBe(dark.outcomeDraw);
      expect(cpu.backgroundColor).toBe(dark.outcomeDrawTint);
      expect(flat(getByTestId("yacht-final-you-total")).backgroundColor).toBeUndefined();
    });

    it("is marked for you when you win", async () => {
      const { getByTestId } = await renderCard(
        card({ totalScore: 150 }),
        card({ totalScore: 120 })
      );
      expect(flat(getByTestId("yacht-final-you-total")).color).toBe(dark.outcomeWin);
      expect(flat(getByTestId("yacht-final-cpu-total")).backgroundColor).toBeUndefined();
    });

    it("is marked for neither on a tie", async () => {
      const { getByTestId } = await renderCard(
        card({ totalScore: 120 }),
        card({ totalScore: 120 })
      );
      expect(flat(getByTestId("yacht-final-you-total")).backgroundColor).toBeUndefined();
      expect(flat(getByTestId("yacht-final-cpu-total")).backgroundColor).toBeUndefined();
    });
  });
});

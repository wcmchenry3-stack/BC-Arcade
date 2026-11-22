import React from "react";
import { render, fireEvent, within, act } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ScrollView, StyleSheet } from "react-native";
import ScoreTable from "../ScoreTable";
import { ThemeProvider, dark, light } from "../../../theme/ThemeContext";
import { clampRowHeight, DEFAULT_ROW_HEIGHT } from "../scoreRowHeight";

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
const CPU = { scores: emptyScores, totalScore: 0, yachtBonusTotal: 0 };

type Props = React.ComponentProps<typeof ScoreTable>;

function table(overrides: Partial<Props> = {}) {
  const props: Props = {
    playerScores: emptyScores,
    playerPossibleScores: {},
    playerRollsUsed: 0,
    playerGameOver: false,
    playerTotalScore: 0,
    playerYachtBonusTotal: 0,
    isAiTurn: false,
    onScore: jest.fn(),
    ...overrides,
  };
  return (
    <ThemeProvider>
      <ScoreTable {...props} />
    </ThemeProvider>
  );
}

async function renderTable(overrides: Partial<Props> = {}) {
  return await render(table(overrides));
}

const HIDDEN = { includeHiddenElements: true };
const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never);

describe("ScoreTable — one table for both modes (#3748)", () => {
  it("solo: all 13 rows, the subtotal band and the total, one score column, no tabs", async () => {
    const { getByTestId, queryByRole, queryByText, getByText } = await renderTable();
    for (const key of ALL_CATEGORIES) expect(getByTestId(`score-row-${key}`)).toBeTruthy();
    expect(getByTestId("yacht-upper-subtotal")).toBeTruthy();
    expect(getByTestId("yacht-total-row")).toBeTruthy();
    expect(queryByRole("tab")).toBeNull();
    expect(getByText("You")).toBeTruthy();
    expect(queryByText("CPU")).toBeNull();
  });

  it("vs: the same 13 rows and band, with the computer's column added", async () => {
    const { getByTestId, getByText } = await renderTable({ cpu: CPU });
    for (const key of ALL_CATEGORIES) expect(getByTestId(`score-row-${key}`)).toBeTruthy();
    expect(getByTestId("yacht-upper-subtotal")).toBeTruthy();
    expect(getByText("You")).toBeTruthy();
    expect(getByText("CPU")).toBeTruthy();
  });

  it("shows both totals in vs and only yours in solo", async () => {
    const vs = await renderTable({ cpu: { ...CPU, totalScore: 98 }, playerTotalScore: 142 });
    expect(vs.getByText("142")).toBeTruthy();
    expect(vs.getByText("98")).toBeTruthy();
    await vs.unmount();
    const solo = await renderTable({ playerTotalScore: 142 });
    expect(solo.getByText("142")).toBeTruthy();
  });

  it("names the Yacht Bonus under the total only when someone has one", async () => {
    const none = await renderTable();
    expect(none.queryByText("Yacht Bonus")).toBeNull();
    await none.unmount();
    const some = await renderTable({ playerYachtBonusTotal: 100, playerTotalScore: 160 });
    expect(some.getByText("Yacht Bonus")).toBeTruthy();
    expect(some.getByText("+100")).toBeTruthy();
  });

  it("labels the straights in full, not abbreviated (audit bug 5)", async () => {
    const { getByText, queryByText } = await renderTable();
    expect(getByText("Small Straight (30)")).toBeTruthy();
    expect(getByText("Large Straight (40)")).toBeTruthy();
    expect(queryByText(/Sm\. Straight/)).toBeNull();
  });
});

describe("ScoreTable — the upper subtotal is a band, not a score row (#3748)", () => {
  it("has no score-row testID, no press handler and is not a button", async () => {
    const { getByTestId, getAllByRole, queryAllByTestId } = await renderTable({
      playerRollsUsed: 1,
      playerPossibleScores: { ones: 3 },
    });
    const band = getByTestId("yacht-upper-subtotal");
    expect(band.props.testID).not.toMatch(/^score-row-/);
    expect(band.props.onPress).toBeUndefined();
    expect(band.props.onClick).toBeUndefined();
    expect(band.props.accessibilityRole).not.toBe("button");
    // Exactly the 13 rows are buttons; the band is none of them.
    expect(getAllByRole("button")).toHaveLength(13);
    expect(queryAllByTestId(/^score-row-/)).toHaveLength(13);
  });

  it("pressing the band scores nothing", async () => {
    const onScore = jest.fn();
    const { getByTestId } = await renderTable({
      playerRollsUsed: 1,
      playerPossibleScores: { ones: 3 },
      onScore,
    });
    await fireEvent.press(getByTestId("yacht-upper-subtotal"));
    expect(onScore).not.toHaveBeenCalled();
  });

  it("looks different from a scoring row: its own background, a top rule, a bold label", async () => {
    const { getByTestId, getByText } = await renderTable();
    const band = flat(getByTestId("yacht-upper-subtotal"));
    const row = flat(getByTestId("score-row-ones"));
    expect(band.backgroundColor).toBe(dark.surfaceHigh);
    expect(row.backgroundColor).not.toBe(band.backgroundColor);
    expect(band.borderTopWidth).toBeGreaterThanOrEqual(2);
    expect(row.borderTopWidth ?? 0).toBe(0);
    const label = flat(getByText("Upper subtotal"));
    expect(label.fontWeight).toBe("900");
    expect(label.textTransform).toBe("uppercase");
  });

  it("shows the subtotal and the bonus progress on the band", async () => {
    const { getByTestId } = await renderTable({
      playerScores: { ...emptyScores, ones: 3, twos: 6, threes: 9, fours: 12 },
    });
    expect(getByTestId("yacht-upper-bonus-line").props.children).toBe("30 / 63 · +35 bonus");
    expect(flat(getByTestId("yacht-upper-subtotal")).minHeight).toBeGreaterThan(0);
  });

  it("marks the bonus earned (check mark and +35) once the subtotal reaches 63", async () => {
    const { getByTestId, getByText } = await renderTable({
      playerScores: { ...emptyScores, twos: 8, threes: 15, fours: 20, fives: 20 },
    });
    expect(getByTestId("yacht-upper-bonus-line").props.children).toBe("63 / 63 ✓ · +35 bonus");
    expect(getByText("+35")).toBeTruthy();
  });

  it("vs: the computer's upper subtotal is in its column", async () => {
    const { getByText } = await renderTable({
      cpu: { ...CPU, scores: { ...emptyScores, sixes: 18, fives: 15 } },
    });
    expect(getByText("33")).toBeTruthy();
  });
});

describe("ScoreTable — scoring rows", () => {
  it("calls onScore with the row's key when an open row is pressed", async () => {
    const onScore = jest.fn();
    const { getByTestId } = await renderTable({
      playerRollsUsed: 1,
      playerPossibleScores: { ones: 3 },
      onScore,
    });
    await fireEvent.press(getByTestId("score-row-ones"));
    expect(onScore).toHaveBeenCalledWith("ones");
  });

  it("does not score before the first roll", async () => {
    const onScore = jest.fn();
    const { getByTestId } = await renderTable({ playerRollsUsed: 0, onScore });
    await fireEvent.press(getByTestId("score-row-ones"));
    expect(onScore).not.toHaveBeenCalled();
    expect(getByTestId("score-row-ones").props.accessibilityState.disabled).toBe(true);
  });

  it("does not score a row that is already scored", async () => {
    const onScore = jest.fn();
    const { getByTestId } = await renderTable({
      playerRollsUsed: 1,
      playerScores: { ...emptyScores, ones: 5 },
      playerPossibleScores: { twos: 8 },
      onScore,
    });
    await fireEvent.press(getByTestId("score-row-ones"));
    expect(onScore).not.toHaveBeenCalled();
  });

  it("does not score on the computer's turn, solo or vs", async () => {
    const onScore = jest.fn();
    const { getByTestId } = await renderTable({
      playerRollsUsed: 1,
      playerPossibleScores: { ones: 3, twos: 6 },
      isAiTurn: true,
      cpu: CPU,
      onScore,
    });
    await fireEvent.press(getByTestId("score-row-ones"));
    expect(onScore).not.toHaveBeenCalled();
  });

  it("does not score once the game is over", async () => {
    const onScore = jest.fn();
    const { getByTestId } = await renderTable({
      playerRollsUsed: 1,
      playerGameOver: true,
      playerPossibleScores: { ones: 3 },
      onScore,
    });
    await fireEvent.press(getByTestId("score-row-ones"));
    expect(onScore).not.toHaveBeenCalled();
  });

  it("vs: a row's label gives the computer's value too, or that it has not scored", async () => {
    const { getByTestId } = await renderTable({
      cpu: { ...CPU, scores: { ...emptyScores, chance: 21 } },
      playerRollsUsed: 1,
      playerScores: { ...emptyScores, twos: 6, chance: 22 },
      playerPossibleScores: { ones: 3 },
    });
    expect(getByTestId("score-row-chance").props.accessibilityLabel).toBe(
      "Chance: scored, 22. Computer: 21"
    );
    expect(getByTestId("score-row-ones").props.accessibilityLabel).toBe(
      "Ones: open, would score 3, double-tap to score. Computer: open"
    );
    expect(getByTestId("score-row-threes").props.accessibilityLabel).toBe(
      "Threes: not available. Computer: open"
    );
  });

  it("solo: a row's label is yours alone", async () => {
    const { getByTestId } = await renderTable({ playerScores: { ...emptyScores, twos: 6 } });
    expect(getByTestId("score-row-twos").props.accessibilityLabel).toBe("Twos: scored, 6");
  });

  it("labels an open row for a screen reader with its potential, a scored one with its score", async () => {
    const { getByTestId } = await renderTable({
      playerRollsUsed: 1,
      playerScores: { ...emptyScores, twos: 6 },
      playerPossibleScores: { ones: 3 },
    });
    expect(getByTestId("score-row-ones").props.accessibilityLabel).toBe(
      "Ones: open, would score 3, double-tap to score"
    );
    expect(getByTestId("score-row-twos").props.accessibilityLabel).toBe("Twos: scored, 6");
    expect(getByTestId("score-row-threes").props.accessibilityLabel).toBe("Threes: not available");
  });
});

describe("ScoreTable — potentials look the same in both modes", () => {
  it.each([
    ["solo", undefined],
    ["vs", CPU],
  ])("%s: teal potentials, zeros dimmed, the best row boxed", async (_mode, cpu) => {
    const { getByTestId } = await renderTable({
      cpu,
      playerRollsUsed: 1,
      playerPossibleScores: { ones: 3, twos: 12, threes: 0, chance: 21 },
    });
    const valueOf = (key: string, text: string) =>
      flat(within(getByTestId(`score-row-${key}`)).getByText(text));
    // The best potential (21) is the one boxed.
    expect(
      flat(within(getByTestId("score-row-chance")).getByTestId("yacht-best-potential")).borderWidth
    ).toBe(2);
    // Teal for a potential, dimmed for a zero.
    expect(valueOf("ones", "3").color).toBe(dark.potential);
    expect(valueOf("twos", "12").color).toBe(dark.potential);
    expect(valueOf("chance", "21").color).toBe(dark.potential);
    expect(valueOf("threes", "0").color).toBe(dark.textMuted);
  });

  it("boxes exactly one row, the highest, and none when every potential is 0", async () => {
    const some = await renderTable({
      playerRollsUsed: 1,
      playerPossibleScores: { ones: 3, twos: 12, chance: 21 },
    });
    expect(some.getAllByTestId("yacht-best-potential")).toHaveLength(1);
    expect(
      within(some.getByTestId("score-row-chance")).getByTestId("yacht-best-potential")
    ).toBeTruthy();
    await some.unmount();
    const zeros = await renderTable({
      playerRollsUsed: 1,
      playerPossibleScores: { ones: 0, twos: 0 },
    });
    expect(zeros.queryByTestId("yacht-best-potential")).toBeNull();
  });

  it("dims a scratched row (0) and shows no potential before the first roll", async () => {
    const scratched = await renderTable({
      playerRollsUsed: 1,
      playerScores: { ...emptyScores, twos: 0, fours: 12 },
      playerPossibleScores: { threes: 9 },
    });
    const colorOf = (key: string, text: string) =>
      flat(within(scratched.getByTestId(`score-row-${key}`)).getByText(text)).color;
    // A scored 0 is a result: bold, like any scored value, not the dimmed open look (#3968).
    expect(colorOf("twos", "0")).toBe(dark.text);
    expect(colorOf("fours", "12")).toBe(dark.text);
    await scratched.unmount();
    const before = await renderTable({
      playerRollsUsed: 0,
      playerPossibleScores: { threes: 9 },
    });
    expect(before.queryByText("9")).toBeNull();
  });
});

describe("ScoreTable — the Hint's row and the computer's last row", () => {
  it("tints and bars the row the Hint suggests, and no other", async () => {
    const { getByTestId, getAllByTestId } = await renderTable({
      playerRollsUsed: 3,
      playerPossibleScores: { large_straight: 40, chance: 15 },
      hintCategory: "large_straight",
    });
    expect(getAllByTestId("yacht-hint-row-bar")).toHaveLength(1);
    const row = getByTestId("score-row-large_straight");
    expect(within(row).getByTestId("yacht-hint-row-bar")).toBeTruthy();
    expect(flat(row).backgroundColor).toBe(dark.outcomeWin + "26");
  });

  it("ignores a hint for a row that is no longer open", async () => {
    const { queryByTestId } = await renderTable({
      playerRollsUsed: 1,
      playerScores: { ...emptyScores, large_straight: 40 },
      hintCategory: "large_straight",
    });
    expect(queryByTestId("yacht-hint-row-bar")).toBeNull();
  });

  it("vs: tints the row the computer just scored purple, with a left bar", async () => {
    const { getByTestId, getAllByTestId } = await renderTable({
      cpu: { ...CPU, scores: { ...emptyScores, full_house: 25 } },
      cpuLastScored: "full_house",
    });
    expect(getAllByTestId("yacht-cpu-row-bar")).toHaveLength(1);
    const row = getByTestId("score-row-full_house");
    expect(within(row).getByTestId("yacht-cpu-row-bar")).toBeTruthy();
    expect(flat(row).backgroundColor).toBe(dark.secondary + "26");
    expect(flat(within(row).getByTestId("yacht-cpu-row-bar")).backgroundColor).toBe(dark.secondary);
  });

  it("solo has no computer row to highlight", async () => {
    const { queryByTestId } = await renderTable({ cpuLastScored: "full_house" });
    expect(queryByTestId("yacht-cpu-row-bar")).toBeNull();
  });

  describe("scrolls the computer's row into view (a small phone)", () => {
    let scrollTo: jest.SpyInstance;
    beforeEach(() => {
      scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
    });
    afterEach(() => scrollTo.mockRestore());

    it("scrolls to the row, a margin above it, when it is highlighted", async () => {
      const { getByTestId, rerender } = await renderTable({ cpu: CPU });
      await fireEvent(getByTestId("yacht-row-wrap-chance"), "layout", {
        nativeEvent: { layout: { x: 0, y: 400, width: 300, height: 29 } },
      });
      await rerender(table({ cpu: CPU, cpuLastScored: "chance" }));
      expect(scrollTo).toHaveBeenCalledTimes(1);
      const arg = scrollTo.mock.calls[0]![0] as { y: number };
      expect(arg.y).toBeGreaterThan(300);
      expect(arg.y).toBeLessThanOrEqual(400);
    });

    it("adds where the card starts: a row's y is relative to the card", async () => {
      const { getByTestId, rerender } = await renderTable({ cpu: CPU });
      await fireEvent(getByTestId("yacht-score-card"), "layout", {
        nativeEvent: { layout: { x: 0, y: 26, width: 300, height: 600 } },
      });
      await fireEvent(getByTestId("yacht-row-wrap-chance"), "layout", {
        nativeEvent: { layout: { x: 0, y: 400, width: 300, height: 29 } },
      });
      await rerender(table({ cpu: CPU, cpuLastScored: "chance" }));
      expect((scrollTo.mock.calls[0]![0] as { y: number }).y).toBe(26 + 400 - 48);
    });

    it("never scrolls above the top", async () => {
      const { getByTestId, rerender } = await renderTable({ cpu: CPU });
      await fireEvent(getByTestId("yacht-row-wrap-ones"), "layout", {
        nativeEvent: { layout: { x: 0, y: 10, width: 300, height: 29 } },
      });
      await rerender(table({ cpu: CPU, cpuLastScored: "ones" }));
      expect((scrollTo.mock.calls[0]![0] as { y: number }).y).toBe(0);
    });

    it("does nothing without a highlighted row", async () => {
      await renderTable({ cpu: CPU });
      expect(scrollTo).not.toHaveBeenCalled();
    });
  });
});

describe("ScoreTable — in vs the computer's scores are in its column", () => {
  it("shows its scored values and a dash for open rows", async () => {
    const { getByTestId } = await renderTable({
      cpu: { ...CPU, scores: { ...emptyScores, chance: 21 } },
    });
    expect(within(getByTestId("score-row-chance")).getByText("21")).toBeTruthy();
    // Ones: your dash and the computer's.
    expect(within(getByTestId("score-row-ones")).getAllByText("—")).toHaveLength(2);
  });
});

describe("ScoreTable — scored rows are obvious without colour (#3968)", () => {
  const scoredProps = {
    playerRollsUsed: 1,
    playerScores: { ...emptyScores, twos: 6, fours: 0 },
    playerPossibleScores: { ones: 3, threes: 0, chance: 21 },
  };

  it("a scored row has a check, a fill, a dimmer label and a bold score; an open row has none", async () => {
    const { getByTestId, queryByTestId } = await renderTable(scoredProps);
    const twos = getByTestId("score-row-twos");
    expect(getByTestId("score-row-check-twos", HIDDEN)).toBeTruthy();
    expect(flat(twos).backgroundColor).toBe(dark.surfaceHigh);
    expect(flat(within(twos).getByText("Twos")).color).toBe(dark.textMuted);
    expect(flat(within(twos).getByText("6")).fontWeight).toBe("700");
    expect(flat(within(twos).getByText("6")).color).toBe(dark.text);

    const ones = getByTestId("score-row-ones");
    expect(queryByTestId("score-row-check-ones", HIDDEN)).toBeNull();
    expect(flat(ones).backgroundColor).toBe("transparent");
    expect(flat(within(ones).getByText("Ones")).color).toBe(dark.text);
    expect(flat(within(ones).getByText("3")).color).toBe(dark.potential);
    expect(flat(within(ones).getByText("3")).fontWeight).not.toBe("700");
  });

  it("uses the lighter surface token in the light theme", async () => {
    try {
      await AsyncStorage.setItem("gaming_app_theme_mode", "light");
      const { getByTestId } = await renderTable(scoredProps);
      await act(async () => {});
      expect(flat(getByTestId("score-row-twos")).backgroundColor).toBe(light.surfaceAlt);
    } finally {
      await AsyncStorage.clear();
    }
  });

  it("a scored 0 keeps the check and a bold 0, unlike an open row's dash or dimmed 0", async () => {
    const { getByTestId, queryByTestId } = await renderTable(scoredProps);
    const fours = getByTestId("score-row-fours");
    expect(getByTestId("score-row-check-fours", HIDDEN)).toBeTruthy();
    expect(flat(within(fours).getByText("0")).fontWeight).toBe("700");
    // An open row with a 0 potential: no check, regular weight, dimmed.
    const threes = getByTestId("score-row-threes");
    expect(queryByTestId("score-row-check-threes", HIDDEN)).toBeNull();
    expect(flat(within(threes).getByText("0")).fontWeight).toBe("400");
    expect(flat(within(threes).getByText("0")).color).toBe(dark.textMuted);
    // An open row with nothing to score: a dash.
    expect(within(getByTestId("score-row-fives")).getByText("—")).toBeTruthy();
  });

  it("the check mark carries no extra spoken label (the row's label says scored)", async () => {
    const { getByTestId } = await renderTable(scoredProps);
    expect(getByTestId("score-row-twos").props.accessibilityLabel).toBe("Twos: scored, 6");
    expect(getByTestId("score-row-fours").props.accessibilityLabel).toBe("Fours: scored, 0");
    expect(getByTestId("score-row-ones").props.accessibilityLabel).toBe(
      "Ones: open, would score 3, double-tap to score"
    );
  });

  it("keeps only `disabled` in the accessibility state: the label says scored or open", async () => {
    const { getByTestId } = await renderTable(scoredProps);
    expect(getByTestId("score-row-twos").props.accessibilityState).toEqual({ disabled: true });
    expect(getByTestId("score-row-ones").props.accessibilityState).toEqual({ disabled: false });
  });

  it("hides the check mark from the accessibility tree", async () => {
    const { getByTestId } = await renderTable(scoredProps);
    const check = getByTestId("score-row-check-twos", HIDDEN);
    expect(check.props.accessibilityElementsHidden).toBe(true);
    expect(check.props.importantForAccessibility).toBe("no-hide-descendants");
  });

  it("vs: the computer's last row keeps its bar and the scored fill, with no tint over the fill", async () => {
    const { getByTestId, queryByTestId } = await renderTable({
      ...scoredProps,
      cpu: { ...CPU, scores: { ...emptyScores, twos: 8 } },
      cpuLastScored: "twos",
    });
    const row = getByTestId("score-row-twos");
    expect(flat(row).backgroundColor).toBe(dark.surfaceHigh);
    expect(queryByTestId("yacht-cpu-row-tint")).toBeNull();
    expect(within(row).getByTestId("yacht-cpu-row-bar")).toBeTruthy();
    expect(within(row).getByTestId("score-row-check-twos", HIDDEN)).toBeTruthy();
  });

  describe("WCAG AA contrast on a scored row, including the one the computer just took", () => {
    const lin = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1, 7), 16);
      return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };

    it.each([
      ["dark", dark, dark.surfaceHigh],
      ["light", light, light.surfaceAlt],
    ] as const)(
      "%s: label, score and the computer's value reach 4.5:1 on the fill",
      (_n, c, fill) => {
        expect(ratio(c.textMuted, fill)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(c.text, fill)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(c.outcomeDraw, fill)).toBeGreaterThanOrEqual(4.5);
      }
    );

    it("the scored row in the table is drawn on exactly that fill, never with a tint over it", async () => {
      const { getByTestId } = await renderTable({
        ...scoredProps,
        cpu: { ...CPU, scores: { ...emptyScores, twos: 8 } },
        cpuLastScored: "twos",
      });
      const row = getByTestId("score-row-twos");
      expect(flat(row).backgroundColor).toBe(dark.surfaceHigh);
      expect(flat(within(row).getByText("Twos")).color).toBe(dark.textMuted);
      expect(flat(within(row).getByText("8")).color).toBe(dark.outcomeDraw);
    });
  });

  it("row labels stay on one line and shrink to 85% before they would truncate", async () => {
    const { getByTestId } = await renderTable(scoredProps);
    for (const [key, text] of [
      ["twos", "Twos"],
      ["ones", "Ones"],
    ] as const) {
      const label = within(getByTestId(`score-row-${key}`)).getByText(text);
      expect(label.props.numberOfLines).toBe(1);
      expect(label.props.adjustsFontSizeToFit).toBe(true);
      expect(label.props.minimumFontScale).toBe(0.85);
    }
  });

  it("the Hint's tint replaces the fill on an open row (an open row is never filled)", async () => {
    const { getByTestId } = await renderTable({ ...scoredProps, hintCategory: "ones" });
    expect(flat(getByTestId("score-row-ones")).backgroundColor).toBe(dark.outcomeWin + "26");
  });
});

describe("ScoreTable — row height is measured and font scaling is capped (#3968)", () => {
  it("starts at the default height before it is measured", async () => {
    const { getByTestId } = await renderTable();
    expect(flat(getByTestId("score-row-ones")).minHeight).toBe(DEFAULT_ROW_HEIGHT);
  });

  it("sizes the rows from the measured height of the table", async () => {
    const { getByTestId } = await renderTable();
    await fireEvent(getByTestId("yacht-scorecard"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 560 } },
    });
    const expected = clampRowHeight(560);
    expect(expected).not.toBe(DEFAULT_ROW_HEIGHT);
    expect(flat(getByTestId("score-row-ones")).minHeight).toBe(expected);
    await fireEvent(getByTestId("yacht-scorecard"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 400 } },
    });
    expect(flat(getByTestId("score-row-ones")).minHeight).toBe(26);
  });

  it("caps font scaling on the row, band and total text, and keeps the band line to one line", async () => {
    const { getByTestId, getByText } = await renderTable({
      playerScores: { ...emptyScores, twos: 6 },
    });
    const row = getByTestId("score-row-twos");
    expect(within(row).getByText("Twos").props.maxFontSizeMultiplier).toBe(1.2);
    expect(within(row).getByText("6").props.maxFontSizeMultiplier).toBe(1.2);
    const line = getByTestId("yacht-upper-bonus-line");
    expect(line.props.maxFontSizeMultiplier).toBe(1.2);
    expect(line.props.numberOfLines).toBe(1);
    expect(line.props.adjustsFontSizeToFit).toBe(true);
    expect(line.props.minimumFontScale).toBe(0.85);
    expect(getByTestId("yacht-total-you").props.maxFontSizeMultiplier).toBe(1.2);
    expect(getByText("Total").props.maxFontSizeMultiplier).toBe(1.2);
  });
});

describe("clampRowHeight (#3968)", () => {
  it("is the default until the table is measured", () => {
    expect(clampRowHeight(null)).toBe(DEFAULT_ROW_HEIGHT);
    expect(clampRowHeight(undefined)).toBe(DEFAULT_ROW_HEIGHT);
    expect(clampRowHeight(0)).toBe(DEFAULT_ROW_HEIGHT);
    expect(clampRowHeight(Number.NaN)).toBe(DEFAULT_ROW_HEIGHT);
  });

  it("is the largest whole-point row that fits 13 rows plus the chrome", () => {
    // 126 pt of chrome: 126 + 13 * 29 = 503 fits 29; 502 does not.
    expect(clampRowHeight(503)).toBe(29);
    expect(clampRowHeight(502)).toBe(28);
    expect(clampRowHeight(126 + 13 * 30)).toBe(30);
  });

  it("never goes below 26 (the table scrolls instead) or above 32", () => {
    expect(clampRowHeight(300)).toBe(26);
    expect(clampRowHeight(1)).toBe(26);
    expect(clampRowHeight(2000)).toBe(32);
  });
});

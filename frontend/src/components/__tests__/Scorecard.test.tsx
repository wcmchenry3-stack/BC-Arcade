import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import Scorecard from "../Scorecard";
import { ThemeProvider } from "../../theme/ThemeContext";

// Ensure all tests run in a narrow viewport so tab layout is active by default.
// Wide-layout tests override this per-describe via beforeEach/afterEach.
jest.spyOn(Dimensions, "get").mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });

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

function renderScorecard(overrides: Partial<React.ComponentProps<typeof Scorecard>> = {}) {
  const defaults = {
    scores: emptyScores,
    possibleScores: {},
    rollsUsed: 0,
    gameOver: false,
    upperSubtotal: 0,
    upperBonus: 0,
    yachtBonusCount: 0,
    yachtBonusTotal: 0,
    totalScore: 0,
    onScore: jest.fn(),
  };
  const props = { ...defaults, ...overrides };
  return render(
    <ThemeProvider>
      <Scorecard {...props} />
    </ThemeProvider>
  );
}

describe("Scorecard — tabs", () => {
  it("renders Upper and Lower tabs", () => {
    const { getAllByRole } = renderScorecard();
    const tabs = getAllByRole("tab");
    expect(tabs.length).toBe(2);
  });

  it("defaults to upper tab selected", () => {
    const { getAllByRole } = renderScorecard();
    const tabs = getAllByRole("tab");
    expect(tabs[0]?.props.accessibilityState?.selected).toBe(true);
    expect(tabs[1]?.props.accessibilityState?.selected).toBe(false);
  });

  it("shows 6 upper category rows by default", () => {
    const { getAllByRole } = renderScorecard();
    const rows = getAllByRole("button").filter((b) => b.props.accessibilityLabel?.includes(":"));
    expect(rows.length).toBe(6);
  });

  it("shows 7 lower category rows after switching to lower tab", () => {
    const { getAllByRole, getByRole } = renderScorecard();
    fireEvent.press(getByRole("tab", { name: /lower/i }));
    const rows = getAllByRole("button").filter((b) => b.props.accessibilityLabel?.includes(":"));
    expect(rows.length).toBe(7);
  });

  it("lower tab becomes selected after pressing it", () => {
    const { getAllByRole, getByRole } = renderScorecard();
    fireEvent.press(getByRole("tab", { name: /lower/i }));
    const tabs = getAllByRole("tab");
    expect(tabs[0]?.props.accessibilityState?.selected).toBe(false);
    expect(tabs[1]?.props.accessibilityState?.selected).toBe(true);
  });
});

describe("Scorecard — wide layout (≥600dp)", () => {
  let dimSpy: jest.SpyInstance;

  beforeEach(() => {
    dimSpy = jest
      .spyOn(Dimensions, "get")
      .mockReturnValue({ width: 800, height: 1200, scale: 1, fontScale: 1 });
  });

  afterEach(() => {
    dimSpy.mockRestore();
    // Restore the narrow-viewport default for subsequent describe blocks
    jest
      .spyOn(Dimensions, "get")
      .mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
  });

  it("renders all 13 categories without tabs", () => {
    const { queryByRole, getAllByRole } = renderScorecard({ rollsUsed: 0 });
    expect(queryByRole("tab")).toBeNull();
    const rows = getAllByRole("button").filter((b) => b.props.accessibilityLabel?.includes(":"));
    expect(rows.length).toBe(13);
  });
});

describe("Scorecard", () => {
  it("displays the total score", () => {
    const { getByText } = renderScorecard({ totalScore: 142 });
    expect(getByText("142")).toBeTruthy();
  });

  it("shows potential scores when rollsUsed > 0", () => {
    // Use distinct values that don't collide with CategoryIcon glyphs (1–6)
    const { getByText } = renderScorecard({
      rollsUsed: 1,
      possibleScores: { ones: 17, twos: 23 },
    });
    expect(getByText("17")).toBeTruthy();
    expect(getByText("23")).toBeTruthy();
  });

  it("does not show potential scores when rollsUsed === 0", () => {
    const { queryByText } = renderScorecard({
      rollsUsed: 0,
      possibleScores: { ones: 17 },
    });
    expect(queryByText("17")).toBeNull();
  });

  it("calls onScore with the correct category key when a row is pressed", () => {
    const onScore = jest.fn();
    const { getByRole } = renderScorecard({
      rollsUsed: 1,
      possibleScores: { ones: 3 },
      onScore,
    });
    fireEvent.press(getByRole("button", { name: /^Ones:/i }));
    expect(onScore).toHaveBeenCalledWith("ones");
  });

  it("does not call onScore when rollsUsed === 0", () => {
    const onScore = jest.fn();
    const { getByRole } = renderScorecard({ rollsUsed: 0, onScore });
    fireEvent.press(getByRole("button", { name: /^Ones:/i }));
    expect(onScore).not.toHaveBeenCalled();
  });

  it("does not call onScore for an already-scored category", () => {
    const onScore = jest.fn();
    const { getByRole } = renderScorecard({
      rollsUsed: 1,
      scores: { ...emptyScores, ones: 3 },
      possibleScores: { twos: 6 },
      onScore,
    });
    fireEvent.press(getByRole("button", { name: /^Ones:/i }));
    expect(onScore).not.toHaveBeenCalled();
  });

  it("shows bonus progress text when upperBonus === 0", () => {
    const { getAllByText } = renderScorecard({ upperSubtotal: 21, upperBonus: 0 });
    expect(getAllByText(/21 \/ 63/).length).toBeGreaterThan(0);
  });

  it("shows bonus achieved text when upperBonus > 0", () => {
    const { getAllByText } = renderScorecard({ upperSubtotal: 63, upperBonus: 35 });
    expect(getAllByText(/✓/).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// GH #263 — scorecard reset: all-null scores render blank (upper & lower)
// ---------------------------------------------------------------------------

const UPPER_CATS = ["Ones", "Twos", "Threes", "Fours", "Fives", "Sixes"];
const LOWER_CATS = [
  "Three of a Kind",
  "Four of a Kind",
  "Full House (25)",
  "Sm. Straight (30)",
  "Lg. Straight (40)",
  "Yacht! (50)",
  "Chance",
];

describe("Scorecard — reset to all-null scores (GH #263)", () => {
  it("renders all upper section rows as 'not available' when scores are null", () => {
    const { getByRole } = renderScorecard({ rollsUsed: 0 });
    for (const cat of UPPER_CATS) {
      expect(getByRole("button", { name: new RegExp(`${cat}:.*not available`, "i") })).toBeTruthy();
    }
  });

  it("renders all lower section rows as 'not available' when scores are null", () => {
    const { getByRole } = renderScorecard({ rollsUsed: 0 });
    fireEvent.press(getByRole("tab", { name: /lower/i }));
    for (const cat of LOWER_CATS) {
      expect(
        getByRole("button", {
          // codeql[js/regex-injection] cat is from LOWER_CATS constant — not user input
          name: new RegExp(`${cat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*not available`, "i"),
        })
      ).toBeTruthy();
    }
  });

  it("transitions upper rows from scored to 'not available' when scores reset to null", () => {
    const filledScores = Object.fromEntries(ALL_CATEGORIES.map((k) => [k, 5]));
    const { rerender, getByRole } = renderScorecard({
      scores: filledScores,
      rollsUsed: 0,
    });
    expect(getByRole("button", { name: /Ones:.*scored/i })).toBeTruthy();

    rerender(
      <ThemeProvider>
        <Scorecard
          scores={emptyScores}
          possibleScores={{}}
          rollsUsed={0}
          gameOver={false}
          upperSubtotal={0}
          upperBonus={0}
          yachtBonusCount={0}
          yachtBonusTotal={0}
          totalScore={0}
          onScore={jest.fn()}
        />
      </ThemeProvider>
    );
    for (const cat of UPPER_CATS) {
      expect(getByRole("button", { name: new RegExp(`${cat}:.*not available`, "i") })).toBeTruthy();
    }
  });

  it("transitions lower rows from scored to 'not available' when scores reset to null", () => {
    const filledScores = Object.fromEntries(ALL_CATEGORIES.map((k) => [k, 5]));
    const { rerender, getByRole } = renderScorecard({
      scores: filledScores,
      rollsUsed: 0,
    });
    fireEvent.press(getByRole("tab", { name: /lower/i }));
    expect(getByRole("button", { name: /Chance:.*scored/i })).toBeTruthy();

    rerender(
      <ThemeProvider>
        <Scorecard
          scores={emptyScores}
          possibleScores={{}}
          rollsUsed={0}
          gameOver={false}
          upperSubtotal={0}
          upperBonus={0}
          yachtBonusCount={0}
          yachtBonusTotal={0}
          totalScore={0}
          onScore={jest.fn()}
        />
      </ThemeProvider>
    );
    for (const cat of LOWER_CATS) {
      expect(
        getByRole("button", {
          // codeql[js/regex-injection] cat is from LOWER_CATS constant — not user input
          name: new RegExp(`${cat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*not available`, "i"),
        })
      ).toBeTruthy();
    }
  });
});

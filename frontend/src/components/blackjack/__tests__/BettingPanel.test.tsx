import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import BettingPanel from "../BettingPanel";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { DEFAULT_RULES } from "../../../game/blackjack/engine";

jest.mock("@expo/vector-icons/MaterialIcons", () => "MockMaterialIcons");

function renderPanel(
  overrides: Partial<{
    chips: number;
    loading: boolean;
    error: string | null;
    betMin: number;
    betMax: number;
    chipDenominations: readonly number[];
  }> = {}
) {
  const onDeal = jest.fn();
  const onRulesChange = jest.fn();
  const {
    chips = 1000,
    loading = false,
    error = null,
    betMin = 5,
    betMax = 25,
    chipDenominations = [5, 10, 25],
  } = overrides;
  const utils = render(
    <ThemeProvider>
      <BettingPanel
        chips={chips}
        betMin={betMin}
        betMax={betMax}
        chipDenominations={chipDenominations}
        onDeal={onDeal}
        loading={loading}
        error={error}
        rules={DEFAULT_RULES}
        onRulesChange={onRulesChange}
      />
    </ThemeProvider>
  );
  return { ...utils, onDeal, onRulesChange };
}

describe("BettingPanel", () => {
  it("renders Deal button", () => {
    const { getByText } = renderPanel();
    expect(getByText("Deal")).toBeTruthy();
  });

  it("Deal button is disabled when bet is 0", () => {
    const { getByLabelText } = renderPanel({ chips: 1000 });
    const dealBtn = getByLabelText(/deal cards with 0-chip bet/i);
    expect(dealBtn.props.accessibilityState.disabled).toBe(true);
  });

  it("calls onDeal with bet amount after placing a chip", () => {
    const { getByLabelText, getByText, onDeal } = renderPanel({ chips: 1000 });
    fireEvent.press(getByLabelText(/add 25 to bet/i));
    fireEvent.press(getByText("Deal"));
    expect(onDeal).toHaveBeenCalledWith(25);
  });

  it("does not call onDeal when loading", () => {
    const { getByText, onDeal } = renderPanel({ loading: true });
    fireEvent.press(getByText("Deal"));
    expect(onDeal).not.toHaveBeenCalled();
  });

  it("renders error message when error prop is set", () => {
    const { getByText } = renderPanel({ error: "Something went wrong" });
    expect(getByText("Something went wrong")).toBeTruthy();
  });

  it("renders chip denomination buttons", () => {
    const { getByLabelText } = renderPanel();
    expect(getByLabelText(/add 5 to bet/i)).toBeTruthy();
    expect(getByLabelText(/add 10 to bet/i)).toBeTruthy();
    expect(getByLabelText(/add 25 to bet/i)).toBeTruthy();
  });

  it("chip click adds denomination to displayed bet", () => {
    const { getByLabelText } = renderPanel({ chips: 1000 });
    fireEvent.press(getByLabelText(/add 25 to bet/i));
    expect(getByLabelText(/deal cards with 25-chip bet/i)).toBeTruthy();
  });

  it("multiple chip clicks accumulate", () => {
    const { getByLabelText } = renderPanel({ chips: 1000 });
    fireEvent.press(getByLabelText(/add 10 to bet/i));
    fireEvent.press(getByLabelText(/add 5 to bet/i));
    expect(getByLabelText(/deal cards with 15-chip bet/i)).toBeTruthy();
  });

  it("Clear Bet button resets bet to 0", () => {
    const { getByLabelText } = renderPanel({ chips: 1000 });
    fireEvent.press(getByLabelText(/add 5 to bet/i));
    fireEvent.press(getByLabelText(/clear bet/i));
    expect(getByLabelText(/deal cards with 0-chip bet/i)).toBeTruthy();
  });

  it("25 chip is disabled when chips < 25", () => {
    const { getByLabelText } = renderPanel({ chips: 10 });
    const btn = getByLabelText(/25.*not available/i);
    expect(btn.props.accessibilityState.disabled).toBe(true);
  });

  describe("tooltip toggle", () => {
    function openRules(utils: ReturnType<typeof renderPanel>) {
      fireEvent.press(utils.getByLabelText(/table rules/i));
    }

    it("tapping soft17 info button shows tooltip text", () => {
      const utils = renderPanel();
      openRules(utils);
      fireEvent.press(utils.getByLabelText(/information about dealer soft 17/i));
      expect(
        utils.getByText(/dealer stands on soft 17/i)
      ).toBeTruthy();
    });

    it("tapping soft17 info button again hides tooltip text", () => {
      const utils = renderPanel();
      openRules(utils);
      fireEvent.press(utils.getByLabelText(/information about dealer soft 17/i));
      fireEvent.press(utils.getByLabelText(/information about dealer soft 17/i));
      expect(
        utils.queryByText(/dealer stands on soft 17/i)
      ).toBeNull();
    });

    it("only one tooltip is visible at a time", () => {
      const utils = renderPanel();
      openRules(utils);
      fireEvent.press(utils.getByLabelText(/information about dealer soft 17/i));
      fireEvent.press(utils.getByLabelText(/information about deck count/i));
      expect(utils.queryByText(/dealer stands on soft 17/i)).toBeNull();
      expect(utils.getByText(/number of decks shuffled/i)).toBeTruthy();
    });

    it("closing the rules panel resets active tooltip", () => {
      const utils = renderPanel();
      openRules(utils);
      fireEvent.press(utils.getByLabelText(/information about dealer soft 17/i));
      // Close the panel
      fireEvent.press(utils.getByLabelText(/table rules/i));
      // Reopen — tooltip should not be visible
      openRules(utils);
      expect(utils.queryByText(/dealer stands on soft 17/i)).toBeNull();
    });
  });
});

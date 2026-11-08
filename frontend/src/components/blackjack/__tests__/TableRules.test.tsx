/**
 * TableRules (#3580): the "Table Rules" section moved off BettingPanel onto the
 * felt. These are BettingPanel's rules tests, unchanged in what they check.
 */
import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import TableRules from "../TableRules";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { DEFAULT_RULES } from "../../../game/blackjack/engine";

async function renderRules() {
  const onRulesChange = jest.fn();
  const utils = await render(
    <ThemeProvider>
      <TableRules rules={DEFAULT_RULES} onRulesChange={onRulesChange} />
    </ThemeProvider>
  );
  return { ...utils, onRulesChange };
}

describe("TableRules", () => {
  async function openRules(utils: Awaited<ReturnType<typeof renderRules>>) {
    await fireEvent.press(utils.getByLabelText(/table rules/i));
  }

  it("is closed until toggled", async () => {
    const utils = await renderRules();
    expect(utils.queryByLabelText(/information about dealer soft 17/i)).toBeNull();
    await openRules(utils);
    expect(utils.getByLabelText(/information about dealer soft 17/i)).toBeTruthy();
  });

  it("tapping soft17 info button shows tooltip text", async () => {
    const utils = await renderRules();
    await openRules(utils);
    await fireEvent.press(utils.getByLabelText(/information about dealer soft 17/i));
    expect(utils.getByText(/dealer stands on soft 17/i)).toBeTruthy();
  });

  it("tapping soft17 info button again hides tooltip text", async () => {
    const utils = await renderRules();
    await openRules(utils);
    await fireEvent.press(utils.getByLabelText(/information about dealer soft 17/i));
    await fireEvent.press(utils.getByLabelText(/information about dealer soft 17/i));
    expect(utils.queryByText(/dealer stands on soft 17/i)).toBeNull();
  });

  it("only one tooltip is visible at a time", async () => {
    const utils = await renderRules();
    await openRules(utils);
    await fireEvent.press(utils.getByLabelText(/information about dealer soft 17/i));
    await fireEvent.press(utils.getByLabelText(/information about deck count/i));
    expect(utils.queryByText(/dealer stands on soft 17/i)).toBeNull();
    expect(utils.getByText(/number of decks shuffled/i)).toBeTruthy();
  });

  it("closing the rules panel resets active tooltip", async () => {
    const utils = await renderRules();
    await openRules(utils);
    await fireEvent.press(utils.getByLabelText(/information about dealer soft 17/i));
    await openRules(utils); // close
    await openRules(utils); // reopen
    expect(utils.queryByText(/dealer stands on soft 17/i)).toBeNull();
  });

  it("changes a rule", async () => {
    const utils = await renderRules();
    await openRules(utils);
    await fireEvent.press(utils.getByLabelText("Dealer hits on soft 17"));
    expect(utils.onRulesChange).toHaveBeenCalledWith({ ...DEFAULT_RULES, hit_soft_17: true });
  });
});

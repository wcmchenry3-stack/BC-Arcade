/**
 * #3614: Mahjong's bottom action bar — Undo, Hint and Shuffle with the labels and test ids the
 * header pills had, 44 pt targets, and the shuffles left as a badge (and, for screen readers,
 * the button's value).
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import MahjongActionBar from "../MahjongActionBar";
import { dark } from "../../../theme/ThemeContext";

const UNDO = "Undo last matched pair";
const HINT = "Show a hint — highlights one valid pair for 2 seconds";
const SHUFFLE = "Shuffle remaining tiles into a new solvable arrangement";

function mount(over: Partial<React.ComponentProps<typeof MahjongActionBar>> = {}) {
  const props = {
    undoDisabled: false,
    hintDisabled: false,
    shuffleDisabled: false,
    shufflesLeft: 3,
    onUndo: jest.fn(),
    onHint: jest.fn(),
    onShuffle: jest.fn(),
    ...over,
  };
  return { props, view: render(<MahjongActionBar {...props} />) };
}

describe("MahjongActionBar", () => {
  it("renders Undo, Hint and Shuffle in that order, with their labels and test ids", async () => {
    await mount().view;
    const bar = screen.getByTestId("mahjong-action-bar");
    const buttons = within(bar).getAllByRole("button");
    expect(buttons.map((b) => b.props.testID)).toEqual([
      "mahjong-undo-button",
      "mahjong-hint-button",
      "mahjong-shuffle-button",
    ]);
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual([UNDO, HINT, SHUFFLE]);
    expect(within(bar).getByText("UNDO")).toBeTruthy();
    expect(within(bar).getByText("HINT")).toBeTruthy();
    expect(within(bar).getByText("SHUFFLE")).toBeTruthy();
  });

  it("calls each handler on press", async () => {
    const { props, view } = mount();
    await view;
    await fireEvent.press(screen.getByLabelText(UNDO));
    await fireEvent.press(screen.getByLabelText(HINT));
    await fireEvent.press(screen.getByLabelText(SHUFFLE));
    expect(props.onUndo).toHaveBeenCalledTimes(1);
    expect(props.onHint).toHaveBeenCalledTimes(1);
    expect(props.onShuffle).toHaveBeenCalledTimes(1);
  });

  it("shows the shuffles left as a badge and as the button's spoken value", async () => {
    await mount({ shufflesLeft: 2 }).view;
    expect(screen.getByTestId("mahjong-shuffle-button-badge")).toHaveTextContent("2");
    expect(screen.getByLabelText(SHUFFLE).props.accessibilityValue).toEqual({
      text: "Shuffles left: 2",
    });
  });

  it("disables a control without calling it", async () => {
    const { props, view } = mount({ undoDisabled: true, shuffleDisabled: true, shufflesLeft: 0 });
    await view;
    for (const label of [UNDO, SHUFFLE]) {
      expect(screen.getByLabelText(label).props.accessibilityState).toEqual({ disabled: true });
      await fireEvent.press(screen.getByLabelText(label));
    }
    expect(props.onUndo).not.toHaveBeenCalled();
    expect(props.onShuffle).not.toHaveBeenCalled();
    expect(screen.getByLabelText(HINT).props.accessibilityState).toEqual({ disabled: false });
  });

  it("gives every control at least a 44 x 44 pt target", async () => {
    await mount().view;
    for (const label of [UNDO, HINT, SHUFFLE]) {
      const style = StyleSheet.flatten(screen.getByLabelText(label).props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      expect(style.minWidth).toBeGreaterThanOrEqual(44);
    }
  });

  it("colours the Hint label with the AA bonus text token, as 2048's Hint (#3754)", async () => {
    await mount().view;
    const label = within(screen.getByTestId("mahjong-action-bar")).getByText("HINT");
    const { color } = StyleSheet.flatten(label.props.style) as { color: string };
    expect(color).toBe(dark.bonusText);
  });
});

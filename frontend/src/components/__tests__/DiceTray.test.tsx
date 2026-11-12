import React from "react";
import { Text } from "react-native";
import { render, fireEvent, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import DiceRow, { dieSizeFor } from "../DiceRow";
import { ThemeProvider, dark } from "../../theme/ThemeContext";

type Props = React.ComponentProps<typeof DiceRow>;

function tray(overrides: Partial<Props> = {}) {
  const props: Props = {
    dice: [1, 2, 3, 4, 5],
    held: [false, false, false, false, false],
    rollsUsed: 1,
    gameOver: false,
    onRoll: jest.fn(),
    onToggleHold: jest.fn(),
    ...overrides,
  };
  return (
    <ThemeProvider>
      <DiceRow {...props} />
    </ThemeProvider>
  );
}

async function renderTray(overrides: Partial<Props> = {}) {
  return await render(tray(overrides));
}

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never);

describe("the thumb tray (#3748)", () => {
  it("holds the turn hint, the five dice, Roll and the actions slot", async () => {
    const { getByTestId, getAllByTestId } = await renderTray({
      actions: <Text testID="slot">actions</Text>,
    });
    const t = within(getByTestId("yacht-tray"));
    expect(t.getByTestId("yacht-hint-line")).toBeTruthy();
    expect(t.getAllByTestId(/^yacht-die-[0-4]$/)).toHaveLength(5);
    expect(t.getByTestId("yacht-roll-button")).toBeTruthy();
    expect(t.getByTestId("slot")).toBeTruthy();
    expect(getAllByTestId(/^yacht-die-[0-4]$/)).toHaveLength(5);
  });

  describe("the turn hint", () => {
    it("solo: says how to start, then how to hold", async () => {
      const before = await renderTray({ rollsUsed: 0 });
      expect(before.getByText("Press Roll to start your turn")).toBeTruthy();
      await before.unmount();
      const after = await renderTray({ rollsUsed: 1 });
      expect(after.getByText("Tap dice to hold")).toBeTruthy();
    });

    it("vs: puts 'Your Turn' in front, each as its own text", async () => {
      const before = await renderTray({ rollsUsed: 0, turnLabel: "Your Turn" });
      expect(before.getByText("Your Turn")).toBeTruthy();
      expect(before.getByText("Press Roll to start")).toBeTruthy();
      await before.unmount();
      const after = await renderTray({ rollsUsed: 2, turnLabel: "Your Turn" });
      expect(after.getByText("Your Turn")).toBeTruthy();
      expect(after.getByText("Tap dice to hold")).toBeTruthy();
    });

    it("the Hint's message replaces it while it is up, and is a different one for 'no hint'", async () => {
      const hint = await renderTray({
        hintMessage: { text: "Hint: keep the highlighted dice", none: false },
      });
      expect(hint.getByTestId("yacht-hint-message")).toHaveTextContent(
        "Hint: keep the highlighted dice"
      );
      expect(hint.queryByText("Tap dice to hold")).toBeNull();
      await hint.unmount();
      const none = await renderTray({ hintMessage: { text: "No hint available", none: true } });
      expect(none.getByTestId("yacht-no-hint-toast")).toHaveTextContent("No hint available");
    });
  });

  describe("dice are sized from the width the row has (audit bug 11)", () => {
    it("is 60 where there is room, smaller where there is not, never below 36", () => {
      expect(dieSizeFor(334)).toBe(60); // a 390 pt phone: 390 - 2 x 16 gutter - 2 x 12 tray
      expect(dieSizeFor(264)).toBe(46); // a 320 pt phone
      expect(dieSizeFor(120)).toBe(36);
    });

    it("five dice and their gaps always fit the row", () => {
      for (const w of [230, 264, 300, 334, 380, 500]) {
        const size = dieSizeFor(w);
        if (size > 36) expect(5 * size + 4 * 8).toBeLessThanOrEqual(w);
      }
    });

    it("sizes the dice from the measured width of the row", async () => {
      const { getAllByTestId } = await renderTray();
      const row = getAllByTestId("yacht-die-0")[0]!.parent!.parent!;
      await fireEvent(row, "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 70 } },
      });
      const die = getAllByTestId("yacht-die-0")[0]!;
      expect(flat(die).width).toBe(dieSizeFor(300));
      expect(flat(die).height).toBe(dieSizeFor(300));
      await fireEvent(row, "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 264, height: 70 } },
      });
      expect(flat(getAllByTestId("yacht-die-4")[0]!).width).toBe(46);
    });
  });

  describe("dice opacity (audit bug 2)", () => {
    const opacityOf = (node: { props: { style?: unknown } }) => flat(node).opacity;

    it("is full before the first roll", async () => {
      const { getByTestId } = await renderTray({ rollsUsed: 0, dice: [0, 0, 0, 0, 0] });
      expect(opacityOf(getByTestId("yacht-die-0"))).toBeUndefined();
    });

    it("is full on the computer's turn", async () => {
      const { getByTestId } = await renderTray({ rollsUsed: 2, locked: true });
      for (let i = 0; i < 5; i++) expect(opacityOf(getByTestId(`yacht-die-${i}`))).toBeUndefined();
    });

    it("is faded only when the game is over", async () => {
      const { getByTestId } = await renderTray({ gameOver: true });
      expect(opacityOf(getByTestId("yacht-die-0"))).toBe(0.4);
    });
  });

  describe("held dice (audit bug 7)", () => {
    it("a held die has a teal ring; the others have none", async () => {
      const { getByTestId, queryByTestId } = await renderTray({
        held: [true, false, false, true, false],
      });
      expect(getByTestId("yacht-die-0-held-ring")).toBeTruthy();
      expect(getByTestId("yacht-die-3-held-ring")).toBeTruthy();
      expect(queryByTestId("yacht-die-1-held-ring")).toBeNull();
      expect(flat(getByTestId("yacht-die-0-held-ring")).borderColor).toBe(dark.accentText);
    });

    it("has no HELD badge or text of any kind", async () => {
      const { queryByText } = await renderTray({ held: [true, true, true, true, true] });
      expect(queryByText(/held/i)).toBeNull();
    });

    it("says it is held to a screen reader, in the language's own words", async () => {
      const { getByTestId } = await renderTray({ held: [true, false, false, false, false] });
      expect(getByTestId("yacht-die-0").props.accessibilityLabel).toBe("Die 1: showing 1, held");
      expect(getByTestId("yacht-die-1").props.accessibilityLabel).toBe("Die 2: showing 2");
      expect(getByTestId("yacht-die-0").props.accessibilityState.checked).toBe(true);
    });

    it("the ring stays inside the dice row: just outside the die, no wider than the gap", async () => {
      const { getByTestId } = await renderTray({ held: [true, false, false, false, false] });
      const ring = flat(getByTestId("yacht-die-0-held-ring"));
      expect(ring.top).toBe(-3);
      expect(ring.left).toBe(-3);
      expect(Math.abs(ring.left as number) * 2).toBeLessThan(8); // two rings never meet in the 8 pt gap
    });

    it("the Hint's dice get a green ring, apart from held's teal", async () => {
      const { getByTestId, queryByTestId } = await renderTray({
        hintHold: [true, true, false, false, false],
        held: [false, false, false, false, false],
      });
      expect(flat(getByTestId("yacht-die-0-hint-ring")).borderColor).toBe(dark.outcomeWin);
      expect(queryByTestId("yacht-die-2-hint-ring")).toBeNull();
    });

    it("the Hint's ring is not drawn on the computer's turn", async () => {
      const { queryByTestId } = await renderTray({
        hintHold: [true, true, true, true, true],
        locked: true,
      });
      expect(queryByTestId("yacht-die-0-hint-ring")).toBeNull();
    });
  });

  describe("the computer's turn (audit bugs 3 and 10)", () => {
    it("has its own hint text and a roll counter, not 'Tap dice to hold'", async () => {
      const { getByText, queryByText } = await renderTray({
        locked: true,
        rollsUsed: 2,
        computerRolls: 2,
        turnLabel: "Your Turn",
      });
      expect(getByText("Computer is rolling…")).toBeTruthy();
      expect(getByText("Roll 2 / 3")).toBeTruthy();
      expect(queryByText("Tap dice to hold")).toBeNull();
      expect(queryByText("Your Turn")).toBeNull();
    });

    it("shows no counter before its first roll", async () => {
      const { queryByText } = await renderTray({ locked: true, rollsUsed: 0, computerRolls: 0 });
      expect(queryByText(/Roll \d \/ 3/)).toBeNull();
    });

    it("Roll reads 'Computer's Turn', never its count, and is disabled", async () => {
      const { getByTestId, getByText, queryByText } = await renderTray({
        locked: true,
        rollsUsed: 1,
        computerRolls: 1,
      });
      expect(getByText("Computer's Turn")).toBeTruthy();
      expect(queryByText(/left/i)).toBeNull();
      const button = getByTestId("yacht-roll-button");
      expect(button.props.accessibilityState.disabled).toBe(true);
      expect(button.props.accessibilityLabel).toBe("Computer's Turn");
    });

    it("no dice can be held while it plays", async () => {
      const onToggleHold = jest.fn();
      const { getByTestId } = await renderTray({ locked: true, rollsUsed: 1, onToggleHold });
      await fireEvent.press(getByTestId("yacht-die-0"));
      expect(onToggleHold).not.toHaveBeenCalled();
    });

    it("has no 'Rolling…' state to show: pressing Roll leaves the label alone", async () => {
      const onRoll = jest.fn();
      const { getByTestId, queryByText } = await renderTray({ rollsUsed: 1, onRoll });
      await fireEvent.press(getByTestId("yacht-roll-button"));
      expect(onRoll).toHaveBeenCalledTimes(1);
      expect(queryByText(/rolling/i)).toBeNull();
      expect(within(getByTestId("yacht-roll-button")).getByText("Roll (2 left)")).toBeTruthy();
    });
  });
});

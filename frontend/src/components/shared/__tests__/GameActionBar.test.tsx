import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import GameActionBar, { type GameBarAction } from "../GameActionBar";

const base: GameBarAction = {
  key: "hint",
  icon: "lightbulb",
  label: "Hint",
  accessibilityLabel: "Hint",
  color: "#123456",
  onPress: jest.fn(),
  testID: "hint-button",
};

async function renderBar(action: Partial<GameBarAction>) {
  return await render(
    <ThemeProvider>
      <GameActionBar testID="bar" height={54} actions={[{ ...base, ...action }]} />
    </ThemeProvider>
  );
}

describe("GameActionBar busy state (#3658)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows a spinner, reports busy and ignores presses while busy", async () => {
    const { getByRole, getByTestId } = await renderBar({ busy: true });
    const button = getByRole("button", { name: "Hint" });
    expect(button.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(getByTestId("hint-button-busy")).toBeTruthy();
    await fireEvent.press(button);
    expect(base.onPress).not.toHaveBeenCalled();
  });

  it("keeps the plain disabled state, with no spinner, when busy is omitted", async () => {
    const { getByRole, queryByTestId } = await renderBar({});
    const button = getByRole("button", { name: "Hint" });
    expect(button.props.accessibilityState).toEqual({ disabled: false });
    expect(queryByTestId("hint-button-busy")).toBeNull();
    await fireEvent.press(button);
    expect(base.onPress).toHaveBeenCalledTimes(1);
  });

  it("a disabled action without busy reports only disabled", async () => {
    const { getByRole } = await renderBar({ disabled: true });
    expect(getByRole("button", { name: "Hint" }).props.accessibilityState).toEqual({
      disabled: true,
    });
  });
});

describe("GameActionBar toggle (#3773)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("a plain action reports no selected state and draws no chip", async () => {
    const { getByRole } = await renderBar({});
    const button = getByRole("button", { name: "Hint" });
    expect(button.props.accessibilityState.selected).toBeUndefined();
    expect(button).not.toHaveStyle({ borderWidth: 1.5 });
  });

  it("an off toggle reports selected false and keeps a transparent ring", async () => {
    const { getByRole } = await renderBar({ selected: false });
    const button = getByRole("button", { name: "Hint" });
    expect(button.props.accessibilityState).toEqual({ disabled: false, selected: false });
    expect(button).toHaveStyle({ borderWidth: 1.5, borderColor: "transparent" });
  });

  it("an on toggle reports selected true and draws a tinted chip with a ring in its colour", async () => {
    const { getByRole } = await renderBar({ selected: true });
    const button = getByRole("button", { name: "Hint" });
    expect(button.props.accessibilityState).toEqual({ disabled: false, selected: true });
    expect(button).toHaveStyle({
      borderColor: base.color,
      backgroundColor: `${base.color}26`,
      borderWidth: 1.5,
    });
  });

  it("a toggle still presses", async () => {
    const { getByRole } = await renderBar({ selected: true });
    await fireEvent.press(getByRole("button", { name: "Hint" }));
    expect(base.onPress).toHaveBeenCalledTimes(1);
  });
});

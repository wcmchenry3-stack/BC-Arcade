import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { PillButton, PILL_DISABLED_OPACITY } from "../PillButton";

async function renderPill(props: Partial<React.ComponentProps<typeof PillButton>> = {}) {
  const onPress = jest.fn();
  await render(
    <ThemeProvider>
      <PillButton label="Undo" onPress={onPress} testID="pill" {...props} />
    </ThemeProvider>
  );
  return { onPress };
}

describe("PillButton", () => {
  it("renders its label and fires onPress", async () => {
    const { onPress } = await renderPill();
    await fireEvent.press(screen.getByRole("button", { name: "Undo" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("uses the accessibility label override when given", async () => {
    await renderPill({ accessibilityLabel: "Undo last move" });
    expect(screen.getByRole("button", { name: "Undo last move" })).toBeTruthy();
  });

  it("does not fire and dims when disabled", async () => {
    const { onPress } = await renderPill({ disabled: true });
    const btn = screen.getByTestId("pill");
    await fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
    expect(btn.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(StyleSheet.flatten(btn.props.style).opacity).toBe(PILL_DISABLED_OPACITY);
  });

  it("shows a spinner, reports busy, and ignores presses while busy", async () => {
    const { onPress } = await renderPill({ busy: true });
    const btn = screen.getByTestId("pill");
    await fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
    expect(btn.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(screen.queryByText("Undo")).toBeNull();
  });

  it("tints border and label with the given color", async () => {
    await renderPill({ color: "#123456" });
    expect(StyleSheet.flatten(screen.getByTestId("pill").props.style).borderColor).toBe("#123456");
    expect(StyleSheet.flatten(screen.getByText("Undo").props.style).color).toBe("#123456");
  });

  it("extends the touch target to 44pt via hitSlop", async () => {
    await renderPill();
    const { top, bottom } = screen.getByTestId("pill").props.hitSlop;
    expect(32 + top + bottom).toBeGreaterThanOrEqual(44);
  });
});

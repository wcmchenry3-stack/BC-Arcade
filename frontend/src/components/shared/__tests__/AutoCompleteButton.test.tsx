import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { AutoCompleteButton } from "../AutoCompleteButton";

describe("AutoCompleteButton (#3566)", () => {
  it("is a button labelled Auto-Complete that fires onPress", async () => {
    const onPress = jest.fn();
    await render(
      <ThemeProvider>
        <AutoCompleteButton onPress={onPress} />
      </ThemeProvider>
    );
    const btn = screen.getByRole("button", { name: "Auto-Complete" });
    expect(btn.props.accessibilityLabel).toBe("Auto-Complete");
    await fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("is the accent pill: 24 x 8 padding, fully rounded, from the theme", async () => {
    await render(
      <ThemeProvider>
        <AutoCompleteButton onPress={() => undefined} />
      </ThemeProvider>
    );
    const style = StyleSheet.flatten(screen.getByLabelText("Auto-Complete").props.style);
    expect(style).toEqual(
      expect.objectContaining({
        paddingHorizontal: 24,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: expect.any(String),
      })
    );
  });
});

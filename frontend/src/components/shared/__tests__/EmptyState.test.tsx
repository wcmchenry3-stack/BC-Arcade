import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { ThemeProvider, dark, light } from "../../../theme/ThemeContext";
import { EmptyState } from "../EmptyState";

async function renderState(props: React.ComponentProps<typeof EmptyState>) {
  return await render(
    <ThemeProvider>
      <EmptyState {...props} />
    </ThemeProvider>
  );
}

describe("EmptyState", () => {
  it("shows a labelled spinner while loading", async () => {
    await renderState({ kind: "loading" });
    expect(screen.getByLabelText("Loading")).toBeTruthy();
  });

  it("shows the empty message without a retry button", async () => {
    await renderState({ kind: "empty", message: "No games yet" });
    expect(screen.getByText("No games yet")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the error message and calls retry", async () => {
    const onPress = jest.fn();
    await renderState({
      kind: "error",
      message: "Could not load",
      retry: { label: "Retry", onPress },
    });
    expect(screen.getByText("Could not load")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("colors an error message with the theme error color", async () => {
    await renderState({ kind: "error", message: "Broken" });
    const color = StyleSheet.flatten(screen.getByText("Broken").props.style).color;
    expect([dark.error, light.error]).toContain(color);
  });

  it("colors an empty message with the muted text color", async () => {
    await renderState({ kind: "empty", message: "Nothing" });
    const color = StyleSheet.flatten(screen.getByText("Nothing").props.style).color;
    expect([dark.textMuted, light.textMuted]).toContain(color);
  });

  it("uses padded inline layout for list empty slots", async () => {
    await renderState({ kind: "empty", message: "None", layout: "inline", testID: "es" });
    expect(StyleSheet.flatten(screen.getByTestId("es").props.style).paddingVertical).toBe(48);
  });
});

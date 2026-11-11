import React from "react";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import HintNotice from "../HintNotice";

function renderNotice(props: Partial<React.ComponentProps<typeof HintNotice>> = {}) {
  return render(
    <ThemeProvider>
      <HintNotice kind="dead" onDismiss={jest.fn()} {...props} />
    </ThemeProvider>
  );
}

describe("HintNotice (#2768)", () => {
  it("is an alert with the message, announced once on iOS", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const r = await renderNotice();
    expect(r.getByTestId("sort-hint-notice").props.accessibilityRole).toBe("alert");
    expect(r.getByText("No way to win from here")).toBeTruthy();
    expect(announce).toHaveBeenCalledWith("No way to win from here");
    expect(announce).toHaveBeenCalledTimes(1);
    announce.mockRestore();
  });

  it("shows only the actions it is given", async () => {
    const onRestart = jest.fn();
    const r = await renderNotice({ onRestart });
    expect(r.queryByRole("button", { name: "Undo to a winnable board" })).toBeNull();
    fireEvent.press(r.getByRole("button", { name: "Restart level" }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("shows no actions for an unknown verdict", async () => {
    const r = await renderNotice({
      kind: "unknown",
      onRestart: jest.fn(),
      onUndoToWinnable: jest.fn(),
    });
    expect(r.getByText("Couldn't find a hint")).toBeTruthy();
    expect(r.queryByRole("button", { name: "Restart level" })).toBeNull();
    expect(r.queryByRole("button", { name: "Undo to a winnable board" })).toBeNull();
  });

  it("has 44pt touch targets and is an overlay", async () => {
    const r = await renderNotice({ onRestart: jest.fn(), onUndoToWinnable: jest.fn() });
    const style = (name: string) =>
      StyleSheet.flatten(r.getByRole("button", { name }).props.style) as Record<string, number>;
    expect(style("Restart level").minHeight).toBeGreaterThanOrEqual(44);
    expect(style("Undo to a winnable board").minHeight).toBeGreaterThanOrEqual(44);
    expect(style("Dismiss").width).toBeGreaterThanOrEqual(44);
    expect(style("Dismiss").height).toBeGreaterThanOrEqual(44);
    expect(StyleSheet.flatten(r.getByTestId("sort-hint-notice").props.style).position).toBe(
      "absolute"
    );
  });

  it("disables the actions while busy", async () => {
    const onRestart = jest.fn();
    const r = await renderNotice({ onRestart, busy: true });
    fireEvent.press(r.getByRole("button", { name: "Restart level" }));
    expect(onRestart).not.toHaveBeenCalled();
  });
});

import React from "react";
import { Text } from "react-native";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { ModalCard, ModalPrimaryButton, ModalSecondaryButton } from "../ModalCard";

async function renderInTheme(ui: React.ReactElement) {
  return await render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("ModalCard", () => {
  it("renders title as a header, body, and children when visible", async () => {
    await renderInTheme(
      <ModalCard visible title="Pick one" body="Choose a mode" testID="card">
        <Text>child</Text>
      </ModalCard>
    );
    expect(screen.getByRole("header", { name: "Pick one" })).toBeTruthy();
    expect(screen.getByText("Choose a mode")).toBeTruthy();
    expect(screen.getByText("child")).toBeTruthy();
  });

  it("renders nothing when not visible", async () => {
    await renderInTheme(
      <ModalCard visible={false} title="Hidden">
        <Text>child</Text>
      </ModalCard>
    );
    expect(screen.queryByText("Hidden")).toBeNull();
  });

  it("uses the md panel size when asked", async () => {
    await renderInTheme(<ModalCard visible size="md" testID="card" />);
    expect(StyleSheet.flatten(screen.getByTestId("card").props.style).maxWidth).toBe(420);
  });

  it("adds the accent top rule only when accentTop is set", async () => {
    await renderInTheme(<ModalCard visible accentTop testID="card" />);
    expect(StyleSheet.flatten(screen.getByTestId("card").props.style).borderTopWidth).toBe(3);
  });
});

describe("ModalCard Lobby chip (#3969)", () => {
  it("renders only when onHome is given", async () => {
    await renderInTheme(<ModalCard visible title="Pick" />);
    expect(screen.queryByTestId("modal-home-chip")).toBeNull();
  });

  it("is a labelled 44pt button outside the card that calls onHome", async () => {
    const onHome = jest.fn();
    await renderInTheme(<ModalCard visible title="Pick" testID="card" onHome={onHome} />);
    const chip = screen.getByRole("button", { name: "Go back to lobby" });
    expect(screen.getByText("Lobby")).toBeTruthy();
    const style = StyleSheet.flatten(chip.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.position).toBe("absolute");
    expect(within(screen.getByTestId("card")).queryByTestId("modal-home-chip")).toBeNull();
    await fireEvent.press(chip);
    expect(onHome).toHaveBeenCalledTimes(1);
  });
});

describe("Modal buttons", () => {
  it("fire their handlers and expose button roles", async () => {
    const onPrimary = jest.fn();
    const onSecondary = jest.fn();
    await renderInTheme(
      <>
        <ModalPrimaryButton label="Start" onPress={onPrimary} />
        <ModalSecondaryButton label="Later" onPress={onSecondary} />
      </>
    );
    await fireEvent.press(screen.getByRole("button", { name: "Start" }));
    await fireEvent.press(screen.getByRole("button", { name: "Later" }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });
});

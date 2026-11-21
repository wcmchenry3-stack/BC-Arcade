import React from "react";
import { Text } from "react-native";
import i18n from "i18next";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
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

describe("ModalCard Lobby chip RTL and status bar (#3969)", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("does not mirror the arrow in LTR", async () => {
    await renderInTheme(<ModalCard visible onHome={() => {}} />);
    const style = StyleSheet.flatten(screen.getByTestId("modal-home-chip-icon").props.style);
    expect(style?.transform).toBeUndefined();
  });

  it("mirrors the arrow in an RTL locale", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    await renderInTheme(<ModalCard visible onHome={() => {}} />);
    const style = StyleSheet.flatten(screen.getByTestId("modal-home-chip-icon").props.style);
    expect(style.transform).toEqual([{ scaleX: -1 }]);
  });

  it("pins the chip to the left edge in LTR", async () => {
    await renderInTheme(<ModalCard visible onHome={() => {}} />);
    const style = StyleSheet.flatten(screen.getByTestId("modal-home-chip").props.style);
    expect(style.left).toBe(16);
    expect(style.right).toBeUndefined();
  });

  it("pins the chip to the right edge in an RTL locale", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    await renderInTheme(<ModalCard visible onHome={() => {}} />);
    const style = StyleSheet.flatten(screen.getByTestId("modal-home-chip").props.style);
    expect(style.right).toBe(16);
    expect(style.left).toBeUndefined();
  });

  it("is status-bar translucent only when onHome is set", async () => {
    // Walk up from the card to its Modal host node, which carries the Modal's props.
    const modalProps = (testID: string) => {
      let node = screen.getByTestId(testID).parent;
      while (node && !("accessibilityViewIsModal" in node.props)) node = node.parent;
      return node!.props;
    };
    const { rerender } = await renderInTheme(<ModalCard visible testID="card" onHome={() => {}} />);
    expect(modalProps("card").statusBarTranslucent).toBe(true);
    await rerender(
      <ThemeProvider>
        <ModalCard visible testID="card" />
      </ThemeProvider>
    );
    expect(modalProps("card").statusBarTranslucent).toBeUndefined();
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

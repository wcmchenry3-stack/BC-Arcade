import React from "react";
import { StyleSheet, Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { GameShell } from "../GameShell";

// GameShell's Stats item (#2635) navigates through useNavigation.
const mockShellNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockShellNavigate }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "common:nav.back") return "← Back";
      if (key === "common:nav.backLabel") return "Go back to home screen";
      if (key === "fab_label") return "Send feedback";
      return key;
    },
  }),
}));

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../../../theme/ThemeContext", () => ({
  useTheme: () => ({
    colors: {
      background: "#0e0e13",
      accent: "#8ff5ff",
      text: "#e8e8f0",
      textMuted: "#9090a8",
      error: "#ff6b6b",
      textOnAccent: "#0e0e13",
    },
    theme: "dark",
  }),
}));

jest.mock("../../FeedbackWidget/FeedbackWidget", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: RNText } = require("react-native");
  const FeedbackWidgetMock = ({ visible }: { visible: boolean; onClose: () => void }) =>
    visible ? <RNText>FeedbackWidget</RNText> : null;
  FeedbackWidgetMock.displayName = "FeedbackWidget";
  return FeedbackWidgetMock;
});

const noop = () => {};

describe("GameShell", () => {
  it("renders the AppHeader with the given title", async () => {
    await render(
      <GameShell gameType={null} title="Yacht" onBack={noop}>
        <Text>game content</Text>
      </GameShell>
    );
    expect(screen.getByText("Yacht")).toBeTruthy();
  });

  it("renders children when not loading", async () => {
    await render(
      <GameShell gameType={null} title="Yacht" onBack={noop}>
        <Text>game content</Text>
      </GameShell>
    );
    expect(screen.getByText("game content")).toBeTruthy();
  });

  it("keeps the title and back button but hides children and the menu while loading", async () => {
    await render(
      <GameShell gameType={null} title="Yacht" onBack={noop} onNewGame={noop} loading>
        <Text>game content</Text>
      </GameShell>
    );
    expect(screen.queryByText("game content")).toBeNull();
    expect(screen.getByText("Yacht")).toBeTruthy();
    expect(screen.getByTestId("nav-back")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "common:overflow.menu.label" })).toBeNull();
    expect(screen.getByLabelText("a11y.loading")).toBeTruthy();
  });

  it("treats a caller paddingBottom as a minimum under the tab bar height", async () => {
    await render(
      <GameShell gameType={null} title="Yacht" onBack={noop} style={{ paddingBottom: 24 }}>
        <Text>game content</Text>
      </GameShell>
    );
    // Outside a tab navigator the tab bar height is 0, so the caller's 24 wins.
    const root = screen.toJSON() as { props: { style: unknown } };
    expect(StyleSheet.flatten(root.props.style as never).paddingBottom).toBe(24);
  });

  it("renders an error banner when error is a non-empty string", async () => {
    await render(
      <GameShell gameType={null} title="Yacht" onBack={noop} error="Something went wrong">
        <Text>game content</Text>
      </GameShell>
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    // Children still render alongside the error banner
    expect(screen.getByText("game content")).toBeTruthy();
  });

  it("does not render an error banner when error is null", async () => {
    await render(
      <GameShell gameType={null} title="Yacht" onBack={noop} error={null}>
        <Text>game content</Text>
      </GameShell>
    );
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });

  it("does not render an error banner when error is an empty string", async () => {
    await render(
      <GameShell gameType={null} title="Yacht" onBack={noop} error="">
        <Text>game content</Text>
      </GameShell>
    );
    // empty string is falsy — no banner
    expect(screen.getByText("game content")).toBeTruthy();
  });

  it("renders rightSlot content in the header area", async () => {
    await render(
      <GameShell gameType={null} title="Yacht" onBack={noop} rightSlot={<Text>Round 3</Text>}>
        <Text>game content</Text>
      </GameShell>
    );
    expect(screen.getByText("Round 3")).toBeTruthy();
  });

  it("gives a game's screen a Stats item that opens that game's stats (#2635)", async () => {
    mockShellNavigate.mockClear();
    await render(
      <GameShell gameType="freecell" title="FreeCell" onBack={noop}>
        <Text>game content</Text>
      </GameShell>
    );
    await fireEvent.press(screen.getByTestId("nav-menu"));
    await fireEvent.press(screen.getByTestId("nav-menu-stats"));
    expect(mockShellNavigate).toHaveBeenCalledWith("GameStats", { gameType: "freecell" });
  });

  it("gives a screen with no game (gameType null) no Stats item (#2635)", async () => {
    await render(
      <GameShell gameType={null} title="Scorecard" onBack={noop} onNewGame={noop}>
        <Text>game content</Text>
      </GameShell>
    );
    await fireEvent.press(screen.getByTestId("nav-menu"));
    expect(screen.queryByTestId("nav-menu-stats")).toBeNull();
    expect(screen.queryByTestId("nav-menu-scorecard")).toBeNull();
  });

  // #2636: the Scorecard item comes from gameType, like Stats.
  it.each(["hearts", "yacht", "blackjack"] as const)(
    "gives %s a Scorecard item that opens its live view",
    async (gameType) => {
      mockShellNavigate.mockClear();
      await render(
        <GameShell gameType={gameType} title="Game" onBack={noop}>
          <Text>game content</Text>
        </GameShell>
      );
      await fireEvent.press(screen.getByTestId("nav-menu"));
      await fireEvent.press(screen.getByTestId("nav-menu-scorecard"));
      expect(mockShellNavigate).toHaveBeenCalledWith("Scorecard", { gameKey: gameType });
    }
  );

  it.each(["cascade", "solitaire", "sudoku", "twenty48", "mahjong", "freecell"] as const)(
    "gives %s (no live view) no Scorecard item",
    async (gameType) => {
      await render(
        <GameShell gameType={gameType} title="Game" onBack={noop}>
          <Text>game content</Text>
        </GameShell>
      );
      await fireEvent.press(screen.getByTestId("nav-menu"));
      expect(screen.getByTestId("nav-menu-stats")).toBeTruthy();
      expect(screen.queryByTestId("nav-menu-scorecard")).toBeNull();
    }
  );
});

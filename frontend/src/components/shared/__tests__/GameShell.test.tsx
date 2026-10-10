import React from "react";
import { StyleSheet, Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { GameShell } from "../GameShell";

// GameShell's Stats item (#2635) navigates through useNavigation.
const mockShellNavigate = jest.fn();
// The default back handler (#2976) returns to the lobby through it too.
const mockShellPopToTop = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockShellNavigate, popToTop: mockShellPopToTop }),
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

// Mutable so the gutter cases (#2976) can give the device side insets.
const mockInsets = { top: 44, bottom: 0, left: 0, right: 0 };
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
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

  describe("default back handler (#2976)", () => {
    beforeEach(() => mockShellPopToTop.mockClear());

    it("returns to the lobby when no onBack is given", async () => {
      await render(
        <GameShell gameType="freecell" title="FreeCell">
          <Text>game content</Text>
        </GameShell>
      );
      await fireEvent.press(screen.getByTestId("nav-back"));
      expect(mockShellPopToTop).toHaveBeenCalledTimes(1);
    });

    it("keeps the default while loading", async () => {
      await render(<GameShell gameType="freecell" title="FreeCell" loading />);
      await fireEvent.press(screen.getByTestId("nav-back"));
      expect(mockShellPopToTop).toHaveBeenCalledTimes(1);
    });

    it("uses the screen's own onBack instead", async () => {
      const onBack = jest.fn();
      await render(
        <GameShell gameType="hearts" title="Hearts" onBack={onBack}>
          <Text>game content</Text>
        </GameShell>
      );
      await fireEvent.press(screen.getByTestId("nav-back"));
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(mockShellPopToTop).not.toHaveBeenCalled();
    });

    it("shows no back button for onBack={null}", async () => {
      await render(<GameShell gameType="sort" title="Sort" onBack={null} loading />);
      expect(screen.queryByTestId("nav-back")).toBeNull();
    });
  });

  describe("side gutter (#2976)", () => {
    afterEach(() => {
      mockInsets.left = 0;
      mockInsets.right = 0;
    });

    async function rootStyle(props: Partial<React.ComponentProps<typeof GameShell>> = {}) {
      await render(
        <GameShell gameType={null} title="Yacht" onBack={noop} {...props}>
          <Text>game content</Text>
        </GameShell>
      );
      const root = screen.toJSON() as { props: { style: unknown } };
      return StyleSheet.flatten(root.props.style as never) as {
        paddingLeft?: number;
        paddingRight?: number;
        paddingBottom?: number;
      };
    }

    it("pads both sides by 12 by default", async () => {
      const style = await rootStyle();
      expect(style.paddingLeft).toBe(12);
      expect(style.paddingRight).toBe(12);
    });

    it("pads by the inset where it is wider than the gutter", async () => {
      mockInsets.left = 47;
      mockInsets.right = 5;
      const style = await rootStyle();
      expect(style.paddingLeft).toBe(47);
      expect(style.paddingRight).toBe(12);
    });

    it("takes another gutter for outliers", async () => {
      mockInsets.right = 30;
      const style = await rootStyle({ gutter: 16 });
      expect(style.paddingLeft).toBe(16);
      expect(style.paddingRight).toBe(30);
    });

    it("pads by the insets alone with gutter 0", async () => {
      mockInsets.left = 20;
      const style = await rootStyle({ gutter: 0 });
      expect(style.paddingLeft).toBe(20);
      expect(style.paddingRight).toBe(0);
    });

    it("applies no side padding with gutter null", async () => {
      mockInsets.left = 20;
      const style = await rootStyle({ gutter: null });
      expect(style.paddingLeft).toBeUndefined();
      expect(style.paddingRight).toBeUndefined();
    });

    it("lets a caller's paddingLeft / paddingRight win, and keeps paddingBottom a minimum", async () => {
      const style = await rootStyle({
        style: { paddingLeft: 3, paddingRight: 4, paddingBottom: 24 },
      });
      expect(style.paddingLeft).toBe(3);
      expect(style.paddingRight).toBe(4);
      expect(style.paddingBottom).toBe(24);
    });
  });
});

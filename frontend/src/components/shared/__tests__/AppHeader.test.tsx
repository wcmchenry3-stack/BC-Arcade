import React from "react";
import { Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AppHeader, APP_HEADER_HEIGHT } from "../AppHeader";

jest.mock("@expo/vector-icons/MaterialIcons", () => "MockMaterialIcons");

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common:nav.back": "← Back",
        "common:nav.backLabel": "Go back to home screen",
        fab_label: "Send feedback",
        "common:overflow.menu.label": "More options",
        "common:overflow.menu.scoreboard": "Scoreboard",
        "common:overflow.menu.newGame": "New Game",
        "common:overflow.abandon.title": "Abandon current game?",
        "common:overflow.abandon.body":
          "Starting a new game will discard your progress in this round. Your lifetime stats won't be affected.",
        "common:overflow.abandon.keepPlaying": "Keep Playing",
        "common:overflow.abandon.startNew": "Start New",
      };
      return map[key] ?? key;
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
      secondary: "#d674ff",
      text: "#e8e8f0",
      textMuted: "#9090a8",
      textOnAccent: "#0e0e13",
      surfaceHigh: "#1a1a22",
      surfaceAlt: "#1c1c24",
      border: "#2e2e38",
      chromeBg: "rgba(14,14,19,0.7)",
      chromeShadowColor: "#8ff5ff",
      chromeShadowOpacity: 0.08,
    },
    theme: "dark",
  }),
}));

jest.mock("../../FeedbackWidget/FeedbackWidget", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: RNText } = require("react-native");
  const FeedbackWidgetMock = ({ visible }: { visible: boolean; onClose: () => void }) =>
    visible ? <RNText>FeedbackWidgetMock</RNText> : null;
  FeedbackWidgetMock.displayName = "FeedbackWidgetMock";
  return FeedbackWidgetMock;
});

jest.mock("../../../../assets/logo.png", () => 1);

const mockAddBreadcrumb = jest.fn();
const mockCaptureMessage = jest.fn();
jest.mock("@sentry/react-native", () => ({
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
}));

beforeEach(() => {
  mockAddBreadcrumb.mockClear();
  mockCaptureMessage.mockClear();
});

describe("AppHeader", () => {
  it("renders the page title", async () => {
    await render(<AppHeader title="Settings" />);
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("renders the BC Arcade logo image", async () => {
    await render(<AppHeader title="Profile" />);
    expect(screen.getByLabelText("BC Arcade")).toBeTruthy();
  });

  it("projects the rightSlot when provided", async () => {
    await render(<AppHeader title="Game" rightSlot={<Text>Round 3 / 13</Text>} />);
    expect(screen.getByText("Round 3 / 13")).toBeTruthy();
  });

  it("renders nothing in the right slot when omitted", async () => {
    await render(<AppHeader title="Ranks" />);
    expect(screen.queryByText("Round")).toBeNull();
  });

  it("has an accessible header role on the wrapper", async () => {
    const { getByRole } = await render(<AppHeader title="Lobby" />);
    expect(getByRole("header", { name: "Lobby" })).toBeTruthy();
  });

  it("renders a help button that opens the FeedbackWidget when pressed", async () => {
    await render(<AppHeader title="2048" />);
    const helpBtn = screen.getByRole("button", { name: "Send feedback" });
    expect(helpBtn).toBeTruthy();
    expect(screen.queryByText("FeedbackWidgetMock")).toBeNull();
    await fireEvent.press(helpBtn);
    expect(screen.getByText("FeedbackWidgetMock")).toBeTruthy();
  });

  it("renders a back button and hides the logo when onBack is provided", async () => {
    const onBack = jest.fn();
    await render(<AppHeader title="2048" onBack={onBack} />);
    const button = screen.getByRole("button", { name: "Go back to home screen" });
    expect(button).toBeTruthy();
    expect(screen.queryByLabelText("BC Arcade")).toBeNull();
    await fireEvent.press(button);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("exports APP_HEADER_HEIGHT as a positive number", () => {
    expect(typeof APP_HEADER_HEIGHT).toBe("number");
    expect(APP_HEADER_HEIGHT).toBeGreaterThan(0);
  });

  // #498 — telemetry: surface regressions where a screen silently drops
  // onBack or the tap never reaches the handler.
  describe("telemetry", () => {
    it("records a mount breadcrumb with hasBack flag", async () => {
      await render(<AppHeader title="Yacht" onBack={() => {}} requireBack />);
      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "ui.header",
          message: "AppHeader mount",
          data: { title: "Yacht", hasBack: true, requireBack: true },
        })
      );
    });

    it("captures a Sentry warning when requireBack is set but onBack is missing", async () => {
      await render(<AppHeader title="Yacht" requireBack />);
      expect(mockCaptureMessage).toHaveBeenCalledWith(expect.stringContaining("Yacht"), "warning");
    });

    it("does not warn when requireBack is unset", async () => {
      await render(<AppHeader title="Lobby" />);
      expect(mockCaptureMessage).not.toHaveBeenCalled();
    });

    it("records a tap breadcrumb before invoking onBack", async () => {
      const onBack = jest.fn();
      await render(<AppHeader title="Yacht" onBack={onBack} requireBack />);
      mockAddBreadcrumb.mockClear();
      await fireEvent.press(screen.getByRole("button", { name: "Go back to home screen" }));
      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "ui.header",
          message: "AppHeader back press",
          data: { title: "Yacht" },
        })
      );
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  // #711 — overflow menu
  describe("overflow menu", () => {
    it("shows the ? help button when no menu props are provided", async () => {
      await render(<AppHeader title="Lobby" />);
      expect(screen.getByRole("button", { name: "Send feedback" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
    });

    it("shows the ⋯ button and hides ? when onNewGame is provided", async () => {
      await render(<AppHeader title="Cascade" onNewGame={jest.fn()} />);
      expect(screen.getByRole("button", { name: "More options" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
    });

    it("shows the ⋯ button when onOpenScoreboard is provided", async () => {
      await render(<AppHeader title="Hearts" onOpenScoreboard={jest.fn()} />);
      expect(screen.getByRole("button", { name: "More options" })).toBeTruthy();
    });

    it("opens the dropdown when ⋯ is pressed", async () => {
      await render(<AppHeader title="2048" onNewGame={jest.fn()} />);
      expect(screen.queryByText("New Game")).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: "More options" }));
      expect(screen.getByText("New Game")).toBeTruthy();
    });

    it("shows Scoreboard item only when onOpenScoreboard is provided", async () => {
      await render(<AppHeader title="Hearts" onNewGame={jest.fn()} onOpenScoreboard={jest.fn()} />);
      await fireEvent.press(screen.getByRole("button", { name: "More options" }));
      expect(screen.getByText("Scoreboard")).toBeTruthy();
      expect(screen.getByText("New Game")).toBeTruthy();
    });

    it("does not show Scoreboard item when onOpenScoreboard is absent", async () => {
      await render(<AppHeader title="2048" onNewGame={jest.fn()} />);
      await fireEvent.press(screen.getByRole("button", { name: "More options" }));
      expect(screen.queryByText("Scoreboard")).toBeNull();
    });

    it("calls onOpenScoreboard and closes the menu when Scoreboard is tapped", async () => {
      const onOpenScoreboard = jest.fn();
      await render(
        <AppHeader title="Hearts" onOpenScoreboard={onOpenScoreboard} onNewGame={jest.fn()} />
      );
      await fireEvent.press(screen.getByRole("button", { name: "More options" }));
      await fireEvent.press(screen.getByText("Scoreboard"));
      expect(onOpenScoreboard).toHaveBeenCalledTimes(1);
      // Menu should be closed after tap
      expect(screen.queryByText("Scoreboard")).toBeNull();
    });

    it("opens the abandon dialog when New Game is tapped", async () => {
      await render(<AppHeader title="2048" onNewGame={jest.fn()} />);
      await fireEvent.press(screen.getByRole("button", { name: "More options" }));
      await fireEvent.press(screen.getByText("New Game"));
      expect(screen.getByText("Abandon current game?")).toBeTruthy();
    });

    it("does not call onNewGame when Keep Playing is tapped", async () => {
      const onNewGame = jest.fn();
      await render(<AppHeader title="2048" onNewGame={onNewGame} />);
      await fireEvent.press(screen.getByRole("button", { name: "More options" }));
      await fireEvent.press(screen.getByText("New Game"));
      await fireEvent.press(screen.getByRole("button", { name: "Keep Playing" }));
      expect(onNewGame).not.toHaveBeenCalled();
      expect(screen.queryByText("Abandon current game?")).toBeNull();
    });

    it("calls onNewGame when Start New is tapped", async () => {
      const onNewGame = jest.fn();
      await render(<AppHeader title="2048" onNewGame={onNewGame} />);
      await fireEvent.press(screen.getByRole("button", { name: "More options" }));
      await fireEvent.press(screen.getByText("New Game"));
      await fireEvent.press(screen.getByRole("button", { name: "Start New" }));
      expect(onNewGame).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Abandon current game?")).toBeNull();
    });
  });
});

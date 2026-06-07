import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import SettingsScreen from "../SettingsScreen";

const mockClearAll = jest.fn().mockResolvedValue(undefined);
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    clearAll: (...args: unknown[]) => mockClearAll(...args),
  },
}));

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../../components/LanguageSwitcher", () => ({
  __esModule: true,
  default: "MockLanguageSwitcher",
}));

async function renderScreen() {
  return await render(
    <ThemeProvider>
      <SettingsScreen />
    </ThemeProvider>
  );
}

describe("SettingsScreen", () => {
  it("renders the AppHeader", async () => {
    await renderScreen();
    expect(screen.getByRole("header")).toBeTruthy();
  });

  it("renders the 3-way theme mode segmented control", async () => {
    await renderScreen();
    expect(screen.getByTestId("theme-mode-segmented")).toBeTruthy();
    expect(screen.getByTestId("theme-mode-system")).toBeTruthy();
    expect(screen.getByTestId("theme-mode-light")).toBeTruthy();
    expect(screen.getByTestId("theme-mode-dark")).toBeTruthy();
  });

  it("selecting a different theme mode flips the selected state", async () => {
    await renderScreen();
    // Default mode is "dark" (initial state before AsyncStorage resolves).
    const darkBefore = screen.getByTestId("theme-mode-dark");
    expect(darkBefore.props.accessibilityState?.selected).toBe(true);

    await fireEvent.press(screen.getByTestId("theme-mode-light"));
    expect(screen.getByTestId("theme-mode-light").props.accessibilityState?.selected).toBe(true);
    expect(screen.getByTestId("theme-mode-dark").props.accessibilityState?.selected).toBe(false);
  });

  describe("Clear local logs", () => {
    beforeEach(() => {
      mockClearAll.mockClear();
    });

    it("renders the clear logs button", async () => {
      await renderScreen();
      expect(screen.getByTestId("clear-logs-button")).toBeTruthy();
    });

    it("tapping the button opens the confirmation modal", async () => {
      await renderScreen();
      await fireEvent.press(screen.getByTestId("clear-logs-button"));
      expect(screen.getByTestId("clear-logs-confirm")).toBeTruthy();
      expect(screen.getByTestId("clear-logs-cancel")).toBeTruthy();
    });

    it("cancel dismisses the modal without calling clearAll", async () => {
      await renderScreen();
      await fireEvent.press(screen.getByTestId("clear-logs-button"));
      await fireEvent.press(screen.getByTestId("clear-logs-cancel"));
      expect(mockClearAll).not.toHaveBeenCalled();
    });

    it("confirm calls gameEventClient.clearAll", async () => {
      await renderScreen();
      await fireEvent.press(screen.getByTestId("clear-logs-button"));
      await fireEvent.press(screen.getByTestId("clear-logs-confirm"));
      await waitFor(() => expect(mockClearAll).toHaveBeenCalledTimes(1));
    });
  });
});

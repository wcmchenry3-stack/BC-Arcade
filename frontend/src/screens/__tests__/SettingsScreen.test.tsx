import React from "react";
import { Linking } from "react-native";
import * as Sentry from "@sentry/react-native";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import SettingsScreen from "../SettingsScreen";

const mockClearAll = jest.fn().mockResolvedValue(undefined);
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    clearAll: (...args: unknown[]) => mockClearAll(...args),
  },
}));

const mockCalls: string[] = [];
jest.mock("../../api/stats", () => ({
  statsApi: {
    deleteMyData: jest.fn(async () => {
      mockCalls.push("deleteMyData");
    }),
  },
}));
jest.mock("../../game/_shared/displayNameSync", () => ({
  clearDisplayNameSync: jest.fn(async () => {
    mockCalls.push("clearDisplayNameSync");
  }),
}));
jest.mock("../../game/_shared/displayName", () => ({
  clearDisplayName: jest.fn(async () => {
    mockCalls.push("clearDisplayName");
    return true;
  }),
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

  describe("Legal links (#1922)", () => {
    let openURL: jest.SpyInstance;

    beforeEach(() => {
      openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    });

    afterEach(() => {
      openURL.mockRestore();
    });

    it("opens the hosted Privacy Policy", async () => {
      await renderScreen();
      const link = screen.getByTestId("privacy-policy-link");
      expect(link.props.accessibilityRole).toBe("link");
      await fireEvent.press(link);
      expect(openURL).toHaveBeenCalledWith("https://buffingchi.com/privacy");
    });

    it("opens the hosted Terms of Service", async () => {
      await renderScreen();
      await fireEvent.press(screen.getByTestId("terms-of-service-link"));
      expect(openURL).toHaveBeenCalledWith("https://buffingchi.com/terms");
    });

    it("labels the links from i18n", async () => {
      await renderScreen();
      expect(screen.getByText("Privacy Policy")).toBeTruthy();
      expect(screen.getByText("Terms of Service")).toBeTruthy();
    });

    it("reports to Sentry instead of crashing when the URL cannot be opened", async () => {
      openURL.mockRejectedValueOnce(new Error("no browser"));
      await renderScreen();
      await fireEvent.press(screen.getByTestId("privacy-policy-link"));
      await waitFor(() => {
        expect(Sentry.captureException).toHaveBeenCalledWith(
          expect.any(Error),
          expect.objectContaining({ tags: { subsystem: "settings", op: "openLegalUrl" } })
        );
      });
    });
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

  it("Delete my data settles the name sync first, then forgets the local name (#2624)", async () => {
    mockCalls.length = 0;
    await renderScreen();
    await fireEvent.press(screen.getByTestId("delete-data-button"));
    await fireEvent.press(screen.getByTestId("delete-data-confirm"));
    await waitFor(() => expect(mockCalls).toContain("clearDisplayName"));
    // No name sync may land after the server-side delete, and the name must
    // be gone locally so the next launch doesn't send it again.
    expect(mockCalls.indexOf("clearDisplayNameSync")).toBeLessThan(
      mockCalls.indexOf("deleteMyData")
    );
    expect(mockCalls.indexOf("deleteMyData")).toBeLessThan(mockCalls.indexOf("clearDisplayName"));
  });
});

import React from "react";
import { cleanup, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import { ThemeProvider } from "../../../theme/ThemeContext";
import GameResultModal from "../GameResultModal";
import LevelProgress from "../LevelProgress";

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

// #2767: numbers follow the app's language, not the device locale. The device
// locale here is en-US (Node's default); the app language is German.
describe("number formatting follows the app language (#2767)", () => {
  beforeEach(async () => {
    expect((1234567).toLocaleString()).toBe("1,234,567");
    await i18n.changeLanguage("de");
  });

  afterEach(async () => {
    await cleanup();
    await i18n.changeLanguage("en");
  });

  it("LevelProgress groups XP with German separators", async () => {
    await render(
      <ThemeProvider>
        <LevelProgress level={8} totalXp={1234567} xpIntoLevel={5} xpForNextLevel={12345} />
      </ThemeProvider>
    );
    expect(screen.getByText("1.234.567 XP")).toBeTruthy();
    expect(screen.getByText("12.345 XP to level 9")).toBeTruthy();
  });

  it("GameResultModal groups the hero score and stats with German separators", async () => {
    await render(
      <ThemeProvider>
        <GameResultModal
          visible
          outcome="win"
          onHome={jest.fn()}
          hero={{ kind: "score", label: "Punkte", value: 1234567 }}
          stats={[{ label: "Zuege", value: 12345 }]}
        />
      </ThemeProvider>
    );
    expect(screen.getByText("1.234.567")).toBeTruthy();
    expect(screen.getByText("12.345")).toBeTruthy();
    expect(screen.queryByText("1,234,567")).toBeNull();
  });
});

import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import LanguageSwitcher from "../LanguageSwitcher";
import { __forceStoreBuildForTests } from "../../game/_shared/buildFlavour";

jest.mock("../../theme/ThemeContext", () => ({
  useTheme: () => ({
    colors: {
      border: "#ccc",
      textMuted: "#666",
      text: "#000",
      modalBg: "#fff",
      surfaceAlt: "#eee",
      accent: "#00f",
    },
    theme: "dark",
    toggle: jest.fn(),
  }),
}));

let mockLanguage = "en";
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: mockLanguage, changeLanguage: jest.fn() },
  }),
}));

jest.mock("../../i18n/locales", () => {
  const LOCALES = [
    { code: "en", label: "English", nativeLabel: "English", flag: "🇺🇸", dir: "ltr" },
    { code: "fr-CA", label: "French (Canadian)", nativeLabel: "Français", flag: "🇨🇦", dir: "ltr" },
    { code: "es", label: "Spanish", nativeLabel: "Español", flag: "🇪🇸", dir: "ltr" },
    { code: "de", label: "German", nativeLabel: "Deutsch", flag: "🇩🇪", dir: "ltr" },
    { code: "ar", label: "Arabic", nativeLabel: "العربية", flag: "🇸🇦", dir: "rtl" },
  ];
  return {
    LOCALES,
    NATIVE_LOCALES: LOCALES.filter((l) => l.dir !== "rtl"),
    LAUNCH_LOCALE_CODES: new Set(["en", "fr-CA", "es"]),
  };
});

describe("LanguageSwitcher", () => {
  it("uses button accessibilityRole on language options (not option)", async () => {
    const { getByLabelText } = await render(<LanguageSwitcher />);

    // Open the modal
    await fireEvent.press(getByLabelText("lang.switcherLabel"));

    // Each language option should have accessibilityRole="button", not "option"
    const englishOption = getByLabelText("English — English");
    const spanishOption = getByLabelText("Español — Spanish");

    expect(englishOption.props.accessibilityRole).toBe("button");
    expect(spanishOption.props.accessibilityRole).toBe("button");
  });

  it("does not use 'option' as accessibilityRole anywhere", async () => {
    const { getByLabelText } = await render(<LanguageSwitcher />);
    await fireEvent.press(getByLabelText("lang.switcherLabel"));

    const englishOption = getByLabelText("English — English");
    const spanishOption = getByLabelText("Español — Spanish");

    expect(englishOption.props.accessibilityRole).not.toBe("option");
    expect(spanishOption.props.accessibilityRole).not.toBe("option");
  });

  it("does not offer RTL locales on native (no layout mirroring)", async () => {
    const { getByLabelText, queryByLabelText } = await render(<LanguageSwitcher />);
    await fireEvent.press(getByLabelText("lang.switcherLabel"));

    expect(getByLabelText("English — English")).toBeTruthy();
    expect(queryByLabelText("العربية — Arabic")).toBeNull();
  });

  describe("store build (#3150)", () => {
    afterEach(() => {
      __forceStoreBuildForTests(false);
      mockLanguage = "en";
    });

    it("offers only the launch locales", async () => {
      __forceStoreBuildForTests(true);
      const { getByLabelText, queryByLabelText } = await render(<LanguageSwitcher />);
      await fireEvent.press(getByLabelText("lang.switcherLabel"));

      expect(getByLabelText("English — English")).toBeTruthy();
      expect(getByLabelText("Français — French (Canadian)")).toBeTruthy();
      expect(getByLabelText("Español — Spanish")).toBeTruthy();
      expect(queryByLabelText("Deutsch — German")).toBeNull();
    });

    it("never labels the trigger with a hidden locale", async () => {
      __forceStoreBuildForTests(true);
      mockLanguage = "de";
      const { getByText, queryByText } = await render(<LanguageSwitcher />);
      expect(getByText("🇺🇸 English")).toBeTruthy();
      expect(queryByText("🇩🇪 Deutsch")).toBeNull();
    });

    it("dev and test builds still offer unlaunched locales", async () => {
      const { getByLabelText } = await render(<LanguageSwitcher />);
      await fireEvent.press(getByLabelText("lang.switcherLabel"));
      expect(getByLabelText("Deutsch — German")).toBeTruthy();
    });
  });
});

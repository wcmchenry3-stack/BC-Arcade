import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import LanguageSwitcher from "../LanguageSwitcher";

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

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: jest.fn() },
  }),
}));

jest.mock("../../i18n/locales", () => ({
  LOCALES: [
    { code: "en", label: "English", nativeLabel: "English", flag: "🇺🇸" },
    { code: "es", label: "Spanish", nativeLabel: "Español", flag: "🇪🇸" },
  ],
}));

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
});

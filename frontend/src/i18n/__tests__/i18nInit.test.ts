import { I18nManager } from "react-native";

jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageTag: "ar-SA", languageCode: "ar" }],
}));

describe("i18n init (native)", () => {
  it("disables RTL layout and resolves to en on an Arabic device", () => {
    const allow = jest.spyOn(I18nManager, "allowRTL").mockImplementation(() => {});
    const force = jest.spyOn(I18nManager, "forceRTL").mockImplementation(() => {});

    // Loaded after the spies are installed; the module runs its setup on import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const i18n = require("../i18n").default;

    expect(allow).toHaveBeenCalledWith(false);
    expect(force).toHaveBeenCalledWith(false);
    expect(i18n.options.lng).toBe("en");
    expect(i18n.options.supportedLngs).not.toContain("ar");
    expect(i18n.options.supportedLngs).not.toContain("he");
  });
});

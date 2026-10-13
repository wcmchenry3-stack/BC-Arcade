import { renderHook } from "@testing-library/react-native";
import { Platform } from "react-native";

import { resolveLocale } from "../resolveLocale";
import { useDeviceLocaleSync } from "../useDeviceLocaleSync";

type Locale = { languageTag: string; languageCode: string | null };

let mockLocales: Locale[] = [];
jest.mock("expo-localization", () => ({
  useLocales: () => mockLocales,
}));

const mockChangeLanguage = jest.fn(() => Promise.resolve());
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { changeLanguage: mockChangeLanguage } }),
}));

describe("useDeviceLocaleSync", () => {
  beforeEach(() => {
    mockChangeLanguage.mockClear();
    mockLocales = [{ languageTag: "en-US", languageCode: "en" }];
  });

  it("does not change the language on mount", async () => {
    await renderHook(() => useDeviceLocaleSync());
    expect(mockChangeLanguage).not.toHaveBeenCalled();
  });

  it("switches to the resolved locale when the OS language changes", async () => {
    const { rerender } = await renderHook(() => useDeviceLocaleSync());

    mockLocales = [{ languageTag: "fr-CA", languageCode: "fr" }];
    await rerender({});

    expect(mockChangeLanguage).toHaveBeenCalledTimes(1);
    expect(mockChangeLanguage).toHaveBeenCalledWith(resolveLocale(mockLocales, Platform.OS));
    expect(mockChangeLanguage).toHaveBeenCalledWith("fr-CA");
  });

  it("does not override the language when the OS tag is unchanged", async () => {
    const { rerender } = await renderHook(() => useDeviceLocaleSync());

    // A new array with the same first tag (e.g. app returning to foreground).
    mockLocales = [{ languageTag: "en-US", languageCode: "en" }];
    await rerender({});

    expect(mockChangeLanguage).not.toHaveBeenCalled();
  });

  it("resolves an unsupported OS language to English", async () => {
    mockLocales = [{ languageTag: "fr-CA", languageCode: "fr" }];
    const { rerender } = await renderHook(() => useDeviceLocaleSync());

    mockLocales = [{ languageTag: "sw-KE", languageCode: "sw" }];
    await rerender({});

    expect(mockChangeLanguage).toHaveBeenCalledWith("en");
  });

  it("does not switch when only an unsupported first language changes", async () => {
    const { rerender } = await renderHook(() => useDeviceLocaleSync());

    // en-US -> sw-KE still resolves to English: nothing to do.
    mockLocales = [{ languageTag: "sw-KE", languageCode: "sw" }];
    await rerender({});

    expect(mockChangeLanguage).not.toHaveBeenCalled();
  });

  it("follows a supported fallback behind an unsupported first language", async () => {
    mockLocales = [
      { languageTag: "sw-KE", languageCode: "sw" },
      { languageTag: "en-US", languageCode: "en" },
    ];
    const { rerender } = await renderHook(() => useDeviceLocaleSync());

    mockLocales = [
      { languageTag: "sw-KE", languageCode: "sw" },
      { languageTag: "fr-CA", languageCode: "fr" },
    ];
    await rerender({});

    expect(mockChangeLanguage).toHaveBeenCalledTimes(1);
    expect(mockChangeLanguage).toHaveBeenCalledWith("fr-CA");
  });
});

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { Platform } from "react-native";
import * as Localization from "expo-localization";
import { LOCALES, NATIVE_LOCALES } from "./locales";
import { NAMESPACES, loadLocaleNamespace } from "./localeLoaders";

// Resolve the best supported locale from the device's preference list
function resolveLocale(): string {
  const deviceLocales = Localization.getLocales();
  // Native has no RTL layout support, so never auto-select ar/he there (#2212)
  const available = Platform.OS === "web" ? LOCALES : NATIVE_LOCALES;
  const supported = new Set(available.map((l) => l.code));

  for (const { languageTag, languageCode } of deviceLocales) {
    if (supported.has(languageTag)) return languageTag;
    // Fall back to base language code (e.g. "fr" matches "fr-CA")
    const match = available.find((l) => l.code.split("-")[0] === languageCode);
    if (match) return match.code;
  }
  return "en";
}

i18n
  .use(resourcesToBackend(loadLocaleNamespace))
  .use(initReactI18next)
  .init({
    lng: resolveLocale(),
    fallbackLng: "en",
    supportedLngs: LOCALES.map((l) => l.code),
    ns: [...NAMESPACES],
    defaultNS: "common",
    interpolation: { escapeValue: false },
    react: { useSuspense: true },
  });

export default i18n;

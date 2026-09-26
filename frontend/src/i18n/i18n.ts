import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { I18nManager, Platform } from "react-native";
import * as Localization from "expo-localization";
import { NAMESPACES, loadLocaleNamespace } from "./localeLoaders";
import { availableLocales, resolveLocale } from "./resolveLocale";

// Native layout mirroring is not implemented (#2212). Keep the layout LTR even on an
// RTL-language device, otherwise the English fallback renders inside a mirrored layout.
if (Platform.OS !== "web") {
  I18nManager.allowRTL(false);
  I18nManager.forceRTL(false);
}

i18n
  .use(resourcesToBackend(loadLocaleNamespace))
  .use(initReactI18next)
  .init({
    lng: resolveLocale(Localization.getLocales(), Platform.OS),
    fallbackLng: "en",
    supportedLngs: availableLocales(Platform.OS).map((l) => l.code),
    ns: [...NAMESPACES],
    defaultNS: "common",
    interpolation: { escapeValue: false },
    react: { useSuspense: true },
  });

export default i18n;

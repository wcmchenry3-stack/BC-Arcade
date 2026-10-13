import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { useLocales } from "expo-localization";
import { resolveLocale } from "./resolveLocale";

/**
 * Follows OS language changes while the app is running (#3151). Android 13+
 * lets the user change the app's language in Settings → App languages; the
 * activity handles the `locale` config change without restarting, so i18n
 * (initialised once from `getLocales()`) would otherwise keep the old language
 * until a cold start.
 *
 * Only a change of the device's first language tag triggers a switch, so an
 * in-app pick from LanguageSwitcher is not overwritten on re-render or when
 * the app returns to the foreground with the same OS language.
 *
 * Call once in a component mounted inside I18nextProvider (e.g. App).
 */
export function useDeviceLocaleSync() {
  const { i18n } = useTranslation();
  const locales = useLocales();
  const tag = locales[0]?.languageTag;
  const lastTag = useRef(tag);

  useEffect(() => {
    if (tag === lastTag.current) return;
    lastTag.current = tag;
    void i18n.changeLanguage(resolveLocale(locales, Platform.OS));
    // `locales` is a new array on each OS change; the tag is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, i18n]);
}

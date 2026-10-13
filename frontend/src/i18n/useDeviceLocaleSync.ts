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
 * Only a change in the locale the OS preference list resolves to triggers a
 * switch, so an in-app pick from LanguageSwitcher is not overwritten on
 * re-render or when the app returns to the foreground with the same OS
 * languages. Keying on the resolved locale (not the first tag) also catches a
 * change to a supported fallback behind an unsupported first language.
 *
 * Call once in a component that mounts after `src/i18n/i18n` is initialised (e.g. App).
 */
export function useDeviceLocaleSync() {
  const { i18n } = useTranslation();
  const locales = useLocales();
  const resolved = resolveLocale(locales, Platform.OS);
  const lastResolved = useRef(resolved);

  useEffect(() => {
    if (resolved === lastResolved.current) return;
    lastResolved.current = resolved;
    void i18n.changeLanguage(resolved);
  }, [resolved, i18n]);
}

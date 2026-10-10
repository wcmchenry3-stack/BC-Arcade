import React from "react";
import { useTranslation } from "react-i18next";
import { LOCALES } from "../i18n/locales";
import { useTheme } from "../theme/ThemeContext";

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation("common");
  const { colors } = useTheme();

  return (
    <select
      value={i18n.language}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      aria-label={t("lang.switcherLabel")}
      data-testid="lang-switcher-select"
      style={{
        backgroundColor: colors.surface,
        color: colors.textMuted,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 13,
        minHeight: 44,
        cursor: "pointer",
      }}
    >
      {LOCALES.map((locale) => (
        <option key={locale.code} value={locale.code}>
          {locale.flag} {locale.nativeLabel}
        </option>
      ))}
    </select>
  );
}

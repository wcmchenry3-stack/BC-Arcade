import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/ThemeContext";
import {
  DAILYWORD_ABSENT,
  DAILYWORD_CORRECT,
  DAILYWORD_LETTER_TEXT,
  DAILYWORD_PRESENT,
} from "../../theme/theme.dailyword";
import { typography } from "../../theme/typography";
import type { DailyWordState } from "../../game/daily_word/types";

/** Half-a-key gap that centres a nine-letter row under a ten-letter one. */
const SPACER = "spacer";

type KeyRows = ReadonlyArray<ReadonlyArray<string>>;

const QWERTY_ROWS: KeyRows = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  [SPACER, "A", "S", "D", "F", "G", "H", "J", "K", "L", SPACER],
  ["Enter", "Z", "X", "C", "V", "B", "N", "M", "Delete"],
];

// Spanish (#3241): QWERTY plus Ñ after L. There are no accent keys: players
// type plain letters and the server folds the accents (docs/games/daily_word.md).
const SPANISH_ROWS: KeyRows = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", "Ñ"],
  ["Enter", "Z", "X", "C", "V", "B", "N", "M", "Delete"],
];

// Devanagari consonants + matras in Varnamala order
const DEVANAGARI_ROWS: KeyRows = [
  ["क", "ख", "ग", "घ", "च", "छ", "ज", "झ", "ट", "ठ"],
  ["ड", "ढ", "त", "थ", "द", "ध", "न", "प", "फ", "ब"],
  ["Enter", "भ", "म", "य", "र", "ल", "व", "श", "स", "Delete"],
  ["ह", "ा", "ि", "ी", "ु", "ू", "े", "ै", "ो", "ौ"],
];

/**
 * The keyboard layout for each puzzle language (#3241). French is QWERTY too:
 * players in Canada use it. A language without an entry gets QWERTY.
 */
export const KEYBOARD_LAYOUTS: Readonly<Record<string, KeyRows>> = {
  en: QWERTY_ROWS,
  fr: QWERTY_ROWS,
  es: SPANISH_ROWS,
  hi: DEVANAGARI_ROWS,
};

/** The label style override for an Enter/Delete key; null keeps the 13 px default. */
export function actionLabelStyle(language: string, label: string) {
  if (language !== "fr" && language !== "es") return null;
  return Array.from(label).length > 6 ? keyStyles.actionTextLong : keyStyles.actionText;
}

export function keyboardRows(language: string): KeyRows {
  return KEYBOARD_LAYOUTS[language] ?? QWERTY_ROWS;
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export function WordKeyboard({
  keyboardState,
  language,
  onKey,
}: {
  readonly keyboardState: DailyWordState["keyboard_state"];
  readonly language: string;
  readonly onKey: (key: string) => void;
}) {
  const { t } = useTranslation("daily_word");
  const { colors } = useTheme();

  const rows = keyboardRows(language);

  // Memoized rather than hoisted: the "unused" key colour follows the theme.
  const KEY_BG = useMemo<Record<string, string>>(
    () => ({
      correct: DAILYWORD_CORRECT,
      present: DAILYWORD_PRESENT,
      absent: DAILYWORD_ABSENT,
      unused: colors.surfaceAlt,
    }),
    [colors.surfaceAlt]
  );

  function renderKey(key: string, idx: number) {
    if (key === SPACER) return <View key={`${key}-${idx}`} style={keyStyles.spacer} />;

    const isAction = key === "Enter" || key === "Delete";
    const letterStatus = keyboardState[key.toLowerCase()] ?? keyboardState[key] ?? "unused";
    const bg = isAction ? colors.surfaceHigh : (KEY_BG[letterStatus] ?? KEY_BG.unused);
    const label =
      key === "Enter" ? t("keyboard.enter") : key === "Delete" ? t("keyboard.delete") : key;
    // French and Spanish labels ("Effacer", "Entrée") need a smaller size to fit
    // their key at 320 px; English and Hindi keep the 13 px labels they always had.
    const labelStyle = isAction ? actionLabelStyle(language, label) : null;

    return (
      <Pressable
        key={`${key}-${idx}`}
        testID={`daily-word-key-${key.toLowerCase()}`}
        onPress={() => onKey(key)}
        style={[keyStyles.key, isAction && keyStyles.actionKey, { backgroundColor: bg }]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text
          numberOfLines={1}
          {...(isAction ? { adjustsFontSizeToFit: true, minimumFontScale: 0.6 } : {})}
          style={[keyStyles.keyText, labelStyle, { color: DAILYWORD_LETTER_TEXT }]}
        >
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={keyStyles.keyboard}>
      {rows.map((row, rowIdx) => (
        <View key={rowIdx} style={keyStyles.keyRow}>
          {row.map((key, keyIdx) => renderKey(key, keyIdx))}
        </View>
      ))}
    </View>
  );
}

// Keys share the row's width by flex weight instead of a fixed size, so a row
// of ten (Q-P, and Spanish's A-Ñ) fits at 320 px. Letters weigh 2, action keys
// 3.8, and a nine-letter row has a half-key spacer (1) at each end.
const keyStyles = StyleSheet.create({
  keyboard: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 520,
    gap: 6,
    paddingHorizontal: 4,
  },
  keyRow: {
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
  },
  key: {
    flex: 2,
    flexBasis: 0,
    minWidth: 0,
    height: 56,
    paddingHorizontal: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  actionKey: {
    flex: 3.8,
  },
  spacer: {
    flex: 1,
    flexBasis: 0,
  },
  keyText: {
    fontFamily: typography.label,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  actionText: {
    fontSize: 11,
    letterSpacing: 0,
  },
  actionTextLong: {
    fontSize: 10,
    letterSpacing: 0,
  },
});

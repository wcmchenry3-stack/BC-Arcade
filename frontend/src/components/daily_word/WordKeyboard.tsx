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

const QWERTY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Enter", "Z", "X", "C", "V", "B", "N", "M", "Delete"],
] as const;

// Devanagari consonants + matras in Varnamala order
const DEVANAGARI_ROWS = [
  ["क", "ख", "ग", "घ", "च", "छ", "ज", "झ", "ट", "ठ"],
  ["ड", "ढ", "त", "थ", "द", "ध", "न", "प", "फ", "ब"],
  ["Enter", "भ", "म", "य", "र", "ल", "व", "श", "स", "Delete"],
  ["ह", "ा", "ि", "ी", "ु", "ू", "े", "ै", "ो", "ौ"],
] as const;

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

  const rows = language === "hi" ? DEVANAGARI_ROWS : QWERTY_ROWS;

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
    const isAction = key === "Enter" || key === "Delete";
    const letterStatus = keyboardState[key.toLowerCase()] ?? keyboardState[key] ?? "unused";
    const bg = isAction ? colors.surfaceHigh : (KEY_BG[letterStatus] ?? KEY_BG.unused);
    const label =
      key === "Enter" ? t("keyboard.enter") : key === "Delete" ? t("keyboard.delete") : key;

    return (
      <Pressable
        key={`${key}-${idx}`}
        testID={`daily-word-key-${key.toLowerCase()}`}
        onPress={() => onKey(key)}
        style={[keyStyles.key, isAction && keyStyles.actionKey, { backgroundColor: bg }]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text numberOfLines={1} style={[keyStyles.keyText, { color: DAILYWORD_LETTER_TEXT }]}>
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={keyStyles.keyboard}>
      {(rows as ReadonlyArray<ReadonlyArray<string>>).map((row, rowIdx) => (
        <View key={rowIdx} style={keyStyles.keyRow}>
          {row.map((key, keyIdx) => renderKey(key, keyIdx))}
        </View>
      ))}
    </View>
  );
}

const keyStyles = StyleSheet.create({
  keyboard: {
    gap: 6,
    paddingHorizontal: 4,
  },
  keyRow: {
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
  },
  key: {
    minWidth: 30,
    height: 56,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  actionKey: {
    minWidth: 52,
  },
  keyText: {
    fontFamily: typography.label,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});

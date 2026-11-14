import React, { memo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { FRUIT_SETS } from "../../theme/fruitSets";
import { useFruitSet } from "../../theme/FruitSetContext";
import { useTheme } from "../../theme/ThemeContext";
import FruitGlyph from "./FruitGlyph";

/** Each tab shows its set's first piece (Cherry, Moon), drawn as on the board (#3698). */
const TAB_GLYPH_SIZE = 18;

function ThemeSelector() {
  const { t } = useTranslation("cascade");
  const { activeFruitSet, setFruitSetById } = useFruitSet();
  const { colors } = useTheme();

  return (
    <View
      style={[styles.strip, { backgroundColor: colors.surfaceHigh }]}
      accessibilityRole="radiogroup"
      accessibilityLabel={t("theme.groupLabel")}
    >
      {Object.values(FRUIT_SETS).map((set) => {
        const active = set.id === activeFruitSet.id;
        return (
          <Pressable
            key={set.id}
            onPress={() => setFruitSetById(set.id)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            aria-checked={active}
            accessibilityLabel={t("theme.optionLabel", { label: set.label })}
            style={[styles.tab, active && { backgroundColor: colors.accent }]}
          >
            {set.fruits[0] && <FruitGlyph fruit={set.fruits[0]} size={TAB_GLYPH_SIZE} />}
            <Text
              style={[styles.label, { color: active ? colors.textOnAccent : colors.textMuted }]}
            >
              {set.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Memoized (#2960): it takes no props and re-renders only when the fruit set or theme changes.
export default memo(ThemeSelector);

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignSelf: "center",
    borderRadius: 16,
    padding: 2,
    marginBottom: 6,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
    minHeight: 28,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
});

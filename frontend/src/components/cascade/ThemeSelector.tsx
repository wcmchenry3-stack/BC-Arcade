import React, { memo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { FRUIT_SETS } from "../../theme/fruitSets";
import { useFruitSet } from "../../theme/FruitSetContext";
import { useTheme } from "../../theme/ThemeContext";
import FruitGlyph from "./FruitGlyph";

/** Each tab shows its set's first piece (Cherry, Pluto), drawn as on the board (#3698). */
const TAB_GLYPH_SIZE = 18;

interface Props {
  /**
   * Called with the tapped set's id (never the active one). When given, the screen decides
   * whether to switch (it confirms first mid-game, #3970); without it a tap switches at once.
   */
  onRequestSelect?: (id: string) => void;
}

// A tab is ~28px tall; the touch target grows to the 44pt guideline without changing the layout.
const TAB_HIT_SLOP = { top: 8, bottom: 8, left: 4, right: 4 } as const;

function ThemeSelector({ onRequestSelect }: Props) {
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
            onPress={() => {
              if (active) return; // the active set: nothing to switch
              (onRequestSelect ?? setFruitSetById)(set.id);
            }}
            hitSlop={TAB_HIT_SLOP}
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

// Memoized (#2960): it re-renders only when the fruit set, theme or `onRequestSelect` changes.
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

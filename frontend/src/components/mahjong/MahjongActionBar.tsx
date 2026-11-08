/**
 * Mahjong's bottom action bar (#3614): Undo, Hint and Shuffle within thumb reach, above the tab
 * bar. Each is an icon over a short label, at least 44 x 44 pt; Shuffle carries a badge with the
 * shuffles left. The labels, accessibility labels and test ids are the ones the header pills had,
 * so screen readers and the e2e helpers find the same controls.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { MAHJONG_HINT_COLOR, MAHJONG_SHUFFLE_COLOR } from "../../theme/theme.mahjong";
import { PILL_DISABLED_OPACITY } from "../shared/PillButton";
import { MAHJONG_ACTION_BAR_H } from "../../game/mahjong/layout";

/** The bar has a fixed height; its small labels and badge grow with font size up to this. */
const MAX_FONT_SCALE = 1.3;

interface ActionProps {
  readonly icon: React.ComponentProps<typeof MaterialIcons>["name"];
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly color: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
  readonly badge?: number;
  readonly accessibilityValue?: string;
}

function Action({
  icon,
  label,
  accessibilityLabel,
  color,
  disabled,
  onPress,
  testID,
  badge,
  accessibilityValue,
}: ActionProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      accessibilityValue={accessibilityValue ? { text: accessibilityValue } : undefined}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [
        styles.action,
        { opacity: disabled ? PILL_DISABLED_OPACITY : pressed ? 0.7 : 1 },
      ]}
    >
      <View>
        <MaterialIcons name={icon} size={26} color={color} />
        {badge !== undefined && (
          <View style={[styles.badge, { backgroundColor: color }]} testID={`${testID}-badge`}>
            <Text
              style={[styles.badgeText, { color: colors.textOnAccent }]}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {badge}
            </Text>
          </View>
        )}
      </View>
      <Text
        style={[styles.label, { color }]}
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface MahjongActionBarProps {
  readonly undoDisabled: boolean;
  readonly hintDisabled: boolean;
  readonly shuffleDisabled: boolean;
  readonly shufflesLeft: number;
  readonly onUndo: () => void;
  readonly onHint: () => void;
  readonly onShuffle: () => void;
}

export default function MahjongActionBar({
  undoDisabled,
  hintDisabled,
  shuffleDisabled,
  shufflesLeft,
  onUndo,
  onHint,
  onShuffle,
}: MahjongActionBarProps) {
  const { t } = useTranslation("mahjong");
  const { colors } = useTheme();
  return (
    <View
      style={[styles.bar, { borderTopColor: colors.border }]}
      testID="mahjong-action-bar"
      accessibilityRole="toolbar"
    >
      <Action
        icon="undo"
        label={t("action.undo")}
        accessibilityLabel={t("action.undoLabel")}
        color={colors.accent}
        disabled={undoDisabled}
        onPress={onUndo}
        testID="mahjong-undo-button"
      />
      <Action
        icon="lightbulb"
        label={t("action.hint")}
        accessibilityLabel={t("action.hintLabel")}
        color={MAHJONG_HINT_COLOR}
        disabled={hintDisabled}
        onPress={onHint}
        testID="mahjong-hint-button"
      />
      <Action
        icon="shuffle"
        label={t("action.shuffle")}
        accessibilityLabel={t("action.shuffleLabel")}
        accessibilityValue={t("hud.shufflesLeft", { count: shufflesLeft })}
        color={MAHJONG_SHUFFLE_COLOR}
        disabled={shuffleDisabled}
        onPress={onShuffle}
        testID="mahjong-shuffle-button"
        badge={shufflesLeft}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: MAHJONG_ACTION_BAR_H,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: {
    flex: 1,
    minHeight: 52,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  label: {
    fontFamily: typography.label,
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -12,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontFamily: typography.label,
    fontSize: 11,
  },
});

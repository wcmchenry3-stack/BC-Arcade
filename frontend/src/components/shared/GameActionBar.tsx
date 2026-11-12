/**
 * The action bar under a game's board (#3614, #3688): icon-over-label buttons at least 44 x 44 pt,
 * in thumb reach above the tab bar. Mahjong (Undo, Hint, Shuffle) and 2048 (Hint, New Game) share
 * it, so a Hint button looks and sits the same in every game that has one. A button may carry a
 * badge (Mahjong's shuffles left) and a spoken value.
 */
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { PILL_DISABLED_OPACITY } from "./PillButton";

/** The bar has a fixed height; its small labels and badge grow with font size up to this. */
const MAX_FONT_SCALE = 1.3;

export interface GameBarAction {
  readonly key: string;
  readonly icon: React.ComponentProps<typeof MaterialIcons>["name"];
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly color: string;
  readonly disabled?: boolean;
  /** A long action is running (Sort's Hint solver, #3658): a spinner replaces the icon and the button is inert. */
  readonly busy?: boolean;
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
  disabled = false,
  busy,
  onPress,
  testID,
  badge,
  accessibilityValue,
}: Omit<GameBarAction, "key">) {
  const { colors } = useTheme();
  const inactive = disabled || busy === true;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={busy === undefined ? { disabled } : { disabled: inactive, busy }}
      accessibilityValue={accessibilityValue ? { text: accessibilityValue } : undefined}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [
        styles.action,
        { opacity: inactive ? PILL_DISABLED_OPACITY : pressed ? 0.7 : 1 },
      ]}
    >
      <View>
        {busy ? (
          <ActivityIndicator
            size="small"
            color={color}
            style={styles.spinner}
            testID={`${testID}-busy`}
          />
        ) : (
          <MaterialIcons name={icon} size={26} color={color} />
        )}
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

export interface GameActionBarProps {
  readonly actions: readonly GameBarAction[];
  readonly height: number;
  readonly testID: string;
}

export default function GameActionBar({ actions, height, testID }: GameActionBarProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.bar, { height, borderTopColor: colors.border }]}
      testID={testID}
      accessibilityRole="toolbar"
    >
      {actions.map(({ key, ...action }) => (
        <Action key={key} {...action} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
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
  // The spinner takes the icon box so the bar does not shift while busy.
  spinner: { width: 26, height: 26 },
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

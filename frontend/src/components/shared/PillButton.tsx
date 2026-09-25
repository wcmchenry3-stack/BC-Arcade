import React from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../theme/ThemeContext";

/** Opacity for a disabled pill. One value across every game's toolbar. */
export const PILL_DISABLED_OPACITY = 0.4;

// The pill is 32pt tall so the header stays compact; hitSlop grows the
// touch target to the 44pt minimum without changing the layout.
const HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 } as const;

export interface PillButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Border and text color. Defaults to the theme accent. */
  color?: string;
  /** Screen-reader label. Defaults to `label`. */
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Outlined, uppercase pill used for in-game toolbar actions (Undo, Hint,
 * Shuffle, New Game). Replaces the per-screen `headerBtn` / `newGameBtn`
 * styles (#2599).
 */
export function PillButton({
  label,
  onPress,
  disabled = false,
  color,
  accessibilityLabel,
  testID,
  style,
}: PillButtonProps) {
  const { colors } = useTheme();
  const tint = color ?? colors.accent;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      style={[
        styles.pill,
        { borderColor: tint, opacity: disabled ? PILL_DISABLED_OPACITY : 1 },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      testID={testID}
    >
      <Text style={[styles.label, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: "center",
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});

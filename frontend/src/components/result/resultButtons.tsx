import { Pressable, StyleSheet, Text } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { Colors } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import type { ResultAction } from "./resultTypes";

/** The result card's primary (filled) and outline buttons. */

export function PrimaryButton({ action, colors }: { action: ResultAction; colors: Colors }) {
  const disabled = !!action.disabled;
  const icon = action.icon ?? (disabled ? "clock-outline" : undefined);
  const fgColor = disabled ? colors.textMuted : colors.textOnAccent;
  return (
    <Pressable
      testID="game-result-primary"
      onPress={action.onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={
        action.accessibilityLabel ?? (action.labelNode ? undefined : action.label)
      }
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        disabled
          ? {
              backgroundColor: colors.surfaceAlt,
              borderColor: colors.border,
              borderWidth: 1.5,
              borderStyle: "dashed",
            }
          : { backgroundColor: colors.accentBright },
        { transform: [{ scale: pressed && !disabled ? 0.97 : 1 }] },
      ]}
    >
      {icon ? (
        <MaterialCommunityIcons
          name={icon}
          size={18}
          color={fgColor}
          // Decorative: the button's name is its label, never the icon glyph (#2964).
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
      {action.labelNode ? (
        action.labelNode([styles.primaryText, { color: fgColor }])
      ) : (
        <Text style={[styles.primaryText, { color: fgColor }]}>{action.label}</Text>
      )}
    </Pressable>
  );
}

export function OutlineButton({
  action,
  colors,
  grow,
  testID,
}: {
  action: ResultAction;
  colors: Colors;
  grow?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={action.onPress}
      disabled={action.disabled}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel ?? action.label}
      accessibilityState={{ disabled: !!action.disabled }}
      style={({ pressed }) => [
        styles.button,
        styles.outline,
        grow ? styles.grow : styles.homeFixed,
        { borderColor: colors.textMuted, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {action.icon ? (
        <MaterialCommunityIcons
          name={action.icon}
          size={18}
          color={colors.text}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
      <Text numberOfLines={1} style={[styles.outlineText, { color: colors.text }]}>
        {action.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  primaryText: { fontFamily: typography.label, fontSize: 16 },
  outline: { borderWidth: 1.5, backgroundColor: "transparent" },
  grow: { flex: 1, minWidth: 0 },
  homeFixed: { width: 118 },
  outlineText: { fontFamily: typography.label, fontSize: 16, flexShrink: 1 },
});

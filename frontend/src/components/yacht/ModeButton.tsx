import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "../../theme/ThemeContext";

/** Solo / vs Computer choice in the pre-game mode picker; filled when selected. */
export default function ModeButton({
  label,
  selected,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      style={
        selected
          ? [
              styles.modeBtn,
              styles.modeBtnPrimary,
              { borderColor: colors.accent, backgroundColor: colors.accent },
            ]
          : [styles.modeBtn, { borderColor: colors.border }]
      }
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
    >
      <Text style={[styles.modeBtnText, { color: selected ? colors.textOnAccent : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modeBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  modeBtnPrimary: {
    marginTop: 4,
  },
  modeBtnText: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});

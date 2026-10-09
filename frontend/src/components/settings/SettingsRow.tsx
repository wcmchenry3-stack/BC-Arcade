import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";

export interface SettingsRowProps {
  label: string;
  /** Secondary line under the label. */
  description: string;
  /** Extra content under the description, e.g. a live status line. */
  details?: React.ReactNode;
  /** The row's control (a button) on the right. */
  children: React.ReactNode;
}

/**
 * A Settings row with a label and description stacked on the left and a
 * control on the right (#2981). Replaces the screen's `rowStacked` blocks.
 */
export function SettingsRow({ label, description, details, children }: SettingsRowProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <View style={styles.text}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.description, { color: colors.text, opacity: 0.7 }]}>
          {description}
        </Text>
        {details}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    borderBottomWidth: 1,
    gap: 12,
  },
  text: { flex: 1 },
  label: { fontSize: 16 },
  description: { fontSize: 13, marginTop: 4 },
});

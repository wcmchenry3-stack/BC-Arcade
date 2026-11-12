import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useTheme } from "../../theme/ThemeContext";

interface Props {
  label: string;
  /** Screen-reader label for the ⓘ button. */
  tooltipLabel: string;
  /** Explanation shown under the row while `expanded`. */
  tooltip: string;
  expanded: boolean;
  onToggleTooltip: () => void;
  /** The row's control (option buttons or a Stepper). */
  children: React.ReactNode;
}

/** One blackjack table-rules row: label + ⓘ tooltip toggle + control. */
export default function RuleRow({
  label,
  tooltipLabel,
  tooltip,
  expanded,
  onToggleTooltip,
  children,
}: Props) {
  const { colors } = useTheme();
  return (
    <View style={ruleRowStyles.section}>
      <View style={ruleRowStyles.row}>
        <View style={ruleRowStyles.labelRow}>
          <Text style={[ruleRowStyles.label, { color: colors.text }]}>{label}</Text>
          <Pressable
            onPress={onToggleTooltip}
            accessibilityRole="button"
            accessibilityLabel={tooltipLabel}
            accessibilityState={{ expanded }}
            hitSlop={8}
          >
            <MaterialIcons name="info-outline" size={14} color={colors.textMuted} />
          </Pressable>
        </View>
        {children}
      </View>
      {expanded && (
        <Text style={[ruleRowStyles.tooltip, { color: colors.textMuted }]}>{tooltip}</Text>
      )}
    </View>
  );
}

/**
 * The row's styles, shared with the rules sheet's fixed rules (TableRules, #3741) so they read as
 * one more row: `section`, `label` and `tooltip`.
 */
export const ruleRowStyles = StyleSheet.create({
  section: {
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
  },
  tooltip: {
    fontSize: 12,
    lineHeight: 17,
  },
});

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";

export interface StatRowProps {
  /** Muted label on the left. */
  label: string;
  /** Bold value on the right. */
  value: string;
  /** Colour token for the value (defaults to `colors.text`), e.g. a P/L sign. */
  valueColor?: string;
  testID?: string;
}

/**
 * One label/value line in a stats card: muted label on the left, bold value
 * on the right (#2981). Replaces the per-screen `statRow` blocks.
 */
export function StatRow({ label, value, valueColor, testID }: StatRowProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} testID={testID}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.value, { color: valueColor ?? colors.text }]}>{value}</Text>
    </View>
  );
}

export interface StatListItem extends StatRowProps {
  /** Stable React key. */
  key: string;
}

/**
 * A run of `StatRow`s with a hairline divider between each pair. Pass only
 * the rows to show: dividers follow the rows actually rendered.
 */
export function StatList({ items }: { items: readonly StatListItem[] }) {
  const { colors } = useTheme();
  return (
    <>
      {items.map(({ key, ...row }, i) => (
        <React.Fragment key={key}>
          {i > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
          <StatRow {...row} />
        </React.Fragment>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
  },
  value: {
    fontSize: 14,
    fontWeight: "700",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";

/**
 * One titled card of the game detail screen (#2840). `note` is a muted line
 * under the content, e.g. that a breakdown doesn't fully explain the total.
 */
export function DetailCard({
  title,
  note,
  children,
  testID,
}: {
  title?: string;
  note?: string | null;
  children?: React.ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceAlt }]} testID={testID}>
      {title != null && (
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          {title}
        </Text>
      )}
      {children}
      {note != null && note !== "" && (
        <Text style={[styles.note, { color: colors.textMuted }]}>{note}</Text>
      )}
    </View>
  );
}

/**
 * A table row: a label column and value columns. The row is one screen-reader
 * element read as `a11yLabel`; its cells are hidden from it.
 */
export function TableRow({
  cells,
  a11yLabel,
  kind = "body",
  isLast,
  labelFlex = 2,
  testID,
}: {
  cells: readonly React.ReactNode[];
  a11yLabel?: string;
  kind?: "head" | "body" | "sub" | "total";
  isLast?: boolean;
  /** Flex of the label column against 1 per value column: lower gives the values more room. */
  labelFlex?: number;
  testID?: string;
}) {
  const { colors } = useTheme();
  const strong = kind === "head" || kind === "total";
  const color = kind === "head" || kind === "sub" ? colors.textMuted : colors.text;
  return (
    <View
      style={[
        styles.row,
        !isLast && {
          borderBottomColor: colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
      ]}
      accessible={a11yLabel != null}
      accessibilityLabel={a11yLabel}
      accessibilityRole={kind === "head" ? "header" : undefined}
      testID={testID}
    >
      {cells.map((cell, i) => (
        <View key={i} style={i === 0 ? [styles.labelCell, { flex: labelFlex }] : styles.valueCell}>
          {typeof cell === "string" || typeof cell === "number" ? (
            <Text
              style={[
                i === 0 ? styles.labelText : styles.valueText,
                { color },
                strong && styles.strong,
                kind === "head" && styles.headText,
              ]}
              // A value column stays one line: it shrinks to fit (large text) rather than wrap.
              numberOfLines={i === 0 ? undefined : 1}
              adjustsFontSizeToFit={i !== 0}
              minimumFontScale={0.6}
            >
              {cell}
            </Text>
          ) : (
            cell
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 12, marginTop: 16 },
  title: { fontSize: 16, fontWeight: "700", marginBottom: 8, paddingHorizontal: 4 },
  note: { fontSize: 13, marginTop: 8, paddingHorizontal: 4 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 4 },
  labelCell: { flex: 2, paddingRight: 8 },
  valueCell: { flex: 1, alignItems: "flex-end" },
  labelText: { fontSize: 14 },
  valueText: { fontSize: 14, fontVariant: ["tabular-nums"], textAlign: "right" },
  strong: { fontWeight: "700" },
  headText: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
});

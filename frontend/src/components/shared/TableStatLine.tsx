/**
 * TableStatLine (#3606) — the one centred stat line under a card game's header:
 * "MOVES 12 · SCORE 45 · TIME 2:14". Shared by Solitaire and FreeCell (#3607).
 *
 * Labels are small Manrope caps in the muted colour; values are Space Grotesk in
 * the text colour. Each item is its own accessible element (`accessibilityLabel`),
 * and a value that ticks on its own (the clock) is passed as `renderValue`.
 */

import React from "react";
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from "react-native";

import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

/**
 * Height of the line at the default font size, in dp. A larger font scale wraps
 * or grows it, so a screen measures the real height (`onLayout`) and uses this
 * only until it has.
 */
export const TABLE_STAT_LINE_HEIGHT = 28;

export interface TableStat {
  readonly key: string;
  /** The label, e.g. "Moves"; drawn in capitals. */
  readonly label: string;
  /** The value as text. */
  readonly value?: string;
  /** A value that updates on its own, given the value's text style. */
  readonly renderValue?: (style: StyleProp<TextStyle>) => React.ReactNode;
  /** Screen-reader label for the whole item ("Moves: 12"). */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

export interface TableStatLineProps {
  readonly stats: readonly TableStat[];
  readonly testID?: string;
  readonly onLayout?: (event: LayoutChangeEvent) => void;
}

export function TableStatLine({ stats, testID, onLayout }: TableStatLineProps) {
  const { colors } = useTheme();
  const valueStyle: StyleProp<TextStyle> = [styles.value, { color: colors.text }];

  return (
    <View style={styles.row} testID={testID} onLayout={onLayout}>
      {stats.map((s) => (
        <View
          key={s.key}
          style={styles.item}
          accessible={s.accessibilityLabel !== undefined}
          accessibilityLabel={s.accessibilityLabel}
          testID={s.testID}
        >
          <Text style={[styles.label, { color: colors.textMuted }]} importantForAccessibility="no">
            {s.label}
          </Text>
          {s.renderValue ? (
            s.renderValue(valueStyle)
          ) : (
            <Text style={valueStyle} importantForAccessibility="no">
              {s.value}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: TABLE_STAT_LINE_HEIGHT,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 20,
    rowGap: 2,
  },
  item: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  label: {
    fontFamily: typography.label,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  value: {
    fontFamily: typography.heading,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
  },
});

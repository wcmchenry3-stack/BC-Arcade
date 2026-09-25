import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

export interface HudStat {
  /** Stable React key. */
  key: string;
  text: string;
  /** Render in `textMuted` instead of `text`. */
  muted?: boolean;
  /** Bold weight, for a title-like first item. */
  bold?: boolean;
  /** Screen-reader label. Defaults to `text`. */
  accessibilityLabel?: string;
  testID?: string;
}

export interface HudStatRowProps {
  stats: readonly HudStat[];
  /** `md` = 14pt (default), `lg` = 16pt. */
  size?: "md" | "lg";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The in-game stat strip under the header (difficulty, moves, score, time).
 * Announced to screen readers as one summary region. Replaces the per-screen
 * `hudRow` / `hudText` styles (#2600).
 */
export function HudStatRow({ stats, size = "md", style, testID }: HudStatRowProps) {
  const { colors } = useTheme();
  const fontSize = size === "lg" ? 16 : 14;

  return (
    <View style={[styles.row, style]} accessibilityRole="summary" testID={testID}>
      {stats.map((s) => (
        <Text
          key={s.key}
          style={[
            styles.text,
            { fontSize, color: s.muted ? colors.textMuted : colors.text },
            s.bold && styles.bold,
          ]}
          accessibilityLabel={s.accessibilityLabel ?? s.text}
          testID={s.testID}
        >
          {s.text}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  text: {
    fontFamily: typography.heading,
    letterSpacing: 0.5,
  },
  bold: {
    fontWeight: "700",
  },
});

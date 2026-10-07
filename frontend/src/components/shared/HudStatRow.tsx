import React from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

interface HudStatBase {
  /** Stable React key. */
  key: string;
}

/** A text stat the row renders itself. */
export interface HudTextStat extends HudStatBase {
  text: string;
  /** Render in `textMuted` instead of `text`. */
  muted?: boolean;
  /** Bold weight, for a title-like first item. */
  bold?: boolean;
  /** Screen-reader label. Defaults to `text`. */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * A stat that renders itself, given the row's text style, for one that updates
 * on its own (a self-ticking clock, #2964).
 */
export interface HudCustomStat extends HudStatBase {
  render: (textStyle: StyleProp<TextStyle>) => React.ReactNode;
  /** Render in `textMuted` instead of `text`. */
  muted?: boolean;
}

export type HudStat = HudTextStat | HudCustomStat;

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
      {stats.map((s) => {
        const textStyle = [
          styles.text,
          { fontSize, color: s.muted ? colors.textMuted : colors.text },
          "bold" in s && s.bold && styles.bold,
        ];
        if ("render" in s)
          return <React.Fragment key={s.key}>{s.render(textStyle)}</React.Fragment>;
        return (
          <Text
            key={s.key}
            style={textStyle}
            accessibilityLabel={s.accessibilityLabel ?? s.text}
            testID={s.testID}
          >
            {s.text}
          </Text>
        );
      })}
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

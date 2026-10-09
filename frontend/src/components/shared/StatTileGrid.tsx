import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

export interface StatTile {
  key: string;
  label: string;
  value: string;
}

export interface StatTileGridProps {
  tiles: readonly StatTile[];
  /** Each tile's testID is `${testIDPrefix}-${tile.key}`. */
  testIDPrefix: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A two-column wrap of stat tiles (uppercase label over a large value), each
 * announced as "label: value" (#2981). Shared by the Profile bento and the
 * per-game stats screen.
 */
export function StatTileGrid({ tiles, testIDPrefix, style }: StatTileGridProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.grid, style]}>
      {tiles.map((tile) => (
        <View
          key={tile.key}
          testID={`${testIDPrefix}-${tile.key}`}
          accessible
          accessibilityLabel={`${tile.label}: ${tile.value}`}
          style={[styles.tile, { backgroundColor: colors.surfaceAlt }]}
        >
          <Text style={[styles.label, { color: colors.textMuted }]}>{tile.label}</Text>
          <Text
            style={[styles.value, { color: colors.text }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {tile.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: {
    flexGrow: 1,
    flexBasis: "45%",
    minHeight: 84,
    padding: 14,
    borderRadius: 16,
  },
  label: {
    fontFamily: typography.label,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  value: { fontFamily: typography.heading, fontSize: 22 },
});

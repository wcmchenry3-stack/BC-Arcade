import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { heartsStandings } from "../../game/hearts/result";

interface Props {
  readonly playerLabels: readonly string[];
  readonly cumulativeScores: readonly number[];
  /** The human seat, highlighted. */
  readonly humanIndex?: number;
}

/** Ranked final scores for the Hearts result card (#2506) — lowest first. */
export default function HeartsFinalStandings({
  playerLabels,
  cumulativeScores,
  humanIndex = 0,
}: Props) {
  const { t } = useTranslation("result");
  const { colors } = useTheme();

  return (
    <View
      style={styles.table}
      accessibilityRole="list"
      accessibilityLabel={t("standings.label")}
      testID="hearts-final-standings"
    >
      {heartsStandings(cumulativeScores).map(({ seat, score, rank }) => {
        const isHuman = seat === humanIndex;
        const name = playerLabels[seat] ?? "";
        return (
          <View
            key={seat}
            testID={`hearts-standing-${seat}`}
            style={[
              styles.row,
              { borderColor: colors.border },
              isHuman && { backgroundColor: colors.surfaceAlt, borderColor: colors.accent },
            ]}
            accessible
            accessibilityLabel={t("standings.row", { rank, name, score })}
          >
            <Text style={[styles.rank, { color: colors.textMuted }]}>{rank}</Text>
            <Text
              style={[styles.name, { color: colors.text }, isHuman && styles.emphasis]}
              numberOfLines={1}
            >
              {name}
            </Text>
            <Text style={[styles.score, { color: colors.text }, isHuman && styles.emphasis]}>
              {score}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  table: {
    alignSelf: "stretch",
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  rank: {
    width: 24,
    fontFamily: typography.heading,
    fontSize: 14,
  },
  name: {
    flex: 1,
    fontSize: 15,
  },
  score: {
    fontFamily: typography.heading,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  emphasis: {
    fontWeight: "800",
  },
});

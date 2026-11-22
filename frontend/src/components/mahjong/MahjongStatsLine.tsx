/**
 * Mahjong's stat line under the header (#3614): the play clock that ranks (#2747), the pairs
 * removed and the matches available now (MOVES). The clock stands in for the in-play score
 * (10 per pair, which PAIRS already shows); the score stays on the result card. In dev builds
 * a long press on the clock toggles the dev panel.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { PlayClockText } from "../shared/PlayClockText";
import { MAHJONG_STATS_ROW_H } from "../../game/mahjong/layout";

export interface MahjongStatsLineProps {
  readonly startedAt: number | null;
  readonly accumulatedMs: number;
  readonly pairsRemoved: number;
  readonly totalPairs: number;
  /** Matches available now. */
  readonly moves: number;
  /** The clock's screen-reader label; keep it stable so only the clock's own tick re-renders. */
  readonly clockA11yLabel: (time: string) => string;
  /** Dev builds: a long press on the clock toggles the dev panel. */
  readonly onClockLongPress?: () => void;
}

export default function MahjongStatsLine({
  startedAt,
  accumulatedMs,
  pairsRemoved,
  totalPairs,
  moves,
  clockA11yLabel,
  onClockLongPress,
}: MahjongStatsLineProps) {
  const { t } = useTranslation("mahjong");
  const { colors } = useTheme();
  const clock = (
    <PlayClockText
      startedAt={startedAt}
      accumulatedMs={accumulatedMs}
      label={t("hud.time")}
      accessibilityLabel={clockA11yLabel}
      style={[styles.text, { color: colors.text }]}
      testID="mahjong-clock"
    />
  );
  return (
    <View style={styles.row} accessibilityRole="summary" testID="mahjong-stats">
      {onClockLongPress ? (
        <Pressable onLongPress={onClockLongPress} accessibilityRole="none">
          {clock}
        </Pressable>
      ) : (
        clock
      )}
      <Text style={[styles.text, { color: colors.textMuted }]} testID="mahjong-pairs">
        {t("hud.pairs")}{" "}
        <Text style={{ color: colors.text }}>
          {pairsRemoved}/{totalPairs}
        </Text>
      </Text>
      <Text
        style={[styles.text, { color: colors.textMuted }]}
        accessibilityLabel={t("hud.movesLabel", { count: moves })}
        testID="mahjong-moves"
      >
        {t("hud.moves")} <Text style={{ color: colors.text }}>{moves}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 20,
    height: MAHJONG_STATS_ROW_H,
  },
  text: {
    fontFamily: typography.heading,
    fontSize: 14,
    letterSpacing: 0.5,
  },
});

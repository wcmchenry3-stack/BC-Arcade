import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { Twenty48State } from "../../game/twenty48/types";

interface Props {
  state: Twenty48State;
}

export function formatTime(ms: number): string {
  // Never a negative time: "-1:-2" read badly for a moment after a move (#3735).
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function highestTile(board: number[][]): number {
  return Math.max(0, ...board.flat());
}

export default function StatsBento({ state }: Props) {
  const { t } = useTranslation("twenty48");
  const { colors } = useTheme();

  // Tick every second while game is active to keep elapsed time current.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (state.game_over || state.startedAt === null) return;
    // Catch up at once: `now` may predate this running segment (#3735, as PlayClockText does).
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.game_over, state.startedAt]);

  // `now` is from the last tick, so it can be older than a clock that just started (the first
  // move, or coming back to the screen): count that gap as no time, not as negative time (#3735).
  const running = state.startedAt !== null ? Math.max(0, now - state.startedAt) : 0;
  const elapsedMs = state.accumulatedMs + running;

  const maxTile = highestTile(state.board);

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surfaceAlt, borderTopColor: colors.tertiary },
        ]}
      >
        <Text numberOfLines={2} style={[styles.label, { color: colors.textMuted }]}>
          {t("stats.highestTile")}
        </Text>
        <Text
          style={[styles.value, { color: colors.tertiaryText, fontFamily: typography.heading }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          accessibilityLabel={t("a11y.highestTile", { value: maxTile > 0 ? maxTile : 0 })}
        >
          {maxTile > 0 ? maxTile : "—"}
        </Text>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: colors.surfaceAlt, borderTopColor: colors.secondary },
        ]}
      >
        <Text numberOfLines={2} style={[styles.label, { color: colors.textMuted }]}>
          {t("stats.timePlayed")}
        </Text>
        <Text
          style={[styles.value, { color: colors.secondaryText, fontFamily: typography.heading }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          accessibilityLabel={t("a11y.timePlayed", { time: formatTime(elapsedMs) })}
        >
          {formatTime(elapsedMs)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // One slim row beside the score cards (#3688).
  row: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
  },
  card: {
    flex: 1,
    minWidth: 0,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 6,
    alignItems: "center",
    borderTopWidth: 2,
  },
  // Up to two lines, so a longer label (es "Ficha Más Alta", fr-CA) wraps rather than being
  // cut off in the slim row; every label reserves both lines, so the four boxes stay aligned.
  label: {
    fontSize: 9,
    lineHeight: 11,
    minHeight: 22,
    fontWeight: "800",
    letterSpacing: 0.3,
    textAlign: "center",
    textAlignVertical: "center",
    textTransform: "uppercase",
  },
  value: {
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
});

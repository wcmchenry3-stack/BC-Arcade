import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "../theme/ThemeContext";
import { AppHeader, APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { starSwarmApi } from "../game/starswarm/api";
import type { LeaderboardEntry } from "../game/starswarm/api";
import { withRetry } from "../game/_shared/withRetry";
import { formatDate } from "../utils/formatTimestamp";

export default function LeaderboardScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation("starswarm");

  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await withRetry(() => starSwarmApi.getLeaderboard());
      setEntries(data.scores);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [load]);

  const renderItem = useCallback(
    ({ item }: { item: LeaderboardEntry }) => (
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <Text style={[styles.colRank, { color: colors.textMuted }]}>{item.rank}</Text>
        <Text style={[styles.colScore, { color: colors.text }]} numberOfLines={1}>
          {item.score.toLocaleString()}
        </Text>
        <Text style={[styles.colWave, { color: colors.text }]}>{item.wave_reached}</Text>
        <Text style={[styles.colDifficulty, { color: colors.accent }]} numberOfLines={1}>
          {item.difficulty_tier}
        </Text>
        <Text style={[styles.colDate, { color: colors.textMuted }]}>
          {formatDate(item.timestamp)}
        </Text>
      </View>
    ),
    [colors]
  );

  const header = (
    <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.colRank, styles.headerCell, { color: colors.textMuted }]}>
        {t("leaderboard.colRank")}
      </Text>
      <Text style={[styles.colScore, styles.headerCell, { color: colors.textMuted }]}>
        {t("leaderboard.colScore")}
      </Text>
      <Text style={[styles.colWave, styles.headerCell, { color: colors.textMuted }]}>
        {t("leaderboard.colWave")}
      </Text>
      <Text style={[styles.colDifficulty, styles.headerCell, { color: colors.textMuted }]}>
        {t("leaderboard.colDifficulty")}
      </Text>
      <Text style={[styles.colDate, styles.headerCell, { color: colors.textMuted }]}>
        {t("leaderboard.colDate")}
      </Text>
    </View>
  );

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" accessibilityLabel="Loading" />
      </View>
    );
  } else if (error) {
    body = (
      <View style={styles.center}>
        <Text style={[styles.errorText, { color: colors.error }]}>{t("leaderboard.error")}</Text>
        <Pressable
          onPress={() => {
            setLoading(true);
            load().finally(() => setLoading(false));
          }}
          style={[styles.retryBtn, { borderColor: colors.accent }]}
          accessibilityRole="button"
        >
          <Text style={[styles.retryText, { color: colors.accent }]}>{t("leaderboard.retry")}</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={entries ?? []}
        keyExtractor={(e) => String(e.rank)}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textMuted }]}>{t("leaderboard.empty")}</Text>
        }
        contentContainerStyle={styles.listContent}
      />
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: APP_HEADER_HEIGHT + insets.top,
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
    >
      <AppHeader title={t("leaderboard.title")} />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 14, marginBottom: 12, textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },
  retryText: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  listContent: { paddingBottom: 32 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCell: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colRank: { width: 28, fontSize: 12, textAlign: "center" },
  colScore: { flex: 2, fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "700" },
  colWave: { width: 40, fontSize: 13, textAlign: "center" },
  colDifficulty: { flex: 1, fontSize: 11, fontWeight: "600" },
  colDate: { width: 72, fontSize: 11, textAlign: "right" },
  empty: { fontSize: 14, textAlign: "center", paddingVertical: 48, paddingHorizontal: 24 },
});

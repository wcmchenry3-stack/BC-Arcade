import React, { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../components/shared/EmptyState";
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
    body = <EmptyState kind="loading" />;
  } else if (error) {
    body = (
      <EmptyState
        kind="error"
        message={t("leaderboard.error")}
        retry={{
          label: t("leaderboard.retry"),
          onPress: () => {
            setLoading(true);
            load().finally(() => setLoading(false));
          },
        }}
      />
    );
  } else {
    body = (
      <FlatList
        data={entries ?? []}
        keyExtractor={(e) => String(e.rank)}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState kind="empty" layout="inline" message={t("leaderboard.empty")} />
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
});

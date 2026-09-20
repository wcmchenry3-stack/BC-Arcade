import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme/ThemeContext";
import { AppHeader, APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { statsApi } from "../api/stats";
import type { StatsResponse, GameRow } from "../api/types";
import type { ProfileStackParamList } from "../types/navigation";
import { formatDate } from "../utils/formatTimestamp";
import { withRetry } from "../game/_shared/withRetry";
import OfflineBanner from "../components/OfflineBanner";
import { isGameVisible } from "../entitlements/gameVisibility";
import { GAME_TITLE_NAMESPACES, gameTitle } from "../i18n/gameTitle";

type ProfileNav = NativeStackNavigationProp<ProfileStackParamList, "ProfileHome">;

interface StatsCardData {
  label: string;
  value: string;
  sublabel?: string;
}

/**
 * Derives the 2×2 bento tiles from the /stats/me response.
 *
 * Only games that exist in this build count (#2390): a store build hides the
 * premium games entirely, so a tester's earlier Yacht or Star Swarm plays must
 * not resurface here as a favourite, a top score, or in the totals. The
 * server's `total_games` / `favorite_game` aggregate over every game, so both
 * are re-derived from the visible `by_game` entries.
 */
function deriveBentoTiles(stats: StatsResponse, t: TFunction): StatsCardData[] {
  const visible = Object.entries(stats.by_game).filter(([game]) => isGameVisible(game));
  const totalGames = visible.reduce((sum, [, s]) => sum + s.played, 0);
  const typesTried = visible.filter(([, s]) => s.played > 0).length;

  let favoriteGame: string | null =
    stats.favorite_game && isGameVisible(stats.favorite_game) ? stats.favorite_game : null;
  if (!favoriteGame) {
    let mostPlayed = 0;
    for (const [game, s] of visible) {
      if (s.played > mostPlayed) {
        mostPlayed = s.played;
        favoriteGame = game;
      }
    }
  }

  // Best single score across all completed games (ignores blackjack's null
  // `best` since it uses best_chips — fall back to best_chips when present).
  let topScore: number | null = null;
  let topScoreGame: string | null = null;
  for (const [game, s] of visible) {
    const candidate = s.best ?? s.best_chips ?? null;
    if (candidate != null && (topScore == null || candidate > topScore)) {
      topScore = candidate;
      topScoreGame = game;
    }
  }

  return [
    {
      label: t("stats.totalGames"),
      value: totalGames.toLocaleString(),
    },
    {
      label: t("stats.favorite"),
      value: favoriteGame ? gameTitle(t, favoriteGame) : t("stats.favoriteEmpty"),
    },
    {
      label: t("stats.topScore"),
      value: topScore != null ? topScore.toLocaleString() : t("stats.topScoreEmpty"),
      sublabel: topScoreGame ? gameTitle(t, topScoreGame) : undefined,
    },
    {
      label: t("stats.gamesTried"),
      value: String(typesTried),
    },
  ];
}

function outcomeGlyph(outcome: string | null): string {
  switch (outcome) {
    case "completed":
      return "✓";
    case "kept_playing":
      return "▸";
    case "abandoned":
      return "·";
    default:
      return "";
  }
}

export default function ProfileScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(["profile", ...GAME_TITLE_NAMESPACES]);
  const navigation = useNavigation<ProfileNav>();

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [games, setGames] = useState<GameRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gamesError, setGamesError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setGamesError(false);
    const [statsResult, gamesResult] = await Promise.allSettled([
      withRetry(() => statsApi.getMyStats()),
      withRetry(() => statsApi.getMyGames(20)),
    ]);
    if (statsResult.status === "fulfilled") setStats(statsResult.value);
    if (gamesResult.status === "fulfilled") {
      setGames(gamesResult.value.items);
    } else {
      setGamesError(true);
    }
    if (statsResult.status === "rejected" && gamesResult.status === "rejected") {
      const err = statsResult.reason;
      setError(err instanceof Error ? err.message : String(err));
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Rows for games hidden in this build would link to a game that does not exist here.
  const visibleGames = useMemo(
    () => (games ?? []).filter((g) => isGameVisible(g.game_type)),
    [games]
  );

  const bentoTiles = useMemo(() => (stats ? deriveBentoTiles(stats, t) : null), [stats, t]);

  const renderItem = useCallback(
    ({ item }: { item: GameRow }) => (
      <Pressable
        onPress={() => navigation.navigate("GameDetail", { gameId: item.id })}
        style={[styles.row, { borderBottomColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel={`${gameTitle(t, item.game_type)} ${item.final_score ?? ""}`}
      >
        <Text style={[styles.rowDate, { color: colors.textMuted }]}>
          {formatDate(item.completed_at ?? item.started_at)}
        </Text>
        <Text style={[styles.rowGame, { color: colors.text }]}>{gameTitle(t, item.game_type)}</Text>
        <Text style={[styles.rowScore, { color: colors.text }]}>
          {item.final_score != null ? item.final_score.toLocaleString() : "—"}
        </Text>
        <Text style={[styles.rowOutcome, { color: colors.accent }]}>
          {outcomeGlyph(item.outcome)}
        </Text>
      </Pressable>
    ),
    [colors, navigation, t]
  );

  const listHeader = (
    <View>
      {bentoTiles && (
        <View style={styles.bento}>
          {bentoTiles.map((tile, idx) => (
            <View key={idx} style={[styles.bentoCard, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={[styles.bentoLabel, { color: colors.textMuted }]}>{tile.label}</Text>
              <Text style={[styles.bentoValue, { color: colors.text }]}>{tile.value}</Text>
              {tile.sublabel && (
                <Text style={[styles.bentoSublabel, { color: colors.textMuted }]}>
                  {tile.sublabel}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t("recentGames.title")}</Text>
      {gamesError && (
        <Text style={[styles.sectionErrorText, { color: colors.error }]}>
          {t("recentGames.loadError")}
        </Text>
      )}
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
        <Text style={[styles.errorText, { color: colors.error }]}>
          {t("recentGames.loadError")}
        </Text>
        <Pressable
          onPress={() => {
            setLoading(true);
            load().finally(() => setLoading(false));
          }}
          style={[styles.retryBtn, { borderColor: colors.accent }]}
          accessibilityRole="button"
        >
          <Text style={[styles.retryText, { color: colors.accent }]}>{t("recentGames.retry")}</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={visibleGames}
        keyExtractor={(g) => g.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          !gamesError ? (
            <Text style={[styles.empty, { color: colors.textMuted }]}>
              {t("recentGames.empty")}
            </Text>
          ) : null
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
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
      <AppHeader title={t("title")} />
      <OfflineBanner />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 14, marginBottom: 12, textAlign: "center" },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  retryText: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  bento: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
    gap: 12,
  },
  bentoCard: {
    flexGrow: 1,
    flexBasis: "45%",
    minHeight: 92,
    padding: 14,
    borderRadius: 16,
  },
  bentoLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  bentoValue: { fontSize: 24, fontWeight: "800" },
  bentoSublabel: { fontSize: 11, marginTop: 2 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  listContent: { paddingBottom: 32 },
  sectionErrorText: {
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowDate: { fontSize: 12, width: 88 },
  rowGame: { fontSize: 14, flex: 1, fontWeight: "600" },
  rowScore: { fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "700" },
  rowOutcome: { fontSize: 16, width: 20, textAlign: "right" },
  empty: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
});

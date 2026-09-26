import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { formatMetric } from "../api/outcomeDisplay";
import {
  completedOf,
  formatPercent,
  formatPlayTime,
  sessionsOf,
  winRateOf,
} from "../api/statsDisplay";
import type { GameTypeStats } from "../api/types";
import type { GameType } from "../api/vocab";
import { AppHeader, APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { EmptyState } from "../components/shared/EmptyState";
import { ConnectedOfflineBanner } from "../components/shared/OfflineBanner";
import { isGameVisible } from "../entitlements/gameVisibility";
import { useLeaderboardLink } from "../hooks/useLeaderboardLink";
import { useMyStats } from "../hooks/useMyStats";
import { gameTitle } from "../i18n/gameTitle";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import type { GameStatsParams, HomeStackParamList } from "../types/navigation";
import { formatDate } from "../utils/formatTimestamp";

export interface GameStatsScreenProps {
  route: { params: GameStatsParams };
  navigation: Pick<NativeStackNavigationProp<HomeStackParamList>, "navigate" | "goBack">;
}

interface Tile {
  key: string;
  label: string;
  value: string;
}

const count = (n: number | null | undefined): string => (n == null ? "—" : n.toLocaleString());

/**
 * The tiles for one game's stats, in reading order. Win figures show "—" for
 * a game with no win concept (the server sends them null); the streaks are
 * left out for such a game. Fields a server older than #2620 omits show "—".
 */
export function statsTiles(t: TFunction, s: GameTypeStats): Tile[] {
  const rate = winRateOf(s);
  const tiles: Tile[] = [
    { key: "sessions", label: t("stats:tile.sessions"), value: count(sessionsOf(s)) },
    { key: "completed", label: t("stats:tile.completed"), value: count(completedOf(s)) },
    { key: "wins", label: t("stats:tile.wins"), value: count(s.won) },
    { key: "losses", label: t("stats:tile.losses"), value: count(s.lost) },
    { key: "ties", label: t("stats:tile.ties"), value: count(s.tied) },
    {
      key: "winRate",
      label: t("stats:tile.winRate"),
      value: rate == null ? "—" : formatPercent(t, rate),
    },
  ];
  if (s.current_win_streak != null) {
    tiles.push({
      key: "currentStreak",
      label: t("stats:tile.currentStreak"),
      value: count(s.current_win_streak),
    });
  }
  if (s.best_win_streak != null) {
    tiles.push({
      key: "bestStreak",
      label: t("stats:tile.bestStreak"),
      value: count(s.best_win_streak),
    });
  }
  tiles.push(
    {
      key: "best",
      label: t("stats:tile.best"),
      value: formatMetric(t, s.best_label_key, s.best_value),
    },
    {
      key: "timePlayed",
      label: t("stats:tile.timePlayed"),
      value: s.time_played_ms == null ? "—" : formatPlayTime(t, s.time_played_ms),
    },
    {
      key: "lastPlayed",
      label: t("stats:tile.lastPlayed"),
      value: formatDate(s.last_played_at) || "—",
    }
  );
  return tiles;
}

/**
 * One game's stats (#2635), from the server (`/stats/me` `by_game[gameType]`):
 * sessions and completed, wins/losses/ties and win rate, win streaks, the
 * best with its label, time played and last played, and links to the game's
 * leaderboard (when it has an openable board) and, for Blackjack, its
 * on-device run history. Opened from every game's ⋯ menu ("Stats").
 *
 * Offline or on a failed request it shows the last response loaded in this
 * app session, else a translated message.
 */
export default function GameStatsScreen({ route, navigation }: GameStatsScreenProps) {
  const { gameType } = route.params;
  // Its own strings, the Profile's formatters (metric, time, percent) and the
  // game's title.
  const { t } = useTranslation(["stats", "profile", gameType]);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { status, stats, stale, refreshing, retry, refresh } = useMyStats();
  const openLeaderboard = useLeaderboardLink(navigation, gameType);
  const openRunHistory = hasRunHistory(gameType)
    ? () => navigation.navigate("BlackjackStats")
    : undefined;

  const game = gameTitle(t, gameType);

  let body: React.ReactNode;
  if (status === "loading") {
    body = <EmptyState kind="loading" />;
  } else if (status === "offline" || status === "error") {
    body = (
      <EmptyState
        kind="error"
        testID="game-stats-error"
        message={t(status === "offline" ? "stats:offline" : "stats:error")}
        retry={status === "error" ? { label: t("stats:retry"), onPress: retry } : undefined}
      />
    );
  } else {
    const gameStats = stats?.by_game[gameType];
    const tiles = gameStats ? statsTiles(t, gameStats) : null;
    body = (
      <ScrollView
        testID="game-stats-scroll"
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
        }
      >
        {stale && (
          <Text
            testID="game-stats-stale"
            accessibilityLiveRegion="polite"
            style={[styles.note, { color: colors.textMuted }]}
          >
            {t("stats:stale")}
          </Text>
        )}
        {tiles ? (
          <View style={styles.grid}>
            {tiles.map((tile) => (
              <View
                key={tile.key}
                testID={`game-stats-tile-${tile.key}`}
                accessible
                accessibilityLabel={`${tile.label}: ${tile.value}`}
                style={[styles.tile, { backgroundColor: colors.surfaceAlt }]}
              >
                <Text style={[styles.tileLabel, { color: colors.textMuted }]}>{tile.label}</Text>
                <Text
                  style={[styles.tileValue, { color: colors.text }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {tile.value}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            kind="empty"
            layout="inline"
            testID="game-stats-empty"
            message={t("stats:empty")}
          />
        )}
        {openLeaderboard && (
          <StatsLink
            label={t("stats:link.leaderboard")}
            icon="emoji-events"
            testID="game-stats-leaderboard"
            onPress={() => openLeaderboard()}
          />
        )}
        {openRunHistory && (
          <StatsLink
            label={t("stats:link.runHistory")}
            icon="history"
            testID="game-stats-run-history"
            onPress={openRunHistory}
          />
        )}
      </ScrollView>
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
      <AppHeader
        title={t("stats:title", { game })}
        requireBack
        onBack={() => navigation.goBack()}
        backAccessibilityLabel={t("stats:a11y.back", { game })}
      />
      <ConnectedOfflineBanner style={styles.offlineBanner} />
      {body}
    </View>
  );
}

/**
 * Blackjack keeps per-run details on the device only (#2628): its stats link
 * to that history. The route exists only where Blackjack does (#2390).
 */
function hasRunHistory(gameType: GameType): boolean {
  return gameType === "blackjack" && isGameVisible(gameType);
}

function StatsLink({
  label,
  icon,
  testID,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  testID: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [
        styles.link,
        { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <MaterialIcons name={icon} size={18} color={colors.accent} />
      <Text style={[styles.linkText, { color: colors.text }]}>{label}</Text>
      <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  offlineBanner: { marginHorizontal: 16, marginTop: 12 },
  scroll: { padding: 12, paddingBottom: 32, gap: 12 },
  note: {
    fontFamily: typography.body,
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 4,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: {
    flexGrow: 1,
    flexBasis: "45%",
    minHeight: 84,
    padding: 14,
    borderRadius: 16,
  },
  tileLabel: {
    fontFamily: typography.label,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  tileValue: { fontFamily: typography.heading, fontSize: 22 },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  linkText: { flex: 1, fontFamily: typography.bodyMedium, fontSize: 15 },
});

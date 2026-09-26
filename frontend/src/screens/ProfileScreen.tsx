import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { EmptyState } from "../components/shared/EmptyState";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import { AppHeader, APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { ConfirmModal } from "../components/shared/ConfirmModal";
import { statsApi } from "../api/stats";
import { fetchAndRememberMyStats } from "../hooks/useMyStats";
import type { StatsResponse, GameRow, GameTypeStats } from "../api/types";
import { formatMetric, gameMetric, knownOutcome, outcomeLabel } from "../api/outcomeDisplay";
import {
  completedOf,
  formatNumber,
  formatPercent,
  formatPlayTime,
  sessionsOf,
  winRateOf,
} from "../api/statsDisplay";
import type { ProfileStackParamList } from "../types/navigation";
import { formatDate } from "../utils/formatTimestamp";
import { withRetry } from "../game/_shared/withRetry";
import { useDisplayName } from "../game/_shared/displayName";
import { removeDisplayName, useDisplayNameRemovalPending } from "../game/_shared/displayNameSync";
import { useNetwork } from "../game/_shared/NetworkContext";
import { playersApi } from "../api/players";
import { ConnectedOfflineBanner } from "../components/shared/OfflineBanner";
import LevelProgress from "../components/shared/LevelProgress";
import DisplayNameField from "../components/shared/DisplayNameField";
import { isGameVisible } from "../entitlements/gameVisibility";
import { GAME_TITLE_NAMESPACES, gameTitle } from "../i18n/gameTitle";

type ProfileNav = NativeStackNavigationProp<ProfileStackParamList, "ProfileHome">;

interface StatsCardData {
  key: string;
  label: string;
  value: string;
}

interface GameSummaryRow {
  game: string;
  title: string;
  /** Games completed; null from a server that predates #2620. */
  completed: number | null;
  /** The best with its label ("412 pts"); null before any qualifying game. */
  best: string | null;
  /** won / (won + lost + tied); null when the game has no win concept. */
  winRate: number | null;
}

/** The games in `/stats/me` that exist in this build (#2390). */
function visibleStats(stats: StatsResponse): [string, GameTypeStats][] {
  return Object.entries(stats.by_game).filter(([game]) => isGameVisible(game));
}

/**
 * One row per visible game played: its own best in its own terms, and its
 * win rate. Ordered by games completed, then sessions, then slug; the first
 * row is the favourite.
 */
function deriveGameSummaries(stats: StatsResponse, t: TFunction): GameSummaryRow[] {
  return visibleStats(stats)
    .filter(([, s]) => sessionsOf(s) > 0)
    .sort(
      ([a, sa], [b, sb]) =>
        (completedOf(sb) ?? 0) - (completedOf(sa) ?? 0) ||
        sessionsOf(sb) - sessionsOf(sa) ||
        a.localeCompare(b)
    )
    .map(([game, s]) => ({
      game,
      title: gameTitle(t, game),
      completed: completedOf(s),
      best: s.best_value != null ? formatMetric(t, s.best_label_key, s.best_value) : null,
      winRate: winRateOf(s),
    }));
}

/**
 * The top tiles (#2637): only figures that mean the same thing for every
 * game, so no score is ever compared with another game's. All of them are
 * re-derived from the visible games (#2390): a store build hides the premium
 * games entirely, so a tester's earlier Yacht or Star Swarm plays must not
 * resurface here. That is also why the favourite is picked here, by games
 * completed, rather than taken from the server (which picks by sessions over
 * every game).
 */
function deriveBentoTiles(
  stats: StatsResponse,
  summaries: GameSummaryRow[],
  t: TFunction
): StatsCardData[] {
  const visible = visibleStats(stats);
  const sessions = visible.reduce((sum, [, s]) => sum + sessionsOf(s), 0);
  const hasCompleted = visible.every(([, s]) => completedOf(s) != null);
  const completed = visible.reduce((sum, [, s]) => sum + (completedOf(s) ?? 0), 0);
  const timePlayedMs = visible.reduce((sum, [, s]) => sum + (s.time_played_ms ?? 0), 0);
  const favorite = summaries[0];

  let favoriteValue: string;
  if (!hasCompleted) favoriteValue = "—";
  else if (favorite && (favorite.completed ?? 0) > 0) favoriteValue = favorite.title;
  else favoriteValue = t("stats.favoriteEmpty");

  return [
    { key: "sessions", label: t("stats.sessions"), value: formatNumber(t, sessions) },
    {
      key: "completed",
      label: t("stats.completed"),
      value: hasCompleted ? formatNumber(t, completed) : "—",
    },
    {
      key: "completionRate",
      label: t("stats.completionRate"),
      value: hasCompleted && sessions > 0 ? formatPercent(t, completed / sessions) : "—",
    },
    { key: "timePlayed", label: t("stats.timePlayed"), value: formatPlayTime(t, timePlayedMs) },
    { key: "gamesTried", label: t("stats.gamesTried"), value: formatNumber(t, summaries.length) },
    { key: "favorite", label: t("stats.favorite"), value: favoriteValue },
  ];
}

/**
 * Under the name editor: says whether the player is on the leaderboards, and
 * lets them take their name off every board (#2637). The editor above sets a
 * name again.
 *
 * States, in order: a removal still waiting to reach the server; a name on
 * this device; no name here but one on the server (fetched when online, e.g.
 * a device that lost its copy); no name anywhere.
 */
function LeaderboardPresence() {
  const { colors } = useTheme();
  const { t } = useTranslation("profile");
  const { isOnline } = useNetwork();
  const { name, isLoaded } = useDisplayName();
  const removalPending = useDisplayNameRemovalPending();
  const [serverName, setServerName] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [removeError, setRemoveError] = useState(false);

  const checkServer = isLoaded && name == null && !removalPending && isOnline;
  useEffect(() => {
    if (!checkServer) {
      setServerName(null);
      return;
    }
    let active = true;
    playersApi
      .getMe()
      .then((me) => {
        if (active) setServerName(me.display_name);
      })
      .catch(() => {
        // Unknown: show the device's state (no name) rather than an error.
        if (active) setServerName(null);
      });
    return () => {
      active = false;
    };
  }, [checkServer]);

  const handleRemove = useCallback(async () => {
    setConfirmVisible(false);
    setRemoveError(!(await removeDisplayName()));
  }, []);

  if (!isLoaded) return null;

  const shownName = name ?? serverName;
  let status: React.ReactNode;
  if (removalPending) {
    status = (
      <Text
        accessibilityLiveRegion="polite"
        testID="profile-name-removing"
        style={[styles.presenceText, { color: colors.textMuted }]}
      >
        {t("boards.removing")}
      </Text>
    );
  } else if (shownName != null) {
    status = (
      <>
        {name == null && (
          <Text
            testID="profile-server-name"
            style={[styles.presenceText, { color: colors.textMuted }]}
          >
            {t("boards.onBoardsAs", { name: shownName })}
          </Text>
        )}
        <Pressable
          onPress={() => {
            setRemoveError(false);
            setConfirmVisible(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={t("boards.removeName")}
          testID="profile-remove-name"
          hitSlop={4}
          style={({ pressed }) => [styles.removeButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <MaterialCommunityIcons name="account-remove-outline" size={18} color={colors.text} />
          <Text style={[styles.removeText, { color: colors.text }]}>{t("boards.removeName")}</Text>
        </Pressable>
      </>
    );
  } else {
    status = (
      <Text
        accessibilityLiveRegion="polite"
        testID="profile-not-on-boards"
        style={[styles.presenceText, { color: colors.textMuted }]}
      >
        {t("boards.notOnBoards")}
      </Text>
    );
  }

  return (
    <View style={styles.presence}>
      {status}
      {removeError && (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[styles.presenceText, { color: colors.error }]}
        >
          {t("boards.removeError")}
        </Text>
      )}
      <ConfirmModal
        visible={confirmVisible}
        title={t("boards.confirm.title")}
        body={t("boards.confirm.body")}
        confirmLabel={t("boards.confirm.confirm")}
        cancelLabel={t("boards.confirm.cancel")}
        destructive
        onConfirm={handleRemove}
        onCancel={() => setConfirmVisible(false)}
        testID="profile-remove-name-confirm"
      />
    </View>
  );
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
      // Remembered for the stats screen opened offline later (#2635).
      fetchAndRememberMyStats(() => withRetry(() => statsApi.getMyStats())),
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

  const gameSummaries = useMemo(() => (stats ? deriveGameSummaries(stats, t) : null), [stats, t]);
  const bentoTiles = useMemo(
    () => (stats && gameSummaries ? deriveBentoTiles(stats, gameSummaries, t) : null),
    [stats, gameSummaries, t]
  );

  const renderItem = useCallback(
    ({ item }: { item: GameRow }) => {
      const title = gameTitle(t, item.game_type);
      const { value, labelKey } = gameMetric(item);
      const metric = formatMetric(t, labelKey, value);
      const outcome = knownOutcome(item.outcome);
      const outcomeText = outcomeLabel(t, item.outcome);
      const date = formatDate(t, item.completed_at ?? item.started_at);
      return (
        <Pressable
          onPress={() => navigation.navigate("GameDetail", { gameId: item.id })}
          style={[styles.row, { borderBottomColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel={t("recentGames.rowA11y", {
            game: title,
            metric,
            outcome: outcomeText,
            date,
          })}
          testID={`recent-game-${item.id}`}
        >
          <View style={styles.rowLine}>
            <Text style={[styles.rowGame, { color: colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.rowMetric, { color: colors.text }]}>{metric}</Text>
          </View>
          <View style={styles.rowLine}>
            <Text style={[styles.rowDate, { color: colors.textMuted }]}>{date}</Text>
            <View style={styles.rowOutcome}>
              {outcome && (
                <MaterialCommunityIcons
                  name={outcome.icon}
                  size={16}
                  color={colors[outcome.color]}
                  testID={`outcome-glyph-${item.outcome}`}
                />
              )}
              <Text style={[styles.rowOutcomeText, { color: colors.textMuted }]}>
                {outcomeText}
              </Text>
            </View>
          </View>
        </Pressable>
      );
    },
    [colors, navigation, t]
  );

  const listHeader = (
    <View>
      {/* Server XP as-is, unlike the bento's visible-games re-derivation (#2390): a store
          build talks to the production database, where the hidden games were never played,
          and every other build shows all twelve games (#2417). The null check covers an
          API that predates the XP fields (a rolled-back or lagging deploy). */}
      {stats?.arcade_level != null && (
        <LevelProgress
          level={stats.arcade_level}
          totalXp={stats.arcade_xp}
          xpIntoLevel={stats.xp_into_level}
          xpForNextLevel={stats.xp_for_next_level}
        />
      )}
      {bentoTiles && (
        <View style={styles.bento}>
          {bentoTiles.map((tile) => (
            <View
              key={tile.key}
              testID={`profile-tile-${tile.key}`}
              accessible
              accessibilityLabel={`${tile.label}: ${tile.value}`}
              style={[styles.bentoCard, { backgroundColor: colors.surfaceAlt }]}
            >
              <Text style={[styles.bentoLabel, { color: colors.textMuted }]}>{tile.label}</Text>
              <Text
                style={[styles.bentoValue, { color: colors.text }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {tile.value}
              </Text>
            </View>
          ))}
        </View>
      )}
      {gameSummaries && gameSummaries.length > 0 && (
        <View>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
            {t("byGame.title")}
          </Text>
          <View style={[styles.gamesCard, { backgroundColor: colors.surfaceAlt }]}>
            <View
              style={styles.gameRow}
              // Column headings; each row's label already names its values.
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text
                style={[styles.gameColHeader, styles.gameTitleCol, { color: colors.textMuted }]}
              >
                {t("byGame.game")}
              </Text>
              <Text
                style={[styles.gameColHeader, styles.gameValueCol, { color: colors.textMuted }]}
              >
                {t("byGame.best")}
              </Text>
              <Text style={[styles.gameColHeader, styles.gameRateCol, { color: colors.textMuted }]}>
                {t("byGame.winRate")}
              </Text>
            </View>
            {gameSummaries.map((row) => {
              const rate = row.winRate != null ? formatPercent(t, row.winRate) : "—";
              return (
                <View
                  key={row.game}
                  testID={`profile-game-${row.game}`}
                  accessible
                  accessibilityLabel={t(
                    row.winRate != null ? "byGame.rowA11y" : "byGame.rowA11yNoWins",
                    {
                      game: row.title,
                      best: row.best ?? t("byGame.noBest"),
                      winRate: rate,
                    }
                  )}
                  style={[
                    styles.gameRow,
                    { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
                  ]}
                >
                  <Text
                    style={[styles.gameTitle, styles.gameTitleCol, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {row.title}
                  </Text>
                  <Text
                    style={[styles.gameValue, styles.gameValueCol, { color: colors.text }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {row.best ?? "—"}
                  </Text>
                  <Text
                    style={[styles.gameValue, styles.gameRateCol, { color: colors.text }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {rate}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
        {t("recentGames.title")}
      </Text>
      {gamesError && (
        <Text style={[styles.sectionErrorText, { color: colors.error }]}>
          {t("recentGames.loadError")}
        </Text>
      )}
    </View>
  );

  let body: React.ReactNode;
  if (loading) {
    body = <EmptyState kind="loading" />;
  } else if (error) {
    body = (
      <EmptyState
        kind="error"
        message={t("recentGames.loadError")}
        retry={{
          label: t("recentGames.retry"),
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
        testID="profile-list"
        data={visibleGames}
        keyExtractor={(g) => g.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          !gamesError ? (
            <EmptyState kind="empty" layout="inline" message={t("recentGames.empty")} />
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
      <ConnectedOfflineBanner style={styles.offlineBannerWrap} />
      <View
        style={[
          styles.displayNameCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <DisplayNameField
          testID="profile-display-name"
          label={t("displayName.label")}
          helper={t("displayName.helper")}
        />
        <LeaderboardPresence />
      </View>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  offlineBannerWrap: { marginHorizontal: 16, marginTop: 12 },
  displayNameCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  presence: { marginTop: 8, gap: 4 },
  presenceText: { fontFamily: typography.body, fontSize: 13 },
  removeButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    minHeight: 44,
  },
  removeText: {
    fontFamily: typography.bodyMedium,
    fontSize: 14,
    textDecorationLine: "underline",
  },
  bento: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
    gap: 12,
  },
  bentoCard: {
    flexGrow: 1,
    flexBasis: "45%",
    minHeight: 84,
    padding: 14,
    borderRadius: 16,
  },
  bentoLabel: {
    fontFamily: typography.label,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  bentoValue: { fontFamily: typography.heading, fontSize: 22 },
  sectionTitle: {
    fontFamily: typography.label,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  gamesCard: {
    marginHorizontal: 12,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 16,
  },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 8,
  },
  gameColHeader: {
    fontFamily: typography.label,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1.0,
  },
  gameTitleCol: { flex: 1 },
  gameValueCol: { width: 112, textAlign: "right" },
  gameRateCol: { width: 76, textAlign: "right" },
  gameTitle: { fontFamily: typography.bodyMedium, fontSize: 14 },
  gameValue: { fontFamily: typography.heading, fontSize: 14, fontVariant: ["tabular-nums"] },
  listContent: { paddingBottom: 32 },
  sectionErrorText: {
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  rowLine: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowGame: { fontFamily: typography.bodyMedium, fontSize: 14, flex: 1 },
  rowMetric: { fontFamily: typography.heading, fontSize: 14, fontVariant: ["tabular-nums"] },
  rowDate: { fontFamily: typography.body, fontSize: 12, flex: 1 },
  rowOutcome: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowOutcomeText: { fontFamily: typography.body, fontSize: 12 },
});

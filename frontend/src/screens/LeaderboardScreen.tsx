import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { GameLeaderboardEntry } from "../api/stats";
import type { BoardDefinition, GameType } from "../api/vocab";
import { AppHeader, APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { EmptyState } from "../components/shared/EmptyState";
import {
  initialPartition,
  partitionChoices,
  partitionGroupLabel,
  partitionValueLabel,
} from "../components/leaderboard/partitions";
import { partitionKey, type Partition } from "../game/_shared/boardPartition";
import { flushDisplayNameSync } from "../game/_shared/displayNameSync";
import { flushQueuedGames } from "../game/_shared/flushQueuedGames";
import { openableBoard } from "../game/_shared/leaderboardAvailability";
import { useLeaderboardData } from "../hooks/useLeaderboardData";
import { gameTitle } from "../i18n/gameTitle";
import { useTheme, type Colors } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import type { LeaderboardParams } from "../types/navigation";
import { formatDate } from "../utils/formatTimestamp";

/** Metric labels the boards declare (`BoardDefinition.labelKey`). */
const METRIC_LABEL_KEYS = new Set(["score", "moves", "level"]);

export interface LeaderboardScreenProps {
  /** `Leaderboard` in the Home stack, the screen's only route (#2634). */
  route: { params: LeaderboardParams };
  navigation: {
    goBack: () => void;
    addListener?: (event: "focus" | "blur", callback: () => void) => () => void;
  };
}

/**
 * One game's leaderboard (#2633): the top players on one board, one entry
 * each (their best), with a picker for partitioned games (Sudoku's difficulty
 * and variant, Star Swarm's tier). The player's own row is highlighted; when
 * they are outside the list, their best entry is pinned below it with its
 * exact rank. A player with no entry (no display name, or no eligible game)
 * sees no "Your best".
 *
 * Opened from the result card's "View leaderboard" link and the game's ⋯
 * menu (`useLeaderboardLink`), only for games with an openable board.
 */
export default function LeaderboardScreen({ route, navigation }: LeaderboardScreenProps) {
  // The route's params are required by type, but a restored or hand-built
  // navigation state can still arrive without them: show "no leaderboard"
  // rather than crash.
  const params = route.params as LeaderboardParams | undefined;
  if (!params?.gameType) return <NoBoard navigation={navigation} />;
  return <GameLeaderboard params={params} navigation={navigation} />;
}

function NoBoard({ navigation }: Pick<LeaderboardScreenProps, "navigation">) {
  const { t } = useTranslation(["leaderboard", "common"]);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
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
        title={t("common:overflow.menu.leaderboard")}
        onBack={() => navigation.goBack()}
        requireBack
      />
      <EmptyState kind="empty" message={t("leaderboard:unavailable")} />
    </View>
  );
}

function GameLeaderboard({
  params: { gameType, partition, refreshAfterSync },
  navigation,
}: {
  params: LeaderboardParams;
  navigation: LeaderboardScreenProps["navigation"];
}) {
  const board = openableBoard(gameType);
  // The screen's strings and the game's own (its title; Sudoku's partition
  // labels are in it), not every game's bundle.
  const { t } = useTranslation(["leaderboard", gameType]);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const game = gameTitle(t, gameType);
  const title = t("leaderboard:title", { game });

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
        title={title}
        onBack={() => navigation.goBack()}
        requireBack
        backAccessibilityLabel={t("leaderboard:a11y.back", { game })}
      />
      {board ? (
        <Board
          // New params (the same route opened for another board) start afresh.
          key={`${gameType}:${partitionKey(partition)}`}
          gameType={gameType}
          board={board}
          requested={partition}
          refreshAfterSync={!!refreshAfterSync}
          navigation={navigation}
          t={t}
          colors={colors}
        />
      ) : (
        <EmptyState kind="empty" message={t("leaderboard:unavailable")} />
      )}
    </View>
  );
}

function Board({
  gameType,
  board,
  requested,
  refreshAfterSync,
  navigation,
  t,
  colors,
}: {
  gameType: GameType;
  board: BoardDefinition;
  requested?: Partition;
  refreshAfterSync: boolean;
  navigation: LeaderboardScreenProps["navigation"];
  t: TFunction;
  colors: Colors;
}) {
  const [partition, setPartition] = useState<Partition>(() =>
    initialPartition(gameType, board, requested)
  );
  const { status, entries, me, refreshing, retry, refresh } = useLeaderboardData(
    gameType,
    partition
  );
  // Timers and listeners below call the latest refresh (the current partition's).
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Coming back to the board (from another tab or screen) shows it as it is
  // now. Only a return counts: the mount's own focus is its first load.
  useEffect(() => {
    const addListener = navigation.addListener;
    if (!addListener) return;
    let left = false;
    const offBlur = addListener("blur", () => {
      left = true;
    });
    const offFocus = addListener("focus", () => {
      if (!left) return;
      left = false;
      refreshRef.current();
    });
    return () => {
      offBlur?.();
      offFocus?.();
    };
  }, [navigation]);

  // Opened from a card whose rank was still pending: the game (or the
  // player's name) may not be on the server yet. Ask again once they are.
  useEffect(() => {
    if (!refreshAfterSync) return;
    let alive = true;
    void Promise.all([flushQueuedGames(), flushDisplayNameSync().catch(() => false)]).then(() => {
      if (alive) refreshRef.current();
    });
    return () => {
      alive = false;
    };
  }, [refreshAfterSync]);

  const metricLabel = t(
    `leaderboard:metric.${METRIC_LABEL_KEYS.has(board.labelKey) ? board.labelKey : "score"}`
  );
  const meInList = entries.some((e) => e.is_me);

  const renderItem = useCallback(
    ({ item }: { item: GameLeaderboardEntry }) => (
      <EntryRow entry={item} metricLabel={metricLabel} t={t} colors={colors} />
    ),
    [metricLabel, t, colors]
  );

  let body: React.ReactNode;
  if (status === "loading") {
    body = <EmptyState kind="loading" />;
  } else if (status === "error" || status === "offline") {
    body = (
      <EmptyState
        kind="error"
        message={t(status === "offline" ? "leaderboard:offline" : "leaderboard:error")}
        retry={{ label: t("leaderboard:retry"), onPress: retry }}
      />
    );
  } else {
    body = (
      <>
        <FlatList
          testID="leaderboard-list"
          data={entries}
          keyExtractor={(e, i) => `${e.rank}-${i}`}
          renderItem={renderItem}
          accessibilityRole="list"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
          }
          ListHeaderComponent={
            entries.length > 0 ? (
              <ColumnHeader metricLabel={metricLabel} t={t} colors={colors} />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState kind="empty" layout="inline" message={t("leaderboard:empty")} />
          }
          contentContainerStyle={styles.listContent}
        />
        {me && !meInList ? (
          <View
            testID="leaderboard-your-best"
            style={[
              styles.yourBest,
              { borderTopColor: colors.border, backgroundColor: colors.surface },
            ]}
          >
            <Text style={[styles.yourBestLabel, { color: colors.textMuted }]}>
              {t("leaderboard:yourBest")}
            </Text>
            <EntryRow entry={me} metricLabel={metricLabel} t={t} colors={colors} pinned />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <>
      {board.partitions.length > 0 ? (
        <View style={styles.pickers}>
          {board.partitions.map((key) => (
            <PartitionChips
              key={key}
              gameType={gameType}
              board={board}
              partitionKey={key}
              value={partition[key]}
              onChange={(value) => setPartition((p) => ({ ...p, [key]: value }))}
              t={t}
              colors={colors}
            />
          ))}
        </View>
      ) : null}
      {board.direction === "asc" ? (
        <Text testID="leaderboard-direction" style={[styles.hint, { color: colors.textMuted }]}>
          {t("leaderboard:direction.asc")}
        </Text>
      ) : null}
      {body}
    </>
  );
}

function PartitionChips({
  gameType,
  board,
  partitionKey,
  value,
  onChange,
  t,
  colors,
}: {
  gameType: GameType;
  board: BoardDefinition;
  partitionKey: string;
  value: string | undefined;
  onChange: (value: string) => void;
  t: TFunction;
  colors: Colors;
}) {
  const choices = useMemo(
    () => partitionChoices(gameType, board, partitionKey),
    [gameType, board, partitionKey]
  );
  const groupLabel = partitionGroupLabel(t, gameType, partitionKey);
  return (
    <View style={styles.pickerRow}>
      <Text style={[styles.pickerLabel, { color: colors.textMuted }]}>{groupLabel}</Text>
      <ScrollView
        testID={`leaderboard-partition-${partitionKey}`}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        accessibilityRole="radiogroup"
        accessibilityLabel={groupLabel}
      >
        {choices.map((choice) => {
          const selected = choice === value;
          const label = partitionValueLabel(t, gameType, partitionKey, choice);
          return (
            <Pressable
              key={choice}
              testID={`leaderboard-chip-${partitionKey}-${choice}`}
              onPress={() => onChange(choice)}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              hitSlop={{ top: 6, bottom: 6 }}
              style={[
                styles.chip,
                selected
                  ? { backgroundColor: colors.accent, borderColor: colors.accent }
                  : { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text
                style={[styles.chipText, { color: selected ? colors.textOnAccent : colors.text }]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ColumnHeader({
  metricLabel,
  t,
  colors,
}: {
  metricLabel: string;
  t: TFunction;
  colors: Colors;
}) {
  // Each row announces its own labels, so the column header is visual only.
  return (
    <View
      testID="leaderboard-columns"
      style={[styles.row, styles.headerRow, { borderBottomColor: colors.border }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.colRank, styles.headerCell, { color: colors.textMuted }]}>
        {t("leaderboard:column.rank")}
      </Text>
      <Text style={[styles.colName, styles.headerCell, { color: colors.textMuted }]}>
        {t("leaderboard:column.player")}
      </Text>
      <Text style={[styles.colValue, styles.headerCell, { color: colors.textMuted }]}>
        {metricLabel}
      </Text>
      <Text style={[styles.colDate, styles.headerCell, { color: colors.textMuted }]}>
        {t("leaderboard:column.date")}
      </Text>
    </View>
  );
}

function EntryRow({
  entry,
  metricLabel,
  t,
  colors,
  pinned = false,
}: {
  entry: GameLeaderboardEntry;
  metricLabel: string;
  t: TFunction;
  colors: Colors;
  pinned?: boolean;
}) {
  const mine = !!entry.is_me;
  const value = entry.value.toLocaleString();
  const date = formatDate(entry.completed_at);
  const a11yLabel = pinned
    ? t("leaderboard:a11y.yourBest", { rank: entry.rank, metric: metricLabel, value, date })
    : t(mine ? "leaderboard:a11y.rowYou" : "leaderboard:a11y.row", {
        rank: entry.rank,
        name: entry.player_name,
        metric: metricLabel,
        value,
        date,
      });
  return (
    <View
      testID={pinned ? "leaderboard-row-pinned" : mine ? "leaderboard-row-me" : undefined}
      accessible
      accessibilityLabel={a11yLabel}
      style={[
        styles.row,
        { borderBottomColor: colors.border },
        mine && !pinned && { backgroundColor: colors.outcomeEndedTint },
        mine && { borderLeftColor: colors.accent, borderLeftWidth: 3 },
      ]}
    >
      <Text style={[styles.colRank, styles.rank, { color: colors.textMuted }]}>{entry.rank}</Text>
      <View style={styles.colName}>
        <Text
          style={[styles.name, { color: colors.text }, mine && styles.nameMine]}
          numberOfLines={1}
        >
          {entry.player_name}
        </Text>
        {mine ? (
          <Text style={[styles.youTag, { color: colors.outcomeEnded }]}>
            {t("leaderboard:you")}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.colValue, styles.value, { color: colors.text }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.colDate, styles.date, { color: colors.textMuted }]}>{date}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pickers: { paddingTop: 8, gap: 6 },
  pickerRow: { gap: 4 },
  pickerLabel: {
    fontFamily: typography.label,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingHorizontal: 16,
  },
  chips: { gap: 8, paddingHorizontal: 16, paddingVertical: 2 },
  chip: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontFamily: typography.label, fontSize: 13 },
  hint: {
    fontFamily: typography.bodyMedium,
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  listContent: { paddingBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: { paddingVertical: 8 },
  headerCell: {
    fontFamily: typography.label,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  colRank: { width: 36, textAlign: "center" },
  colName: { flex: 1, minWidth: 0 },
  colValue: { minWidth: 56, textAlign: "right" },
  colDate: { width: 88, textAlign: "right" },
  rank: { fontFamily: typography.heading, fontSize: 14, fontVariant: ["tabular-nums"] },
  name: { fontFamily: typography.body, fontSize: 14 },
  nameMine: { fontFamily: typography.label },
  youTag: {
    fontFamily: typography.label,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  value: { fontFamily: typography.heading, fontSize: 15, fontVariant: ["tabular-nums"] },
  date: { fontFamily: typography.body, fontSize: 12 },
  yourBest: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  yourBestLabel: {
    fontFamily: typography.label,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingHorizontal: 16,
  },
});

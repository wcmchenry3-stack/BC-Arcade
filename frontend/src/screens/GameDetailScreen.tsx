import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { GAME_TITLE_NAMESPACES, gameTitle } from "../i18n/gameTitle";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { EmptyState } from "../components/shared/EmptyState";
import { useTheme } from "../theme/ThemeContext";
import { AppHeader, APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { statsApi } from "../api/stats";
import type { GameDetailResponse } from "../api/types";
import { formatMetric, gameMetric, outcomeLabel } from "../api/outcomeDisplay";
import type { ProfileStackParamList } from "../types/navigation";
import { formatTimestamp } from "../utils/formatTimestamp";
import { ApiError, isNetworkError } from "../game/_shared/httpClient";
import { GameDetailSections } from "../components/gameDetail/GameDetailSections";

/**
 * Why the detail couldn't load. `unavailable` is the server refusing it (403:
 * another player's game; 404: not synced yet, or gone): asking again won't
 * help, and nothing about the game is shown.
 */
type LoadError = "offline" | "unavailable" | "failed";

function loadErrorOf(e: unknown): LoadError {
  if (isNetworkError(e)) return "offline";
  if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return "unavailable";
  return "failed";
}

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, "GameDetail">;
  route: RouteProp<ProfileStackParamList, "GameDetail">;
};

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

export default function GameDetailScreen({ navigation, route }: Props) {
  const { gameId } = route.params;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(["profile", "stats", ...GAME_TITLE_NAMESPACES]);

  const [detail, setDetail] = useState<GameDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await statsApi.getGameDetail(gameId, false);
      setDetail(d);
    } catch (e) {
      setDetail(null);
      setError(loadErrorOf(e));
    }
  }, [gameId]);

  const retry = useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

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

  let body: React.ReactNode;
  if (loading) {
    body = <EmptyState kind="loading" />;
  } else if (error || !detail) {
    body = (
      <EmptyState
        kind="error"
        message={t(error === "offline" ? "detail.offline" : "detail.loadError")}
        retry={error === "unavailable" ? undefined : { label: t("stats:retry"), onPress: retry }}
        testID="game-detail-error"
      />
    );
  } else {
    const metric = gameMetric(detail);
    body = (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.card, { backgroundColor: colors.surfaceAlt }]}>
          <DetailRow
            label={t("detail.gameType")}
            value={gameTitle(t, detail.game_type)}
            colors={colors}
          />
          <DetailRow
            label={t("detail.score")}
            // The board's metric with its label, as Profile's recent games show it.
            value={formatMetric(t, metric.labelKey, metric.value)}
            colors={colors}
          />
          <DetailRow
            label={t("detail.outcome")}
            value={outcomeLabel(t, detail.outcome)}
            colors={colors}
          />
          <DetailRow
            label={t("detail.duration")}
            value={formatDuration(detail.duration_ms)}
            colors={colors}
          />
          <DetailRow
            label={t("detail.startedAt")}
            value={formatTimestamp(t, detail.started_at)}
            colors={colors}
          />
          <DetailRow
            label={t("detail.completedAt")}
            value={formatTimestamp(t, detail.completed_at)}
            colors={colors}
            isLast
          />
        </View>
        <GameDetailSections detail={detail} />
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
      <AppHeader title={t("detail.title")} requireBack onBack={() => navigation.goBack()} />
      {body}
    </View>
  );
}

function DetailRow({
  label,
  value,
  colors,
  isLast,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>["colors"];
  isLast?: boolean;
}) {
  return (
    <View
      style={[
        styles.detailRow,
        !isLast && {
          borderBottomColor: colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <Text style={[styles.detailLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16 },
  card: {
    borderRadius: 16,
    padding: 8,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.0,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
});

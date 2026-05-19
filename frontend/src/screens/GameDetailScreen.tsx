import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useTheme } from "../theme/ThemeContext";
import { AppHeader, APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { statsApi } from "../api/stats";
import type { GameDetailResponse } from "../api/types";
import type { ProfileStackParamList } from "../types/navigation";
import { formatTimestamp } from "../utils/formatTimestamp";

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, "GameDetail">;
  route: RouteProp<ProfileStackParamList, "GameDetail">;
};

function formatGameType(raw: string): string {
  switch (raw) {
    case "twenty48":
      return "2048";
    case "blackjack":
      return "Blackjack";
    case "yacht":
      return "Yacht";
    case "cascade":
      return "Cascade";
    default:
      return raw;
  }
}

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
  const { t } = useTranslation("profile");

  const [detail, setDetail] = useState<GameDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await statsApi.getGameDetail(gameId, false);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [gameId]);

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
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" accessibilityLabel="Loading" />
      </View>
    );
  } else if (error || !detail) {
    body = (
      <View style={styles.center}>
        <Text style={[styles.errorText, { color: colors.error }]}>{t("detail.loadError")}</Text>
      </View>
    );
  } else {
    body = (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.card, { backgroundColor: colors.surfaceAlt }]}>
          <DetailRow
            label={t("detail.gameType")}
            value={formatGameType(detail.game_type)}
            colors={colors}
          />
          <DetailRow
            label={t("detail.score")}
            value={detail.final_score != null ? detail.final_score.toLocaleString() : "—"}
            colors={colors}
          />
          <DetailRow label={t("detail.outcome")} value={detail.outcome ?? "—"} colors={colors} />
          <DetailRow
            label={t("detail.duration")}
            value={formatDuration(detail.duration_ms)}
            colors={colors}
          />
          <DetailRow
            label={t("detail.startedAt")}
            value={formatTimestamp(detail.started_at)}
            colors={colors}
          />
          <DetailRow
            label={t("detail.completedAt")}
            value={formatTimestamp(detail.completed_at)}
            colors={colors}
            isLast
          />
        </View>
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 14, textAlign: "center" },
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

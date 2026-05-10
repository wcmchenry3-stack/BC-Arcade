import React, { useCallback } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { HomeStackParamList } from "../../App";
import { useTheme } from "../theme/ThemeContext";
import { useBlackjackGame } from "../game/blackjack/BlackjackGameContext";
import { TABLE_CONFIGS } from "../game/blackjack/tables";
import { GameShell } from "../components/shared/GameShell";

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, "BlackjackVictory">;
};

export default function BlackjackVictoryScreen({ navigation }: Props) {
  const { t } = useTranslation(["blackjack"]);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { engine, sessionStats, handleCashOut, handleKeepPlaying, handleTableSelect } =
    useBlackjackGame();

  const activeTable =
    TABLE_CONFIGS.find((tc) => tc.betMin === engine?.betMin && tc.betMax === engine?.betMax) ??
    TABLE_CONFIGS[0]!;
  const tableIndex = TABLE_CONFIGS.indexOf(activeTable);
  const nextTable = TABLE_CONFIGS[tableIndex + 1];

  const winRate =
    sessionStats.handsPlayed > 0
      ? Math.round((sessionStats.handsWon / sessionStats.handsPlayed) * 100)
      : 0;

  const netPL = engine ? engine.chips - engine.startingChips : 0;

  const onCashOut = useCallback(async () => {
    await handleCashOut();
    navigation.replace("BlackjackBetting");
  }, [handleCashOut, navigation]);

  // End the run then immediately start the next table — bypasses TableSelectPanel.
  const onNextTable = useCallback(async () => {
    if (!nextTable) return;
    await handleCashOut();
    handleTableSelect(nextTable);
    navigation.replace("BlackjackBetting");
  }, [handleCashOut, handleTableSelect, nextTable, navigation]);

  const onKeepPlaying = useCallback(() => {
    handleKeepPlaying();
    navigation.replace("BlackjackBetting");
  }, [handleKeepPlaying, navigation]);

  return (
    <GameShell
      title={t("blackjack:game.title")}
      requireBack
      onBack={() => navigation.popToTop()}
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero section */}
        <View style={styles.hero}>
          <Text style={[styles.heroTitle, { color: colors.accent }]}>
            {t("blackjack:victory.title")}
          </Text>
          <Text style={[styles.heroSubtitle, { color: colors.textMuted }]}>
            {t("blackjack:victory.subtitle", {
              table: t(activeTable.labelKey as Parameters<typeof t>[0]),
            })}
          </Text>
        </View>

        {/* Chip count */}
        <View
          style={[styles.chipCard, { backgroundColor: colors.surface, borderColor: colors.accent }]}
        >
          <Text style={[styles.chipCount, { color: colors.accent }]}>
            {t("blackjack:victory.chipsLabel", {
              chips: engine?.chips?.toLocaleString() ?? "—",
            })}
          </Text>
          <Text style={[styles.chipGoal, { color: colors.textMuted }]}>
            {t("blackjack:victory.goalLine", {
              goal: engine?.runGoal?.toLocaleString() ?? "—",
            })}
          </Text>
        </View>

        {/* Stats */}
        <View style={[styles.statsCard, { backgroundColor: colors.surface }]}>
          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>
              {t("blackjack:victory.statsHands", { hands: sessionStats.handsPlayed })}
            </Text>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {t("blackjack:victory.statsWinRate", { winRate })}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>
              {t("blackjack:victory.statsBiggestWin")}
            </Text>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {t("blackjack:victory.statsBiggestWinAmount", { amount: sessionStats.biggestWin })}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>
              {t("blackjack:victory.statsNetPL")}
            </Text>
            <Text style={[styles.statValue, { color: netPL >= 0 ? colors.accent : colors.error }]}>
              {netPL >= 0
                ? t("blackjack:victory.statsNetPLPositive", { amount: netPL })
                : t("blackjack:victory.statsNetPLNegative", { amount: netPL })}
            </Text>
          </View>
        </View>

        {/* CTAs */}
        <View style={styles.actions}>
          {nextTable ? (
            <>
              <Pressable
                style={[styles.btn, { backgroundColor: colors.accent }]}
                onPress={onNextTable}
                accessibilityRole="button"
                accessibilityLabel={t("blackjack:victory.nextTableLabel", {
                  table: t(nextTable.labelKey as Parameters<typeof t>[0]),
                })}
              >
                <Text style={[styles.btnText, { color: colors.surface }]}>
                  {t("blackjack:victory.nextTable", {
                    table: t(nextTable.labelKey as Parameters<typeof t>[0]),
                  })}
                </Text>
              </Pressable>

              <Pressable
                style={[styles.btn, styles.btnSecondary, { borderColor: colors.border }]}
                onPress={onKeepPlaying}
                accessibilityRole="button"
                accessibilityLabel={t("blackjack:victory.keepPlayingLabel")}
              >
                <Text style={[styles.btnText, { color: colors.text }]}>
                  {t("blackjack:victory.keepPlaying")}
                </Text>
              </Pressable>

              <Pressable
                style={styles.cashOutLink}
                onPress={onCashOut}
                accessibilityRole="button"
                accessibilityLabel={t("blackjack:victory.cashOutLabel")}
              >
                <Text style={[styles.cashOutLinkText, { color: colors.textMuted }]}>
                  {t("blackjack:victory.cashOut")}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={[styles.btn, { backgroundColor: colors.accent }]}
                onPress={onCashOut}
                accessibilityRole="button"
                accessibilityLabel={t("blackjack:victory.cashOutLabel")}
              >
                <Text style={[styles.btnText, { color: colors.surface }]}>
                  {t("blackjack:victory.cashOut")}
                </Text>
              </Pressable>

              <Pressable
                style={[styles.btn, styles.btnSecondary, { borderColor: colors.border }]}
                onPress={onKeepPlaying}
                accessibilityRole="button"
                accessibilityLabel={t("blackjack:victory.keepPlayingLabel")}
              >
                <Text style={[styles.btnText, { color: colors.text }]}>
                  {t("blackjack:victory.keepPlaying")}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
    gap: 20,
  },
  hero: {
    alignItems: "center",
    gap: 6,
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  heroSubtitle: {
    fontSize: 15,
    fontWeight: "500",
    textAlign: "center",
  },
  chipCard: {
    width: "100%",
    maxWidth: 320,
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: 2,
    gap: 4,
  },
  chipCount: {
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  chipGoal: {
    fontSize: 13,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  statsCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  statLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  statValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  actions: {
    width: "100%",
    maxWidth: 320,
    gap: 12,
    alignItems: "center",
  },
  btn: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  btnText: {
    fontSize: 16,
    fontWeight: "700",
  },
  cashOutLink: {
    paddingVertical: 8,
  },
  cashOutLinkText: {
    fontSize: 13,
    fontWeight: "500",
    textDecorationLine: "underline",
  },
});

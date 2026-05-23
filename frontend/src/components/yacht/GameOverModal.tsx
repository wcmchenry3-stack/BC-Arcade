import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  ViewStyle,
  TextStyle,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import {
  UPPER_CATEGORY_KEYS,
  LOWER_CATEGORY_KEYS,
  CATEGORY_I18N_KEY,
} from "../../game/yacht/categories";

interface GameOverModalProps {
  visible: boolean;
  totalScore: number;
  upperBonus: number;
  yachtBonusCount: number;
  yachtBonusTotal: number;
  scores: Record<string, number | null>;
  onPlayAgain: () => void;
  onDismiss: () => void;
  vsResult?: "win" | "lose" | "tie";
  aiTotalScore?: number;
  aiUpperBonus?: number;
  aiScores?: Record<string, number | null>;
}

function fmtScore(val: number | null | undefined): string {
  return val != null ? String(val) : "—";
}

export default function GameOverModal({
  visible,
  totalScore,
  upperBonus,
  yachtBonusCount,
  yachtBonusTotal,
  scores,
  onPlayAgain,
  onDismiss,
  vsResult,
  aiTotalScore,
  aiUpperBonus,
  aiScores,
}: GameOverModalProps) {
  const { t } = useTranslation("yacht");
  const { colors } = useTheme();
  const { height: screenHeight } = useWindowDimensions();

  const isVs = !!aiScores;

  const scoreGlow: TextStyle | null =
    Platform.OS === "web"
      ? ({ textShadow: `0 0 18px ${colors.accent}66, 0 0 6px ${colors.accent}` } as TextStyle)
      : null;

  const playAgainBg: ViewStyle =
    Platform.OS === "web"
      ? ({
          backgroundImage: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBright})`,
          boxShadow: `0 0 24px ${colors.accent}55`,
        } as ViewStyle)
      : { backgroundColor: colors.accentBright };

  function renderScoreRow(cat: string) {
    return (
      <View key={cat} style={styles.scoreRow}>
        <Text style={[styles.rowLabel, { color: colors.textMuted }]} numberOfLines={1}>
          {t(CATEGORY_I18N_KEY[cat])}
        </Text>
        <Text style={[styles.rowVal, { color: colors.text }]}>{fmtScore(scores[cat])}</Text>
        {isVs && (
          <Text style={[styles.rowVal, { color: colors.textMuted }]}>
            {fmtScore(aiScores?.[cat])}
          </Text>
        )}
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" accessibilityViewIsModal>
      <View style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.75)" }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceHigh,
              borderColor: colors.border,
              borderTopColor: colors.accent,
              maxHeight: screenHeight * 0.88,
            },
          ]}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {vsResult ? (
              <Text
                style={[
                  styles.title,
                  {
                    color:
                      vsResult === "win"
                        ? colors.bonus
                        : vsResult === "lose"
                          ? colors.textMuted
                          : colors.text,
                  },
                ]}
                accessibilityRole="header"
              >
                {vsResult === "win"
                  ? t("gameOver.youWin")
                  : vsResult === "lose"
                    ? t("gameOver.computerWins")
                    : t("gameOver.tie")}
              </Text>
            ) : (
              <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
                {t("gameOver.title")}
              </Text>
            )}
            <Text style={[styles.scoreLabel, { color: colors.textMuted }]}>
              {t("gameOver.finalScore")}
            </Text>
            <Text
              style={[styles.scoreValue, { color: colors.accent }, scoreGlow]}
              accessibilityLabel={t("gameOver.scoreLabel", { score: totalScore })}
            >
              {totalScore}
            </Text>
            {vsResult !== undefined && aiTotalScore !== undefined && (
              <Text style={[styles.aiScoreRow, { color: colors.textMuted }]}>
                {t("score.opponent")}: {aiTotalScore}
              </Text>
            )}
            {(upperBonus > 0 || yachtBonusTotal > 0) && (
              <View style={styles.bonusStack}>
                {upperBonus > 0 && (
                  <View
                    style={[
                      styles.bonusPill,
                      { backgroundColor: colors.surfaceAlt, borderColor: colors.bonus },
                    ]}
                  >
                    <Text style={[styles.bonusText, { color: colors.bonus }]}>
                      {t("gameOver.upperBonus")}
                    </Text>
                  </View>
                )}
                {yachtBonusTotal > 0 && (
                  <View
                    style={[
                      styles.bonusPill,
                      { backgroundColor: colors.surfaceAlt, borderColor: colors.bonus },
                    ]}
                  >
                    <Text style={[styles.bonusText, { color: colors.bonus }]}>
                      {t("gameOver.yachtBonus", {
                        count: yachtBonusCount,
                        total: yachtBonusTotal,
                      })}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Scorecard section */}
            <View style={[styles.scorecardDivider, { backgroundColor: colors.border }]} />
            <Text style={[styles.scorecardHeader, { color: colors.textMuted }]}>
              {t("gameOver.scorecard")}
            </Text>

            <View style={styles.scorecardContainer}>
              {isVs && (
                <View style={styles.scoreRow}>
                  <Text style={[styles.rowLabel, { color: "transparent" }]}>-</Text>
                  <Text style={[styles.colHeader, { color: colors.textMuted }]}>
                    {t("score.you")}
                  </Text>
                  <Text style={[styles.colHeader, { color: colors.textMuted }]}>
                    {t("vsMode.cpu")}
                  </Text>
                </View>
              )}

              <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
                {t("section.upper")}
              </Text>
              {UPPER_CATEGORY_KEYS.map(renderScoreRow)}
              <View style={[styles.subtotalRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.subtotalLabel, { color: colors.textMuted }]}>
                  {t("score.bonusRow")}
                </Text>
                <Text
                  style={[
                    styles.subtotalVal,
                    { color: upperBonus > 0 ? colors.bonus : colors.textMuted },
                  ]}
                >
                  {upperBonus > 0 ? "+35" : "—"}
                </Text>
                {isVs && (
                  <Text
                    style={[
                      styles.subtotalVal,
                      { color: (aiUpperBonus ?? 0) > 0 ? colors.bonus : colors.textMuted },
                    ]}
                  >
                    {(aiUpperBonus ?? 0) > 0 ? "+35" : "—"}
                  </Text>
                )}
              </View>

              <Text style={[styles.sectionLabel, { color: colors.textMuted, marginTop: 8 }]}>
                {t("section.lower")}
              </Text>
              {LOWER_CATEGORY_KEYS.map(renderScoreRow)}

              <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.totalLabel, { color: colors.text }]}>
                  {t("section.total")}
                </Text>
                <Text style={[styles.totalVal, { color: colors.accent }]}>{totalScore}</Text>
                {isVs && (
                  <Text style={[styles.totalVal, { color: colors.text }]}>{aiTotalScore}</Text>
                )}
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.playAgainButton,
                playAgainBg,
                { transform: [{ scale: pressed ? 0.96 : 1 }] },
              ]}
              onPress={onPlayAgain}
              accessibilityRole="button"
              accessibilityLabel={t("gameOver.playAgainLabel")}
            >
              <Text style={[styles.playAgainText, { color: colors.textOnAccent }]}>
                {t("gameOver.playAgain")}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.dismissButton, { borderColor: colors.border }]}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={t("gameOver.dismissLabel")}
            >
              <Text style={[styles.dismissText, { color: colors.textMuted }]}>
                {t("gameOver.dismiss")}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderTopWidth: 3,
    width: "86%",
    maxWidth: 340,
    overflow: "hidden",
  },
  scroll: {
    width: "100%",
  },
  scrollContent: {
    alignItems: "center",
    padding: 28,
    paddingBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  scoreLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  scoreValue: {
    fontSize: 64,
    fontWeight: "900",
    lineHeight: 70,
    marginBottom: 12,
  },
  bonusStack: {
    gap: 6,
    marginBottom: 4,
    alignItems: "center",
  },
  bonusPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  bonusText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  aiScoreRow: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: -4,
  },
  scorecardDivider: {
    height: 1,
    alignSelf: "stretch",
    marginVertical: 16,
  },
  scorecardHeader: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 8,
    alignSelf: "flex-start",
  },
  scorecardContainer: {
    alignSelf: "stretch",
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 2,
    marginTop: 4,
  },
  scoreRow: {
    flexDirection: "row",
    paddingVertical: 3,
    alignItems: "center",
  },
  rowLabel: {
    flex: 3,
    fontSize: 11,
  },
  rowVal: {
    flex: 1.5,
    fontSize: 11,
    fontWeight: "600",
    textAlign: "right",
  },
  colHeader: {
    flex: 1.5,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    textAlign: "right",
  },
  subtotalRow: {
    flexDirection: "row",
    paddingVertical: 4,
    alignItems: "center",
    borderTopWidth: 1,
    marginTop: 2,
  },
  subtotalLabel: {
    flex: 3,
    fontSize: 11,
    fontWeight: "700",
  },
  subtotalVal: {
    flex: 1.5,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "right",
  },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 5,
    alignItems: "center",
    borderTopWidth: 1,
    marginTop: 4,
  },
  totalLabel: {
    flex: 3,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  totalVal: {
    flex: 1.5,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "right",
  },
  playAgainButton: {
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: 999,
    marginTop: 16,
  },
  playAgainText: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  dismissButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 12,
    borderWidth: 1,
  },
  dismissText: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
});

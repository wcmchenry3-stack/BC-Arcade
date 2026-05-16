import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  ViewStyle,
  TextStyle,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";

interface GameOverModalProps {
  visible: boolean;
  totalScore: number;
  upperBonus: number;
  yachtBonusCount: number;
  yachtBonusTotal: number;
  onPlayAgain: () => void;
  onDismiss: () => void;
  vsResult?: "win" | "lose" | "tie";
  aiTotalScore?: number;
}

export default function GameOverModal({
  visible,
  totalScore,
  upperBonus,
  yachtBonusCount,
  yachtBonusTotal,
  onPlayAgain,
  onDismiss,
  vsResult,
  aiTotalScore,
}: GameOverModalProps) {
  const { t } = useTranslation("yacht");
  const { colors } = useTheme();

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
            },
          ]}
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
                  : t("gameOver.title")}
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
    padding: 28,
    alignItems: "center",
    width: "86%",
    maxWidth: 340,
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
    marginBottom: 18,
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
  playAgainButton: {
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: 999,
    marginTop: 4,
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
  aiScoreRow: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: -4,
  },
});

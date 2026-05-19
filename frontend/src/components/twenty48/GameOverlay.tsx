import React from "react";
import { View, Text, Pressable, StyleSheet, Platform, ViewStyle, TextStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

interface GameOverlayProps {
  type: "game_over" | "win";
  score: number;
  onNewGame: () => void;
  onKeepPlaying?: () => void;
  onHome: () => void;
}

export default function GameOverlay({
  type,
  score,
  onNewGame,
  onKeepPlaying,
  onHome,
}: GameOverlayProps) {
  const { t } = useTranslation(["twenty48", "common"]);
  const { colors } = useTheme();

  const isWin = type === "win";
  const title = isWin ? t("twenty48:win.title") : t("twenty48:gameOver.title");
  const body = isWin ? t("twenty48:win.body") : t("twenty48:gameOver.body", { score });

  const accentColor = isWin ? colors.accent : colors.secondary;

  // Backdrop blur on web for depth.
  const backdropExtra: ViewStyle =
    Platform.OS === "web" ? ({ backdropFilter: "blur(8px)" } as ViewStyle) : {};

  // Gradient CTA — web uses CSS linear-gradient, native falls back to solid.
  const ctaStyle: ViewStyle =
    Platform.OS === "web"
      ? ({
          backgroundImage: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBright})`,
          boxShadow: `0 0 24px ${colors.accent}55`,
        } as ViewStyle)
      : { backgroundColor: colors.accentBright };

  // Score glow on web.
  const scoreGlow: TextStyle =
    Platform.OS === "web"
      ? ({
          textShadow: `0 0 18px ${accentColor}66, 0 0 6px ${accentColor}`,
        } as TextStyle)
      : {};

  return (
    <View style={[styles.backdrop, { backgroundColor: "rgba(0,0,0,0.75)" }, backdropExtra]}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surfaceHigh,
            borderColor: colors.border,
            borderTopColor: accentColor,
          },
        ]}
        accessibilityRole="dialog"
        accessibilityViewIsModal
      >
        <Text
          style={[styles.title, { color: colors.text, fontFamily: typography.heading }]}
          accessibilityRole="header"
        >
          {title}
        </Text>

        <Text style={[styles.scoreLabel, { color: colors.textMuted }]}>
          {t("twenty48:score.label")}
        </Text>
        <Text
          style={[styles.scoreValue, { color: accentColor }, scoreGlow]}
          accessibilityLabel={t("twenty48:score.accessibilityLabel", { score })}
        >
          {score}
        </Text>

        <Text style={[styles.body, { color: colors.textMuted }]}>{body}</Text>

        <View style={styles.buttons}>
          {isWin && onKeepPlaying && (
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                ctaStyle,
                { transform: [{ scale: pressed ? 0.96 : 1 }] },
              ]}
              onPress={onKeepPlaying}
              accessibilityRole="button"
              accessibilityLabel={t("twenty48:actions.keepPlayingLabel")}
            >
              <Text style={[styles.btnText, { color: colors.textOnAccent }]}>
                {t("twenty48:actions.keepPlaying")}
              </Text>
            </Pressable>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.btn,
              isWin ? styles.outlineBtn : ctaStyle,
              isWin ? { borderColor: colors.border } : null,
              { transform: [{ scale: !isWin && pressed ? 0.96 : 1 }] },
            ]}
            onPress={onNewGame}
            accessibilityRole="button"
            accessibilityLabel={t("twenty48:actions.newGameLabel")}
          >
            <Text style={[styles.btnText, { color: isWin ? colors.text : colors.textOnAccent }]}>
              {t("twenty48:actions.newGame")}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.btn, styles.outlineBtn, { borderColor: colors.border }]}
            onPress={onHome}
            accessibilityRole="button"
            accessibilityLabel={t("twenty48:actions.quitLabel")}
          >
            <Text style={[styles.btnText, { color: colors.textMuted }]}>
              {t("twenty48:gameOver.home")}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderTopWidth: 3,
    padding: 28,
    width: "85%",
    maxWidth: 340,
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  scoreLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  scoreValue: {
    fontSize: 64,
    fontWeight: "900",
    lineHeight: 70,
    marginBottom: 4,
  },
  body: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  buttons: {
    width: "100%",
    gap: 10,
  },
  btn: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  outlineBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  btnText: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});

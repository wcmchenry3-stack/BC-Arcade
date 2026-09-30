import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

export interface JoinLeaderboardsPromptProps {
  /**
   * Joins the leaderboards (the player's explicit opt-in). Resolves false when
   * the join couldn't be stored; the prompt then shows an error.
   */
  onJoin?: () => Promise<boolean> | void;
  testID?: string;
}

/**
 * The result card's one-time "Join leaderboards" prompt (#2778). Players never
 * type a public name: joining gives them one the server generates, which they
 * can change for another generated name, or leave with, in Profile.
 */
export default function JoinLeaderboardsPrompt({ onJoin, testID }: JoinLeaderboardsPromptProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("result");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleJoin() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await onJoin?.();
    setBusy(false);
    if (ok === false) setFailed(true);
  }

  return (
    <View testID={testID} style={styles.container}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{t("namePrompt.label")}</Text>
      <Text style={[styles.helper, { color: colors.text }]}>{t("namePrompt.helper")}</Text>
      <Pressable
        onPress={handleJoin}
        disabled={busy}
        testID={testID ? `${testID}-join` : undefined}
        accessibilityRole="button"
        accessibilityLabel={t("namePrompt.join")}
        accessibilityState={{ disabled: busy, busy }}
        style={[styles.joinBtn, { backgroundColor: colors.accentBright, opacity: busy ? 0.4 : 1 }]}
      >
        <Text style={[styles.joinText, { color: colors.textOnAccent }]}>
          {t("namePrompt.join")}
        </Text>
      </Pressable>
      {failed && (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[styles.helper, { color: colors.error }]}
        >
          {t("namePrompt.joinError")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  label: {
    fontFamily: typography.label,
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  helper: { fontFamily: typography.body, fontSize: 13 },
  joinBtn: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  joinText: { fontFamily: typography.label, fontSize: 15 },
});

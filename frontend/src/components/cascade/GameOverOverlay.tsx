import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Modal,
} from "react-native";
import { useTranslation } from "react-i18next";
import { cascadeApi, ScoreEntry } from "../../game/cascade/api";
import { ApiError, isNetworkError } from "../../game/_shared/httpClient";
import { useTheme } from "../../theme/ThemeContext";
import { useNetwork } from "../../game/_shared/NetworkContext";
import { scoreQueue } from "../../game/_shared/scoreQueue";
import { OfflineBanner } from "../shared/OfflineBanner";

interface Props {
  score: number;
  gameId: string | null;
  onRestart: () => void;
}

export default function GameOverOverlay({ score, gameId, onRestart }: Props) {
  const { t } = useTranslation("cascade");
  const { colors } = useTheme();
  const { isOnline, isInitialized } = useNetwork();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<ScoreEntry | null>(null);
  const [savedLocally, setSavedLocally] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) return;
    if (!gameId) {
      setError(t("errors:score.save"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const playerName = name.trim();
    // If we know we're offline, skip the fetch and queue immediately.
    if (isInitialized && !isOnline) {
      try {
        await scoreQueue.enqueue("cascade", { game_id: gameId, player_name: playerName });
        setSavedLocally(true);
      } catch {
        setError(t("errors:score.save"));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    try {
      const entry = await cascadeApi.submitPlayerName(gameId, playerName);
      setSubmitted(entry);
    } catch (e) {
      // Network/fetch failures (isNetworkError) and transient server errors (429)
      // are queued for automatic retry when connectivity/rate-limits allow.
      // Permanent application errors fall through to the generic message.
      const isTransient = isNetworkError(e) || (e instanceof ApiError && e.status === 429);
      if (isTransient) {
        try {
          await scoreQueue.enqueue("cascade", { game_id: gameId, player_name: playerName });
          setSavedLocally(true);
        } catch {
          setError(t("errors:score.save"));
        }
      } else {
        setError(t("errors:score.save"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal transparent animationType="fade" accessibilityViewIsModal>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surfaceHigh }]}>
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {t("gameOver.title")}
          </Text>
          <Text
            style={[styles.score, { color: colors.accent }]}
            accessibilityLabel={t("gameOver.scoreLabel", { score: score.toLocaleString() })}
          >
            {score.toLocaleString()}
          </Text>
          <Text
            style={[styles.scoreLabel, { color: colors.textMuted }]}
            importantForAccessibility="no"
          >
            {t("gameOver.points")}
          </Text>

          {!submitted && !savedLocally ? (
            <>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: "transparent",
                    color: colors.text,
                  },
                ]}
                placeholder={t("gameOver.namePlaceholder")}
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
                maxLength={32}
                editable={!submitting}
                accessibilityLabel={t("gameOver.nameLabel")}
                accessibilityHint={t("gameOver.nameHint")}
              />
              {error && (
                <Text
                  style={[styles.error, { color: colors.error }]}
                  accessibilityLiveRegion="assertive"
                  accessibilityRole="alert"
                >
                  {error}
                </Text>
              )}
              <Pressable
                style={[
                  styles.btn,
                  { backgroundColor: colors.accent, opacity: submitting ? 0.6 : 1 },
                ]}
                onPress={handleSubmit}
                disabled={submitting || !name.trim()}
                accessibilityRole="button"
                accessibilityLabel={t("gameOver.saveLabel")}
                accessibilityState={{ disabled: submitting || !name.trim(), busy: submitting }}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>{t("gameOver.saveButton")}</Text>
                )}
              </Pressable>
            </>
          ) : savedLocally ? (
            <OfflineBanner />
          ) : (
            <Text style={[styles.saved, { color: colors.bonus }]}>
              {t("gameOver.savedConfirmation", { rank: submitted!.rank })}
            </Text>
          )}

          <Pressable
            style={[styles.restartBtn, { borderColor: colors.accent }]}
            onPress={onRestart}
            accessibilityRole="button"
            accessibilityLabel={t("gameOver.playAgain")}
          >
            <Text style={[styles.restartText, { color: colors.accent }]}>
              {t("gameOver.playAgainButton")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(14,14,19,0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
  },
  score: {
    fontSize: 52,
    fontWeight: "800",
    lineHeight: 56,
  },
  scoreLabel: {
    fontSize: 14,
    marginTop: -8,
  },
  input: {
    width: "100%",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 16,
    marginTop: 8,
  },
  error: {
    fontSize: 13,
  },
  btn: {
    width: "100%",
    padding: 14,
    borderRadius: 20,
    alignItems: "center",
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  saved: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: 4,
  },
  restartBtn: {
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 10,
    borderWidth: 1,
  },
  restartText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
